// HXBot v1.7.4（CU-07 应用路线）：HXBot 自己读不了的老格式（.xls .doc .ppt、WPS 的 .et .wps .dps、
// iWork 的 .numbers .pages .key、.odt .odp .rtf .csv），先用这台电脑上的应用转成新格式，再走原生处理；
// 以及原生做不了的“实时数据透视表”（Windows 上的 Excel 或 WPS 表格）。
// 顺序：LibreOffice（后台、不开窗口，有就先用）→ Mac 上的 iWork 导出 → Office 或 WPS 的自动化接口。
// 应用只在临时文件夹里的副本上干活；结果交回 run.ts 留版本、写回、读回。文件路径和参数经环境变量传给脚本，
// 不拼进脚本文字，路径里有引号或特殊字符也不会变成命令。
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { type HxRunner, type HxRunResult, hxRunFailure, hxRunOk } from "../hx-computer/runner";
import { HX_POWERSHELL } from "../hx-computer/tables-win";
import { hxCsvToXlsx } from "../hx-files/csv";

export type HxModernType = "xlsx" | "docx" | "pptx";

export interface HxAppRouteHost {
  run: HxRunner;
  platform: NodeJS.Platform;
  /** Whether a file exists (an app's program). */
  exists?: (path: string) => Promise<boolean>;
  env?: Readonly<Record<string, string | undefined>>;
}

export type HxAppResult = { ok: true; app: string; path: string } | { ok: false; reasons: string[] };

const TIMEOUT_MS = 180_000;

/** The modern type that a legacy type converts to. */
export function hxModernTypeOf(extension: string): HxModernType | null {
  if (["xls", "et", "csv", "numbers", "ods", "xlsb"].includes(extension)) return "xlsx";
  if (["doc", "wps", "rtf", "odt", "pages"].includes(extension)) return "docx";
  if (["ppt", "dps", "key", "odp"].includes(extension)) return "pptx";
  return null;
}

async function fileThere(host: HxAppRouteHost, path: string): Promise<boolean> {
  if (host.exists) return host.exists(path);
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

/** LibreOffice's program on this computer, if it is installed. */
export async function hxLibreOffice(host: HxAppRouteHost): Promise<string | null> {
  const env = host.env ?? process.env;
  const candidates =
    host.platform === "darwin"
      ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
      : host.platform === "win32"
        ? [
            join(env.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.exe"),
            join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "LibreOffice", "program", "soffice.exe"),
          ]
        : [
            "/usr/bin/soffice",
            "/usr/lib/libreoffice/program/soffice",
            "/opt/libreoffice/program/soffice",
            "/snap/bin/libreoffice",
          ];
  for (const candidate of candidates) if (await fileThere(host, candidate)) return candidate;
  return null;
}

/** A private folder for the app's copy; removed by the caller with `hxDropWork`. */
export async function hxWorkFolder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hx-skill-"));
}

export async function hxDropWork(folder: string): Promise<void> {
  if (basename(folder).startsWith("hx-skill-")) await rm(folder, { recursive: true, force: true });
}

async function withLibreOffice(
  host: HxAppRouteHost,
  input: string,
  to: HxModernType,
  folder: string,
): Promise<HxAppResult> {
  const program = await hxLibreOffice(host);
  if (!program) return { ok: false, reasons: ["LibreOffice is not installed"] };
  // A profile of its own: a LibreOffice that the user has open would otherwise take the job and return at once.
  const profile = join(folder, `lo-${randomBytes(4).toString("hex")}`);
  const profileUrl = `file://${host.platform === "win32" ? "/" : ""}${profile.replaceAll("\\", "/")}`;
  const out = join(folder, "out");
  const result = await host.run(
    program,
    [
      "--headless",
      "--norestore",
      "--nologo",
      "--nodefault",
      "--nolockcheck",
      `-env:UserInstallation=${profileUrl}`,
      "--convert-to",
      to,
      "--outdir",
      out,
      input,
    ],
    { timeoutMs: TIMEOUT_MS },
  );
  const made = join(out, `${basename(input, extname(input))}.${to}`);
  if (hxRunOk(result) && (await fileThere(host, made))) return { ok: true, app: "LibreOffice", path: made };
  return { ok: false, reasons: [hxRunFailure("LibreOffice", result)] };
}

// The scripts read their paths from the environment (HX_IN, HX_OUT), never from their text.
/**
 * iWork on a Mac opens its own files and the old Office ones, and exports the modern Office format.
 * Not sandboxed against a script the way Office is: on a real Mac (v1.7.4) Numbers and Pages converted
 * a copy in the temporary folder where Excel and Word could not open it.
 */
const IWORK: Record<HxModernType, { app: string; as: string; opens: readonly string[] }> = {
  xlsx: { app: "Numbers", as: "Microsoft Excel", opens: ["numbers", "xls", "csv"] },
  docx: { app: "Pages", as: "Microsoft Word", opens: ["pages", "doc", "rtf"] },
  pptx: { app: "Keynote", as: "Microsoft PowerPoint", opens: ["key", "ppt"] },
};

/** The types macOS's own `textutil` converts to .docx: no app, no window, nothing to grant. */
const TEXTUTIL_OPENS = ["doc", "rtf", "odt"];

/** Whether a Mac app is installed (in /Applications or ~/Applications). */
async function macAppInstalled(host: HxAppRouteHost, app: string): Promise<boolean> {
  const home = host.env?.HOME ?? homedir();
  for (const folder of ["/Applications", join(home, "Applications")]) {
    const path = join(folder, `${app}.app`);
    if (
      host.exists
        ? await host.exists(path)
        : await stat(path).then(
            () => true,
            () => false,
          )
    )
      return true;
  }
  return false;
}

/**
 * Commands of AppleScript's Standard Additions. Inside a `tell application` block AppleScript sends such
 * a command to that app (found on a real Mac): `system attribute` then reads the app's environment, not
 * HXBot's, and the copy's name came back empty, and an empty name matches every document, the user's
 * too; Numbers and Pages, still starting, answered -600; `delay` makes the app itself wait. So the Mac
 * scripts use them only at the top level or in a handler; hxMacOsaxInsideTell checks every script.
 */
const MAC_OSAX =
  /\bsystem attribute\b|\bdelay\b|\bread \(|\bopen for access\b|\bclose access\b|\bset eof\b|\bwrite\b.+\bto\b|\bdo shell script\b|\bdisplay (dialog|alert|notification)\b|\bpath to\b|\bcurrent date\b|\brandom number\b/u;

/** The lines of an AppleScript that use a Standard Additions command inside a `tell application` block. */
export function hxMacOsaxInsideTell(script: string): string[] {
  const found: string[] = [];
  let depth = 0;
  for (const raw of script.split("\n")) {
    const line = raw.trim();
    // `tell X to …` is one statement, unless it ends by opening a block (`… to tell process p`). Any
    // `tell` block counts: a command inside `tell theDoc` inside the app goes to the app as well.
    const tell = /^tell\b(.*)$/u.exec(line);
    if (tell) {
      const parts = (tell[1] ?? "").split(/\s+to\s+/u);
      const last = (parts.at(-1) ?? "").trim();
      if (parts.length === 1 || /^tell\b/u.test(last)) depth += 1;
      else if (MAC_OSAX.test(tell[1] ?? "")) found.push(line);
      continue;
    }
    if (line === "end tell") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0 && MAC_OSAX.test(line)) found.push(line);
  }
  return found;
}

export interface HxMacOwnScript {
  /** The app, as AppleScript names it: "Numbers", "Microsoft Excel". */
  app: string;
  /** The app's open documents: documents, workbooks, presentations. */
  collection: string;
  /** Handlers, at the top of the script (they run in the script, not in the app). */
  handlers?: readonly string[];
  /** More inputs from the environment, read before anything else (top level). */
  inputs?: readonly string[];
  /** Lines in the app before it opens the copy (Excel: its alerts). */
  prepare?: readonly string[];
  /** Lines in the app that open HXBot's copy, `inPath`. */
  open: readonly string[];
  /** Lines in the app once `theDoc` is HXBot's copy: the work, saved to `outPath`. */
  work: readonly string[];
  /** Lines in the app at the end, also after an error (Excel: its alerts back). */
  restore?: readonly string[];
}

/**
 * An AppleScript that opens HXBot's copy (HX_IN) in a Mac app, finds it among the app's open documents
 * by the copy's unique name (HX_STEM, hxCopyStem), does `work` on it, closes it without saving and
 * quits the app only when HXBot started it. Never “the front document”: that may be the user's, and
 * HXBot closes `theDoc` without saving. The search waits up to 60 s while the app still opens or
 * imports: Keynote answers “missing value” while it imports a .ppt, and Word's and PowerPoint's `open`
 * answer nothing (found on a real Mac). The inputs are read and the waits made outside the app (see
 * MAC_OSAX). After quitting, it waits until the app is gone, so that the next script does not hand its
 * file to an app that is quitting.
 */
export function hxMacOwnScript(s: HxMacOwnScript): string {
  const tell = `tell application "${s.app}"`;
  const at = (by: number, lines: readonly string[]) => lines.map((line) => `${" ".repeat(by)}${line}`);
  const quitIfOurs = (by: number) =>
    at(by, [
      `if (not wasRunning) and (application "${s.app}" is running) then`,
      `  ${tell}`,
      `    if (count of ${s.collection}) is 0 then quit saving no`,
      "  end tell",
      "  repeat 50 times",
      `    if not (application "${s.app}" is running) then exit repeat`,
      "    delay 0.2",
      "  end repeat",
      "end if",
    ]);
  return [
    ...(s.handlers ?? []),
    'set inPath to system attribute "HX_IN"',
    'set outPath to system attribute "HX_OUT"',
    'set stem to system attribute "HX_STEM"',
    ...(s.inputs ?? []),
    // Only HXBot's own name: an empty or another name would match the user's documents.
    'if stem does not start with "hxbot-" or (length of stem) < 18 then error "HXBot gave its copy no name." number -1700',
    `set wasRunning to application "${s.app}" is running`,
    "set theDoc to missing value",
    'set openError to ""',
    "try",
    ...at(2, [
      tell,
      ...at(2, s.prepare ?? []),
      "  try",
      ...at(4, s.open),
      "  on error errText",
      "    set openError to errText",
      "  end try",
      "end tell",
    ]),
    "  repeat 300 times",
    `    ${tell}`,
    `      repeat with d in ${s.collection}`,
    "        try",
    "          if (name of d) starts with stem then",
    "            set theDoc to contents of d",
    "            exit repeat",
    "          end if",
    "        end try",
    "      end repeat",
    "    end tell",
    "    if theDoc is not missing value then exit repeat",
    '    if openError is not "" then exit repeat',
    "    delay 0.2",
    "  end repeat",
    '  if theDoc is missing value then error ("The file did not open. " & openError) number -43',
    `  ${tell}`,
    ...at(4, s.work),
    "    close theDoc saving no",
    ...at(4, s.restore ?? []),
    "  end tell",
    "on error errMsg number errNum",
    `  if application "${s.app}" is running then`,
    `    ${tell}`,
    "      try",
    "        if theDoc is not missing value then close theDoc saving no",
    "      end try",
    ...(s.restore?.length ? at(6, ["try", ...at(2, s.restore), "end try"]) : []),
    "    end tell",
    "  end if",
    ...quitIfOurs(2),
    "  error errMsg number errNum",
    "end try",
    ...quitIfOurs(0),
  ].join("\n");
}

/** A unique name for HXBot's copy: the scripts find the copy by it among the user's own documents. */
export function hxCopyStem(): string {
  return `hxbot-${randomBytes(6).toString("hex")}`;
}

/**
 * Runs an AppleScript with its paths in the environment. An app that a previous script quit may still
 * be quitting and answer “not running” (-600, seen on a real Mac): then once more after 2 seconds.
 */
export async function hxOsascript(
  host: HxAppRouteHost,
  script: string,
  env: Readonly<Record<string, string>>,
): Promise<HxRunResult> {
  const first = await host.run("osascript", ["-e", script], { timeoutMs: TIMEOUT_MS, env });
  if (hxRunOk(first) || !/\(-600\)/u.test(first.stderr)) return first;
  await new Promise((done) => setTimeout(done, 2_000));
  return host.run("osascript", ["-e", script], { timeoutMs: TIMEOUT_MS, env });
}

function iworkScript(app: string, as: string): string {
  return hxMacOwnScript({
    app,
    collection: "documents",
    open: ["open (POSIX file inPath as alias)"],
    work: [`export theDoc to (POSIX file outPath) as ${as}`],
  });
}

/**
 * Microsoft Office for Mac, through its AppleScript dictionaries. AppleScript reaches the instance the
 * user may have open: HXBot opens its copy read-only, closes only that document, puts back the alerts
 * setting it changed, and quits only an app that it started itself (hxMacOwnScript). Excel tries its
 * own `open workbook` first, then the plain `open`.
 */
const MAC_OFFICE: Record<HxModernType, { app: string; script: string }> = {
  xlsx: {
    app: "Microsoft Excel",
    script: hxMacOwnScript({
      app: "Microsoft Excel",
      collection: "workbooks",
      prepare: ["set oldAlerts to display alerts", "set display alerts to false"],
      open: [
        "try",
        "  open workbook workbook file name (POSIX file inPath as text) read only true",
        "on error",
        "  open (POSIX file inPath as alias)",
        "end try",
      ],
      work: ["save workbook as theDoc filename (POSIX file outPath as text) file format Excel XML file format"],
      restore: ["set display alerts to oldAlerts"],
    }),
  },
  docx: {
    app: "Microsoft Word",
    script: hxMacOwnScript({
      app: "Microsoft Word",
      collection: "documents",
      open: ["open file name (POSIX file inPath as text) with read only"],
      work: ["save as theDoc file name (POSIX file outPath as text) file format format document"],
    }),
  },
  pptx: {
    app: "Microsoft PowerPoint",
    script: hxMacOwnScript({
      app: "Microsoft PowerPoint",
      collection: "presentations",
      open: ["open (POSIX file inPath as alias)"],
      work: ["save theDoc in (POSIX file outPath as text) as save as Open XML presentation"],
    }),
  },
};

/**
 * Office for Mac is sandboxed: it opens and saves only what it may reach, and a script cannot grant it
 * more (a copy in the temporary folder fails: Excel answers “parameter error”, the others open nothing).
 * Every Office app may use the Office group container, so the copy goes there, into a folder of its own.
 */
async function officeFolder(host: HxAppRouteHost): Promise<string | null> {
  const home = host.env?.HOME ?? homedir();
  const group = join(home, "Library", "Group Containers", "UBF8T346G9.Office");
  const info = await stat(group).catch(() => null);
  if (!info?.isDirectory()) return null;
  return mkdtemp(join(group, "HXBot-")).catch(() => null);
}

/** The ProgIDs on Windows: Microsoft Office first, then WPS Office. */
const WINDOWS_APPS: Record<HxModernType, string[]> = {
  xlsx: ["Excel.Application", "Ket.Application", "KET.Application"],
  docx: ["Word.Application", "Kwps.Application", "KWPS.Application"],
  pptx: ["PowerPoint.Application", "Kwpp.Application", "KWPP.Application"],
};

/** The open documents of an Office or WPS app, by the format it saves. */
const WINDOWS_DOCUMENTS: Record<HxModernType, string> = {
  xlsx: "Workbooks",
  docx: "Documents",
  pptx: "Presentations",
};

/**
 * A PowerShell script around `body`, which opens the copy as `$doc`. Office may hand out the instance
 * that the user has open (PowerPoint and WPS do): that one is the user's. It is not hidden and not
 * quit, only HXBot's document is closed (also after an error), and the alerts and macro settings
 * HXBot changed are put back. Only an instance that nobody sees and that has no document (one HXBot
 * started) is quit at the end.
 */
function windowsScript(to: HxModernType, body: readonly string[]): string {
  const documents = WINDOWS_DOCUMENTS[to];
  const close = to === "pptx" ? "$doc.Close()" : "$doc.Close($false)";
  return [
    "$ErrorActionPreference = 'Stop'",
    "$app = New-Object -ComObject $env:HX_APP",
    "$own = $false",
    `try { $own = (-not $app.Visible) -and ($app.${documents}.Count -eq 0) } catch {}`,
    "$alerts = $null",
    "$security = $null",
    "try { $alerts = $app.DisplayAlerts } catch {}",
    "try { $security = $app.AutomationSecurity } catch {}",
    "$doc = $null",
    "try {",
    ...body.map((line) => `  ${line}`),
    "} finally {",
    `  if ($null -ne $doc) { try { ${close} } catch {} }`,
    "  if ($own) { try { $app.Quit() } catch {} } else {",
    "    if ($null -ne $alerts) { try { $app.DisplayAlerts = $alerts } catch {} }",
    "    if ($null -ne $security) { try { $app.AutomationSecurity = $security } catch {} }",
    "  }",
    "  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)",
    "}",
  ].join("\n");
}

/** Open read-only with no window, no alerts and no macros, save as the modern format, close. */
function windowsConvertScript(to: HxModernType): string {
  const body: Record<HxModernType, string[]> = {
    xlsx: [
      "$app.DisplayAlerts = $false",
      "try { $app.AutomationSecurity = 3 } catch {}",
      "$doc = $app.Workbooks.Open($env:HX_IN, 0, $true)",
      "$doc.SaveAs($env:HX_OUT, 51)",
      "$doc.Close($false)",
      "$doc = $null",
    ],
    docx: [
      "$app.DisplayAlerts = 0",
      "try { $app.AutomationSecurity = 3 } catch {}",
      "$doc = $app.Documents.Open($env:HX_IN, $false, $true)",
      "try { $doc.SaveAs2($env:HX_OUT, 16) } catch { $doc.SaveAs($env:HX_OUT, 16) }",
      "$doc.Close($false)",
      "$doc = $null",
    ],
    pptx: [
      "$doc = $app.Presentations.Open($env:HX_IN, -1, 0, 0)",
      "$doc.SaveAs($env:HX_OUT, 24)",
      "$doc.Close()",
      "$doc = $null",
    ],
  };
  return windowsScript(to, body[to]);
}

async function powershell(host: HxAppRouteHost, script: string, env: Readonly<Record<string, string>>) {
  return host.run(
    HX_POWERSHELL,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeoutMs: TIMEOUT_MS, env },
  );
}

/**
 * Converts `source` to `to` with an app of this computer. The source is copied into `folder` first,
 * so that no app opens (or locks, or saves) the user's own file. Returns the converted file in `folder`.
 */
export async function hxConvertWithApp(
  source: string,
  to: HxModernType,
  folder: string,
  host: HxAppRouteHost,
): Promise<HxAppResult> {
  const extension = extname(source).slice(1).toLowerCase();
  // A .csv is text: HXBot reads it itself, with no app (Numbers adds a row with the table's name).
  if (extension === "csv" && to === "xlsx") {
    const made = join(folder, "converted.xlsx");
    try {
      await writeFile(made, hxCsvToXlsx(await readFile(source), basename(source, extname(source))));
      return { ok: true, app: "HXBot", path: made };
    } catch (error) {
      return { ok: false, reasons: [`HXBot could not read the .csv: ${error instanceof Error ? error.message : "?"}`] };
    }
  }
  const stem = hxCopyStem();
  const input = join(folder, `${stem}.${extension || "bin"}`);
  await copyFile(source, input);
  const reasons: string[] = [];
  const office = await withLibreOffice(host, input, to, folder);
  if (office.ok) return office;
  reasons.push(...office.reasons);
  const output = join(folder, `converted.${to}`);
  const env = { HX_IN: input, HX_OUT: output, HX_STEM: stem };
  if (host.platform === "darwin") {
    // LibreOffice (above), then iWork, then textutil, then Office: Office for Mac is sandboxed and on a
    // real Mac could not open a copy that a script gave it, so it comes last.
    const iwork = IWORK[to];
    const attempts: { app: string; script: string | null }[] = [];
    if (iwork.opens.includes(extension) && (await macAppInstalled(host, iwork.app)))
      attempts.push({ app: iwork.app, script: iworkScript(iwork.app, iwork.as) });
    if (to === "docx" && TEXTUTIL_OPENS.includes(extension)) attempts.push({ app: "textutil", script: null });
    attempts.push(MAC_OFFICE[to]);
    for (const attempt of attempts) {
      if (attempt.script === null) {
        const result = await host.run("/usr/bin/textutil", ["-convert", "docx", "-output", output, input], {
          timeoutMs: TIMEOUT_MS,
        });
        if (hxRunOk(result) && (await fileThere(host, output))) return { ok: true, app: "textutil", path: output };
        reasons.push(hxRunFailure("textutil", result));
        continue;
      }
      const script = attempt.script;
      const office = attempt.app.startsWith("Microsoft ") ? await officeFolder(host) : null;
      try {
        const here = office
          ? { HX_IN: join(office, basename(input)), HX_OUT: join(office, basename(output)), HX_STEM: stem }
          : env;
        if (office) await copyFile(input, here.HX_IN);
        const result = await hxOsascript(host, script, here);
        if (hxRunOk(result) && (await fileThere(host, here.HX_OUT))) {
          if (office) await copyFile(here.HX_OUT, output);
          return { ok: true, app: attempt.app, path: output };
        }
        reasons.push(hxRunFailure(attempt.app, result));
      } finally {
        if (office) await rm(office, { recursive: true, force: true });
      }
    }
  } else if (host.platform === "win32") {
    for (const app of WINDOWS_APPS[to]) {
      const result = await powershell(host, windowsConvertScript(to), { ...env, HX_APP: app });
      if (hxRunOk(result) && (await fileThere(host, output))) return { ok: true, app, path: output };
      reasons.push(hxRunFailure(app, result));
    }
  }
  return { ok: false, reasons };
}

export interface HxPivotInput {
  path: string;
  sheet: string | null;
  range: string;
  rows: readonly string[];
  values: readonly { column: string; fn: "sum" | "count" | "average" | "min" | "max" }[];
}

/** Excel's XlConsolidationFunction values. */
const XL_FUNCTIONS = { sum: -4157, count: -4112, average: -4106, max: -4136, min: -4139 } as const;

/**
 * A live PivotTable on a new sheet, made by Excel or WPS 表格 on Windows on the copy `path`, which it
 * saves in place. The params go in as JSON in the environment.
 */
export async function hxLivePivot(
  input: HxPivotInput,
  host: HxAppRouteHost,
): Promise<HxAppResult & { sheet?: string }> {
  if (host.platform !== "win32") {
    return {
      ok: false,
      reasons: ["A live PivotTable needs Excel or WPS 表格 on Windows; on this computer use the action summary."],
    };
  }
  const spec = JSON.stringify({
    sheet: input.sheet,
    range: input.range,
    rows: input.rows,
    values: input.values.map((value) => ({
      column: value.column,
      fn: XL_FUNCTIONS[value.fn],
      caption: `${value.fn} of ${value.column}`,
    })),
  });
  const script = [
    "$spec = $env:HX_SPEC | ConvertFrom-Json",
    windowsScript("xlsx", [
      "$app.DisplayAlerts = $false",
      "try { $app.AutomationSecurity = 3 } catch {}",
      "$doc = $app.Workbooks.Open($env:HX_IN)",
      "if ($spec.sheet) { $ws = $doc.Worksheets.Item($spec.sheet) } else { $ws = $doc.Worksheets.Item(1) }",
      "$source = $ws.Range($spec.range)",
      "$target = $doc.Worksheets.Add([Type]::Missing, $doc.Worksheets.Item($doc.Worksheets.Count))",
      "$base = 'Pivot'; $name = $base; $n = 2",
      'while ($true) { $taken = $false; foreach ($s in $doc.Worksheets) { if ($s.Name -eq $name) { $taken = $true } }; if (-not $taken) { break }; $name = "$base $n"; $n++ }',
      "$target.Name = $name",
      "$cache = $doc.PivotCaches().Create(1, $source)",
      "$pivot = $cache.CreatePivotTable($target.Range('A3'), 'HXBotPivot')",
      "foreach ($row in $spec.rows) { $pivot.PivotFields($row).Orientation = 1 }",
      "foreach ($value in $spec.values) { [void]$pivot.AddDataField($pivot.PivotFields($value.column), $value.caption, $value.fn) }",
      "$doc.Save()",
      "$doc.Close($false)",
      "$doc = $null",
      'Write-Output "HXSHEET:$name"',
    ]),
  ].join("\n");
  const reasons: string[] = [];
  for (const app of WINDOWS_APPS.xlsx) {
    const result = await powershell(host, script, { HX_IN: input.path, HX_APP: app, HX_SPEC: spec });
    const sheet = /HXSHEET:(.+)/.exec(result.stdout)?.[1]?.trim();
    if (hxRunOk(result) && sheet) return { ok: true, app, path: input.path, sheet };
    reasons.push(hxRunFailure(app, result));
  }
  return { ok: false, reasons };
}
