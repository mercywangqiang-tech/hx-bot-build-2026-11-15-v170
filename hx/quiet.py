"""HXBot：不打扰其他应用（v1.7.0）。

用户 2026-11-14 23:54：“HXBot经常影响其他应用的运行！在V1.7.0必须完全解决！Windows也会存在这样的问题！”；
选了五种情况：别的应用变卡、风扇响；焦点被抢、窗口乱跳；快捷键、复制粘贴失灵；别的应用卡死或退出；经常断网。
00:08：“1.7.0的要把所有可能bug全部解决掉，穷举式的测试！必须完成！”

这一步改上游的主进程文件（HX 自己的代码在 src/main/hx-quiet.ts、src/backend/hx-computer/front.ts 等）：
① 高亮框：每 33 毫秒向驱动要一次全部窗口 → 每 250 毫秒看一次，只在驱动最近 15 秒有过动作时读，每秒最多两次；
② 高亮框不接鼠标，不再转发（Windows 上转发要装全局鼠标钩子）；灵动岛、停靠栏在 Windows 上只在鼠标靠近时转发；
③ 不抢焦点（F4）：助手的工具要打开的系统设置页、远程控制的询问，只在用户正在用 HXBot 时到前面；
  用户在用别的应用时发一条通知，点了才打开（src/main/hx-ask-first.ts）。同一页短时间内只开或只问一次；
④ 更新下载限速（F8，src/main/hx-network.ts）；⑤ Windows 停助手进程时留下它打开的有窗口的应用（F9，
  src/backend/hx-process-keep.ts）；⑥ 助手读窗口没写上限时补上 1500 个元素、3 秒（F10，src/main/hx-driver-bounds.ts）。
"""

from __future__ import annotations


def quiet_rim(r) -> None:
    r.replace("src/main/computer-use-highlight-window.ts",
              "const DEFAULT_POLL_INTERVAL_MS = 33;\n",
              "// HXBot (v1.7.0): 30 reads of every window a second kept every app busy (hx-quiet.ts).\n"
              "const DEFAULT_POLL_INTERVAL_MS = HX_RIM_POLL_MS;\n")
    r.replace("src/main/computer-use-highlight-window.ts",
              'import type { CuaDriverFailure } from "./cua-driver-effects";\n',
              'import type { CuaDriverFailure } from "./cua-driver-effects";\nimport { HX_RIM_POLL_MS } from "./hx-quiet";\n')
    path = "src/main/application-services.ts"
    r.replace(path,
              "        if (turnStartedAt === null) return null;\n",
              "        if (turnStartedAt === null) return null;\n"
              "        // HXBot (v1.7.0): read the driver only after it acted lately, and at most twice a second.\n"
              "        const quiet = hxRimQuiet.next(cuaDriver.lastAction(HX_RIM_ACTIVE_MS) !== null);\n"
              "        if (quiet === \"hide\") return null;\n"
              "        if (quiet === \"keep\") return previous;\n")
    r.replace(path,
              "  const computerUseHighlight = new ComputerUseHighlightController({\n",
              "  const hxRimQuiet = new HxRimQuiet();\n"
              "  const computerUseHighlight = new ComputerUseHighlightController({\n")
    r.replace(path,
              'import { IdleRestart } from "./idle-restart";\n',
              'import { HX_RIM_ACTIVE_MS, HxRimQuiet } from "./hx-quiet";\n'
              'import { IdleRestart } from "./idle-restart";\n')


def quiet_mouse(r) -> None:
    r.replace("src/main/main-window.ts",
              "  window.setIgnoreMouseEvents(true, { forward: true });\n",
              "  // HXBot (v1.7.0): no forwarding: the rim takes no event, and on Windows forwarding is a mouse hook.\n"
              "  window.setIgnoreMouseEvents(true);\n")
    path = "src/main/dynamic-island-window.ts"
    r.replace(path, "    window.setIgnoreMouseEvents(!interactive, { forward: true });\n",
              "    hxIgnoreMouse(window, !interactive);\n")
    r.replace(path, "    window.setIgnoreMouseEvents(true, { forward: true });\n",
              "    hxIgnoreMouse(window, true);\n")
    r.replace(path, 'import { sendToRenderer } from "./renderer-ipc";\n',
              'import { hxIgnoreMouse } from "./hx-quiet";\nimport { sendToRenderer } from "./renderer-ipc";\n')
    path = "src/main/agent-dock-window.ts"
    r.replace(path, "    window.setIgnoreMouseEvents(!input.interactive, { forward: true });\n",
              "    hxIgnoreMouse(window, !input.interactive);\n")
    r.replace(path, "        window.setIgnoreMouseEvents(true, { forward: true });\n",
              "        hxIgnoreMouse(window, true);\n")
    r.replace(path, 'import { sendToRenderer } from "./renderer-ipc";\n',
              'import { hxIgnoreMouse } from "./hx-quiet";\nimport { sendToRenderer } from "./renderer-ipc";\n')


ASK_EN = {
    "computerUse.hxAskTitle": "HXBot needs a permission",
    "computerUse.hxAskBody": "Click to open the page in System Settings. HXBot does not open it while you work in another app.",
}
ASK_ZH = {
    "computerUse.hxAskTitle": "HXBot 需要一项授权",
    "computerUse.hxAskBody": "点这里打开系统设置里的那一页。你在用别的应用时，HXBot 不会自己打开它。",
}
REMOTE_EN = {"remoteDesktop.host.hxAskBody": "Click within 30 seconds to answer in HXBot."}
REMOTE_ZH = {"remoteDesktop.host.hxAskBody": "30 秒内点这里，到 HXBot 里回答。"}


def quiet_focus(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/computerUse.ts", "\n});\n", ASK_EN)
    r.add_messages(f"{messages}/zh/computerUse.ts", "\n} as const satisfies", ASK_ZH)
    r.add_messages(f"{messages}/en/remoteDesktop.ts", "\n});\n", REMOTE_EN)
    r.add_messages(f"{messages}/zh/remoteDesktop.ts", "\n} as const satisfies", REMOTE_ZH)
    path = "src/main/remote-control-question.ts"
    r.replace(path,
              "        if (signal.aborted || window.isDestroyed()) return false;\n"
              "        options.presentMainWindow(window);\n",
              "        if (signal.aborted || window.isDestroyed()) return false;\n"
              "        // HXBot (v1.7.0): the question takes the front only while the user works in HXBot. In another\n"
              "        // app the user gets a notification, and the question opens on a click (hx-ask-first.ts).\n"
              "        if (!hxUserInHxbot()) {\n"
              "          const text = {\n"
              "            title: options.translate(\"remoteDesktop.host.questionTitle\", { name: memberName }),\n"
              "            body: options.translate(\"remoteDesktop.host.hxAskBody\"),\n"
              "          };\n"
              "          if (!(await hxWaitForClick(signal, text, window))) return false;\n"
              "          if (signal.aborted || window.isDestroyed()) return false;\n"
              "        }\n"
              "        options.presentMainWindow(window);\n")
    r.replace(path, 'import { showRetainedNotification } from "./desktop-notifications";\n',
              'import { showRetainedNotification } from "./desktop-notifications";\n'
              'import { hxUserInHxbot, hxWaitForClick } from "./hx-ask-first";\n')


def quiet_process_tree(r) -> None:
    path = "src/backend/windows-process-tree.ts"
    r.replace(path,
              "  yield* Effect.tryPromise({\n"
              "    try: () =>\n"
              "      new Promise<void>((resolve) =>\n"
              "        execFile(\"taskkill\", [\"/pid\", String(pid), \"/T\", \"/F\"], { windowsHide: true }, () => resolve()),\n"
              "      ),\n",
              "  // HXBot (v1.7.0): an app with a window that the agent opened stays open (hx-process-keep.ts).\n"
              "  const tree = yield* Effect.promise(() => hxTreeWithoutApps(pid));\n"
              "  const args = tree ? hxTaskkillArgs(tree) : [\"/pid\", String(pid), \"/T\", \"/F\"];\n"
              "  yield* Effect.tryPromise({\n"
              "    try: () => new Promise<void>((resolve) => execFile(\"taskkill\", args, { windowsHide: true }, () => resolve())),\n")
    r.replace(path, 'import { Effect, Fiber, Schema } from "effect";\n',
              'import { Effect, Fiber, Schema } from "effect";\nimport { hxTaskkillArgs, hxTreeWithoutApps } from "./hx-process-keep";\n')


def quiet_reads(r) -> None:
    path = "src/main/cua-driver-action-tap.ts"
    r.replace(path, '    let pending = "";\n    let skipping = false;\n    client.on("data", (chunk: Buffer) => {\n      daemon.write(chunk);\n      pending += chunk.toString("utf8");\n      let newline = pending.indexOf("\\n");\n      while (newline >= 0) {\n        const line = pending.slice(0, newline);\n        pending = pending.slice(newline + 1);\n        // Told before the daemon can answer, because this runs in the same turn as the write above.\n        if (skipping) {\n          answers.expect(null);\n        } else {\n          const at = this.#now();\n          const { tool, action, pointer } = readRequest(line, at);\n          answers.expect(tool === null ? null : { tool, at });\n          if (action) this.#action = action;\n          if (pointer) this.#pointer = pointer;\n        }\n        skipping = false;\n        newline = pending.indexOf("\\n");\n      }\n      if (pending.length > MAX_REQUEST_LINE_BYTES) {\n        pending = "";\n        skipping = true;\n      }\n    });\n  }\n\n',
              '    // HXBot (v1.7.0): whole request lines go to the daemon, so that a window read that names no\n    // bounds gets them (hx-driver-bounds.ts). Every other line goes on byte for byte.\n    let pending: Buffer = Buffer.alloc(0);\n    let skipping = false;\n    client.on("data", (chunk: Buffer) => {\n      let rest = chunk;\n      if (skipping) {\n        const cut = rest.indexOf(NEWLINE);\n        if (cut < 0) {\n          daemon.write(rest);\n          return;\n        }\n        answers.expect(null);\n        daemon.write(rest.subarray(0, cut + 1));\n        skipping = false;\n        rest = rest.subarray(cut + 1);\n      }\n      pending = pending.length > 0 ? Buffer.concat([pending, rest]) : rest;\n      let newline = pending.indexOf(NEWLINE);\n      while (newline >= 0) {\n        const raw = pending.subarray(0, newline + 1);\n        const line = raw.subarray(0, newline).toString("utf8");\n        pending = pending.subarray(newline + 1);\n        // Told before the daemon can answer: the line goes to the daemon below.\n        const at = this.#now();\n        const { tool, action, pointer } = readRequest(line, at);\n        answers.expect(tool === null ? null : { tool, at });\n        if (action) this.#action = action;\n        if (pointer) this.#pointer = pointer;\n        const bounded = tool === "get_window_state" ? hxBoundedRequest(line) : null;\n        daemon.write(bounded === null ? raw : `${bounded}\\n`);\n        newline = pending.indexOf(NEWLINE);\n      }\n      if (pending.length > MAX_REQUEST_LINE_BYTES) {\n        daemon.write(pending);\n        pending = Buffer.alloc(0);\n        skipping = true;\n      }\n    });\n  }\n\n')
    r.replace(path, 'import { rewriteCallAnswer } from "./cua-driver-structured-text";\n',
              'import { rewriteCallAnswer } from "./cua-driver-structured-text";\n'
              'import { hxBoundedRequest } from "./hx-driver-bounds";\n')


def quiet_stream(r) -> None:
    # 远程桌面：码率由观看的一方（Moonlight）要，高的时候 20 Mbit/s 以上；主机这边封顶 10 Mbit/s。
    r.replace("src/main/sunshine-moonlight-runtime.ts",
              '      "stream_audio = disabled",\n',
              '      "stream_audio = disabled",\n'
              '      // HXBot (v1.7.0): the viewer asks for the bitrate; at most 10 Mbit/s leaves the network to the user.\n'
              '      "max_bitrate = 10000",\n')


def quiet_agent_priority(r) -> None:
    path = "src/backend/provider-processes.ts"
    r.replace(path,
              "  if (pid === undefined) return;\n  processes.set(pid,",
              "  if (pid === undefined) return;\n"
              "  // HXBot (v1.7.0): the agent and the commands it runs leave the processor to the user's apps first.\n"
              "  hxLowerAgentPriority(pid);\n"
              "  processes.set(pid,")
    import brand_rename
    brand_rename.add_import(r, path, 'import { hxLowerAgentPriority } from "./hx-process-keep";')


def quiet_tabs(r) -> None:
    # 助手的浏览器标签页在后台照常满帧运行（上游为了让助手操作不卡），视频、动画页面一直占处理器。
    # 两分钟没被用的标签页恢复后台节流；助手再用它时取消节流。用户正看着的页面本来就不节流。
    path = "src/backend/browser-host.ts"
    r.replace(path, "const IDLE_TAB_SWEEP_MS = 60_000;\n",
              "const IDLE_TAB_SWEEP_MS = 60_000;\n"
              "/** HXBot (v1.7.0): a hidden tab that nobody used for this long is throttled again, as Chromium does. */\n"
              "const HX_TAB_THROTTLE_MS = 2 * 60_000;\n")
    r.replace(path,
              "      if (this.#tabInUse(tab)) tab.lastUsedAt = now;\n"
              "      else if (now - tab.lastUsedAt >= idleMs) yield* this.#sleep(tab);\n"
              "      else awake.push(tab);\n",
              "      if (this.#tabInUse(tab)) tab.lastUsedAt = now;\n"
              "      else if (now - tab.lastUsedAt >= idleMs) yield* this.#sleep(tab);\n"
              "      else awake.push(tab);\n"
              "      // HXBot (v1.7.0): an unused hidden tab no longer runs its timers and frames at full rate.\n"
              "      if (!tab.contents.isDestroyed())\n"
              "        tab.contents.setBackgroundThrottling(now - tab.lastUsedAt >= HX_TAB_THROTTLE_MS);\n")
    r.replace(path,
              "    yield* this.#wake(tab);\n    tab.lastUsedAt = Date.now();\n    return tab;\n",
              "    yield* this.#wake(tab);\n    tab.lastUsedAt = Date.now();\n"
              "    // HXBot (v1.7.0): a tab that an agent uses runs at full rate again (see the idle sweep).\n"
              "    if (!tab.contents.isDestroyed()) tab.contents.setBackgroundThrottling(false);\n"
              "    return tab;\n")


def apply(r) -> None:
    quiet_rim(r)
    quiet_mouse(r)
    quiet_focus(r)
    quiet_process_tree(r)
    quiet_reads(r)
    quiet_stream(r)
    quiet_agent_priority(r)
    quiet_tabs(r)
