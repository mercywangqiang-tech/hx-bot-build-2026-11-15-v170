// HXBot: the screenshots of the version highlights, in Chinese and in English (hx-highlights).
//
// Usage: bun scripts/hx-highlight-shots.ts <Storybook URL> <output folder>   (HX_SHOTS=id,id for some only)
//
// Start Storybook first (`bun run storybook`). For each highlight, this opens its story in
// src/renderer/stories/HxHighlights.stories.tsx (or an existing story), in each language and in the
// light scheme, and takes the part of the screen that the highlight is about. Then it draws the
// picture that the What's new page, the 新功能说明 document and the website show: the client version
// it came in, the HOT or NEW mark, the screenshot with numbered rings on what to look at, and the
// numbered notes beside it. Output: <id>.<zh|en>.png (2x, for the website and the documents),
// <id>.<zh|en>.jpg (1.2x, for the What's new page: hx/server/portal/assets/whats-new/) and a JSON
// report. The data in the screenshots is made up, and each picture says so.
//
// Each version adds its highlights to SHOTS and keeps the earlier ones (newest first), so the
// pictures of all versions are made again with the app as it is now.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";

type Lang = "zh" | "en";
type Words = Record<Lang, string>;

interface Callout {
  /** What to ring: a CSS selector, or the text it shows (in each language). */
  css?: string;
  text?: Words;
  /** The whole text of the element, not a part of it. */
  exact?: boolean;
  /** Ring this ancestor of what was found (a CSS selector), such as the whole row. */
  closest?: string;
  label: Words;
  note: Words;
  /** Where the number goes: left of the ring (default), right of it, or on its corner. */
  badge?: "start" | "end" | "corner";
}

interface Shot {
  id: string;
  story: string;
  /** The client version that brought it. */
  version: string;
  tag?: "hot" | "new";
  title: Words;
  lead: Words;
  /** The part of the page to take. */
  crop: string;
  /** Clicks before the screenshot, by the text of what to click. */
  clicks?: Words[];
  width?: number;
  /** At most this tall (CSS pixels), from the top of the crop. */
  height?: number;
  /** Runs in the page before the screenshot, to take away what only the story shows. */
  prepare?: (lang: Lang) => void;
  callouts: Callout[];
}

/** Newest first. One HOT and one NEW in all. */
export const SHOTS: Shot[] = [
  {
    id: "computer-quiet",
    story: "hxbot-highlights--computer-quiet",
    version: "0.67.9",
    tag: "new",
    title: { zh: "HXBot 不打扰其他应用", en: "HXBot leaves your other apps alone" },
    lead: {
      zh: "助手操作电脑时，你切走了就不再往你的应用里打字，也不把窗口拉到前面；结束时松开修饰键。不拖慢别的应用、不抢焦点、不占满网络。",
      en: "While the agent works on the computer, it types nothing into the app you moved to and pulls no window to the front; at the end it lets go of the modifier keys. No slow apps, no stolen focus, no full network.",
    },
    crop: ".hx-highlight-frame",
    width: 720,
    prepare: () => {
      for (const row of document.querySelectorAll<HTMLElement>(".hx-highlight-frame .agent-step"))
        row.style.margin = "14px 0";
    },
    callouts: [
      {
        text: {
          zh: "点正文输入框：在后台点好了，没有把记事本拉到前面",
          en: "Click the text box: done in the background, Notepad stays behind",
        },
        badge: "end",
        label: { zh: "不抢焦点", en: "No stolen focus" },
        note: { zh: "授权页、远程控制询问先发通知", en: "Pages and questions come as a notification" },
      },
      {
        text: {
          zh: "输入文字之前：你切到了别的应用，按键没有发出去",
          en: "Before typing: you moved to another app, so no key was sent",
        },
        badge: "end",
        label: { zh: "按键只发给目标应用", en: "Keys go to the target app only" },
        note: { zh: "你切走了就停下问你", en: "It stops and asks when you move away" },
      },
      {
        text: {
          zh: "操作结束：松开了 Ctrl、Shift、Alt，别的应用的快捷键照常",
          en: "Work done: Ctrl, Shift and Alt let go, other apps' shortcuts work",
        },
        badge: "end",
        label: { zh: "快捷键不失灵", en: "Shortcuts keep working" },
        note: { zh: "剪贴板也保持你原来复制的", en: "Your clipboard keeps your copy too" },
      },
    ],
  },
  {
    id: "computer-apps",
    story: "hxbot-highlights--computer-apps",
    version: "0.67.8",
    title: { zh: "助手直接用应用命令", en: "The agent uses app commands" },
    lead: {
      zh: "切到前台、隐藏、退出、摆窗口、读写默认应用、点菜单命令，再加上 AppleScript、JXA、快捷指令和 PowerShell，都由 HXBot 自己做；一条路走不通自动换下一条。",
      en: "Front, hide, quit, window places, default apps, menu commands, plus AppleScript, JXA, Shortcuts and PowerShell, all in HXBot itself; when one way does not work, it takes the next.",
    },
    crop: ".hx-highlight-frame",
    width: 720,
    // Rings on three rows in a row: more room between the rows, so that no ring covers the next one.
    prepare: () => {
      for (const row of document.querySelectorAll<HTMLElement>(".hx-highlight-frame .agent-step"))
        row.style.margin = "14px 0";
    },
    callouts: [
      {
        text: {
          zh: "computer_run 运行 AppleScript：Excel 把“销售.xlsx”另存为“销售.pdf”",
          en: "computer_run runs an AppleScript: Excel saves Sales.xlsx as Sales.pdf",
        },
        label: { zh: "脚本在 HXBot 里运行", en: "Scripts run in HXBot itself" },
        note: { zh: "删除、发送这类脚本先问你", en: "It asks before a script deletes or sends" },
      },
      {
        text: {
          zh: "窗口放到左半边：直达不行，改用命令，放好了",
          en: "Window to the left half: the direct way did not work, so a command did it",
        },
        badge: "end",
        label: { zh: "走不通自动换路", en: "The next way, by itself" },
        note: { zh: "直达 → 命令 → 控件 → 看图", en: "Direct → command → controls → image" },
      },
      {
        text: {
          zh: "退出 Excel：有没保存的改动，Excel 自己问要不要保存，交给你点",
          en: "Quit Excel: it has unsaved changes and asks whether to save, so you choose",
        },
        badge: "end",
        label: { zh: "先正常退出", en: "A normal quit first" },
        note: { zh: "强制退出要你同意", en: "Force quit only with your yes" },
      },
    ],
  },
  {
    id: "computer-grants",
    story: "hxbot-highlights--computer-grants",
    version: "0.67.7",
    title: { zh: "授权只要输密码或按指纹", en: "Grants with a password or Touch ID only" },
    lead: {
      zh: "点“授予”后，屏幕录制、App 管理的开关由 HXBot 自己打开；只要有辅助功能，助手就能一步步操作应用。升级后授权不再失效。",
      en: "After Grant, HXBot turns on Screen Recording and App Management itself; with Accessibility alone, the agent works in apps step by step. Grants now hold after updates.",
    },
    crop: ".hx-highlight-frame",
    width: 640,
    callouts: [
      {
        text: {
          zh: "让 HXBot 截屏。点击和输入不需要它。",
          en: "Lets HXBot take screenshots. Clicking and typing work without it.",
        },
        label: { zh: "屏幕录制只给截屏用", en: "Screen Recording is for screenshots" },
        note: { zh: "点“授予”，HXBot 自己打开开关", en: "After Grant, HXBot turns the switch on" },
      },
      {
        text: {
          zh: "让 HXBot 点击和输入。打开后，HXBot 自己去开屏幕录制。",
          en: "Lets HXBot click and type. HXBot then turns on Screen Recording itself.",
        },
        label: { zh: "辅助功能：你点一下", en: "Accessibility: one click by you" },
        note: { zh: "macOS 只许你自己打开这一项", en: "macOS lets only you turn this one on" },
      },
    ],
  },
  {
    id: "grant-steps",
    story: "hxbot-highlights--grant-steps",
    version: "0.67.7",
    title: { zh: "HXBot 自己点开关", en: "HXBot turns the switch on itself" },
    lead: {
      zh: "系统设置打开到那一页，HXBot 按下自己那一行的开关；macOS 要密码时，你输入密码或按指纹就好。",
      en: "System Settings opens at that page and HXBot presses the switch of its own row; when macOS asks, you give your password or Touch ID.",
    },
    crop: ".hx-highlight-frame",
    width: 420,
    callouts: [
      {
        text: {
          zh: "HXBot 有辅助功能授权时，会自己打开这个开关。系统要密码时，输入密码或按指纹即可。",
          en: "When HXBot has Accessibility, it turns this switch on itself. When macOS asks, give your password or Touch ID.",
        },
        label: { zh: "你只输密码或按指纹", en: "Only your password or Touch ID" },
        note: { zh: "在 macOS 15、26 上实测", en: "Checked on macOS 15 and 26" },
      },
    ],
  },
  {
    id: "computer-install",
    story: "hxbot-highlights--computer-install",
    version: "0.67.7",
    title: { zh: "助手帮你装应用", en: "The agent installs apps" },
    lead: {
      zh: "下载好的 .app、.zip、.dmg 由 HXBot 装进“应用程序”文件夹；已经装过的先问你，旧版放进废纸篓。",
      en: "HXBot puts a downloaded .app, .zip or .dmg into Applications; it asks before it replaces an app, and the earlier version goes to the Trash.",
    },
    crop: ".hx-highlight-frame",
    width: 720,
    callouts: [
      {
        text: {
          zh: "签名：Developer ID Application: Anthropic PBC · 已公证",
          en: "Signature: Developer ID Application: Anthropic PBC · notarized",
        },
        label: { zh: "先看签名和公证", en: "Signature and notarization" },
        note: { zh: "macOS 第一次打开时照常检查", en: "macOS still checks it the first time" },
      },
      {
        text: {
          zh: "已经装了 Claude 1.9：先问你，你回答“替换”",
          en: "Claude 1.9 is installed: it asked you, and you said “replace”",
        },
        badge: "end",
        label: { zh: "替换前先问", en: "It asks before it replaces" },
        note: { zh: "旧版放进废纸篓，可以找回", en: "The earlier version goes to the Trash" },
      },
    ],
  },
  {
    id: "computer-steps",
    story: "hxbot-highlights--computer-steps",
    version: "0.67.6",
    title: { zh: "打开应用后一步步操作", en: "Step by step in an app" },
    lead: {
      zh: "助手按你的话自己列出步骤，用鼠标和键盘一步步做，每一步都核对；对话里的进度卡写明做到哪一步。",
      en: "The agent plans the steps from your words and works with the mouse and the keyboard, checking each step; the progress card in the chat shows how far it is.",
    },
    crop: ".hx-highlight-frame",
    width: 720,
    callouts: [
      {
        text: { zh: "在备忘录里新建一条", en: "Make a note in Notes" },
        label: { zh: "说要做什么", en: "Say what to do" },
        note: { zh: "助手自己列出步骤", en: "The agent plans the steps itself" },
      },
      {
        css: ".task-list-header",
        badge: "end",
        label: { zh: "进度卡和停止键", en: "The card and the stop keys" },
        note: {
          zh: "按 ⌃⌥Esc（Windows：Ctrl+Alt+Esc）随时停止",
          en: "Press ⌃⌥Esc (Windows: Ctrl+Alt+Esc) to stop at any time",
        },
      },
      {
        css: '.task-list-item[data-state="active"]',
        badge: "end",
        label: { zh: "一步一步，步步核对", en: "Step by step, each one checked" },
        note: { zh: "发送、付款、删除前先问你", en: "It asks before it sends, pays or deletes" },
      },
    ],
  },
  {
    id: "team-progress-card",
    story: "hxbot-highlights--team-progress-card",
    version: "0.67.6",
    title: { zh: "协作的进度卡", en: "The progress card of a team" },
    lead: {
      zh: "原来的对话里一张卡：每一步谁在做、做到哪、交接了几次、用了多久，原地更新。",
      en: "One card in your chat: who does each step, how far it is, the handoffs and the time, updated in place.",
    },
    crop: ".hx-highlight-frame",
    width: 720,
    callouts: [
      {
        css: ".task-list-header",
        badge: "end",
        label: { zh: "交接次数和用时", en: "Handoffs and time" },
        note: { zh: "上限直接在对话里说", en: "Say the limits in the chat" },
      },
      {
        css: '.task-list-item[data-state="active"]',
        badge: "end",
        label: { zh: "每一步谁在做", en: "Who does each step" },
        note: { zh: "最多 20 个成员，共用技能和连接器", en: "Up to 20 members, who share skills and connectors" },
      },
    ],
  },
  {
    id: "team-summary",
    story: "hxbot-highlights--team-summary",
    version: "0.67.6",
    title: { zh: "默认最强，设置更少", en: "The strongest by default, fewer settings" },
    lead: {
      zh: "自动选择模型默认打开、质量优先；团队上限收成一行，点“调整上限”才展开。",
      en: "Auto model is on and puts quality first; the team limits are one line, and Change the limits opens them.",
    },
    crop: ".hx-highlight-frame",
    callouts: [
      {
        text: { zh: "按工作内容自动选择模型", en: "Choose the model by the work" },
        label: { zh: "默认打开", en: "On by default" },
        note: { zh: "默认质量优先，可改成免费优先", en: "Quality first by default; Free first saves cost" },
      },
      {
        text: { zh: "团队：最多 20 人", en: "Teams: up to 20 members" },
        label: { zh: "一行摘要", en: "One line" },
        note: { zh: "默认 20 人、240 分钟、80 次交接", en: "20 members, 240 min and 80 handoffs by default" },
      },
    ],
  },
  {
    id: "team-card",
    story: "hxbot-highlights--team-card",
    version: "0.67.5",
    title: { zh: "说一句话，自动组队", en: "Say it, and get a team" },
    lead: {
      zh: "建议卡写明每个角色由谁来做：从现有的智能体里按专长选，缺的角色新建。点“开始”就开一个协作房间。",
      en: "The card names who takes each role: an agent you have, picked by skill, or a new member. Start opens a team room.",
    },
    crop: ".hx-highlight-frame",
    callouts: [
      {
        text: { zh: "由 方案老李 来做", en: "Leo takes it" },
        badge: "end",
        label: { zh: "按专长选人", en: "Picked by skill" },
        note: { zh: "从你现有的智能体里选", en: "From the agents you have" },
      },
      {
        text: { zh: "新建一个成员", en: "a new member" },
        badge: "end",
        label: { zh: "缺的角色新建", en: "A new member for a missing role" },
        note: { zh: "团队结束后自动收起，也可以留下", en: "Hidden when the team ends, or kept" },
      },
      {
        text: { zh: "开始", en: "Start" },
        exact: true,
        badge: "end",
        label: { zh: "点“开始”就组队", en: "Start makes the team" },
        note: { zh: "开一个协作房间，带头的按步骤分派", en: "A team room opens; the lead gives out the steps" },
      },
    ],
  },
  {
    id: "team-progress",
    story: "hxbot-highlights--team-progress",
    version: "0.67.5",
    title: { zh: "进度和结果回到原来的对话", en: "Progress and the result come back to your chat" },
    lead: {
      zh: "谁交给了谁、做完了几步，都在你原来的对话里；插话、叫停、换人，直接在这里说。",
      en: "Who gave what to whom and how many steps are done show in your chat; add words, stop or swap a member right there.",
    },
    crop: ".hx-highlight-frame",
    width: 900,
    callouts: [
      {
        text: { zh: "已组队", en: "Team started" },
        label: { zh: "自动组队", en: "A team, made for you" },
        note: { zh: "协作房间和分工都自动建好", en: "The room and the roles, set up for you" },
      },
      {
        text: { zh: "交给 文案小王", en: "to Wendy" },
        label: { zh: "交接单", en: "Handoff forms" },
        note: {
          zh: "每次交接都写明目标、文件、下一步",
          en: "Each handoff states the goal, the files and the next step",
        },
      },
      {
        text: { zh: "协作完成", en: "Team done" },
        label: { zh: "结果回到这里", en: "The result comes back" },
        note: { zh: "临时成员自动收起", en: "Members made for it are hidden" },
      },
    ],
  },
  {
    id: "team-settings",
    story: "hxbot-highlights--team-settings",
    version: "0.67.5",
    title: { zh: "团队的上限", en: "The limits of a team" },
    lead: {
      zh: "在助手设置的“建议卡”下面：团队最多几个人、最长多久、最多交接几次。到了上限，团队停下来问你。",
      en: "Under the proposal card in the agent's settings: how many members, how long and how many handoffs. At a limit, the team stops and asks you.",
    },
    crop: ".hx-highlight-frame",
    callouts: [
      {
        text: { zh: "团队成员最多", en: "Team members at most" },
        closest: ".agent-settings-runtime-row",
        label: { zh: "人数", en: "Members" },
        note: { zh: "默认最多 5 个", en: "At most 5 by default" },
      },
      {
        text: { zh: "团队最长时间", en: "Longest team time" },
        closest: ".agent-settings-runtime-row",
        label: { zh: "时间和交接次数", en: "Time and handoffs" },
        note: { zh: "默认 120 分钟、20 次交接", en: "120 minutes and 20 handoffs by default" },
      },
      {
        text: { zh: "为团队新建的成员", en: "Members made for a team" },
        closest: ".agent-settings-runtime-row",
        label: { zh: "新建的成员", en: "New members" },
        note: { zh: "团队结束后收起，或者留下", en: "Hidden when the team ends, or kept" },
      },
    ],
  },
  {
    id: "opencode-services",
    story: "hxbot-highlights--open-code-services",
    version: "0.67.4",
    title: { zh: "连接 OpenCode 的全部服务商", en: "Connect any OpenCode service" },
    lead: {
      zh: "模型面板“+”→ 添加 → OpenCode 全部服务商：200 多家，网页登录或粘贴密钥就能用。",
      en: "Model panel “+” › Add › All OpenCode services: 200+ services, by browser sign-in or an API key.",
    },
    crop: '[role="dialog"]',
    clicks: [{ zh: "OpenAI", en: "OpenAI" }],
    width: 900,
    callouts: [
      {
        css: ".hx-opencode-free",
        label: { zh: "免费模型", en: "Free models" },
        note: { zh: "无需登录，已经可用", en: "No sign-in, ready to use" },
      },
      {
        css: ".hx-opencode-list .custom-provider-preset",
        label: { zh: "已连接", en: "Connected" },
        note: { zh: "连上的模型马上进入智能体的模型选择", en: "Its models join each agent's model list" },
      },
      {
        text: { zh: "网页登录：Sign in with ChatGPT", en: "Sign in: Sign in with ChatGPT" },
        badge: "end",
        label: { zh: "网页登录或密钥", en: "Browser sign-in or a key" },
        note: {
          zh: "像 ChatGPT 那样在浏览器里登录，或粘贴 API 密钥",
          en: "Sign in as with ChatGPT, or paste an API key",
        },
      },
    ],
  },
  {
    id: "proposal-card",
    story: "hxbot-highlights--proposal-card",
    version: "0.67.4",
    title: { zh: "开工前的建议卡", en: "A proposal card before the work" },
    lead: {
      zh: "复杂的事先出一张卡：几个智能体、谁做什么、各用什么模型，点“开始”才动手。",
      en: "Bigger work starts with a card: how many agents, who does what, which models. Nothing starts until Start.",
    },
    crop: ".hx-highlight-frame",
    callouts: [
      {
        text: { zh: "研究员", en: "Researcher" },
        label: { zh: "分工和模型", en: "Roles and models" },
        note: { zh: "每个角色做什么、用哪个模型、是否免费", en: "What each role does, its model, free or not" },
      },
      {
        text: { zh: "步骤", en: "Steps" },
        exact: true,
        label: { zh: "步骤", en: "Steps" },
        note: { zh: "分几步、要用哪些应用、哪几步要你确认", en: "The steps, the apps, and where it waits for you" },
      },
      {
        text: { zh: "开始", en: "Start" },
        exact: true,
        badge: "end",
        label: { zh: "你点了才开始", en: "You start it" },
        note: { zh: "也可以改一改，或就用一个智能体", en: "Or change it, or use one agent" },
      },
    ],
  },
  {
    id: "auto-model-lines",
    story: "hxbot-highlights--auto-model-lines",
    version: "0.67.4",
    title: { zh: "对话里写明用了哪个模型", en: "The chat names the model" },
    lead: {
      zh: "每件工作开始前一行小字：这件事是什么、由哪个模型来做。",
      en: "Before each piece of work, one small line: what the work is and which model does it.",
    },
    crop: ".hx-highlight-frame",
    width: 860,
    callouts: [
      {
        text: { zh: "写作：由 GLM-5.3-Flash Free 来做", en: "writing: GLM-5.3-Flash Free takes it" },
        label: { zh: "免费优先", en: "Free first" },
        note: { zh: "写作这类工作，免费模型就够用", en: "A free model is enough for writing" },
      },
      {
        text: { zh: "看图：换用", en: "an image: switched to" },
        label: { zh: "看图换能看图的", en: "Images need vision" },
        note: { zh: "发来图片时，换成能看图的模型", en: "An image moves the work to a vision model" },
      },
      {
        text: { zh: "方案与推理：换用", en: "planning and reasoning: switched to" },
        label: { zh: "难的换更强的", en: "Harder work, stronger model" },
        note: { zh: "定方案用更强的模型", en: "Planning uses a stronger model" },
      },
    ],
  },
  {
    id: "auto-model",
    story: "hxbot-highlights--auto-model",
    version: "0.67.4",
    title: { zh: "按工作内容自动选模型", en: "Auto model: the model fits the work" },
    lead: {
      zh: "在助手设置里打开“自动选择模型”：每件工作先判断类型和难度，再选模型。",
      en: "Turn on Auto model in the agent's settings: each piece of work gets a model by its kind and difficulty.",
    },
    crop: ".hx-highlight-frame",
    callouts: [
      {
        text: { zh: "按工作内容自动选择模型", en: "Choose the model by the work" },
        closest: ".agent-settings-notifications",
        label: { zh: "一个开关", en: "One switch" },
        note: { zh: "打开就生效，手动选模型时自动关掉", en: "On at once; choosing a model by hand turns it off" },
      },
      {
        text: { zh: "免费优先", en: "Free first" },
        closest: ".agent-settings-runtime-row",
        label: { zh: "默认免费优先", en: "Free first by default" },
        note: { zh: "也可以选“均衡”或“质量优先”", en: "Or Balanced, or Quality first" },
      },
      {
        text: { zh: "现在：", en: "Now:" },
        closest: "p",
        label: { zh: "一眼看到怎么选", en: "See the choices" },
        note: { zh: "每种工作现在会用哪个模型", en: "Which model each kind of work uses now" },
      },
    ],
  },
  {
    id: "computer-open",
    story: "hxbot-highlights--computer-open",
    version: "0.67.3",
    tag: "hot",
    title: { zh: "按名字直接操作电脑", en: "Operate the computer by name" },
    lead: {
      zh: "一句话打开应用、系统设置页、文件和网址，直接改 32 项常用设置；不截图，不点鼠标。",
      en: "Open apps, settings pages, files and web pages by name, and change 32 common settings, with no screenshots and no clicks.",
    },
    crop: ".hx-highlight-frame",
    width: 860,
    callouts: [
      {
        text: { zh: "你：打开网易云音乐", en: "You: open NetEase Cloud Music" },
        label: { zh: "说一句话", en: "Just say it" },
        note: { zh: "中文、英文、拼音都行", en: "Chinese, English or pinyin" },
      },
      {
        text: { zh: "打开了网易云音乐", en: "Opened NetEase Cloud Music" },
        label: { zh: "按名字直接打开", en: "Opens by name" },
        note: { zh: "0.4 秒，不截图，不点鼠标", en: "0.4 s, no screenshot, no clicks" },
      },
      {
        text: { zh: "深色模式：关 → 开", en: "Dark mode: off → on" },
        badge: "end",
        label: { zh: "直接改设置", en: "Changes settings directly" },
        note: { zh: "改完读回核对，对不上自动改回", en: "Read back after the change; put back if it differs" },
      },
    ],
  },
  {
    id: "computer-catalog",
    story: "hxbot-highlights--computer-use",
    version: "0.67.3",
    title: { zh: "本机目录与自检", en: "Catalog of this computer and self-test" },
    lead: {
      zh: "设置 → Computer Use：HXBot 记下这台电脑的应用和设置，一键自检每项设置。",
      en: "Settings › Computer Use: HXBot keeps a catalog of this computer's apps and settings, and checks each setting in one click.",
    },
    crop: ".hx-highlight-frame",
    clicks: [{ zh: "运行自检", en: "Run the self-test" }],
    width: 860,
    callouts: [
      {
        text: { zh: "应用 128 个", en: "128 apps" },
        label: { zh: "本机目录", en: "The catalog" },
        note: { zh: "应用、设置页、可以直接改的设置", en: "Apps, settings pages, settings it changes directly" },
      },
      {
        text: { zh: "重新建立目录", en: "Rebuild the catalog" },
        badge: "end",
        label: { zh: "装了新应用", en: "New app installed" },
        note: { zh: "点一下重新建立目录", en: "Rebuild the catalog in one click" },
      },
      {
        text: { zh: "通过 56 项", en: "56 passed" },
        label: { zh: "一键自检", en: "Self-test" },
        note: { zh: "逐项读写核对，不改变任何设置的值", en: "Reads and writes each one; changes no value" },
      },
    ],
  },
  {
    id: "settings-groups",
    story: "settings-settingsmodal--open",
    version: "0.67.3",
    title: { zh: "设置窗口三组分类", en: "Settings in three groups" },
    lead: {
      zh: "左侧分成“设置”“功能”“数据与安全”，新增“关于”和“获取帮助”。",
      en: "Settings, Features and Data & security on the left, plus About and Get help.",
    },
    crop: ".settings-page",
    width: 1100,
    height: 700,
    // The story's own heading is English and it has an "Open settings" button; the app has neither.
    prepare: (lang) => {
      const title = document.querySelector(".settings-page-title");
      if (title) title.textContent = lang === "zh" ? "设置" : "Settings";
      for (const button of document.querySelectorAll(".settings-page-nav button"))
        if (button.textContent?.trim() === "Open settings") button.remove();
    },
    callouts: [
      {
        text: { zh: "功能", en: "Features" },
        exact: true,
        badge: "end",
        label: { zh: "三组分类", en: "Three groups" },
        note: { zh: "设置、功能、数据与安全", en: "Settings, Features, Data & security" },
      },
      {
        text: { zh: "Computer Use", en: "Computer Use" },
        exact: true,
        badge: "end",
        label: { zh: "电脑操控", en: "Computer control" },
        note: { zh: "目录和自检都在这里", en: "The catalog and the self-test are here" },
      },
      {
        text: { zh: "获取帮助", en: "Get help" },
        exact: true,
        badge: "end",
        label: { zh: "关于 · 获取帮助", en: "About · Get help" },
        note: { zh: "官网、条款、使用指南、意见反馈", en: "Website, terms, the guide, feedback" },
      },
    ],
  },
];

const BRAND = {
  blue: "#0156D3",
  orange: "#EB6100",
  ink: "#1D1D1F",
  muted: "#6E6E73",
  canvas: "#F5F5F7",
};

/** The widest a screenshot is shown: the card (1440) less its padding and the notes column. */
const SHOT_COLUMN = 1440 - 112 - 40 - 360;

const WORDS = {
  demo: { zh: "演示数据", en: "Demo data" },
  version: { zh: "桌面端", en: "Desktop" },
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

async function find(root: Locator, callout: Callout, lang: Lang): Promise<Locator> {
  if (callout.text) {
    const byText = root.getByText(callout.text[lang], { exact: callout.exact ?? false }).first();
    if ((await byText.count()) > 0) return byText;
  }
  if (callout.css) return root.locator(callout.css).first();
  throw new Error(`nothing to ring: ${callout.label[lang]}`);
}

interface Ring {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function capture(page: Page, base: string, shot: Shot, lang: Lang): Promise<{ png: Buffer; rings: Ring[] }> {
  const locale = lang === "zh" ? "zh" : "en";
  await page.setViewportSize({ width: shot.width ?? 1000, height: 1600 });
  await page.goto(`${base}/iframe.html?id=${shot.story}&viewMode=story&globals=locale:${locale};colorScheme:light`, {
    waitUntil: "networkidle",
    timeout: 180_000,
  });
  const root = page.locator(shot.crop).first();
  await root.waitFor({ state: "visible", timeout: 60_000 });
  for (const click of shot.clicks ?? []) {
    await root.getByText(click[lang], { exact: true }).first().click();
  }
  await page.waitForTimeout(1200);
  if (shot.prepare) await page.evaluate(shot.prepare, lang);
  // No focus ring or tooltip from the first control.
  await page.evaluate(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const whole = await root.boundingBox();
  if (!whole) throw new Error(`${shot.id}: ${shot.crop} is not on the page`);
  const box = { ...whole, height: Math.min(whole.height, shot.height ?? whole.height) };
  const rings: Ring[] = [];
  for (const callout of shot.callouts) {
    const target = await find(root, callout, lang);
    const rect = callout.closest
      ? await target.evaluate((element, selector) => {
          const found = element.closest(selector) ?? element;
          const r = found.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }, callout.closest)
      : await target.boundingBox();
    if (!rect) throw new Error(`${shot.id} (${lang}): ${callout.label[lang]} is not on the page`);
    if (rect.y + rect.height > box.y + box.height + 1)
      throw new Error(`${shot.id} (${lang}): ${callout.label[lang]} is below the part that is taken`);
    rings.push({
      x: (rect.x - box.x) / box.width,
      y: (rect.y - box.y) / box.height,
      w: rect.width / box.width,
      h: rect.height / box.height,
    });
  }
  const png = await page.screenshot({ type: "png", animations: "disabled", clip: box, fullPage: true });
  return { png, rings };
}

/** The screenshot's width in CSS pixels (it is taken at 2x). */
function cssWidth(png: Buffer): number {
  return png.readUInt32BE(16) / 2;
}

function compose(shot: Shot, lang: Lang, png: Buffer, rings: Ring[], font: string): string {
  // Shown at its own size (the text as big as in the app), never stretched.
  const width = Math.min(SHOT_COLUMN, Math.round(cssWidth(png)));
  // The card is only as wide as the screenshot and the notes (no empty right part), at least 900.
  const inner = Math.max(width + 40 + 360, 900);
  const tag =
    shot.tag === "hot"
      ? `<span class="tag hot">HOT</span>`
      : shot.tag === "new"
        ? `<span class="tag new">NEW</span>`
        : "";
  const marks = rings
    .map(
      (ring, index) =>
        `<div class="ring" style="left:calc(${(ring.x * 100).toFixed(3)}% - 6px);top:calc(${(ring.y * 100).toFixed(3)}% - 3px);width:calc(${(ring.w * 100).toFixed(3)}% + 12px);height:calc(${(ring.h * 100).toFixed(3)}% + 6px)"><b class="${shot.callouts[index]?.badge ?? "start"}">${index + 1}</b></div>`,
    )
    .join("");
  const notes = shot.callouts
    .map(
      (callout, index) =>
        `<li><b>${index + 1}</b><div><strong>${escapeHtml(callout.label[lang])}</strong><span>${escapeHtml(callout.note[lang])}</span></div></li>`,
    )
    .join("");
  return `<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><style>
@font-face { font-family: "Google Sans Flex"; src: url(data:font/woff2;base64,${font}) format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { background: ${BRAND.canvas}; font-family: "Google Sans Flex", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif; color: ${BRAND.ink}; }
.card { width: ${inner + 112}px; padding: 48px 56px 40px; }
header { display: flex; align-items: center; gap: 12px; }
.ver { font-size: 15px; font-weight: 600; color: ${BRAND.blue}; background: rgba(1,86,211,.08); border-radius: 999px; padding: 6px 14px; }
.tag { font-size: 13px; font-weight: 700; letter-spacing: .08em; color: #fff; border-radius: 999px; padding: 5px 11px; }
.tag.hot { background: ${BRAND.orange}; }
.tag.new { background: ${BRAND.blue}; }
h1 { font-size: 40px; line-height: 1.2; font-weight: 600; letter-spacing: -.01em; margin-top: 18px; }
.lead { font-size: 19px; line-height: 1.55; color: ${BRAND.muted}; margin-top: 10px; max-width: ${inner}px; }
.body { display: grid; grid-template-columns: ${width}px 360px; gap: 40px; margin-top: 34px; align-items: start; }
.shot { position: relative; border-radius: 22px; overflow: visible; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 18px 48px rgba(0,0,0,.10); }
.shot img { display: block; width: 100%; border-radius: 22px; }
.ring { position: absolute; border: 2.5px solid ${BRAND.blue}; border-radius: 12px; box-shadow: 0 0 0 5px rgba(1,86,211,.14); }
.ring b, li > b { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: ${BRAND.blue}; color: #fff; font-size: 16px; font-weight: 700; }
.ring b { position: absolute; top: 50%; margin-top: -15px; box-shadow: 0 0 0 3px #fff; }
.ring b.start { left: -42px; }
.ring b.end { right: -42px; }
.ring b.corner { left: -16px; top: -16px; margin-top: 0; }
ol { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 22px; margin-top: 8px; }
li { display: flex; gap: 14px; align-items: flex-start; }
li > b { flex: 0 0 30px; }
li strong { display: block; font-size: 19px; font-weight: 600; line-height: 1.35; }
li span { display: block; font-size: 16px; line-height: 1.5; color: ${BRAND.muted}; margin-top: 4px; }
footer { margin-top: 28px; font-size: 13px; color: ${BRAND.muted}; }
</style></head><body><div class="card"><header><span class="ver">${WORDS.version[lang]} ${shot.version}</span>${tag}</header>
<h1>${escapeHtml(shot.title[lang])}</h1><p class="lead">${escapeHtml(shot.lead[lang])}</p>
<div class="body"><div class="shot"><img src="data:image/png;base64,${png.toString("base64")}" alt="">${marks}</div><ol>${notes}</ol></div>
<footer>HXBot · ${WORDS.demo[lang]}</footer></div></body></html>`;
}

async function main(): Promise<void> {
  const [base, outArg] = process.argv.slice(2);
  if (!base || !outArg) throw new Error("Usage: bun scripts/hx-highlight-shots.ts <Storybook URL> <output folder>");
  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });
  const tags = SHOTS.filter((shot) => shot.tag);
  if (tags.filter((shot) => shot.tag === "hot").length !== 1 || tags.filter((shot) => shot.tag === "new").length !== 1)
    throw new Error("SHOTS must have one HOT and one NEW");
  const font = readFileSync(join(import.meta.dir, "..", "hx/docs/assets/google-sans-flex-latin.woff2")).toString(
    "base64",
  );
  const browser = await chromium.launch({
    executablePath: process.env.HX_CHROME ?? "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--font-render-hinting=none"],
  });
  const report: { id: string; lang: Lang; file: string; rings: number }[] = [];
  try {
    // HX_SHOTS=id,id makes only those again (while working on them).
    const only = (process.env.HX_SHOTS ?? "").split(",").filter(Boolean);
    for (const shot of SHOTS.filter((item) => only.length === 0 || only.includes(item.id))) {
      for (const lang of ["zh", "en"] as const) {
        const page = await browser.newPage({ deviceScaleFactor: 2 });
        const { png, rings } = await capture(page, base.replace(/\/$/, ""), shot, lang);
        await page.close();
        const html = compose(shot, lang, png, rings, font);
        const file = join(out, `${shot.id}.${lang}.png`);
        // The page shows it about 820 pixels wide: 1.2x is sharp there and small to load.
        for (const [scale, path, type] of [
          [2, file, "png"],
          [1.2, join(out, `${shot.id}.${lang}.jpg`), "jpeg"],
        ] as const) {
          const card = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
          await card.setContent(html, { waitUntil: "load" });
          await card.locator(".card").screenshot(type === "png" ? { path, type } : { path, type, quality: 84 });
          await card.close();
        }
        report.push({ id: shot.id, lang, file, rings: rings.length });
        process.stdout.write(`${shot.id}.${lang}.png\n`);
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(
    join(out, "report.json"),
    `${JSON.stringify({ at: new Date().toISOString(), shots: report }, null, 2)}\n`,
  );
}

await main();
