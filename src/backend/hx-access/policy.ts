// HXBot：最大权限（存为 access "workspace"）的判定规则。
//
// An agent at 最大权限 does almost everything without asking: it reads anywhere, writes and deletes in
// its workspace roots (its workspace, the shared folder, the folders the user added and the temporary
// folders), creates new files anywhere, runs commands, uses websites, the screen, web search and
// Computer Use. A few things need the user's confirmation, given once ("允许一次") or for good
// ("始终允许", a rule for every agent): changing a file that exists outside the workspace roots,
// deleting outside them, reading or writing where keys and logins are kept, a command that runs as
// administrator (sudo) or deletes what cannot be told, and filling in a card (every payment). Since
// v1.6.8 signing in with a saved Vault password and deleting a Vault item ask nothing (the user,
// 2026-11-14), so no tool asks for those two kinds any more; rules of those kinds made before stay
// readable. This module only decides; it changes nothing and has no state.
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type AccessAction = "read" | "write" | "delete";
export const ACCESS_ACTIONS: readonly AccessAction[] = ["read", "write", "delete"];

export type AccessTargetType =
  | "folder"
  | "file"
  | "website"
  | "command"
  | "screen"
  | "search"
  | "password"
  | "payment"
  | "vault";
export const ACCESS_TARGET_TYPES: readonly AccessTargetType[] = [
  "folder",
  "file",
  "website",
  "command",
  "screen",
  "search",
  "password",
  "payment",
  "vault",
];

export interface AccessTarget {
  type: AccessTargetType;
  /**
   * An absolute path, a website address or host (also for password and payment), a command or its
   * first words ("*" for any), a Vault item id ("*" for any), or "" for screen and search.
   */
  value: string;
}

export interface AccessGrant {
  id: string;
  /** The agent, or "*" for a rule that holds for every agent (始终允许). */
  agentId: string;
  /** The provider thread and turn the grant belongs to, or "*" for a rule. */
  threadId: string;
  turnId: string;
  targets: readonly AccessTarget[];
  actions: readonly AccessAction[];
  reason: string;
  purpose: string;
  grantedAt: number;
  /** 允许一次: each target covers one use, then it is gone. A rule is never once. */
  once: boolean;
}

export type AccessOperation =
  | { kind: "path"; action: AccessAction; path: string }
  | { kind: "site"; action: "read" | "write"; url: string }
  | {
      kind: "command";
      command: string;
      /** It deletes, and what it deletes cannot be told. */
      deletes: boolean;
      /** It runs as administrator (sudo, su, doas, runas). */
      elevates: boolean;
      /** The words of the parts that need the confirmation, for a prefix grant such as `sudo apt`. */
      parts: readonly (readonly string[])[];
    }
  | { kind: "screen" }
  | { kind: "search" }
  | { kind: "password"; site: string }
  | { kind: "payment"; site: string }
  | { kind: "vault"; item: string };

export interface AccessContext {
  /** The workspace roots, absolute. */
  roots: readonly string[];
  /** The grants of the agent's task and the rules for every agent. */
  grants: readonly AccessGrant[];
  /** Where keys and logins are kept: reading or writing there needs a confirmation. Absolute. */
  protectedRoots?: readonly string[];
  platform?: NodeJS.Platform;
  /** Whether a path exists; a test passes its own. */
  exists?: (path: string) => boolean;
}

/** A grant target that an allowed operation used: a once grant loses it. */
export interface AccessUse {
  grantId: string;
  target: number;
}

/** For each operation: "free", the grant target that covers it, or null when it needs a confirmation. */
export type AccessCover = "free" | AccessUse | null;

export type AccessDecision =
  | { allowed: true; used: AccessUse[]; covers: AccessCover[] }
  | { allowed: false; missing: AccessOperation[]; covers: AccessCover[] };

function pathApi(platform: NodeJS.Platform | undefined) {
  return (platform ?? process.platform) === "win32" ? win32 : posix;
}

/**
 * The real location of `path`: symlinks resolved for the part that exists, the rest appended. A link
 * in the workspace that points outside it is outside, so it cannot carry a write out.
 */
function realLocation(path: string, platform?: NodeJS.Platform): string {
  const api = pathApi(platform);
  const absolute = api.resolve(path);
  let existing = absolute;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(existing);
      return rest.length > 0 ? api.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = api.dirname(existing);
      if (parent === existing) return absolute;
      rest.push(api.basename(existing));
      existing = parent;
    }
  }
}

/** True when `path` is `root` or inside it. Both are absolute. */
function isInside(path: string, root: string, platform?: NodeJS.Platform): boolean {
  const api = pathApi(platform);
  const relative = api.relative(root, path);
  const windows = (platform ?? process.platform) === "win32";
  const inside = relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative));
  // Windows paths do not care about case.
  if (!inside && windows) return isInside(path.toLowerCase(), root.toLowerCase(), "linux");
  return inside;
}

/** The host of a website address or a bare host, in lower case without "www.". Null when there is none. */
export function siteHost(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//u.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./u, "").replace(/\.$/u, "");
  return host || null;
}

/** True when `host` is the granted host or a subdomain of it. */
function hostCovered(host: string, granted: string): boolean {
  return host === granted || host.endsWith(`.${granted}`);
}

/**
 * Where keys and logins are kept, under the home folder: ssh, cloud and package registry keys, the
 * macOS keychains, the browsers' profiles with their cookies and saved passwords, and `extra` (HXBot's
 * own data folder with its Vault). Reading or writing there needs a confirmation even at 最大权限.
 */
export function hxProtectedRoots(home: string = homedir(), extra: readonly string[] = [], platform?: NodeJS.Platform) {
  const api = pathApi(platform);
  const relative = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".git-credentials",
    ".config/gcloud",
    ".config/gh",
    ".config/google-chrome",
    ".config/chromium",
    ".config/microsoft-edge",
    ".config/BraveSoftware",
    ".mozilla",
    "Library/Keychains",
    "Library/Cookies",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Microsoft Edge",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Firefox",
    "Library/Safari",
    "AppData/Local/Google/Chrome/User Data",
    "AppData/Local/Microsoft/Edge/User Data",
    "AppData/Local/BraveSoftware",
    "AppData/Roaming/Mozilla",
    "AppData/Roaming/Microsoft/Credentials",
    "AppData/Roaming/Microsoft/Protect",
  ];
  return [...relative.map((path) => api.join(home, ...path.split("/"))), ...extra];
}

function grantsCovering(
  context: AccessContext,
  test: (target: AccessTarget, grant: AccessGrant) => boolean,
): AccessUse | null {
  for (const grant of context.grants) {
    const index = grant.targets.findIndex((target) => test(target, grant));
    if (index >= 0) return { grantId: grant.id, target: index };
  }
  return null;
}

function pathCovered(context: AccessContext, action: AccessAction, path: string): AccessUse | null {
  const platform = context.platform;
  return grantsCovering(context, (target, grant) => {
    if (!grant.actions.includes(action)) return false;
    if (target.type !== "folder" && target.type !== "file") return false;
    const granted = realLocation(target.value, platform);
    return target.type === "folder" ? isInside(path, granted, platform) : path === granted;
  });
}

function insideAny(roots: readonly string[], path: string, platform?: NodeJS.Platform): boolean {
  return roots.some((root) => isInside(path, realLocation(root, platform), platform));
}

/** The words of a command prefix grant, or "*" for any command. */
function commandWords(value: string): string[] {
  return tokenize(value)?.words ?? [];
}

/** A part of a command, such as `sudo apt install x`, covered by a command grant: "*", its first words, or the whole command. */
function commandCovered(context: AccessContext, operation: Extract<AccessOperation, { kind: "command" }>) {
  const normalized = operation.command.replace(/\s+/gu, " ").trim();
  const whole = grantsCovering(
    context,
    (target) =>
      target.type === "command" &&
      (target.value.trim() === "*" || target.value.replace(/\s+/gu, " ").trim() === normalized),
  );
  if (whole) return whole;
  if (operation.parts.length === 0) return null;
  let first: AccessUse | null = null;
  for (const part of operation.parts) {
    const use = grantsCovering(context, (target) => {
      if (target.type !== "command") return false;
      const words = commandWords(target.value);
      if (words.length === 0) return false;
      return (
        programName(part[0] ?? "") === programName(words[0] ?? "") &&
        words.slice(1).every((word, index) => part[index + 1] === word)
      );
    });
    if (!use) return null;
    first ??= use;
  }
  return first;
}

/** Decides a list of operations. Every one must be allowed; the result lists those that are not. */
export function decideAccess(context: AccessContext, operations: readonly AccessOperation[]): AccessDecision {
  const covers = operations.map((operation) => operationCover(context, operation));
  const missing = operations.filter((_operation, index) => covers[index] === null);
  if (missing.length > 0) return { allowed: false, missing, covers };
  const used = covers.filter((cover): cover is AccessUse => cover !== null && cover !== "free");
  return { allowed: true, used, covers };
}

/** True when `path` is in the workspace roots and not where keys are kept: reading and writing there is plain work. */
export function insideWorkspaceRoots(context: AccessContext, path: string): boolean {
  const real = realLocation(path, context.platform);
  return (
    !insideAny(context.protectedRoots ?? [], real, context.platform) && insideAny(context.roots, real, context.platform)
  );
}

/** Where an operation sits: "free", the grant target that covers it, or null when it needs a confirmation. */
function operationCover(context: AccessContext, operation: AccessOperation): AccessCover {
  const platform = context.platform;
  switch (operation.kind) {
    case "path": {
      const path = realLocation(operation.path, platform);
      const guarded = insideAny(context.protectedRoots ?? [], path, platform);
      const inside = !guarded && insideAny(context.roots, path, platform);
      if (operation.action === "read" && !guarded) return "free";
      if (operation.action === "write") {
        if (inside) return "free";
        // A new file outside is fine; changing one that is there needs a confirmation.
        const exists = context.exists ?? existsSync;
        if (!guarded && !exists(path)) return "free";
      }
      if (operation.action === "delete" && inside) return "free";
      return pathCovered(context, operation.action, path);
    }
    case "site":
    case "screen":
    case "search":
      return "free";
    case "command":
      if (!operation.deletes && !operation.elevates) return "free";
      return commandCovered(context, operation);
    case "password":
    case "payment": {
      const host = siteHost(operation.site);
      const type = operation.kind;
      return grantsCovering(context, (target) => {
        if (target.type !== type) return false;
        if (target.value.trim() === "*") return type === "password";
        const granted = siteHost(target.value);
        return host !== null && granted !== null && hostCovered(host, granted);
      });
    }
    case "vault":
      return grantsCovering(
        context,
        (target) => target.type === "vault" && (target.value === "*" || target.value === operation.item),
      );
  }
}

// ---------------------------------------------------------------- commands

/** Programs that only read, and the paths they read (a key file read this way needs a confirmation). */
const READ_ONLY_PROGRAMS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "stat",
  "file",
  "du",
  "tree",
  "pwd",
  "echo",
  "printf",
  "which",
  "whoami",
  "date",
  "uname",
  "sort",
  "uniq",
  "cut",
  "tr",
  "jq",
  "diff",
  "cmp",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "true",
  "false",
  "test",
  "nl",
  "md5sum",
  "sha256sum",
  "shasum",
  "find",
  "sed",
  "git",
]);
/** Git subcommands that only read. */
const GIT_READ = new Set(["status", "log", "diff", "show", "ls-files", "rev-parse", "blame", "describe"]);
/** Programs whose first argument that is not an option is a pattern, not a path. */
const PATTERN_FIRST = new Set(["grep", "egrep", "fgrep", "rg", "jq"]);
/** Programs that delete their arguments. */
const DELETE_PROGRAMS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "srm",
  "trash",
  "del",
  "erase",
  "rd",
  "remove-item",
  "ri",
  "rimraf",
]);
/** Programs that run the rest of the command as administrator. */
const ELEVATE_PROGRAMS = new Set(["sudo", "su", "doas", "pkexec", "runas", "gsudo"]);
/** Programs that change the files they name. The value says which operands: all, the last, or all but the first. */
const MODIFY_PROGRAMS: Readonly<Record<string, "all" | "last" | "rest">> = {
  touch: "all",
  mkdir: "all",
  truncate: "all",
  tee: "all",
  chmod: "rest",
  chown: "rest",
  chgrp: "rest",
  chattr: "rest",
  cp: "last",
  mv: "last",
  ln: "last",
  install: "last",
  rsync: "last",
  scp: "last",
};
const DELETE_WORD = /(^|[^A-Za-z0-9_-])(rm|rmdir|unlink|shred|del|erase|rd|remove-item|rimraf)([^A-Za-z0-9_-]|$)/iu;
const ELEVATE_WORD = /(^|[^A-Za-z0-9_-])(sudo|doas|pkexec|runas|gsudo)([^A-Za-z0-9_-]|$)|(^|[\s;&|(])su(\s|$)/iu;

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh"]);
const POWERSHELLS = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe"]);

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function programName(word: string): string {
  const base = word.split(/[\\/]/u).pop() ?? word;
  return base.toLowerCase().replace(/\.exe$/u, "");
}

interface Tokens {
  words: string[];
  /**
   * For each word, whether the shell changes it before the program sees it: a variable, `~user`, a
   * brace list or a cmd `%VAR%`. Such a word names a place that cannot be told here.
   */
  expands: boolean[];
  /** The command has a substitution, a subshell or a background job: it cannot be read word by word. */
  complex: boolean;
}

/** The characters after `$` that make a shell expansion. */
const EXPANSION_START = /[A-Za-z0-9_{?@*#!$'"-]/u;

/**
 * Shell-like words: quotes and backslashes join, operators split. The operators `&&`, `||`, `;`, `|`,
 * `&` and a newline become their own words; redirections become ">" words followed by their target.
 * Null when the quotes do not close.
 */
function tokenize(command: string): Tokens | null {
  const words: string[] = [];
  const expands: boolean[] = [];
  let current = "";
  let started = false;
  let expanding = false;
  let quote: "'" | '"' | null = null;
  let complex = false;
  const operator = (word: string) => {
    words.push(word);
    expands.push(false);
  };
  const push = () => {
    if (started) {
      words.push(current);
      expands.push(expanding || /%[A-Za-z_][A-Za-z0-9_]*%/u.test(current));
    }
    current = "";
    started = false;
    expanding = false;
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    const next = command[index + 1] ?? "";
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && (next === '"' || next === "\\" || next === "$" || next === "`")) {
        current += next;
        index += 1;
      } else {
        if (char === "`" || (char === "$" && next === "(")) complex = true;
        else if (char === "$" && EXPANSION_START.test(next)) expanding = true;
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === "\\") {
      current += next;
      started = true;
      index += 1;
      continue;
    }
    if (char === "`" || (char === "$" && next === "(") || ((char === "<" || char === ">") && next === "(")) {
      complex = true;
      current += char;
      started = true;
      continue;
    }
    if (
      (char === "$" && EXPANSION_START.test(next)) ||
      (char === "{" && next !== "}") ||
      (char === "~" && !started && next !== "/" && next !== "" && next !== " " && next !== "\t")
    ) {
      expanding = true;
      current += char;
      started = true;
      continue;
    }
    if (char === " " || char === "\t") {
      push();
      continue;
    }
    if (char === "\n" || char === ";") {
      push();
      operator(";");
      continue;
    }
    if (char === "&" || char === "|") {
      push();
      if (next === char) {
        operator(char + next);
        index += 1;
      } else if (char === "&" && next === ">") {
        operator(">");
        index += 1;
        if (command[index + 1] === ">") index += 1;
      } else {
        if (char === "&") complex = true;
        operator(char);
      }
      continue;
    }
    if (char === ">" || (char === "<" && next !== "<")) {
      // A file descriptor number written just before belongs to the redirection.
      if (/^\d+$/u.test(current)) {
        current = "";
        started = false;
      }
      push();
      if (char === ">") {
        if (next === ">") index += 1;
        if (command[index + 1] === "&") {
          // 2>&1 duplicates a stream; it names no file.
          index += 1;
          while (/\d/u.test(command[index + 1] ?? "")) index += 1;
          continue;
        }
        operator(">");
      } else operator("<");
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) return null;
  push();
  return { words, expands, complex };
}

interface CommandSegment {
  words: string[];
  /** Only reads, and every path it reads. */
  readOnly: boolean;
  reads: string[];
  /** Files that it writes: redirections, and the files that cp, mv, touch, sed -i and the like change. */
  writes: string[];
  /** cp, mv, ln and install: the target, and the sources that land in it when it is a folder. */
  into?: { target: string; sources: string[] };
  /** mkdir: folders that it makes; one that is there already is not changed. */
  makesFolders?: string[];
  /** Files that it takes away: the sources of mv. */
  moves: string[];
  /** A delete program, or a read program used to delete (find -delete, git clean). */
  deletes: boolean;
  /** The paths that a delete program names, or null when it names none that can be told. */
  deleteTargets: string[] | null;
  /** It writes somewhere that cannot be told (a place the shell expands). */
  unknownWrite: boolean;
  /** It runs as administrator. */
  elevates: boolean;
  /** `cd` and `pushd`: the folder that the next parts run in, or null when it cannot be told. */
  changesDirectory?: string | null;
  /** The words as written, with sudo and its options: a confirmation for `sudo apt` matches them. */
  written: string[];
}

export interface CommandAnalysis {
  segments: CommandSegment[];
}

/** The inner command of a shell wrapper such as `bash -lc '…'` or `powershell -Command …`. */
function unwrapShell(words: string[]): string | null {
  const program = programName(words[0] ?? "");
  if (SHELLS.has(program)) {
    const flag = words.findIndex((word, index) => index > 0 && /^-[a-z]*c[a-z]*$/u.test(word));
    if (flag > 0 && words[flag + 1] !== undefined && flag + 2 === words.length) return words[flag + 1] ?? null;
  }
  if (POWERSHELLS.has(program)) {
    const flag = words.findIndex((word, index) => index > 0 && /^-(c|command)$/iu.test(word));
    if (flag > 0 && flag + 1 < words.length) return words.slice(flag + 1).join(" ");
  }
  if (program === "cmd") {
    const flag = words.findIndex((word, index) => index > 0 && /^\/c$/iu.test(word));
    if (flag > 0 && flag + 1 < words.length) return words.slice(flag + 1).join(" ");
  }
  return null;
}

/**
 * The parts of a command, each read as a program and its arguments. Null when the command cannot be
 * read safely: an unclosed quote, a substitution, a subshell or a background job. A null command needs
 * a command grant as a whole.
 */
export function analyzeCommand(command: string, depth = 0): CommandAnalysis | null {
  const tokens = tokenize(command);
  if (!tokens || tokens.complex || depth > 3) return null;
  const inner = unwrapShell(tokens.words);
  if (inner !== null) return analyzeCommand(inner, depth + 1);
  const segments: CommandSegment[] = [];
  let words: Word[] = [];
  const close = () => {
    if (words.length > 0) segments.push(segmentOf(words));
    words = [];
  };
  tokens.words.forEach((text, index) => {
    if (text === "&&" || text === "||" || text === ";" || text === "|") close();
    else words.push({ text, expands: tokens.expands[index] === true });
  });
  close();
  return { segments };
}

interface Word {
  text: string;
  expands: boolean;
}

/** Programs whose options can make them run another program or write a file. */
const RISKY_READ_OPTIONS: Readonly<Record<string, RegExp>> = {
  rg: /^--(pre|pre-glob|hostname-bin)(=|$)/u,
  sort: /^(-o|--output|--compress-program)/u,
  tree: /^-o$/u,
  git: /^--(no-index|ext-diff|textconv|output)(=|$)/u,
};

/** The path in an option such as `--file=/etc/x` or `-f/etc/x`, which the program reads. */
function optionPath(option: string): string | null {
  const equals = option.indexOf("=");
  const value = equals >= 0 ? option.slice(equals + 1) : /^-[A-Za-z]/u.test(option) ? option.slice(2) : "";
  return /^(~|\.|\/|[A-Za-z]:[\\/]|\\\\)/u.test(value) ? value : null;
}

function segmentOf(all: Word[]): CommandSegment {
  const writes: string[] = [];
  const inputs: string[] = [];
  let words: Word[] = [];
  // A redirection to a place that the shell expands writes somewhere that cannot be told.
  let unknownWrite = false;
  for (let index = 0; index < all.length; index += 1) {
    const word = all[index];
    if (!word) continue;
    if (word.text === ">" || word.text === "<") {
      const target = all[index + 1];
      index += 1;
      if (target === undefined) continue;
      if (word.text === "<") inputs.push(target.text);
      else if (target.expands) unknownWrite = true;
      else if (target.text !== "/dev/null" && target.text.toLowerCase() !== "nul") writes.push(target.text);
      continue;
    }
    words.push(word);
  }
  const base: Pick<CommandSegment, "writes" | "moves" | "deletes" | "deleteTargets" | "unknownWrite" | "elevates"> = {
    writes,
    moves: [],
    deletes: false,
    deleteTargets: null,
    unknownWrite,
    elevates: false,
  };
  // Environment assignments before the program.
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[0]?.text ?? "")) words.shift();
  const written = words.map((word) => word.text);
  // sudo and the like: the rest runs as administrator, and is read for what it does.
  let elevates = false;
  while (words.length > 0 && ELEVATE_PROGRAMS.has(programName(words[0]?.text ?? ""))) {
    elevates = true;
    words = words.slice(1);
    while (words.length > 0 && (words[0]?.text ?? "").startsWith("-")) {
      const option = words[0]?.text ?? "";
      words = words.slice(1);
      // sudo -u user, -g group, -C n, -D dir take a value.
      if (/^-[ugCDhpRrTt]$/u.test(option) && words.length > 0) words = words.slice(1);
    }
  }
  const texts = words.map((word) => word.text);
  const program = programName(texts[0] ?? "");
  const argWords = words.slice(1);
  const args = texts.slice(1);
  const options = args.filter((arg) => arg.startsWith("-"));
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const operandsExpand = argWords.some((word) => word.expands);
  const result = (fields: Partial<CommandSegment>): CommandSegment => ({
    words: texts,
    written,
    readOnly: false,
    reads: [],
    ...base,
    elevates,
    ...fields,
  });

  if (program === "cd" || program === "pushd") {
    const target = operands[0];
    return result({ changesDirectory: target !== undefined && !operandsExpand ? target : null });
  }
  if (DELETE_PROGRAMS.has(program)) {
    return result({ deletes: true, deleteTargets: operandsExpand ? null : operands });
  }
  if (program === "git") {
    // git clean takes away what is not tracked under its paths (the folder it runs in by default);
    // git rm takes away the files it names. With an option before the subcommand (-C, --work-tree)
    // the place cannot be told.
    const after = operands.slice(1);
    if (args[0] === "clean")
      return result({ deletes: true, deleteTargets: operandsExpand ? null : after.length > 0 ? after : ["."] });
    if (args[0] === "rm") return result({ deletes: true, deleteTargets: operandsExpand ? null : after });
    if (operands.includes("clean") || operands.includes("rm")) return result({ deletes: true });
  }
  if (program === "find" && args.some((arg) => /^-(delete|exec|execdir|ok|okdir)$/u.test(arg))) {
    // find deletes under the folder it starts in: with -delete, or a delete program after -exec.
    const executed = args.flatMap((arg, index) =>
      /^-(exec|execdir|ok|okdir)$/u.test(arg) ? [args[index + 1] ?? ""] : [],
    );
    const deletes = args.includes("-delete") || executed.some((name) => DELETE_PROGRAMS.has(programName(name)));
    if (!deletes) return result({});
    const start = operands[0] !== undefined && !/^[-(!)]/u.test(operands[0]) ? operands[0] : ".";
    return result({ deletes: true, deleteTargets: operandsExpand ? null : [start] });
  }
  const modify = MODIFY_PROGRAMS[program];
  if (modify) {
    if (operandsExpand) return result({ unknownWrite: true });
    // cp -t DIR and mv -t DIR name the target first.
    const targetOption = args.findIndex((arg) => arg === "-t" || arg === "--target-directory");
    const files = operands.filter((operand) => !/^[a-z]+:\/\//iu.test(operand) && !/^[^/]+@[^:]+:/u.test(operand));
    let changed: string[];
    let sources: string[] = [];
    if (targetOption >= 0 && args[targetOption + 1]) {
      changed = [args[targetOption + 1] ?? ""];
      sources = files.filter((file) => file !== changed[0]);
    } else if (modify === "last") {
      changed = files.slice(-1);
      sources = files.slice(0, -1);
    } else if (modify === "rest") changed = files.slice(1);
    else changed = files;
    if (program === "rsync" && options.some((option) => option.startsWith("--delete")))
      return result({ writes: [...writes, ...changed], deletes: true, deleteTargets: changed, moves: [] });
    if (program === "mkdir") return result({ makesFolders: changed });
    if (
      (program === "cp" || program === "mv" || program === "ln" || program === "install") &&
      changed[0] &&
      sources.length > 0
    )
      return result({
        into: { target: changed[0], sources },
        moves: program === "mv" ? sources : [],
        reads: program === "mv" ? [] : sources,
      });
    return result({
      writes: [...writes, ...changed],
      moves: program === "mv" ? sources : [],
      reads: program === "mv" ? [] : sources,
    });
  }
  if (program === "sed" && options.some((option) => /^-[a-z]*i/u.test(option) || option.startsWith("--in-place"))) {
    if (operandsExpand) return result({ unknownWrite: true });
    const scripts = options.some((option) => option === "-e" || option === "--expression" || option === "-f");
    return result({ writes: [...writes, ...(scripts ? operands : operands.slice(1))] });
  }
  if (program === "dd") {
    const output = args.find((arg) => arg.startsWith("of="));
    if (output) return result({ writes: [...writes, output.slice(3)], unknownWrite: unknownWrite || operandsExpand });
  }
  let readOnly = READ_ONLY_PROGRAMS.has(program);
  // Git reads only with its subcommand first: an option before it can name another repository.
  if (program === "git") readOnly = GIT_READ.has(args[0] ?? "");
  if (program === "sed") readOnly = true;
  // uniq writes its second file.
  if (program === "uniq" && operands.length > 1) return result({ writes: [...writes, operands[1] ?? ""] });
  const risky = RISKY_READ_OPTIONS[program];
  if (risky && options.some((option) => risky.test(option))) readOnly = false;
  if (operandsExpand) readOnly = false;
  if (!readOnly) return result({});

  let paths = operands;
  if (PATTERN_FIRST.has(program) && !options.some((option) => option === "-e" || option === "-f"))
    paths = operands.slice(1);
  if (program === "git") paths = [];
  if (program === "sed") paths = operands.slice(1);
  if (program === "find")
    paths = operands.filter((operand, index) => index === 0 || !/^[-(!)]/u.test(operand)).slice(0, 1);
  if (
    ["echo", "printf", "which", "whoami", "date", "uname", "true", "false", "test", "basename", "dirname"].includes(
      program,
    )
  )
    paths = [];
  const optionPaths = options.map(optionPath).filter((path): path is string => path !== null);
  return result({ readOnly: true, reads: [...paths, ...optionPaths, ...inputs] });
}

/**
 * The operations of a command that runs in `cwd`: the files it reads, changes and deletes, as path
 * operations, and one command operation. That one needs a confirmation when the command runs as
 * administrator or deletes what cannot be told; otherwise it is free, like every command at 最大权限,
 * and is there for the activity record. A command that only reads has none. A command that HXBot
 * cannot read word by word needs the confirmation when it names sudo or a delete program.
 */
export function commandOperations(command: string, cwd: string, platform?: NodeJS.Platform): AccessOperation[] {
  const api = pathApi(platform);
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  const analysis = analyzeCommand(command);
  if (!analysis) {
    const deletes = DELETE_WORD.test(command);
    const elevates = ELEVATE_WORD.test(command);
    return [{ kind: "command", command, deletes, elevates, parts: [] }];
  }
  const operations: AccessOperation[] = [];
  const parts: string[][] = [];
  let deletes = false;
  let elevates = false;
  let readsOnly = true;
  let directory: string | null = cwd;
  const resolve = (path: string): string | null => {
    const expanded = path.replace(/^~(?=$|[\\/])/u, home);
    if (api.isAbsolute(expanded)) return api.resolve(expanded);
    return directory === null ? null : api.resolve(directory, expanded);
  };
  for (const segment of analysis.segments) {
    if (segment.changesDirectory !== undefined) {
      directory = segment.changesDirectory === null ? null : resolve(segment.changesDirectory);
      continue;
    }
    if (!segment.readOnly) readsOnly = false;
    let needs = false;
    if (segment.elevates) {
      elevates = true;
      needs = true;
    }
    for (const read of segment.reads) {
      const path = resolve(read);
      if (path) operations.push({ kind: "path", action: "read", path });
    }
    // A file in a folder that cannot be told (after `cd $DIR`) is changed or taken away somewhere unknown.
    for (const write of segment.writes) {
      const path = resolve(write);
      if (path) operations.push({ kind: "path", action: "write", path });
      else {
        deletes = true;
        needs = true;
      }
    }
    if (segment.into) {
      const target = resolve(segment.into.target);
      if (!target) {
        deletes = true;
        needs = true;
      } else if (isFolder(target))
        for (const source of segment.into.sources)
          operations.push({ kind: "path", action: "write", path: api.join(target, api.basename(source)) });
      else operations.push({ kind: "path", action: "write", path: target });
    }
    for (const folder of segment.makesFolders ?? []) {
      const path = resolve(folder);
      if (!path) {
        deletes = true;
        needs = true;
      } else if (!isFolder(path)) operations.push({ kind: "path", action: "write", path });
    }
    for (const moved of segment.moves) {
      const path = resolve(moved);
      if (path) operations.push({ kind: "path", action: "delete", path });
      else {
        deletes = true;
        needs = true;
      }
    }
    if (segment.deletes) {
      const targets = segment.deleteTargets;
      if (targets === null || targets.length === 0) {
        deletes = true;
        needs = true;
      } else {
        for (const target of targets) {
          const path = resolve(target);
          if (path) operations.push({ kind: "path", action: "delete", path });
          else {
            deletes = true;
            needs = true;
          }
        }
      }
    }
    if (segment.unknownWrite) {
      deletes = true;
      needs = true;
    }
    if (needs) parts.push(segment.written);
  }
  if (elevates || deletes || !readsOnly) operations.push({ kind: "command", command, deletes, elevates, parts });
  return operations;
}
