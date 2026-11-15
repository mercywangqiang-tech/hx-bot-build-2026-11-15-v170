"""HXBot：强制更新（v1.6.2）。

新版本发布后，客户端不更新就不能用，而且是自动更新：
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
from pathlib import Path

import brand_rename

BRAND = json.loads((Path(__file__).resolve().parent / "brand.json").read_text(encoding="utf-8"))
VERSIONS = BRAND["versions"]
MINIMUM = BRAND.get("minimumVersions", {})
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
        "HXBot downloads each new version by itself. Choose Update now in the window that opens to install it; "
        "if no one does within 10 minutes, HXBot installs it when it is idle. Until a new version is installed, HXBot cannot be used.",
}
SETTINGS_ZH = {
    "settings.updates.hxForced.title": "自动更新",
    "settings.updates.hxForced.description":
        "HXBot 自动下载每个新版本，在弹出的窗口里点“立即更新”安装；10 分钟内没人点，会在空闲时自动安装。新版本装好之前不能使用。",
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
    # 最低版本（v1.6.3 起）：桌面端是这一版的 主.次.0（0.67.x 都能用，0.68.0 起旧的大版本必须更新），手机端是这一版；
    # brand.json 的 minimumVersions 写了就以它为准（某个小版本必须马上装时）
    minimum = minimum_versions()
    r.regex("apps/auth-api/src/server/hx-client-version.ts",
            r'HX_MINIMUM_CLIENT_VERSIONS = \{ desktop: "[0-9.]+", mobile: "[0-9.]+" \}',
            f'HX_MINIMUM_CLIENT_VERSIONS = {{ desktop: "{minimum["desktop"]}", mobile: "{minimum["mobile"]}" }}')


def minimum_versions() -> dict:
    """账号服务接受的最低客户端版本（hx-update-policy.ts 的规则）。"""
    major, minor = VERSIONS["desktop"].split(".")[:2]
    rule = {"desktop": f"{major}.{minor}.0", "mobile": VERSIONS["mobile"]}
    return {**rule, **{key: value for key, value in MINIMUM.items() if key in rule and value}}


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
    # 下载好的新版本先等用户点“立即更新”：没人点时 10 分钟后才在空闲时自动重启安装（没人看着的电脑也会更新）
    requested = "src/main/requested-update.ts"
    r.replace(requested,
              "  graceMs?: number;\n",
              "  graceMs?: number;\n"
              "  /** HXBot: the wait before the automatic install, which no one asked for. The user can choose Update now first. */\n"
              "  automaticGraceMs?: number;\n")
    r.replace(requested, "  readonly #graceMs: number;\n", "  readonly #graceMs: number;\n  readonly #automaticGraceMs: number;\n")
    r.replace(requested,
              "    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;\n",
              "    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;\n"
              "    this.#automaticGraceMs = options.automaticGraceMs ?? this.#graceMs;\n")
    r.replace(requested,
              "      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);\n"
              "      this.#publish();\n"
              "      this.#scheduleAttempt(this.#graceMs);\n",
              "      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);\n"
              "      this.#publish();\n"
              "      this.#scheduleAttempt(this.#automaticGraceMs);\n")
    r.replace(services,
              "    preference: updatePreference,\n"
              "    savePreference: (change) => writeUpdatePreference(updatePreferenceFile, change),\n",
              "    preference: updatePreference,\n"
              "    // HXBot: the window asks the user to choose Update now; without that, the install waits 10 minutes,\n"
              "    // and only an update that must be installed installs by itself (hx-update-policy.ts).\n"
              "    automaticGraceMs: 10 * 60_000,\n"
              "    hxAutomaticOnlyIf: () => hxUpdateIsRequired(updater.getStatus()),\n"
              "    savePreference: (change) => writeUpdatePreference(updatePreferenceFile, change),\n")
    # 自动下载、自动安装，不能关闭
    store = "src/main/update-preference-store.ts"
    r.replace(store,
              "    return {\n"
              "      autoDownload: parsed.autoDownload,\n",
              "    return {\n"
              "      // HXBot: updates are required, so they always download and install by themselves.\n"
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
              "              {/* HXBot: updates are required; they download and install by themselves. */}\n"
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
              "      {/* HXBot: a new version must be installed before HXBot can be used. */}\n"
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
    # 自动安装只给必须更新的版本；可以不装的版本由用户在窗口里决定
    requested = "src/main/requested-update.ts"
    r.replace(requested,
              "  automaticGraceMs?: number;\n",
              "  automaticGraceMs?: number;\n"
              "  /** HXBot: the automatic install is only for an update that must be installed (hx-update-policy.ts). */\n"
              "  hxAutomaticOnlyIf?: () => boolean;\n")
    r.replace(requested, "  readonly #automaticGraceMs: number;\n",
              "  readonly #automaticGraceMs: number;\n  readonly #hxAutomaticOnlyIf: () => boolean;\n")
    r.replace(requested,
              "    this.#automaticGraceMs = options.automaticGraceMs ?? this.#graceMs;\n",
              "    this.#automaticGraceMs = options.automaticGraceMs ?? this.#graceMs;\n"
              "    this.#hxAutomaticOnlyIf = options.hxAutomaticOnlyIf ?? (() => true);\n")
    r.replace(requested,
              "    return this.#autoInstall || this.#clientInUse !== null;\n",
              "    return (this.#autoInstall && this.#hxAutomaticOnlyIf()) || this.#clientInUse !== null;\n")
    services = "src/main/application-services.ts"
    brand_rename.add_import(r, services, 'import { hxUpdateIsRequired } from "@hxbot/contracts/hx-update-policy";')
    # 这一版的新功能写进 latest.yml（electron-builder 的 releaseInfo）
    notes = RELEASE_NOTES.get(VERSIONS["desktop"])
    if not notes:
        r.errors.append(f"hx/release-notes.json: 没有桌面端 {VERSIONS['desktop']} 的新功能")
        return
    text = json.dumps({"version": VERSIONS["desktop"], "zh": notes["zh"], "en": notes["en"]}, ensure_ascii=False)
    r.replace("electron-builder.yml",
              f"publish:\n  provider: generic\n  url: {r.SITE}/updates/desktop\n",
              f"publish:\n  provider: generic\n  url: {r.SITE}/updates/desktop\n"
              "# HXBot: what is new in this version, for the update window (hx/release-notes.json).\n"
              f"releaseInfo:\n  releaseNotes: {json.dumps(text, ensure_ascii=False)}\n")


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
