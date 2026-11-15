"""客户端在应用里更新：rebrand.py 的一步（v1.6.2 起）。

桌面端从 HXBot 自己的服务器取更新（https://<站点>/updates/desktop/，electron-builder 的 generic 方式，
地址写进安装包的 app-update.yml）。每个请求带 HXBot 的登录令牌，nginx 交给账号服务校验，没登录取不到。
Windows、Linux 用 electron-updater：服务器上有旧版本的 .blockmap 时只下载变化的块（增量）。
Mac 用 src/main/hx-updates.ts 的 HxMacUpdateAdapter：研究版没有苹果开发者签名，electron-updater 在 Mac 上
用的 Squirrel.Mac 只肯装签名相同的新版本，所以改为下载新版本的 ZIP，HXBot 退出后由脚本替换应用再打开。
手机端“有新版本”的按钮：读服务器的 /updates/mobile.json（同样带登录令牌），安卓打开新安装包的下载地址，
iPhone 打开无线安装链接或 TestFlight（apps/mobile/src/features/app-update/model/hx-app-update.ts）。

这里只做上游文件里的接线。由 rebrand.py 调用 updates(r)，r 是 rebrand 模块本身。
"""

from __future__ import annotations

import brand_rename  # 同目录：add_import


def desktop(r) -> None:
    # 登录令牌：只给更新用（HxMacUpdateAdapter、hxAuthorizedUpdater 放进 Authorization 请求头）
    r.replace("src/main/central-auth-manager.ts",
              '  readonly downloadAuthorized = Effect.fn("CentralAuth.downloadAuthorized")(\n',
              "  /** HXBot: the session of the signed-in user, for the update requests (hx-updates.ts); null signed out. */\n"
              "  hxSessionToken(): string | null {\n"
              "    return this.#sessionToken;\n"
              "  }\n\n"
              '  readonly downloadAuthorized = Effect.fn("CentralAuth.downloadAuthorized")(\n')

    services = "src/main/application-services.ts"
    brand_rename.add_import(r, services, 'import { HxMacUpdateAdapter, hxAuthorizedUpdater, hxReadUpdateFeedUrl } from "./hx-updates";')
    brand_rename.add_import(r, services, 'import { hxUserInHxbot } from "./hx-ask-first";')
    r.replace(services,
              "  } else if (updatesEnabled) {\n"
              "    const realAdapter = await loadElectronUpdater();\n"
              "    if (realAdapter) {\n"
              "      updateAdapter = realAdapter;\n"
              "      updaterCacheDirectory = electronUpdaterCacheDirectory();\n",
              "  } else if (updatesEnabled && process.platform === \"darwin\") {\n"
              "    // HXBot: the research edition has no Apple Developer ID signature, which Squirrel.Mac needs. The\n"
              "    // adapter downloads the ZIP of the new version and replaces the app after it quits (hx-updates.ts).\n"
              "    const feedUrl = hxReadUpdateFeedUrl(process.resourcesPath);\n"
              "    if (feedUrl) {\n"
              "      updaterCacheDirectory = electronUpdaterCacheDirectory();\n"
              "      updateAdapter = new HxMacUpdateAdapter({\n"
              "        feedUrl,\n"
              "        currentVersion,\n"
              "        arch: process.arch,\n"
              "        sessionToken: () => centralAuth.hxSessionToken(),\n"
              "        cacheDirectory: updaterCacheDirectory,\n"
              "        executablePath: app.getPath(\"exe\"),\n"
              "        logPath: join(app.getPath(\"userData\"), \"logs\", \"update\", \"install.log\"),\n"
              "        pid: process.pid,\n"
              "        quit: () => app.quit(),\n"
              "        userInFront: hxUserInHxbot,\n"
              "      });\n"
              "    } else {\n"
              "      updaterEnabled = false;\n"
              "    }\n"
              "  } else if (updatesEnabled) {\n"
              "    const realAdapter = await loadElectronUpdater();\n"
              "    if (realAdapter) {\n"
              "      // HXBot: each request carries the HXBot session; the server gives updates only to signed-in clients.\n"
              "      updateAdapter = hxAuthorizedUpdater(realAdapter, () => centralAuth.hxSessionToken());\n"
              "      updaterCacheDirectory = electronUpdaterCacheDirectory();\n")


def mobile(r) -> None:
    model = "apps/mobile/src/features/app-update/model/app-update.ts"
    brand_rename.add_import(r, model, 'import { hxOpenNewVersion, hxRememberUpdateSession } from "./hx-app-update";')
    r.replace(model,
              "  const { session } = useMobileSession();\n"
              "  const apiUrl = session?.apiUrl ?? null;\n"
              "  const latest = useLatestAppVersion(apiUrl ?? \"\");\n",
              "  const { session } = useMobileSession();\n"
              "  // HXBot: the install button asks the HXBot server where the new version is (hx-app-update.ts).\n"
              "  hxRememberUpdateSession(session ? { apiUrl: session.apiUrl, sessionToken: session.sessionToken } : null);\n"
              "  const apiUrl = session?.apiUrl ?? null;\n"
              "  const latest = useLatestAppVersion(apiUrl ?? \"\");\n")
    r.replace(model,
              "  const [url, webUrl] = isIOS ? [IOS_STORE_URL, IOS_STORE_WEB_URL] : [ANDROID_STORE_URL, ANDROID_STORE_WEB_URL];\n",
              "  // HXBot: the new version comes from the HXBot server: the installer on Android, the install link or\n"
              "  // TestFlight on iPhone. Without that answer, the portal opens, where the download page is.\n"
              "  if (await hxOpenNewVersion(isIOS ? \"ios\" : \"android\", (url) => Linking.openURL(url))) return;\n"
              "  const [url, webUrl] = isIOS ? [IOS_STORE_URL, IOS_STORE_WEB_URL] : [ANDROID_STORE_URL, ANDROID_STORE_WEB_URL];\n")


def updates(r) -> None:
    desktop(r)
    mobile(r)
