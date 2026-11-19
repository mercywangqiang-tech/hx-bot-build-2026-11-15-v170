"""HXBot：客户端更新（v1.6.2 起；v1.7.1 起大版本不再强制）。

v1.7.1 起（用户 2026-11-18：“以后大版本都不做强制更新，只需要在打开 hxbot 客户端后直接更新即可”）：
- 桌面端：打开 HXBot 时找到的新版本自动下载、装好，在助手都空闲时几秒后重启进入新版，不弹窗、不用点（右下角提示
  “HXBot 正在安装更新”，可以取消这一次）；用着用着才找到的，下次打开时再装（hx-update-policy.ts 的 hxInstallsByItself）。
  “更新 HXBot”窗口只在账号服务拒绝了这个版本（426）时挡住界面；账号服务不再按版本拒绝，所以平时不会出现。
- 以后的版本都不拦（用户 2026-11-18：“以后版本都不拦，需要自动更新即可”）：账号服务不按版本拒绝带版本请求头的客户端，
  最低版本固定在带这个请求头的最早版本（minimum_versions：桌面端 0.67.0、手机端 1.5.0），不跟着当前版本升高，
  也不再有单独设成必须更新的版本（原来的 hx/brand.json minimumVersions 已去掉）。
- 手机端的“更新 HXBot”整屏提示（hx-forced-update.tsx）随下一次手机端发版改成不挡住；1.5.0 这一版没有变。

v1.6.2～v1.7.0 的做法（留作记录）：新版本发布后，客户端不更新就不能用，而且是自动更新：
- 桌面端：新版本自动下载（不能关闭）；有新版本时整个窗口被“更新 HXBot”对话框挡住，“立即更新”一出现就能点，点了就（下载完）
  重启安装；没人点时下载好 10 分钟后在空闲时自动重启安装（v1.6.3 起，原来是下载完 10 秒后自动重启）；失败可以重试或去下载页
  （src/renderer/src/features/updates/HxForcedUpdate.tsx）。账号服务回答 426 时马上检查新版本（hx-client-header.ts）。
- 手机端：下载中心发布了更新的版本时整屏挡住，自动打开下载或安装；最后一步“安装”系统规定要用户自己点
  （apps/mobile/src/features/app-update/components/hx-forced-update.tsx）。
- 账号服务：每个请求带 X-HXBot-Client（版本），过旧的回答 426；没有这个请求头的旧版本不能再登录；
  升级到这一版时所有登录失效一次（apps/auth-api/src/server/hx-client-version.ts，迁移 9003）。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import brand_rename

BRAND = json.loads((Path(__file__).resolve().parent / "brand.json").read_text(encoding="utf-8"))
VERSIONS = BRAND["versions"]
# 每个桌面端版本的新功能（更新窗口里列出来；打包时写进 latest.yml 的 releaseNotes）
RELEASE_NOTES = json.loads((Path(__file__).resolve().parent / "release-notes.json").read_text(encoding="utf-8"))

TEXT_EN = {
    "update.hxForced.title": "Update HXBot",
    "update.hxForced.body": "HXBot {version} is out. Install it to keep using HXBot.",
    "update.hxForced.starting": "Choose Update now to download and install it.",
    "update.hxForced.downloading": "Downloading the new version…",
    "update.hxForced.downloadingProgress": "Downloading the new version… {progress}%",
    "update.hxForced.ready":
        "The new version is downloaded. Choose Update now to restart HXBot and install it. "
        "If no one does within 10 minutes, HXBot restarts to install it when it is idle.",
    "update.hxForced.installing": "Installing. HXBot restarts by itself.",
    "update.hxForced.failed":
        "The update did not go through. Try again, or download the new version from the download page and install it.",
    "update.hxForced.installNow": "Update now",
    "update.hxForced.afterDownload": "HXBot restarts to install it when the download is done.",
    "update.hxForced.retry": "Try again",
    "update.hxForced.manual": "Open the download page",
    "update.hxOptional.title": "HXBot {version} is ready",
    "update.hxOptional.body": "Here is what is new. Updating takes a moment; your agents and conversations stay as they are.",
    "update.hxOptional.ready": "Downloaded. Choose Update now to restart HXBot and install it, or Later to keep working.",
    "update.hxOptional.later": "Later",
    "update.hxOptional.whatsNew": "What is new",
}
TEXT_ZH = {
    "update.hxForced.title": "更新 HXBot",
    "update.hxForced.body": "HXBot {version} 已发布，更新后才能继续使用。",
    "update.hxForced.starting": "点“立即更新”下载并安装新版本。",
    "update.hxForced.downloading": "正在下载新版本…",
    "update.hxForced.downloadingProgress": "正在下载新版本… {progress}%",
    "update.hxForced.ready": "新版本已下载好。点“立即更新”重启安装；10 分钟内没人点，HXBot 会在空闲时自动重启安装。",
    "update.hxForced.installing": "正在安装，HXBot 会自动重启。",
    "update.hxForced.failed": "更新没有完成。请重试，或者到下载页下载新版本安装。",
    "update.hxForced.installNow": "立即更新",
    "update.hxForced.afterDownload": "下载完 HXBot 会自动重启安装。",
    "update.hxForced.retry": "重试",
    "update.hxForced.manual": "打开下载页",
    "update.hxOptional.title": "HXBot {version} 新版本来了",
    "update.hxOptional.body": "看看有什么新变化。更新只要一会儿，助手和对话都会保留。",
    "update.hxOptional.ready": "已下载好。点“立即更新”重启安装，或者点“以后再说”继续使用。",
    "update.hxOptional.later": "以后再说",
    "update.hxOptional.whatsNew": "新功能",
}
SETTINGS_EN = {
    "settings.updates.hxForced.title": "Automatic updates",
    "settings.updates.hxForced.description":
        "HXBot looks for a new version every few minutes, also while the agents work. It downloads and installs it in "
        "the background, then saves and restarts into it when the agents are idle, or after 10 minutes at most. Agents "
        "that the restart cut off continue by themselves. There is nothing to click.",
}
SETTINGS_ZH = {
    "settings.updates.hxForced.title": "自动更新",
    "settings.updates.hxForced.description":
        "HXBot 每隔几分钟查一次新版本，助手干活时也查。找到后在后台下载、装好，等助手都空闲（最多等 10 分钟）就保存并"
        "重启进入新版；被重启打断的助手重启后自己接着做。不用点。",
}
MOBILE_EN = {
    "mobile.app.hxForced.title": "Update HXBot",
    "mobile.app.hxForced.body": "HXBot {version} is out. Install it to keep using HXBot.",
    "mobile.app.hxForced.androidHint": "When the download is done, open it and follow the steps to install.",
    "mobile.app.hxForced.iosHint": "Tap Install in the window that opens, then wait on the Home Screen until it is installed.",
    "mobile.app.hxForced.update": "Update now",
    "mobile.app.hxForced.manual": "You can also sign in at bot.hxallai.com and download it there.",
    "mobile.app.hxForced.outdated":
        "This version of HXBot is too old to sign in. Sign in at bot.hxallai.com in a browser, download the new version, "
        "install it, then sign in here.",
}
MOBILE_ZH = {
    "mobile.app.hxForced.title": "更新 HXBot",
    "mobile.app.hxForced.body": "HXBot {version} 已发布，更新后才能继续使用。",
    "mobile.app.hxForced.androidHint": "下载完成后打开安装包，按提示安装。",
    "mobile.app.hxForced.iosHint": "在弹出的窗口里点“安装”，回到主屏幕等安装完成。",
    "mobile.app.hxForced.update": "立即更新",
    "mobile.app.hxForced.manual": "也可以在 bot.hxallai.com 登录后下载。",
    "mobile.app.hxForced.outdated": "这个版本的 HXBot 太旧了，不能登录。请用浏览器打开 bot.hxallai.com 登录，下载新版本安装后再登录。",
}


def server(r) -> None:
    handler = "apps/auth-api/src/server/worker-handler.ts"
    brand_rename.add_import(r, handler, 'import { hxClientGate } from "./hx-client-version";')
    r.replace(handler,
              "      const researchPage = hxResearchPageRedirect(request);\n"
              "      if (researchPage) return researchPage;\n",
              "      const researchPage = hxResearchPageRedirect(request);\n"
              "      if (researchPage) return researchPage;\n"
              "      // HXBot: an outdated desktop or phone app is told to update (hx-client-version.ts).\n"
              "      const outdatedClient = hxClientGate(request);\n"
              "      if (outdatedClient) return outdatedClient;\n")
    # 最低版本（v1.7.1 起固定，以后的版本都不拦）：桌面端 0.67.0、手机端 1.5.0（都是带版本请求头的最早版本）
    minimum = minimum_versions()
    r.regex("apps/auth-api/src/server/hx-client-version.ts",
            r'HX_MINIMUM_CLIENT_VERSIONS = \{ desktop: "[0-9.]+", mobile: "[0-9.]+" \}',
            f'HX_MINIMUM_CLIENT_VERSIONS = {{ desktop: "{minimum["desktop"]}", mobile: "{minimum["mobile"]}" }}')


# v1.7.1 起（用户 2026-11-18：以后版本都不拦，自动更新即可）：最低版本固定在带版本请求头的最早版本，
# 不跟着当前版本升高，也不能单独把某个版本设成必须更新
FLOOR = {"desktop": "0.67.0", "mobile": "1.5.0"}


def minimum_versions() -> dict:
    """账号服务接受的最低客户端版本（hx-update-policy.ts 的规则）。"""
    return dict(FLOOR)


def desktop(r) -> None:
    services = "src/main/application-services.ts"
    brand_rename.add_import(r, services, 'import { hxAtMostEvery, hxClientFetch } from "./hx-client-header";')
    r.replace(services,
              "  const centralAuth = new CentralAuthManager({\n"
              "    apiUrl: centralAuthApiUrl,\n",
              "  // HXBot: set once the updater exists. A refused request then looks for the new version at once.\n"
              "  let hxOnOutdated: (() => void) | null = null;\n"
              "  const centralAuth = new CentralAuthManager({\n"
              "    apiUrl: centralAuthApiUrl,\n"
              "    // HXBot: each request names this version, and the account service refuses outdated ones.\n"
              "    fetch: hxClientFetch(fetch, app.getVersion(), () => hxOnOutdated),\n")
    # 账号服务说这个版本太旧（426）：马上检查新版本，“HXBot 有新版本”的对话框随即弹出（最多一分钟查一次）
    r.replace(services,
              '  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => Effect.runPromise(updater.stop()));\n',
              '  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => Effect.runPromise(updater.stop()));\n'
              "  hxOnOutdated = hxAtMostEvery(60_000, () => {\n"
              "    updater.hxSetRequired();\n"
              "    Effect.runFork(updater.checkForUpdates());\n"
              "  });\n")
    # v1.7.1 起（用户 2026-11-18）：找到的新版本自动下载、装好，在空闲时几秒后重启进入新版，不用点；
    # v1.7.3 紧急修正起用着用着找到的也一样（不再等下次打开）。只有账号服务要求必须装的（426），先等 10 分钟让用户点“立即更新”。
    requested = "src/main/requested-update.ts"
    r.replace(requested,
              "  graceMs?: number;\n",
              "  graceMs?: number;\n"
              "  /** HXBot: the wait before the automatic install, which no one asked for, read when it is scheduled. */\n"
              "  automaticGraceMs?: () => number;\n")
    r.replace(requested, "  readonly #graceMs: number;\n", "  readonly #graceMs: number;\n  readonly #automaticGraceMs: () => number;\n")
    r.replace(requested,
              "    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;\n",
              "    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;\n"
              "    this.#automaticGraceMs = options.automaticGraceMs ?? (() => this.#graceMs);\n")
    r.replace(requested,
              "      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);\n"
              "      this.#publish();\n"
              "      this.#scheduleAttempt(this.#graceMs);\n",
              "      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);\n"
              "      this.#publish();\n"
              "      this.#scheduleAttempt(this.#automaticGraceMs());\n")
    r.replace(services,
              "    preference: updatePreference,\n"
              "    savePreference: (change) => writeUpdatePreference(updatePreferenceFile, change),\n",
              "    preference: updatePreference,\n"
              "    // HXBot (v1.7.1, v1.7.3 hotfix): a new version downloads, installs and restarts by itself when the agents are\n"
              "    // idle, with nothing to click, whenever HXBot finds it. Only an update that the account service requires waits\n"
              "    // 10 minutes for Update now first (hx-update-policy.ts).\n"
              "    automaticGraceMs: () => hxAutomaticGraceMs(updater.getStatus()),\n"
              "    hxAutomaticOnlyIf: hxInstallsByItself(() => updater.getStatus()),\n"
              "    savePreference: (change) => writeUpdatePreference(updatePreferenceFile, change),\n")
    # 自动下载、自动安装，不能关闭
    store = "src/main/update-preference-store.ts"
    r.replace(store,
              "    return {\n"
              "      autoDownload: parsed.autoDownload,\n",
              "    return {\n"
              "      // HXBot: updates always download and install by themselves (hx-update-policy.ts).\n"
              "      autoDownload: true,\n")
    r.replace(store,
              "      autoInstall: isBoolean(parsed.autoInstall) ? parsed.autoInstall : DEFAULT_PREFERENCE.autoInstall,\n",
              "      autoInstall: true,\n")
    r.replace(store,
              "const DEFAULT_PREFERENCE: UpdatePreference = { autoDownload: true, allowRemoteUpdates: true, autoInstall: false };\n",
              "const DEFAULT_PREFERENCE: UpdatePreference = { autoDownload: true, allowRemoteUpdates: true, autoInstall: true };\n")
    tab = "packages/ui/src/features/settings/SettingsUpdatesTab.tsx"
    r.replace(tab,
              "              <SwitchField\n"
              '                data-settings-row="settings.updates.autoDownload.title"\n'
              "                checked={props.value.autoDownloadUpdates}\n"
              '                onChange={(checked) => props.onUpdateSetting("autoDownloadUpdates", checked)}\n'
              '                label={t("settings.updates.autoDownload.title")}\n'
              '                description={t("settings.updates.autoDownload.description")}\n'
              "              />\n"
              "              <SwitchField\n"
              '                data-settings-row="settings.updates.autoInstall.title"\n'
              "                checked={props.value.autoInstallUpdates}\n"
              '                onChange={(checked) => props.onUpdateSetting("autoInstallUpdates", checked)}\n'
              '                label={t("settings.updates.autoInstall.title")}\n'
              '                description={t("settings.updates.autoInstall.description")}\n'
              "              />\n",
              "              {/* HXBot: updates download and install by themselves (hx-update-policy.ts). */}\n"
              '              <Item data-settings-row="settings.updates.hxForced.title">\n'
              "                <ItemContent>\n"
              '                  <ItemTitle>{t("settings.updates.hxForced.title")}</ItemTitle>\n'
              '                  <ItemDescription>{t("settings.updates.hxForced.description")}</ItemDescription>\n'
              "                </ItemContent>\n"
              "              </Item>\n")
    overlays = "src/renderer/src/WorkspaceOverlays.tsx"
    brand_rename.add_import(r, overlays, 'import { HxForcedUpdate } from "./features/updates/HxForcedUpdate";')
    r.replace(overlays,
              "    <Loading>\n"
              "      <SettingsModal\n",
              "    <Loading>\n"
              "      {/* HXBot: the window for an update that the account service requires (hx-update-policy.ts). */}\n"
              "      <HxForcedUpdate />\n"
              "      <SettingsModal\n")


def mobile(r) -> None:
    fetch = "apps/mobile/src/features/support/model/logged-fetch.ts"
    r.replace(fetch,
              "/** `expo/fetch` with a support log line for each request. Import it instead of `expo/fetch`. */\n"
              "export const fetch = withRequestLog(expoFetch);\n",
              "/** HXBot: this app and its version, on each request (hx-client-header.ts). */\n"
              "const hxClient = hxClientValue(Platform.OS, Application.nativeApplicationVersion);\n"
              "const hxFetch: typeof expoFetch = (input, init) => {\n"
              "  if (!hxClient) return expoFetch(input, init);\n"
              "  const base = init?.headers ?? (typeof input === \"object\" && \"headers\" in input ? input.headers : undefined);\n"
              "  return expoFetch(input, { ...init, headers: hxClientHeaders(base, hxClient) });\n"
              "};\n"
              "\n"
              "/** `expo/fetch` with a support log line for each request. Import it instead of `expo/fetch`. */\n"
              "export const fetch = withRequestLog(hxFetch);\n")
    brand_rename.add_import(r, fetch, 'import * as Application from "expo-application";')
    brand_rename.add_import(r, fetch, 'import { Platform } from "react-native";')
    brand_rename.add_import(r, fetch, 'import { hxClientHeaders, hxClientValue } from "./hx-client-header";')
    # 登录时服务器说这个版本太旧（426 client_outdated）：说清楚要先更新
    r.replace("apps/mobile/src/features/auth/api/mobile-auth.ts",
              '  ["too_many_code_attempts", "mobile.auth.email.hxPasswordTooMany"],\n]);\n',
              '  ["too_many_code_attempts", "mobile.auth.email.hxPasswordTooMany"],\n'
              '  ["client_outdated", "mobile.app.hxForced.outdated"],\n]);\n')
    layout = "apps/mobile/src/app/(app)/_layout.tsx"
    brand_rename.add_import(r, layout, 'import { HxForcedUpdate } from "@/features/app-update/components/hx-forced-update";')
    r.replace(layout,
              "                <MermaidRendererHost />\n"
              "                <AudioWaveformHost />\n",
              "                <MermaidRendererHost />\n"
              "                <AudioWaveformHost />\n"
              "                {/* HXBot: a published new version must be installed (hx-forced-update.tsx). */}\n"
              "                <HxForcedUpdate />\n")


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/update.ts", "\n});\n", TEXT_EN)
    r.add_messages(f"{messages}/zh/update.ts", "\n} as const satisfies", TEXT_ZH)
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)
    r.add_messages(f"{messages}/en/mobile/app.ts", "\n});\n", MOBILE_EN)
    r.add_messages(f"{messages}/zh/mobile/app.ts", "\n} as const satisfies", MOBILE_ZH)


def update_policy(r) -> None:
    """v1.6.3：平时的新版本可以不装，大版本（主.次 变了）和账号服务拒绝的版本必须装；窗口里列出新功能。"""
    rep_contracts(r)
    service = "src/main/update-service.ts"
    brand_rename.add_import(r, service, 'import { hxReleaseNotesText } from "@hxbot/contracts/hx-update-policy";')
    r.replace(service,
              "  readonly updateInfo: { readonly version: string };\n",
              "  readonly updateInfo: { readonly version: string; readonly releaseNotes?: unknown };\n")
    r.replace(service,
              "this.#markAvailable(result.updateInfo.version);",
              "this.#markAvailable(result.updateInfo.version, result.updateInfo.releaseNotes);", count=2)
    r.replace(service,
              "  #markAvailable(version: string): void {\n"
              "    this.#setStatus({\n"
              '      phase: "available",\n'
              "      availableVersion: version,\n",
              "  #markAvailable(version: string, releaseNotes?: unknown): void {\n"
              "    this.#setStatus({\n"
              '      phase: "available",\n'
              "      availableVersion: version,\n"
              "      // HXBot: what is new in it, for the update window (hx-update-policy.ts).\n"
              "      hxReleaseNotes: hxReleaseNotesText(releaseNotes),\n")
    r.replace(service,
              "  /** Host-managed sessions display host state and never invoke the tenant updater. */\n"
              "  setManagedByHost(managed: boolean): void {\n",
              "  /** HXBot: the account service refused this version (426), so the new one must be installed. */\n"
              "  hxSetRequired(): void {\n"
              "    if (this.#status.hxRequired) return;\n"
              "    this.#setStatus({ hxRequired: true });\n"
              "  }\n"
              "\n"
              "  /** Host-managed sessions display host state and never invoke the tenant updater. */\n"
              "  setManagedByHost(managed: boolean): void {\n")
    # 哪些更新自动安装：打开时找到的和账号服务要求的（v1.7.1 起；v1.6.3～v1.7.0 只有必须更新的版本）
    requested = "src/main/requested-update.ts"
    r.replace(requested,
              "  automaticGraceMs?: () => number;\n",
              "  automaticGraceMs?: () => number;\n"
              "  /** HXBot: which updates install by themselves: found as HXBot opened, or required (hx-update-policy.ts). */\n"
              "  hxAutomaticOnlyIf?: () => boolean;\n")
    r.replace(requested, "  readonly #automaticGraceMs: () => number;\n",
              "  readonly #automaticGraceMs: () => number;\n  readonly #hxAutomaticOnlyIf: () => boolean;\n")
    r.replace(requested,
              "    this.#automaticGraceMs = options.automaticGraceMs ?? (() => this.#graceMs);\n",
              "    this.#automaticGraceMs = options.automaticGraceMs ?? (() => this.#graceMs);\n"
              "    this.#hxAutomaticOnlyIf = options.hxAutomaticOnlyIf ?? (() => true);\n")
    r.replace(requested,
              "    return this.#autoInstall || this.#clientInUse !== null;\n",
              "    return (this.#autoInstall && this.#hxAutomaticOnlyIf()) || this.#clientInUse !== null;\n")
    services = "src/main/application-services.ts"
    brand_rename.add_import(r, services, 'import { hxAutomaticGraceMs, hxInstallsByItself } from "@hxbot/contracts/hx-update-policy";')
    # 这一版的新功能写进 latest.yml（electron-builder 的 releaseInfo）
    notes = RELEASE_NOTES.get(VERSIONS["desktop"])
    if not notes:
        r.errors.append(f"hx/release-notes.json: 没有桌面端 {VERSIONS['desktop']} 的新功能")
        return
    text = json.dumps({"version": VERSIONS["desktop"], "zh": notes["zh"], "en": notes["en"]}, ensure_ascii=False)
    block = ("# HXBot: what is new in this version, for the update window (hx/release-notes.json).\n"
             f"releaseInfo:\n  releaseNotes: {json.dumps(text, ensure_ascii=False)}\n")
    # v1.7.1: a tree that already has the block of an earlier version, or of earlier notes, keeps one block only.
    # A second releaseInfo is a duplicate YAML key, and electron-builder takes the wrong notes or stops.
    builder = r.read("electron-builder.yml")
    seen = []
    def keep(match):
        if match.group(0) == block and not seen:
            seen.append(True)
            return match.group(0)
        return ""
    kept = re.sub(r"# HXBot: what is new in this version, for the update window \(hx/release-notes\.json\)\.\n"
                  r"releaseInfo:\n  releaseNotes: [^\n]*\n", keep, builder)
    if kept != builder:
        r.write("electron-builder.yml", kept)
    r.replace("electron-builder.yml",
              f"publish:\n  provider: generic\n  url: {r.SITE}/updates/desktop\n",
              f"publish:\n  provider: generic\n  url: {r.SITE}/updates/desktop\n" + block)


def rep_contracts(r) -> None:
    r.replace("packages/contracts/package.json",
              '    "./live-activity-relay": "./src/live-activity-relay.ts",\n',
              '    "./hx-update-policy": "./src/hx-update-policy.ts",\n'
              '    "./live-activity-relay": "./src/live-activity-relay.ts",\n')
    r.replace("packages/contracts/src/ipc-app-auth.ts",
              "  /** A restart that the user of this computer asked for. Absent when none waits. */\n"
              "  idleRestart?: IdleRestart;\n"
              "}\n",
              "  /** A restart that the user of this computer asked for. Absent when none waits. */\n"
              "  idleRestart?: IdleRestart;\n"
              "  /** HXBot: the account service refused this version, so the update must be installed. */\n"
              "  hxRequired?: boolean;\n"
              "  /** HXBot: what is new in the available version (hx/release-notes.json, as JSON). */\n"
              "  hxReleaseNotes?: string | null;\n"
              "}\n")


def forced_updates(r) -> None:
    server(r)
    desktop(r)
    update_policy(r)
    mobile(r)
    text(r)
