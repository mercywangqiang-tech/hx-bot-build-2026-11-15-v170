// HXBot 真机检查（v1.6.8）：安装应用（computer_install，复盘 F6）在真 Mac 上走一遍。
//
// 做一个很小的测试应用（只做临时签名，带上隔离标记），打成 .zip 和 .dmg，然后用 HXBot 自己的 hxInstallApp：
//   I1 装进“应用程序”文件夹，读回版本、签名，隔离标记还在；
//   I2 再装一个新版本，没说替换时先回 confirm；
//   I3 说了替换后装上新版本，旧版进废纸篓，“应用程序”文件夹里不留临时文件；
//   I4 从磁盘映像装，装好后卸下。
// 用的是 macOS 自带的 ditto、hdiutil、codesign、spctl、plutil、lsappinfo，和产品里一样。
// 废纸篓：产品里由 Electron 的 shell.trashItem 放进去，这里没有 Electron，用改名放进 ~/.Trash 代替。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { HX_INSTALL_FILES, type HxInstallDeps, type HxInstallResult, hxInstallApp } from "../hx-computer/install";
import { hxRun } from "../hx-computer/runner";
import type { HxRealItems } from "./report";

const run = promisify(execFile);
const ID = "org.example.hxinstall";
const NAME = "HXInstallCheck";

async function makeApp(folder: string, version: string): Promise<string> {
  const app = join(folder, `${NAME}.app`);
  await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
  await writeFile(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${ID}</string>
<key>CFBundleExecutable</key><string>hxinstall</string>
<key>CFBundleName</key><string>${NAME}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`,
    "utf8",
  );
  await run("/bin/cp", ["/usr/bin/true", join(app, "Contents", "MacOS", "hxinstall")]);
  await run("/usr/bin/codesign", ["-s", "-", "--force", app]);
  // As a download from a browser: macOS checks the app the first time it opens.
  await run("/usr/bin/xattr", ["-w", "com.apple.quarantine", "0081;00000000;HXBot check;", app]);
  return app;
}

async function quarantined(path: string): Promise<boolean> {
  return run("/usr/bin/xattr", ["-p", "com.apple.quarantine", path]).then(
    () => true,
    () => false,
  );
}

function line(result: HxInstallResult): string {
  return JSON.stringify(result).slice(0, 600);
}

export async function hxInstallRealCheck(input: {
  items: HxRealItems;
  log: (line: string) => void;
  platform: NodeJS.Platform;
}): Promise<void> {
  const { items, log } = input;
  if (input.platform !== "darwin") {
    items.add("I1", "安装应用（computer_install）", "skip", `这台机器是 ${input.platform}，安装应用只在 Mac 上检查`);
    return;
  }
  const target = `/Applications/${NAME}.app`;
  const trash = join(homedir(), ".Trash");
  const work = await mkdtemp(join(tmpdir(), "hxbot-install-check-"));
  const deps: HxInstallDeps = {
    run: hxRun,
    files: HX_INSTALL_FILES,
    platform: "darwin",
    trashItem: async (path) => {
      await mkdir(trash, { recursive: true });
      await rename(path, join(trash, `${basename(path)}-${Date.now()}`));
    },
  };
  try {
    await rm(target, { recursive: true, force: true });
    const v1 = await makeApp(join(work, "v1"), "1.0");
    const v2 = await makeApp(join(work, "v2"), "2.0");
    const zip = join(work, `${NAME}-2.0.zip`);
    await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", v2, zip]);
    const v3 = await makeApp(join(work, "v3"), "3.0");
    const dmg = join(work, `${NAME}-3.0.dmg`);
    await run(
      "/usr/bin/hdiutil",
      ["create", "-volname", NAME, "-srcfolder", join(work, "v3"), "-ov", "-format", "UDZO", dmg],
      {
        timeout: 120_000,
      },
    );
    log(`test apps: ${v1}, ${zip}, ${v3} → ${dmg}`);

    const first = await hxInstallApp(deps, { path: v1 });
    items.check(
      "I1",
      "装进“应用程序”文件夹：读回版本和签名，隔离标记保留",
      first.status === "installed" &&
        first.app.version === "1.0" &&
        first.signature.authority === "ad-hoc" &&
        !first.signature.notarized &&
        (await quarantined(target)),
      line(first),
    );

    const asked = await hxInstallApp(deps, { path: zip });
    items.check(
      "I2",
      "已经装了时先问（confirm），不动原来的",
      asked.status === "confirm" && asked.installed.version === "1.0" && asked.incoming.version === "2.0",
      line(asked),
    );

    const replaced = await hxInstallApp(deps, { path: zip, replace: true });
    const leftovers = (await readdir("/Applications")).filter((name) => name.includes("hxbot-"));
    const inTrash = (await readdir(trash).catch(() => [])).some((name) => name.startsWith(`${NAME} 1.0.app`));
    items.check(
      "I3",
      "同意替换后装上新版本，旧版进废纸篓，不留临时文件",
      replaced.status === "installed" &&
        replaced.app.version === "2.0" &&
        replaced.replaced?.version === "1.0" &&
        inTrash &&
        leftovers.length === 0,
      `${line(replaced)}；废纸篓里有旧版：${inTrash}；“应用程序”文件夹里的临时文件：${leftovers.join(", ") || "无"}`,
    );

    const fromImage = await hxInstallApp(deps, { path: dmg, replace: true });
    const mounted = await run("/usr/bin/hdiutil", ["info"]).then((result) => result.stdout.includes("hxbot-dmg-"));
    items.check(
      "I4",
      "从磁盘映像装，装好后卸下",
      fromImage.status === "installed" && fromImage.app.version === "3.0" && !mounted,
      `${line(fromImage)}；映像还挂着：${mounted}`,
    );
  } catch (error) {
    items.add("I9", "安装应用的检查没有跑完", "fail", error instanceof Error ? error.message : String(error));
  } finally {
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
