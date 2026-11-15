// HXBot 电脑操控（二）：把电脑操控驱动的状态和“打开授权页”交给逐步操作的工具（v1.6.7）。
// 助手第一次要用逐步操作而驱动还没起来时，工具经这里问一次驱动：授过权的就此启动，缺授权的打开
// 系统设置里缺的那一页，和“设置 → 电脑操控”里的“授权”按钮做的一样。v1.6.8：只提逐步操作要的辅助功能；
// 打开那一页之后，能由 HXBot 自己按的开关由 HXBot 按（hx-mac-grants.ts），用户只输密码或按指纹。
import { execFile } from "node:child_process";
import type { MacPermissionId } from "@hxbot/contracts/ipc";
import type { AppTranslate } from "@hxbot/i18n";
import { app, clipboard, desktopCapturer, shell, systemPreferences } from "electron";
import { runCauseEffect } from "../backend/effect-boundary";
import { hxComputer } from "../backend/hx-computer/computer";
import { hxStepGrantsMissing } from "../backend/hx-computer/driver-help";
import type { HxClipboardKeep } from "../backend/hx-computer/front";
import type { CuaDriverRuntime } from "./cua-driver-runtime";
import { hxAskFirst } from "./hx-ask-first";
import { hxComputerWorkSource } from "./hx-computer-stop";
import { hxLsappinfoPid, hxMacGrants } from "./hx-mac-grants";
import { MAC_PERMISSION_URLS } from "./mac-permission-urls";

/** HXBot's own bundle id, for resetting its own entries in Privacy & Security. */
const BUNDLE_ID = process.env.__CFBundleIdentifier || "com.hxallai.bot";
/** System Settings, whatever the language of macOS. */
const SYSTEM_SETTINGS = "com.apple.systempreferences";
/** After its last action, an agent still counts as working on this computer for this long. */
const HX_WORK_HOLDS_MS = 60_000;
/** Privacy & Security → App Management (macOS 13 and later): changing apps of other developers. */
const APP_MANAGEMENT_URL = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AppBundles";
/** Privacy & Security → Automation: the apps that HXBot may control (computer_app, computer_run; v1.6.9). */
const AUTOMATION_URL = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation";

export function hxConnectComputerDriver(input: {
  driver: Pick<CuaDriverRuntime, "state" | "stop" | "start" | "running" | "mcpServerConfig" | "lastAction">;
  openExternal: (url: string) => Promise<void>;
  showSteps: (id: MacPermissionId) => Promise<void>;
  translate: AppTranslate;
}): void {
  const openPage = async (id: MacPermissionId) => {
    await input.openExternal(MAC_PERMISSION_URLS[id]);
    await input.showSteps(id).catch(() => undefined);
  };
  // v1.7.0 (F4): a page that an agent's tool wants comes to the front only while the user works in
  // HXBot; otherwise a notification opens it on a click (hx-ask-first.ts).
  const askText = () => ({
    title: input.translate("computerUse.hxAskTitle"),
    body: input.translate("computerUse.hxAskBody"),
  });
  if (process.platform === "darwin")
    hxMacGrants.set({
      driver: input.driver,
      accessibility: () => systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: () => systemPreferences.getMediaAccessStatus("screen") === "granted",
      askScreenRecording: async () => {
        await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
      },
      openPage,
      resetOwn: (service) =>
        new Promise((resolve, reject) => {
          execFile("/usr/bin/tccutil", ["reset", service, BUNDLE_ID], { timeout: 15_000 }, (error) =>
            error ? reject(error) : resolve(),
          );
        }),
      settingsPid: () =>
        new Promise((resolve) => {
          execFile(
            "/usr/bin/lsappinfo",
            ["info", "-only", "pid", "-app", SYSTEM_SETTINGS],
            { timeout: 5000 },
            (error, stdout) => {
              resolve(error ? null : hxLsappinfoPid(String(stdout)));
            },
          );
        }),
      names: [...new Set([app.getName(), "HXBot"])],
    });
  // computer_install (v1.6.8, F6): the earlier version goes to the Trash; a refusal opens App Management.
  // computer_app and computer_run (v1.6.9): a refused Apple event opens the Automation page.
  hxComputer.setInstallHelp({
    trashItem: (path) => shell.trashItem(path),
    async askAppManagement() {
      if (process.platform !== "darwin") return;
      await hxAskFirst.open(
        "app-management",
        async () => {
          await input.openExternal(APP_MANAGEMENT_URL);
          void hxMacGrants.pressAppManagement();
        },
        askText(),
      );
    },
    async openAutomation() {
      if (process.platform !== "darwin") return;
      await hxAskFirst.open("automation", () => input.openExternal(AUTOMATION_URL), askText());
    },
  });
  hxComputer.setClipboardKeep(hxClipboardKeep);
  // v1.7.0: the stop keys are held while an agent works on this computer (hx-computer-stop.ts).
  hxComputerWorkSource(
    () => hxComputer.workedWithin(HX_WORK_HOLDS_MS) || input.driver.lastAction(HX_WORK_HOLDS_MS) !== null,
  );
  hxComputer.setDriverHelp({
    async check() {
      const state = await runCauseEffect(input.driver.state());
      // As at startup: a driver without its grants does not keep running.
      if (state.status !== "ready") await runCauseEffect(input.driver.stop()).catch(() => undefined);
      return {
        status: state.status,
        // Only what the step tools need (Accessibility): Screen Recording serves screenshots alone.
        missing: hxStepGrantsMissing(state.permissions),
        message: state.message,
      };
    },
    async openPermission(id) {
      await hxAskFirst.open(
        id,
        async () => {
          await hxMacGrants.prepare(id);
          await openPage(id);
          void hxMacGrants.press(id);
        },
        askText(),
      );
    },
  });
}

/** The types on the clipboard and its text: enough to tell that something else is on it. */
async function clipboardKey(): Promise<{ types: string[]; text: string }> {
  const items = await clipboard.read();
  return { types: items.flatMap((item) => item.types), text: await clipboard.readText() };
}

/**
 * The user's clipboard around typed text (v1.7.0, F5). Only the text is read: reading every type
 * would make the app that copied it produce each one (a large copy in Excel takes seconds).
 * A text copy goes back as it was; a copy of another kind is left as it is now.
 */
const hxClipboardKeep: HxClipboardKeep = {
  async save() {
    const before = await clipboardKey();
    const textOnly = before.types.every((type) => type === "text/plain");
    return {
      changed: async () => {
        const now = await clipboardKey();
        return now.text !== before.text || now.types.join("|") !== before.types.join("|");
      },
      putBack: async () => {
        if (!textOnly) return;
        if (before.types.length === 0) clipboard.clear();
        else await clipboard.writeText(before.text);
      },
    };
  },
};
