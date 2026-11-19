// HXBot v1.7.4（CU-07 应用路线）：HXBot 自己读不了的老格式（.xls .doc .ppt、WPS 的 .et .wps .dps、
// iWork 的 .numbers .pages .key、.odt .odp .rtf .csv），先用这台电脑上的应用转成新格式，再走原生处理；
// 以及原生做不了的“实时数据透视表”（Windows 上的 Excel 或 WPS 表格）。
// 顺序：LibreOffice（后台、不开窗口，有就先用）→ Mac 上的 iWork 导出 → Office 或 WPS 的自动化接口。
// 应用只在临时文件夹里的副本上干活；结果交回 run.ts 留版本、写回、读回。文件路径和参数经环境变量传给脚本，
// 不拼进脚本文字，路径里有引号或特殊字符也不会变成命令。
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { type HxRunner, hxRunFailure, hxRunOk } from "../hx-computer/runner";
import { HX_POWERSHELL } from "../hx-computer/tables-win";

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
const IWORK: Record<HxModernType, { app: string; as: string; from: string }> = {
  xlsx: { app: "Numbers", as: "Microsoft Excel", from: "numbers" },
  docx: { app: "Pages", as: "Microsoft Word", from: "pages" },
  pptx: { app: "Keynote", as: "Microsoft PowerPoint", from: "key" },
};

/**
 * The lines after the work of a Mac app: an app that HXBot started is quit again when no document is
 * left in it; an app that the user had open keeps running, with only HXBot's own document closed.
 */
function macQuitIfOurs(documents: string): string {
  return `  if not wasRunning and (count of ${documents}) is 0 then quit saving no`;
}

function iworkScript(app: string, as: string): string {
  return [
    'set inPath to system attribute "HX_IN"',
    'set outPath to system attribute "HX_OUT"',
    `set wasRunning to application "${app}" is running`,
    `tell application "${app}"`,
    "  try",
    "    set theDoc to open (POSIX file inPath as alias)",
    `    export theDoc to (POSIX file outPath) as ${as}`,
    "    close theDoc saving no",
    "  on error errMsg number errNum",
    "    try",
    "      close theDoc saving no",
    "    end try",
    `  ${macQuitIfOurs("documents")}`,
    "    error errMsg number errNum",
    "  end try",
    macQuitIfOurs("documents"),
    "end tell",
  ].join("\n");
}

/**
 * Microsoft Office for Mac, through its AppleScript dictionaries. AppleScript reaches the instance the
 * user may have open: HXBot opens its copy read-only, closes only that document, puts back the alerts
 * setting it changed, and quits only an app that it started itself. Word's and PowerPoint's `open`
 * return nothing and may finish a moment later, so the script waits for the new document (at most 20 s)
 * and takes it as the front one. Excel tries its own `open workbook` first, then the plain `open`.
 * (Found on a real Mac, v1.7.4: Word answered “theDoc is not defined”, PowerPoint “no result”.)
 */
function macOfficeScript(app: string, documents: string, work: readonly string[], close: string): string {
  return [
    'set inPath to system attribute "HX_IN"',
    'set outPath to system attribute "HX_OUT"',
    `set wasRunning to application "${app}" is running`,
    `tell application "${app}"`,
    ...(app === "Microsoft Excel" ? ["  set oldAlerts to display alerts", "  set display alerts to false"] : []),
    `  set countBefore to count of ${documents}`,
    "  try",
    ...work.map((line) => `    ${line}`),
    `    ${close}`,
    "  on error errMsg number errNum",
    "    try",
    `      ${close}`,
    "    end try",
    ...(app === "Microsoft Excel" ? ["    set display alerts to oldAlerts"] : []),
    `  ${macQuitIfOurs(documents)}`,
    "    error errMsg number errNum",
    "  end try",
    ...(app === "Microsoft Excel" ? ["  set display alerts to oldAlerts"] : []),
    macQuitIfOurs(documents),
    "end tell",
  ].join("\n");
}

/** Lines that wait (at most 20 s) until `documents` has one more than `before`. */
const waitForOne = (documents: string) => [
  "repeat 100 times",
  `  if (count of ${documents}) > countBefore then exit repeat`,
  "  delay 0.2",
  "end repeat",
  `if (count of ${documents}) is not greater than countBefore then error "The file did not open." number -43`,
];

const MAC_OFFICE: Record<HxModernType, { app: string; script: string }> = {
  xlsx: {
    app: "Microsoft Excel",
    script: macOfficeScript(
      "Microsoft Excel",
      "workbooks",
      [
        "try",
        "  set wb to open workbook workbook file name (POSIX file inPath as text) read only true",
        "on error",
        "  open (POSIX file inPath as alias)",
        ...waitForOne("workbooks").map((line) => `  ${line}`),
        "  set wb to active workbook",
        "end try",
        "save workbook as wb filename (POSIX file outPath as text) file format Excel XML file format",
      ],
      "close wb saving no",
    ),
  },
  docx: {
    app: "Microsoft Word",
    script: macOfficeScript(
      "Microsoft Word",
      "documents",
      [
        "open file name (POSIX file inPath as text) with read only",
        ...waitForOne("documents"),
        "set theDoc to active document",
        "save as theDoc file name (POSIX file outPath as text) file format format document",
      ],
      "close theDoc saving no",
    ),
  },
  pptx: {
    app: "Microsoft PowerPoint",
    script: macOfficeScript(
      "Microsoft PowerPoint",
      "presentations",
      [
        "open (POSIX file inPath as alias)",
        ...waitForOne("presentations"),
        "set thePres to active presentation",
        "save thePres in (POSIX file outPath as text) as save as Open XML presentation",
      ],
      "close thePres saving no",
    ),
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

async function osascript(host: HxAppRouteHost, script: string, env: Readonly<Record<string, string>>) {
  return host.run("osascript", ["-e", script], { timeoutMs: TIMEOUT_MS, env });
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
  const input = join(folder, `input.${extension || "bin"}`);
  await copyFile(source, input);
  const reasons: string[] = [];
  const office = await withLibreOffice(host, input, to, folder);
  if (office.ok) return office;
  reasons.push(...office.reasons);
  const output = join(folder, `converted.${to}`);
  const env = { HX_IN: input, HX_OUT: output };
  if (host.platform === "darwin") {
    const iwork = IWORK[to];
    const attempts = extension === iwork.from ? [{ app: iwork.app, script: iworkScript(iwork.app, iwork.as) }] : [];
    attempts.push(MAC_OFFICE[to]);
    for (const attempt of attempts) {
      const office = attempt.app.startsWith("Microsoft ") ? await officeFolder(host) : null;
      try {
        const here = office ? { HX_IN: join(office, basename(input)), HX_OUT: join(office, basename(output)) } : env;
        if (office) await copyFile(input, here.HX_IN);
        const result = await osascript(host, attempt.script, here);
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
