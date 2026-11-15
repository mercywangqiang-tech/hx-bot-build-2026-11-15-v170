"""HXBot v1.6.5：在“添加服务商”里连接 OpenCode 的全部服务商（hx-opencode）。

“添加服务商或助手”里多一组“OpenCode 全部服务商”；服务商设置页底部多一行，打开同一个窗口。
窗口里是 OpenCode 自己的服务商清单（含免费模型），每家按 OpenCode 提供的方式连接：网页登录、
API 密钥、本机已有的凭据。连接通过 HXBot 临时起的、只在本机、带随机密码的 OpenCode 服务完成，
凭据由 OpenCode 自己保存；连完 OpenCode 空闲时重启，新模型进入智能体的模型选择和自动选择模型。

HX 自己的文件（同步清单里）：
  packages/contracts/src/hx-opencode.ts          请求和回答的形状、主进程和界面两边的检查
  src/backend/hx-opencode/{catalog,server,service,names}.ts
  src/renderer/src/features/hx-opencode/*          窗口、设置页那一行、样式、请求
  src/renderer/src/preview/hx-opencode-mock.ts     预览和故事板用的几家服务商
这里按上游原来的文件名和包名定位（mock-openbot.ts、@openbot/…），所以在 brand_rename.EXCLUDE_CONTENT 里。
"""

from __future__ import annotations

import brand_rename

TEXT_EN = {
    "settings.hxOpenCode.presetGroup": "OpenCode",
    "settings.hxOpenCode.presetTitle": "All OpenCode services",
    "settings.hxOpenCode.presetDescription": "Free models, browser sign-in or an API key, for 200+ services",
    "settings.hxOpenCode.title": "All OpenCode services",
    "settings.hxOpenCode.subtitle": "Connected models show in each agent's model list and in auto model.",
    "settings.hxOpenCode.search": "Search services",
    "settings.hxOpenCode.loading": "Reading OpenCode's services…",
    "settings.hxOpenCode.missing": "OpenCode is not installed. Download OpenCode in the provider list first.",
    "settings.hxOpenCode.old":
        "OpenCode {version} is on this computer. Connecting needs version 2 or later. Update OpenCode in the "
        "provider list first.",
    "settings.hxOpenCode.failed": "OpenCode did not give its service list: {detail}",
    "settings.hxOpenCode.retry": "Try again",
    "settings.hxOpenCode.freeTitle": "OpenCode Free",
    "settings.hxOpenCode.freeDetail": "Free models: {count}. No sign-in. Ready to use.",
    "settings.hxOpenCode.ready": "Ready",
    "settings.hxOpenCode.connected": "Connected",
    "settings.hxOpenCode.models": "Models: {count}",
    "settings.hxOpenCode.way.oauth": "Browser sign-in",
    "settings.hxOpenCode.way.key": "API key",
    "settings.hxOpenCode.way.external": "Credentials on this computer",
    "settings.hxOpenCode.way.env": "Environment variable",
    "settings.hxOpenCode.signInWith": "Sign in: {label}",
    "settings.hxOpenCode.useKey": "Paste an API key",
    "settings.hxOpenCode.useExternal": "Use: {label}",
    "settings.hxOpenCode.envHint": "OpenCode also reads {names}.",
    "settings.hxOpenCode.connection.key": "{label} · API key",
    "settings.hxOpenCode.connection.oauth": "{label} · browser sign-in",
    "settings.hxOpenCode.connection.external": "{label} · credentials on this computer",
    "settings.hxOpenCode.connection.env": "Environment variable {name}",
    "settings.hxOpenCode.disconnect": "Disconnect",
    "settings.hxOpenCode.keyLabel": "API key",
    "settings.hxOpenCode.keyPlaceholder": "Paste the key",
    "settings.hxOpenCode.connect": "Connect",
    "settings.hxOpenCode.cancel": "Cancel",
    "settings.hxOpenCode.waiting":
        "The sign-in page is open in your browser. When you finish there, this updates by itself.",
    "settings.hxOpenCode.reopen": "Open the sign-in page again",
    "settings.hxOpenCode.codeLabel": "Code from the sign-in page",
    "settings.hxOpenCode.submitCode": "Send code",
    "settings.hxOpenCode.expired": "The sign-in expired. Start it again.",
    "settings.hxOpenCode.signInFailed": "The sign-in did not complete: {detail}",
    "settings.hxOpenCode.done":
        "{name} is connected. OpenCode restarts when it is idle, then the new models show in the model list.",
    "settings.hxOpenCode.removed": "{name} is disconnected.",
    "settings.hxOpenCode.error": "That did not work: {detail}",
    "settings.hxOpenCode.unknown": "No reason was given.",
    "settings.hxOpenCode.note":
        "OpenCode keeps the credentials on this computer, as opencode auth login does. HXBot keeps no copy.",
    "settings.hxOpenCode.openPage": "Open the page",
    "settings.hxOpenCode.empty": "No service matches “{query}”.",
    "settings.hxOpenCode.sectionDescription":
        "Connect any of OpenCode's 200+ services, free models included. Connected models show in each agent's "
        "model list.",
    "settings.hxOpenCode.sectionOpen": "Connect services",
    "settings.hxOpenCode.noWay": "Connect this service in a terminal with opencode auth login.",
    "settings.hxOpenCode.requiredMissing": "Fill in: {field}",
}

TEXT_ZH = {
    "settings.hxOpenCode.presetGroup": "OpenCode",
    "settings.hxOpenCode.presetTitle": "OpenCode 全部服务商",
    "settings.hxOpenCode.presetDescription": "200 多家服务商：免费模型、网页登录或 API 密钥",
    "settings.hxOpenCode.title": "OpenCode 全部服务商",
    "settings.hxOpenCode.subtitle": "连接后，这些模型出现在智能体的模型选择里，也进入自动选择模型的范围。",
    "settings.hxOpenCode.search": "搜索服务商",
    "settings.hxOpenCode.loading": "正在读取 OpenCode 的服务商…",
    "settings.hxOpenCode.missing": "OpenCode 还没有安装。先在服务商列表里下载 OpenCode。",
    "settings.hxOpenCode.old": "这台电脑上的 OpenCode 是 {version}，连接需要 2 或更新的版本。先在服务商列表里更新 OpenCode。",
    "settings.hxOpenCode.failed": "OpenCode 没有给出服务商列表：{detail}",
    "settings.hxOpenCode.retry": "重试",
    "settings.hxOpenCode.freeTitle": "OpenCode Free",
    "settings.hxOpenCode.freeDetail": "免费模型 {count} 个，无需登录，已可用。",
    "settings.hxOpenCode.ready": "已可用",
    "settings.hxOpenCode.connected": "已连接",
    "settings.hxOpenCode.models": "{count} 个模型",
    "settings.hxOpenCode.way.oauth": "网页登录",
    "settings.hxOpenCode.way.key": "API 密钥",
    "settings.hxOpenCode.way.external": "本机凭据",
    "settings.hxOpenCode.way.env": "环境变量",
    "settings.hxOpenCode.signInWith": "网页登录：{label}",
    "settings.hxOpenCode.useKey": "粘贴 API 密钥",
    "settings.hxOpenCode.useExternal": "使用本机凭据：{label}",
    "settings.hxOpenCode.envHint": "OpenCode 也会读取环境变量 {names}。",
    "settings.hxOpenCode.connection.key": "{label} · API 密钥",
    "settings.hxOpenCode.connection.oauth": "{label} · 网页登录",
    "settings.hxOpenCode.connection.external": "{label} · 本机凭据",
    "settings.hxOpenCode.connection.env": "环境变量 {name}",
    "settings.hxOpenCode.disconnect": "断开",
    "settings.hxOpenCode.keyLabel": "API 密钥",
    "settings.hxOpenCode.keyPlaceholder": "粘贴密钥",
    "settings.hxOpenCode.connect": "连接",
    "settings.hxOpenCode.cancel": "取消",
    "settings.hxOpenCode.waiting": "已在浏览器打开登录页。在那里完成登录后，这里会自动更新。",
    "settings.hxOpenCode.reopen": "再次打开登录页",
    "settings.hxOpenCode.codeLabel": "登录页显示的代码",
    "settings.hxOpenCode.submitCode": "提交代码",
    "settings.hxOpenCode.expired": "登录已过期，请重新开始。",
    "settings.hxOpenCode.signInFailed": "登录没有完成：{detail}",
    "settings.hxOpenCode.done": "已连接 {name}。OpenCode 空闲时会重启，之后新模型出现在模型选择里。",
    "settings.hxOpenCode.removed": "已断开 {name}。",
    "settings.hxOpenCode.error": "操作没有完成：{detail}",
    "settings.hxOpenCode.unknown": "没有说明原因。",
    "settings.hxOpenCode.note": "凭据由 OpenCode 保存在这台电脑上（和在终端里运行 opencode auth login 一样），HXBot 不另存。",
    "settings.hxOpenCode.openPage": "打开说明页",
    "settings.hxOpenCode.empty": "没有匹配“{query}”的服务商。",
    "settings.hxOpenCode.sectionDescription": "连接 OpenCode 里的 200 多家服务商（含免费模型）。连上的模型出现在智能体的模型选择里。",
    "settings.hxOpenCode.sectionOpen": "连接服务商",
    "settings.hxOpenCode.noWay": "这家需要在终端里用 opencode auth login 连接。",
    "settings.hxOpenCode.requiredMissing": "请填写：{field}",
}

ENDPOINTS = (
    "    // HXBot: every OpenCode service, connected through the OpenCode of this computer (hx-opencode).\n"
    '    hxOpenCodeCatalog: request<undefined, HxOcCatalog>()("app:hx-opencode-catalog"),\n'
    '    hxOpenCodeConnectKey: request<HxOcKeyInput, HxOcCatalog>()("app:hx-opencode-connect-key"),\n'
    '    hxOpenCodeConnectExternal: request<HxOcMethodInput, HxOcCatalog>()("app:hx-opencode-connect-external"),\n'
    '    hxOpenCodeStartSignIn: request<HxOcMethodInput, HxOcAttempt>()("app:hx-opencode-start-sign-in"),\n'
    '    hxOpenCodeSignInStatus: request<HxOcAttemptRef, HxOcAttemptStatus>()("app:hx-opencode-sign-in-status"),\n'
    '    hxOpenCodeCompleteSignIn: request<HxOcCompleteInput, HxOcAttemptStatus>()("app:hx-opencode-complete-sign-in"),\n'
    '    hxOpenCodeCancelSignIn: request<HxOcAttemptRef, void>()("app:hx-opencode-cancel-sign-in"),\n'
    '    hxOpenCodeDisconnect: request<HxOcDisconnectInput, HxOcCatalog>()("app:hx-opencode-disconnect"),\n'
)

HANDLERS = (
    "      // HXBot: every OpenCode service (hx-opencode). Main checks each input; OpenCode keeps the credential.\n"
    "      hxOpenCodeCatalog: handler(() => hxOpenCode.catalog()),\n"
    "      hxOpenCodeConnectKey: payloadHandler(decodeHxOcKeyInput, (input) => hxOpenCode.connectKey(input)),\n"
    "      hxOpenCodeConnectExternal: payloadHandler(decodeHxOcMethodInput, (input) => hxOpenCode.connectExternal(input)),\n"
    "      hxOpenCodeStartSignIn: payloadHandler(decodeHxOcMethodInput, (input) => hxOpenCode.startSignIn(input)),\n"
    "      hxOpenCodeSignInStatus: payloadHandler(decodeHxOcAttemptRef, (input) => hxOpenCode.signInStatus(input)),\n"
    "      hxOpenCodeCompleteSignIn: payloadHandler(decodeHxOcCompleteInput, (input) => hxOpenCode.completeSignIn(input)),\n"
    "      hxOpenCodeCancelSignIn: payloadHandler(decodeHxOcAttemptRef, (input) => hxOpenCode.cancelSignIn(input)),\n"
    "      hxOpenCodeDisconnect: payloadHandler(decodeHxOcDisconnectInput, (input) => hxOpenCode.disconnect(input)),\n"
)

PRESET_GROUP = (
    "            <div class=\"custom-provider-list\">\n"
    "              {/* HXBot: every OpenCode service, where OpenCode is this computer's (hx-opencode). */}\n"
    "              <Show when={props.onOpenCode}>\n"
    "                <section class=\"custom-provider-preset-group\" aria-label={t(\"settings.hxOpenCode.presetGroup\")}>\n"
    "                  <Text variant=\"label-sm\" tone=\"muted\">\n"
    "                    {t(\"settings.hxOpenCode.presetGroup\")}\n"
    "                  </Text>\n"
    "                  <ul class=\"custom-provider-presets\">\n"
    "                    <li>\n"
    "                      <Button\n"
    "                        type=\"button\"\n"
    "                        variant=\"ghost\"\n"
    "                        class=\"custom-provider-preset\"\n"
    "                        onClick={() => props.onOpenCode?.()}\n"
    "                      >\n"
    "                        <span class=\"custom-provider-preset-icon\" aria-hidden=\"true\">\n"
    "                          <Plug />\n"
    "                        </span>\n"
    "                        <span class=\"custom-provider-preset-copy\">\n"
    "                          <span class=\"custom-provider-preset-title\">{t(\"settings.hxOpenCode.presetTitle\")}</span>\n"
    "                          <span class=\"custom-provider-preset-description\">\n"
    "                            {t(\"settings.hxOpenCode.presetDescription\")}\n"
    "                          </span>\n"
    "                        </span>\n"
    "                        <ChevronRight class=\"custom-provider-preset-chevron\" aria-hidden=\"true\" />\n"
    "                      </Button>\n"
    "                    </li>\n"
    "                  </ul>\n"
    "                </section>\n"
    "              </Show>\n"
)


def contracts(r) -> None:
    # 排在自动选模型那一行之前（auto_model.py 加的），那一步的定位不受影响
    r.replace("packages/contracts/package.json",
              '    "./hx-auto-model": "./src/hx-auto-model.ts",\n',
              '    "./hx-opencode": "./src/hx-opencode.ts",\n'
              '    "./hx-auto-model": "./src/hx-auto-model.ts",\n')
    endpoints = "packages/contracts/src/ipc-endpoints.ts"
    brand_rename.add_import(
        r, endpoints,
        "import type {\n  HxOcAttempt,\n  HxOcAttemptRef,\n  HxOcAttemptStatus,\n  HxOcCatalog,\n  HxOcCompleteInput,\n"
        "  HxOcDisconnectInput,\n  HxOcKeyInput,\n  HxOcMethodInput,\n} from \"./hx-opencode\";")
    anchor = '    cancelProviderRestart: request<AgentProviderId, AgentStatus>()("app:cancel-provider-restart"),\n'
    r.replace(endpoints, anchor, anchor + ENDPOINTS)


def main_process(r) -> None:
    handlers = "src/main/ipc/provider-handlers.ts"
    brand_rename.add_import(r, handlers, 'import { hxOpenCode } from "../../backend/hx-opencode/service";')
    brand_rename.add_import(r, handlers, 'import { resolveInstalledFirst, resolveOpencodeCli } from "../../backend/cli";')
    brand_rename.add_import(
        r, handlers,
        "import {\n  decodeHxOcAttemptRef,\n  decodeHxOcCompleteInput,\n  decodeHxOcDisconnectInput,\n  decodeHxOcKeyInput,\n"
        "  decodeHxOcMethodInput,\n} from \"@openbot/contracts/hx-opencode\";")
    head = '}: ProviderIpcDependencies): Pick<IpcGroupHandlers, "providers" | "providerRuntimes"> {\n'
    r.replace(handlers, head,
              head +
              "  // HXBot: the OpenCode services connect through the OpenCode that the agents run (hx-opencode).\n"
              "  hxOpenCode.configure({\n"
              "    resolveCli: () =>\n"
              "      Effect.runPromise(\n"
              "        resolveInstalledFirst(\n"
              "          (input) => resolveOpencodeCli(input),\n"
              "          providerRuntimes.bundledExecutables().opencode,\n"
              "          true,\n"
              "        ),\n"
              "      ),\n"
              "    openLink,\n"
              "    changed: async () => {\n"
              '      await runCauseEffect(service.restartProvider("opencode"));\n'
              "    },\n"
              "  });\n")
    anchor = ("      cancelProviderRestart: payloadHandler(parseProviderId, async (provider) =>\n"
              "        service.cancelProviderRestart(provider),\n"
              "      ),\n")
    r.replace(handlers, anchor, anchor + HANDLERS)

    preload = "src/preload/index.ts"
    brand_rename.add_import(
        r, preload,
        'import { decodeHxOcAttempt, decodeHxOcAttemptStatus, decodeHxOcCatalog } from "@openbot/contracts/hx-opencode";')
    anchor = "    cancelProviderRestart: decodeAgentStatusFromMain,\n"
    r.replace(preload, anchor,
              anchor +
              "    hxOpenCodeCatalog: decodeHxOcCatalog,\n"
              "    hxOpenCodeConnectKey: decodeHxOcCatalog,\n"
              "    hxOpenCodeConnectExternal: decodeHxOcCatalog,\n"
              "    hxOpenCodeStartSignIn: decodeHxOcAttempt,\n"
              "    hxOpenCodeSignInStatus: decodeHxOcAttemptStatus,\n"
              "    hxOpenCodeCompleteSignIn: decodeHxOcAttemptStatus,\n"
              "    hxOpenCodeCancelSignIn: decodeVoid,\n"
              "    hxOpenCodeDisconnect: decodeHxOcCatalog,\n")

    # 模型列表里用服务商的名字：deepseek/… 显示成 DeepSeek/…
    config = "src/backend/opencode-config.ts"
    brand_rename.add_import(r, config, 'import { hxOpenCodeNames } from "./hx-opencode/names";')
    r.replace(config,
              "    source().find((provider) => provider.id === providerId)?.name ?? OPENCODE_PROVIDER_NAMES[providerId];\n",
              "    source().find((provider) => provider.id === providerId)?.name ??\n"
              "    OPENCODE_PROVIDER_NAMES[providerId] ??\n"
              "    // HXBot: a service connected from the OpenCode services dialog (hx-opencode).\n"
              "    hxOpenCodeNames.name(providerId);\n")

    services = "src/main/application-services.ts"
    brand_rename.add_import(r, services, 'import { hxOpenCodeNames } from "../backend/hx-opencode/names";')
    anchor = '  hxAutoModelStore.open(join(app.getPath("userData"), "hx-auto-model"));\n'
    r.replace(services, anchor,
              anchor +
              "  // HXBot: the names of the OpenCode services the user connected, for the model list (hx-opencode).\n"
              '  hxOpenCodeNames.open(join(app.getPath("userData"), "hx-opencode"));\n')


def renderer(r) -> None:
    mock = "src/renderer/src/preview/mock-openbot.ts"
    brand_rename.add_import(r, mock, 'import { hxOpenCodePreview } from "./hx-opencode-mock";')
    anchor = "    cancelProviderRestart: async () => clone(agentStatus),\n"
    r.replace(mock, anchor, anchor + "    ...hxOpenCodePreview,\n")

    dialog = "packages/ui/src/features/custom-providers/CustomProviderPresetDialog.tsx"
    r.replace(dialog, "  Plus,\n  Text,\n  X,\n", "  Plug,\n  Plus,\n  Text,\n  X,\n")
    r.replace(dialog,
              "  onChoose: (preset: CustomProviderPresetId) => void;\n  onCancel: () => void;\n}\n",
              "  onChoose: (preset: CustomProviderPresetId) => void;\n  onCancel: () => void;\n"
              "  /** HXBot: opens every OpenCode service (hx-opencode). Absent where OpenCode is not this computer's. */\n"
              "  onOpenCode?: (() => void) | undefined;\n}\n")
    r.replace(dialog, '            <div class="custom-provider-list">\n', PRESET_GROUP)

    section = "src/renderer/src/features/settings/ProviderSettingsSection.tsx"
    brand_rename.add_import(r, section, 'import { HxOpenCodeDialog } from "../hx-opencode/HxOpenCodeDialog";')
    brand_rename.add_import(r, section, 'import { HxOpenCodeSection } from "../hx-opencode/HxOpenCodeSection";')
    anchor = "  const [presetFor, setPresetFor] = createSignal<DetectedProvider | null>(null);\n"
    r.replace(section, anchor,
              anchor +
              "  // HXBot: every OpenCode service, from the add dialog and from the line under the list (hx-opencode).\n"
              "  const [hxOpenCodeOpen, setHxOpenCodeOpen] = createSignal(false);\n")
    r.replace(section,
              "              onCancel={() => setChoosing(false)}\n",
              "              onCancel={() => setChoosing(false)}\n"
              "              onOpenCode={() => {\n"
              "                setChoosing(false);\n"
              "                setHxOpenCodeOpen(true);\n"
              "              }}\n")
    r.replace(section,
              "              onClose={() => setPresetFor(null)}\n"
              "              onSaved={host.showSaved}\n"
              "            />\n"
              "          </>\n",
              "              onClose={() => setPresetFor(null)}\n"
              "              onSaved={host.showSaved}\n"
              "            />\n"
              "            <HxOpenCodeDialog open={hxOpenCodeOpen()} onClose={() => setHxOpenCodeOpen(false)} />\n"
              "          </>\n")
    r.replace(section,
              "          <>\n"
              "            <Show when={props.providerDetection}>\n",
              "          <>\n"
              "            <Show when={detectedApi()}>\n"
              "              <HxOpenCodeSection onOpen={() => setHxOpenCodeOpen(true)} />\n"
              "            </Show>\n"
              "            <Show when={props.providerDetection}>\n")

    r.replace("src/renderer/src/styles.css",
              '@import "@openbot/ui/features/custom-providers/custom-providers.css";\n',
              '@import "@openbot/ui/features/custom-providers/custom-providers.css";\n'
              '@import "./features/hx-opencode/hx-opencode.css";\n')


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", TEXT_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", TEXT_ZH)


def apply(r) -> None:
    contracts(r)
    main_process(r)
    renderer(r)
    text(r)
