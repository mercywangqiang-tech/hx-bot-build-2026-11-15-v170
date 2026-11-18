// HXBot v1.7.1（Windows）：一个常驻的 PowerShell，回答停助手进程前“这棵进程树里有哪些进程”这类短问题。
//
// One start of PowerShell took 22 seconds on a Windows 11 ARM computer of GitHub, and about half a
// second of processor time on x64. The list of the process tree before a stop (v1.7.0,
// hx-process-keep.ts) may take 4 seconds: on ARM it never came back in time, so every stop fell back
// to `taskkill /T` and closed the apps that the agent had opened (Notepad, Word) with what was not
// saved in them. v1.7.1 stops idle agent processes more often (HX-Flow G6), which made it worse.
//
// So the first agent process on Windows starts one PowerShell below normal priority, and it stays
// while agents run; each question is one line on its input, and the answer ends with a line of its
// own. It is not ready while it starts: then, and when it does not answer in time, `ask` gives null
// and the caller does what it did before. After 10 minutes with no question it ends; HXBot ends it
// when it quits.
import { type ChildProcess, spawn } from "node:child_process";
import { constants, setPriority } from "node:os";
import { HX_POWERSHELL } from "./hx-computer/tables-win";

/** How long a PowerShell with no question stays. */
const HX_POWERSHELL_IDLE_MS = 10 * 60_000;
/** The longest answer, so a script that prints without end cannot fill the memory. */
const HX_POWERSHELL_MAX_ANSWER = 1024 * 1024;

interface Question {
  marker: string;
  resolve(answer: string | null): void;
  timer: ReturnType<typeof setTimeout>;
}

/** One line that runs a script of any length: the script goes as base64 of UTF-16, as -EncodedCommand. */
function hxPowerShellLine(script: string, env: Readonly<Record<string, string>>, marker: string): string {
  const assignments = Object.entries(env)
    .filter(([name]) => /^[A-Z_][A-Z0-9_]*$/u.test(name))
    .map(
      ([name, value]) =>
        `$env:${name}=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(value, "utf16le").toString("base64")}'))`,
    );
  const body = Buffer.from(script, "utf16le").toString("base64");
  return [
    ...assignments,
    `try { & ([ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${body}')))) } catch { }`,
    // Through the same output as the script, so the line comes after what the script printed.
    `Write-Output '${marker}'`,
  ].join("; ");
}

/** The text before the line `marker`, or null while that line has not come. */
function hxPowerShellAnswer(buffer: string, marker: string): { answer: string; rest: string } | null {
  const lines = buffer.split(/\r?\n/u);
  const index = lines.findIndex((line) => line.trim() === marker);
  if (index < 0) return null;
  return { answer: lines.slice(0, index).join("\n"), rest: lines.slice(index + 1).join("\n") };
}

class HxPowerShell {
  #child: ChildProcess | null = null;
  #ready = false;
  #buffer = "";
  #question: Question | null = null;
  #chain: Promise<unknown> = Promise.resolve();
  #count = 0;
  #idle: ReturnType<typeof setTimeout> | null = null;
  readonly #command: string;
  readonly #platform: NodeJS.Platform;

  constructor(command = HX_POWERSHELL, platform: NodeJS.Platform = process.platform) {
    this.#command = command;
    this.#platform = platform;
  }

  /** Starts the PowerShell when it is not there (Windows only). It is ready some seconds later. */
  warm(): void {
    if (this.#platform !== "win32") return;
    this.#touch();
    if (this.#child) return;
    let child: ChildProcess;
    try {
      child = spawn(
        this.#command,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
        {
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        },
      );
    } catch {
      return;
    }
    this.#child = child;
    this.#ready = false;
    this.#buffer = "";
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // It ended already, or the system refuses: it runs at the priority it has.
      }
    }
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.#read(chunk));
    child.once("error", () => this.#ended(child));
    child.once("exit", () => this.#ended(child));
    child.stdin?.on("error", () => this.#ended(child));
    // The first answer says that it is ready.
    const marker = this.#marker();
    this.#question = {
      marker,
      resolve: (answer) => {
        if (answer !== null && this.#child === child) this.#ready = true;
      },
      timer: setTimeout(() => this.close(), 120_000),
    };
    child.stdin?.write(`${hxPowerShellLine("", {}, marker)}\n`);
  }

  get ready(): boolean {
    return this.#ready;
  }

  /**
   * Runs a script and gives what it printed, or null when the PowerShell is not ready, ended, or did
   * not answer within `timeoutMs` (then it ends, and the next agent process starts it again).
   */
  ask(script: string, env: Readonly<Record<string, string>>, timeoutMs: number): Promise<string | null> {
    const next = this.#chain.then(() => this.#ask(script, env, timeoutMs));
    this.#chain = next.catch(() => null);
    return next;
  }

  #ask(script: string, env: Readonly<Record<string, string>>, timeoutMs: number): Promise<string | null> {
    const child = this.#child;
    if (!child || !this.#ready || !child.stdin) return Promise.resolve(null);
    this.#touch();
    return new Promise((resolve) => {
      const marker = this.#marker();
      this.#question = {
        marker,
        resolve,
        timer: setTimeout(() => {
          this.#question = null;
          resolve(null);
          // An answer that did not come in time could come later and mix with the next one.
          this.close();
        }, timeoutMs),
      };
      child.stdin?.write(`${hxPowerShellLine(script, env, marker)}\n`);
    });
  }

  /** Ends the PowerShell. A question that waits gets null. */
  close(): void {
    const child = this.#child;
    if (child) this.#ended(child);
    try {
      child?.kill();
    } catch {
      // It ended already.
    }
  }

  #marker(): string {
    this.#count += 1;
    return `HX-END-${process.pid}-${this.#count}`;
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    if (this.#buffer.length > HX_POWERSHELL_MAX_ANSWER) {
      this.close();
      return;
    }
    const question = this.#question;
    if (!question) return;
    const found = hxPowerShellAnswer(this.#buffer, question.marker);
    if (!found) return;
    this.#buffer = found.rest;
    this.#question = null;
    clearTimeout(question.timer);
    question.resolve(found.answer);
  }

  #ended(child: ChildProcess): void {
    if (this.#child !== child) return;
    this.#child = null;
    this.#ready = false;
    this.#buffer = "";
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
    const question = this.#question;
    this.#question = null;
    if (question) {
      clearTimeout(question.timer);
      question.resolve(null);
    }
  }

  #touch(): void {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = setTimeout(() => this.close(), HX_POWERSHELL_IDLE_MS);
    this.#idle.unref?.();
  }
}

/** The one PowerShell of this process. */
export const hxPowerShell = new HxPowerShell();
if (process.platform === "win32") process.once("exit", () => hxPowerShell.close());
