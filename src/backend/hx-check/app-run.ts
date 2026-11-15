// HXBot 真机检查（v1.6.9）：应用命令（computer_app）和脚本（computer_run）在真的 Mac、Windows 上走一遍。
//
// 用的是产品里同一份 hxAppControl、hxRunScript，和系统自带的应用（Mac：文本编辑；Windows：记事本）：
//   A1 列出正在运行的应用；A2 打开一个文件后切到前台；A3 窗口放到左半边；A4 读菜单、点一个不改东西的菜单命令；
//   A5 隐藏；A6 正常退出并核对已经退出；A7 运行一段不控制别的应用的脚本；A8 让应用里有没保存的改动后退出：
//   应用自己问要不要保存时回 waiting，强制退出没同意时回 confirm，同意后真的退出；A9 读默认浏览器；
//   A10 改默认应用（Mac：.md 文件改成文本编辑并读回；Windows：打开“默认应用”页）。
// GitHub 的机器上没有人点系统的“自动化”授权框，所以控制别的应用的脚本可能回 needs-permission：
// 这一项记“提醒”，不算失败（产品里由用户在系统的框里点“好”）。
import { execFile, spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type HxAppDeps, type HxAppResult, hxAppControl } from "../hx-computer/app-control";
import { type HxRunScriptResult, hxRunScript } from "../hx-computer/run-script";
import { hxRun } from "../hx-computer/runner";
import type { HxRealItems } from "./report";

const run = promisify(execFile);

function line(result: HxAppResult | HxRunScriptResult): string {
  return JSON.stringify(result).slice(0, 600);
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function hxAppRealCheck(input: {
  items: HxRealItems;
  log: (line: string) => void;
  platform: NodeJS.Platform;
}): Promise<void> {
  const { items, log, platform } = input;
  if (platform !== "darwin" && platform !== "win32") {
    items.add("A1", "应用命令（computer_app）", "skip", `这台机器是 ${platform}，应用命令只在 Mac、Windows 上检查`);
    return;
  }
  let automationPage = 0;
  const deps: HxAppDeps = {
    run: hxRun,
    platform,
    sleep,
    openAutomationPage: async () => {
      automationPage += 1;
    },
  };
  const scripts = { run: hxRun, platform, openAutomationPage: deps.openAutomationPage };
  const mac = platform === "darwin";
  const appName = mac ? "TextEdit" : "notepad";
  const work = await mkdtemp(join(tmpdir(), "hxbot-app-check-"));
  const file = join(work, "hxbot-app-check.txt");
  await writeFile(file, "HXBot app check\n", "utf8");
  const open = async () => {
    if (mac) await run("/usr/bin/open", ["-a", "TextEdit", file]);
    // Started on its own, with no output to hold open: through `cmd /c start` the check waited for Notepad to end.
    else spawn("notepad.exe", [file], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const listed = await hxAppControl(deps, { action: "list" });
      if (i === 0) log(`list after open: ${line(listed)}`);
      if (
        listed.status === "apps" &&
        listed.apps.some(
          (app) =>
            app.name === appName || app.id.toLowerCase() === appName.toLowerCase() || app.id === "com.apple.TextEdit",
        )
      )
        return true;
    }
    return false;
  };
  try {
    if (mac) {
      // What the ObjC bridge of JXA gives for the fields the list reads, for the log.
      const probe = await hxRunScript(scripts, {
        language: "jxa",
        script:
          "ObjC.import('AppKit'); const l = $.NSWorkspace.sharedWorkspace.runningApplications; const a = l.objectAtIndex(0); JSON.stringify({ count: [typeof l.count, String(l.count)], policy: [typeof a.activationPolicy, String(ObjC.unwrap(a.activationPolicy))], pid: [typeof a.processIdentifier, String(a.processIdentifier)], active: [typeof a.active, String(ObjC.unwrap(a.active))] })",
      });
      log(`jxa bridge: ${line(probe)}`);
    }
    const listed = await hxAppControl(deps, { action: "list" });
    items.check(
      "A1",
      "列出正在运行的应用",
      listed.status === "apps" &&
        listed.apps.length > 0 &&
        (!mac || listed.apps.some((app) => app.id === "com.apple.finder")),
      listed.status === "apps"
        ? listed.apps
            .map((app) => app.name)
            .slice(0, 12)
            .join("、")
        : line(listed),
    );
    const opened = await open();
    log(`opened ${appName}: ${opened}`);
    const front = await hxAppControl(deps, { action: "front", app: appName });
    items.check(
      "A2",
      `打开文件后把${mac ? "文本编辑" : "记事本"}切到前台`,
      opened && front.status === "done",
      line(front),
    );

    const placed = await hxAppControl(deps, { action: "window", app: appName, place: "left" });
    items.add(
      "A3",
      "窗口放到左半边",
      placed.status === "done" ? "pass" : placed.status === "needs-permission" ? "warn" : "fail",
      line(placed),
    );

    if (mac) {
      const menus = await hxAppControl(deps, { action: "menus", app: appName });
      const hasEdit = menus.status === "menus" && menus.menus.some((menu) => menu.menu === "Edit");
      const clicked = hasEdit
        ? await hxAppControl(deps, { action: "menu", app: appName, path: ["Edit", "Select All"] })
        : menus;
      const risky = await hxAppControl(deps, { action: "menu", app: appName, path: ["Edit", "Delete"] });
      items.add(
        "A4",
        "读菜单、点“编辑 › 全选”；“删除”这类菜单命令先问",
        hasEdit && clicked.status === "done" && risky.status === "confirm"
          ? "pass"
          : menus.status === "needs-permission"
            ? "warn"
            : "fail",
        `${line(menus).slice(0, 300)}；${line(clicked).slice(0, 200)}；${line(risky).slice(0, 200)}`,
      );
    } else {
      const menus = await hxAppControl(deps, { action: "menus", app: appName });
      items.check("A4", "Windows 的菜单交给逐步操作（use-steps）", menus.status === "use-steps", line(menus));
    }

    const hidden = await hxAppControl(deps, { action: "hide", app: appName });
    items.check("A5", "隐藏（Windows：最小化）", hidden.status === "done", line(hidden));

    const quit = await hxAppControl(deps, { action: "quit", app: appName });
    items.check("A6", "正常退出并核对已经退出", quit.status === "done" && quit.action === "quit", line(quit));

    const script = mac
      ? await hxRunScript(scripts, {
          language: "jxa",
          script: "ObjC.import('Foundation'); $.NSProcessInfo.processInfo.operatingSystemVersionString.js",
        })
      : await hxRunScript(scripts, { language: "powershell", script: "[Environment]::OSVersion.VersionString" });
    items.check(
      "A7",
      `在 HXBot 里运行一段${mac ? " JXA " : " PowerShell "}脚本，读回输出`,
      script.status === "ran" && /version|windows|\d+\.\d+/iu.test(script.output),
      line(script),
    );

    // Unsaved changes, then quit: the app asks whether to save; force needs a yes.
    await open();
    const edit = mac
      ? await hxRunScript(scripts, {
          language: "applescript",
          script: 'tell application "TextEdit"\n  set text of document 1 to "HXBot app check, not saved"\nend tell',
        })
      : await hxRunScript(scripts, {
          language: "powershell",
          script:
            "$s = New-Object -ComObject WScript.Shell; $p = Get-Process notepad | Select-Object -First 1; [void]$s.AppActivate($p.Id); Start-Sleep -Milliseconds 800; $s.SendKeys('HXBot not saved'); 'typed'",
        });
    if (edit.status !== "ran") {
      items.add(
        "A8",
        "有没保存的改动时退出：应用自己问，强制退出先问",
        edit.status === "needs-permission" ||
          (edit.status === "failed" && edit.reason.includes("did not answer in time"))
          ? "warn"
          : "fail",
        `改不了文件内容（${edit.status}；GitHub 的机器上没有人点“自动化”授权框）：${line(edit)}；打开自动化页 ${automationPage} 次`,
      );
      await hxAppControl(deps, { action: "quit", app: appName, force: true, confirmed: true });
    } else {
      await sleep(800);
      const asks = await hxAppControl(deps, { action: "quit", app: appName });
      const unasked = await hxAppControl(deps, { action: "quit", app: appName, force: true });
      const forced =
        asks.status === "waiting"
          ? await hxAppControl(deps, { action: "quit", app: appName, force: true, confirmed: true })
          : asks;
      // A Notepad that keeps its own session (Windows 11) quits without asking: that counts too.
      const ok =
        (asks.status === "waiting" && unasked.status === "confirm" && forced.status === "done") ||
        (asks.status === "done" && !mac);
      items.add(
        "A8",
        "有没保存的改动时退出：应用自己问（waiting），强制退出没同意先问，同意后退出",
        ok ? "pass" : "fail",
        `${line(asks).slice(0, 250)}；${line(unasked).slice(0, 150)}；${line(forced).slice(0, 200)}`,
      );
    }

    const browser = await hxAppControl(deps, { action: "default", kind: "browser" });
    items.check("A9", "读默认浏览器", browser.status === "default" && browser.app !== "", line(browser));

    // Change a default app. A file type on a Mac changes without a dialog of macOS (a browser has one);
    // Windows lets only the user change it, so HXBot opens the Default apps page.
    const changed = mac
      ? await hxAppControl(deps, { action: "default", kind: "type", type: "md", app: "TextEdit" })
      : await hxAppControl(deps, { action: "default", kind: "browser", app: "Microsoft Edge" });
    items.add(
      "A10",
      mac ? "把 .md 文件的默认应用改成文本编辑，读回核对" : "改默认浏览器：打开“默认应用”页（status page）",
      mac
        ? changed.status === "default" && changed.app.toLowerCase() === "com.apple.textedit"
          ? "pass"
          : changed.status === "confirm-dialog"
            ? "warn"
            : "fail"
        : changed.status === "page"
          ? "pass"
          : "fail",
      line(changed),
    );
  } catch (error) {
    items.add("A99", "应用命令的检查没有跑完", "fail", error instanceof Error ? error.message : String(error));
  }
}
