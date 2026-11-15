"""HXBot：窗口的修正（v1.6.8）。

用户 2026-11-14 15:22：“系统经常最大化后黑屏，有时候死机！认真阅读代码，吧V1.6.8改好！”；补充（Mac，0.67.4）：
“关闭（X）HXBot窗口，出现背景色黑色，整个桌面背景变黑，然后，切换到别的应用，黑屏消失！”

原因（读代码查实）：Mac 上点关闭按钮时，主窗口不关，只隐藏（src/main/main-window.ts 的 close 事件：
event.preventDefault() 后 window.hide()），Dock 图标再把它叫回来。窗口在全屏（绿色按钮“最大化”在 macOS 上就是
进入全屏）时被隐藏，它所在的全屏空间留下来，空的，整块屏幕是黑的，直到切到别的应用。看起来像黑屏、死机。

改法：先退出全屏，macOS 报告已退出（leave-full-screen）后再隐藏；2 秒内没有报告也照样隐藏
（src/main/hx-full-screen.ts，HX 自己的文件）。
"""

from __future__ import annotations


def hide_out_of_full_screen(r) -> None:
    path = "src/main/main-window.ts"
    r.replace(path,
              '      if ((process.platform === "darwin" || keepRunningInBackground()) && !isQuitting()) {\n'
              '        event.preventDefault();\n'
              '        window.hide();\n'
              '      }\n',
              '      if ((process.platform === "darwin" || keepRunningInBackground()) && !isQuitting()) {\n'
              '        event.preventDefault();\n'
              '        // HXBot (v1.6.8): a window hidden in full screen leaves a black Space over the display.\n'
              '        hxHideOutOfFullScreen(window);\n'
              '      }\n')
    r.replace(path, 'import { dynamicIslandNotchSizeForDisplay } from "./dynamic-island-window";\n',
              'import { dynamicIslandNotchSizeForDisplay } from "./dynamic-island-window";\n'
              'import { hxHideOutOfFullScreen } from "./hx-full-screen";\n')


def apply(r) -> None:
    hide_out_of_full_screen(r)
