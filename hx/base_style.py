"""HXBot：界面基础样式向 WorkBuddy 靠拢（v1.6.3，排期第 1 项）。

按 WorkBuddy 的截图实测：浅灰底配白色圆角卡片、灰色的分组小标题和行内说明、绿色开关、只有一个向下箭头的下拉框、
32 高的按钮和输入框、白底细边的菜单和选项列表、圆角 24 的弹窗、细线滑块。

- 新的颜色和尺寸是 token（这里写上游的名字 --openbot-*，改名一步统一换成 --hxbot-*；本文件不参与改名）：在 packages/brand/src/tokens.css 声明（深色的值），tokens-light.css 给浅色的值；
  几个已有的浅色值改成实测的颜色（底色 #f7f7f7、主按钮 #191919、悬停 #f5f5f5、选中 #ebebeb、遮罩、占位文字、菜单阴影）。
- 各控件改用它们的规则在 src/renderer/src/styles/hx-look.css（HX 自己的文件），styles.css 最后引入。
- 下拉框的图标从上下两个箭头换成一个向下的箭头（打开时转成朝上）。
手机端用自己的 tokens-native.css，这一项不改手机端。
"""

from __future__ import annotations

TOKENS = "packages/brand/src/tokens.css"
TOKENS_LIGHT = "packages/brand/src/tokens-light.css"

# 新 token 的深色值（tokens.css 是唯一的声明处）
NEW_TOKENS = """  /* HXBot: the controls as in WorkBuddy (v1.6.3). A switch that is on and a check are green, the
   * knob of a switch and of a slider is white, a field that is open or focused has a darker border,
   * menus and lists have a thin border, a dialog has a 24px radius. tokens-light.css gives the
   * light values. */
  --openbot-control-on: #57bf9c;
  --openbot-control-off: rgba(255, 255, 255, 0.16);
  --openbot-control-knob: #ffffff;
  --openbot-control-knob-shadow: rgba(0, 0, 0, 0.3);
  --openbot-control-knob-width: 12px;
  --openbot-control-knob-height: 18px;
  --openbot-field-border-active: rgba(255, 255, 255, 0.3);
  --openbot-menu-border: rgba(255, 255, 255, 0.1);
  --openbot-slider-line: rgba(255, 255, 255, 0.28);
  --openbot-radius-dialog: 24px;
"""

# 浅色：改已有的值（左边是上游原文，右边是实测的颜色）
LIGHT_VALUES = [
    ("  --openbot-bg-canvas: #f5f5f6;\n", "  --openbot-bg-canvas: #f7f7f7;\n"),
    ("  --openbot-bg-canvas-clear: rgba(245, 245, 246, 0);\n", "  --openbot-bg-canvas-clear: rgba(247, 247, 247, 0);\n"),
    ("  --openbot-bg-sidebar: #f5f5f6;\n", "  --openbot-bg-sidebar: #f7f7f7;\n"),
    ("  --openbot-bg-native-sidebar: #f5f5f6;\n", "  --openbot-bg-native-sidebar: #f7f7f7;\n"),
    # 悬停色和底色保持原来的差距（WorkBuddy 菜单里是 #f5f5f5，但放在灰底上几乎看不出来）
    ("  --openbot-bg-control-hover: #f0f0f2;\n", "  --openbot-bg-control-hover: #f2f2f2;\n"),
    ("  --openbot-bg-control-active: #e8e8eb;\n", "  --openbot-bg-control-active: #ebebeb;\n"),
    ("  --openbot-bg-overlay: rgba(245, 245, 246, 0.92);\n", "  --openbot-bg-overlay: rgba(247, 247, 247, 0.92);\n"),
    ("  --openbot-dialog-overlay: rgba(20, 20, 20, 0.12);\n", "  --openbot-dialog-overlay: rgba(0, 0, 0, 0.15);\n"),
    ("  --openbot-scroll-edge-overlay: rgba(245, 245, 246, 0.72);\n",
     "  --openbot-scroll-edge-overlay: rgba(247, 247, 247, 0.72);\n"),
    ("  --openbot-text-placeholder: #5c5c61;\n", "  --openbot-text-placeholder: #a3a3a3;\n"),
    ("  --openbot-surface-light: #1c1c1e;\n", "  --openbot-surface-light: #191919;\n"),
    ("  --openbot-shadow-menu: transparent;\n", "  --openbot-shadow-menu: rgba(0, 0, 0, 0.08);\n"),
]

# 浅色：新 token 的值，接在浅色块的最后
LIGHT_NEW = """
  /* HXBot: the controls as in WorkBuddy (v1.6.3), measured on its screenshots. */
  --openbot-control-off: #e5e5e5;
  --openbot-control-knob-shadow: rgba(0, 0, 0, 0.15);
  --openbot-field-border-active: #b2b2b2;
  --openbot-menu-border: #dedede;
  --openbot-slider-line: #b2b2b2;
"""


def tokens(r) -> None:
    r.replace(TOKENS, "  --openbot-switch-sm-inset: 1px;\n", "  --openbot-switch-sm-inset: 1px;\n" + NEW_TOKENS)
    for old, new in LIGHT_VALUES:
        r.replace(TOKENS_LIGHT, old, new)
    # 菜单的阴影：上游在浅色下去掉了所有阴影；WorkBuddy 的菜单和选项列表有一层很淡的阴影
    r.replace(TOKENS_LIGHT,
              "  /* No drop shadows: on the dark canvas they do not show, but on white they read as a halo.\n"
              "     A raised surface keeps its 1px ring. */\n",
              "  /* No drop shadows: on the dark canvas they do not show, but on white they read as a halo.\n"
              "     A raised surface keeps its 1px ring. HXBot: menus and lists keep a faint shadow, as in\n"
              "     WorkBuddy. */\n")
    r.replace(TOKENS_LIGHT,
              "  --openbot-shadow-overlay: 0 0 0 transparent;\n}\n",
              "  --openbot-shadow-overlay: 0 0 0 transparent;\n" + LIGHT_NEW + "}\n")


def select_icon(r) -> None:
    path = "packages/ui/src/select.tsx"
    r.replace(path, 'import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";\n',
              'import ChevronDown from "lucide-solid/icons/chevron-down";\n')
    r.replace(path, "        <ChevronsUpDown aria-hidden=\"true\" />\n      </SelectPrimitive.Icon>\n",
              "        <ChevronDown aria-hidden=\"true\" />\n      </SelectPrimitive.Icon>\n")
    r.replace(path, "          <span class=\"ui-select-trigger-icon\">\n            <ChevronsUpDown aria-hidden=\"true\" />\n",
              "          <span class=\"ui-select-trigger-icon\">\n            <ChevronDown aria-hidden=\"true\" />\n")


def color_picker_icon(r) -> None:
    # 聊天颜色、聊天背景的选择框和下拉框长得一样，图标也一起换
    path = "packages/ui/src/color-picker.tsx"
    r.replace(path, 'import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";\n',
              'import ChevronDown from "lucide-solid/icons/chevron-down";\n')
    r.replace(path, "      <span class=\"ui-select-trigger-icon\">\n        <ChevronsUpDown aria-hidden=\"true\" />\n",
              "      <span class=\"ui-select-trigger-icon\">\n        <ChevronDown aria-hidden=\"true\" />\n")


def routine_menu_icon(r) -> None:
    # 定时触发的切换按钮也是下拉，用同一个单箭头
    path = "packages/ui/src/features/conversation/RoutineTriggerMenu.tsx"
    r.replace(path, "import { AlarmClock, buttonVariants, Check, ChevronsUpDown, DropdownMenu } from \"@openbot/ui\";\n",
              "import { AlarmClock, buttonVariants, Check, ChevronDown, DropdownMenu } from \"@openbot/ui\";\n")
    r.replace(path, "      >\n        <ChevronsUpDown aria-hidden=\"true\" />\n      </DropdownMenu.Trigger>\n",
              "      >\n        <ChevronDown aria-hidden=\"true\" />\n      </DropdownMenu.Trigger>\n")


def button_story(r) -> None:
    # 默认按钮改成 32 高，按钮一览里的说明跟着改
    r.replace("src/renderer/stories/Button.stories.tsx", "            Default · 36 px\n", "            Default · 32 px\n")


def stylesheet(r) -> None:
    r.replace("src/renderer/src/styles.css",
              '@import "./styles/chat-background.css";\n',
              '@import "./styles/chat-background.css";\n'
              "/* HXBot: the controls as in WorkBuddy. Last, so they win over the rules above. */\n"
              '@import "./styles/hx-look.css";\n')


def apply(r) -> None:
    tokens(r)
    select_icon(r)
    color_picker_icon(r)
    routine_menu_icon(r)
    button_story(r)
    stylesheet(r)
