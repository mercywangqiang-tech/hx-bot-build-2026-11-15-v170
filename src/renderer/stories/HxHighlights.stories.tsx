// HXBot: the screens of the version highlights, with demo data (hx-highlights).
//
// `scripts/hx-highlight-shots.ts` opens each story in Chinese and in English and saves the
// screenshots that the What's new page, the 新功能说明 document and the website's HXBot page show.
// Each story renders the real component; only the data is made up. A new version adds its stories
// here and keeps the earlier ones, as the What's new page keeps the earlier versions.

import { HX_AUTO_DEFAULTS, type HxAutoModelView } from "@hxbot/contracts/hx-auto-model";
import type { HxComputerStatus, HxSelfTestReport } from "@hxbot/contracts/hx-computer";
import type { HxOcCatalog, HxOcIntegration } from "@hxbot/contracts/hx-opencode";
import type { ComputerUseState } from "@hxbot/contracts/ipc";
import type { UiConfirmBlock as UiConfirmSpec } from "@hxbot/contracts/ui-blocks";
import { Text } from "@hxbot/ui";
import { type AgentStep, AgentStepsDisclosure } from "@hxbot/ui/features/conversation/AgentSteps";
import { ChatActionMarker } from "@hxbot/ui/features/conversation/ChatActionMarker";
import { MarkdownMessageText } from "@hxbot/ui/features/conversation/MarkdownMessageText";
import { TaskList } from "@hxbot/ui/features/conversation/TaskList";
import { UiConfirmBlock } from "@hxbot/ui/features/conversation/ui-blocks/UiConfirmBlock";
import { CustomProviderPresetDialog } from "@hxbot/ui/features/custom-providers/CustomProviderPresetDialog";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { HxAutoModelSection } from "../src/features/agents/HxAutoModelSection";
import { ComputerUsePermissionHelp } from "../src/features/computer-use/ComputerUsePermissionHelp";
import { ComputerUseSetup } from "../src/features/computer-use/ComputerUseSetup";
import { HxOpenCodeDialog } from "../src/features/hx-opencode/HxOpenCodeDialog";
import type { HxOpenCodePort } from "../src/features/hx-opencode/hx-opencode-port";
import { HxComputerPanel } from "../src/features/settings/HxComputerPanel";
import { useI18n } from "../src/i18n-context";
import "./hx-highlights.css";
import { createMockHxBot } from "./mock-hxbot";

const meta = {
  title: "HXBot/Highlights",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const zh = () => useI18n().locale().startsWith("zh");

// ---------------------------------------------------------------- v1.6.4: computer control

function computerSteps(): AgentStep[] {
  if (zh())
    return [
      { id: "t1", kind: "thinking", text: "要打开网易云音乐，再打开深色模式。先在这台电脑的目录里找。" },
      { id: "p1", kind: "progress", text: "在目录里找到“网易云音乐”（拼音 wyyyy 也能找到）" },
      { id: "p2", kind: "progress", text: "打开了网易云音乐 · 0.4 秒，没有截图，没有点鼠标" },
      { id: "p3", kind: "progress", text: "深色模式：关 → 开，读回核对一致" },
    ];
  return [
    {
      id: "t1",
      kind: "thinking",
      text: "Open NetEase Cloud Music, then turn on dark mode. I look in this computer's catalog first.",
    },
    { id: "p1", kind: "progress", text: "Found “NetEase Cloud Music” in the catalog (pinyin “wyyyy” finds it too)" },
    { id: "p2", kind: "progress", text: "Opened NetEase Cloud Music · 0.4 s, no screenshot, no clicks" },
    { id: "p3", kind: "progress", text: "Dark mode: off → on, read back and checked" },
  ];
}

/** An agent opens an app by name and changes a setting, with the steps open. */
export const ComputerOpen: Story = {
  render: () => {
    const isZh = zh();
    return (
      <main class="foundation-story hx-highlight-frame">
        <Text>
          {isZh ? "你：打开网易云音乐，再把深色模式打开" : "You: open NetEase Cloud Music and turn on dark mode"}
        </Text>
        <AgentStepsDisclosure steps={computerSteps()} defaultOpen={true} facts={{ durationMs: 2_100, failed: 0 }} />
        <MarkdownMessageText
          body={isZh ? "网易云音乐已经打开，深色模式也打开了。" : "NetEase Cloud Music is open, and dark mode is on."}
          agents={[]}
          onSelectAgent={fn()}
          onOpenLink={fn()}
        />
      </main>
    );
  },
};

const COMPUTER_STATUS: HxComputerStatus = {
  platform: "mac",
  builtAt: Date.UTC(2026, 10, 14, 9, 30),
  apps: 128,
  pages: 40,
  settings: 16,
  directSettings: 16,
  disabled: [],
  unchecked: 0,
};

const SELF_TEST: HxSelfTestReport = {
  platform: "mac",
  system: "macOS 26.1",
  startedAt: Date.UTC(2026, 10, 14, 9, 31),
  finishedAt: Date.UTC(2026, 10, 14, 9, 31, 4),
  items: [],
  passed: 56,
  failed: 0,
  skipped: 0,
  file: "~/Downloads/HXBot-self-test-2026-11-14.json",
};

/** Settings › Computer Use: the catalog of this computer and the self-test. */
export const ComputerUse: Story = {
  render: () => (
    <main class="foundation-story hx-highlight-frame">
      <HxComputerPanel
        visible={true}
        calls={{
          status: async () => COMPUTER_STATUS,
          rebuild: async () => COMPUTER_STATUS,
          selfTest: async () => SELF_TEST,
        }}
      />
    </main>
  ),
};

// ---------------------------------------------------------------- v1.6.5: auto model

const MODELS: HxAutoModelView["models"] = [
  {
    ref: { provider: "opencode", model: "opencode/glm-5.3-flash-free" },
    name: "GLM-5.3-Flash Free",
    tier: "B",
    cost: "free",
    vision: false,
    ready: true,
    excluded: false,
  },
  {
    ref: { provider: "opencode", model: "opencode/nemotron-3.5-super-vl-free" },
    name: "Nemotron 3.5 Super VL Free",
    tier: "B",
    cost: "free",
    vision: true,
    ready: true,
    excluded: false,
  },
  {
    ref: { provider: "opencode", model: "deepseek/deepseek-v4-pro" },
    name: "DeepSeek V4 Pro",
    tier: "A",
    cost: "paid",
    vision: false,
    ready: true,
    excluded: false,
  },
  {
    ref: { provider: "claude", model: "claude-opus-5-5" },
    name: "Claude Opus 5.5",
    tier: "S",
    cost: "subscription",
    vision: true,
    ready: true,
    excluded: false,
  },
];

const AUTO_VIEW: HxAutoModelView = {
  agentId: "a1",
  settings: { ...HX_AUTO_DEFAULTS, enabled: true },
  models: MODELS,
  preview: {
    chat: { provider: "opencode", model: "opencode/glm-5.3-flash-free", name: "GLM-5.3-Flash Free" },
    writing: { provider: "opencode", model: "opencode/glm-5.3-flash-free", name: "GLM-5.3-Flash Free" },
    "code-large": { provider: "opencode", model: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    vision: {
      provider: "opencode",
      model: "opencode/nemotron-3.5-super-vl-free",
      name: "Nemotron 3.5 Super VL Free",
    },
    reasoning: { provider: "claude", model: "claude-opus-5-5", name: "Claude Opus 5.5" },
  },
  freeQuota: { blockedUntil: null, usedToday: 12 },
  decisions: [],
};

/** Agent settings › Auto model, on, with its preview. */
export const AutoModel: Story = {
  render: () => (
    <main class="foundation-story hx-highlight-frame">
      {/* As wide as the agent settings panel opens (SETTINGS_PANEL_DEFAULT). */}
      <div class="agent-settings-page hx-highlight-panel">
        <HxAutoModelSection
          agentId="a1"
          calls={{ view: async () => AUTO_VIEW, update: async (_agent, settings) => ({ ...AUTO_VIEW, settings }) }}
        />
      </div>
    </main>
  ),
};

/** The line in the chat before each piece of work. */
export const AutoModelLines: Story = {
  render: () => {
    const { t } = useI18n();
    const line = (text: string) => ({
      kind: "model-switch" as const,
      reason: "auto" as const,
      text,
      timestamp: "2026-11-14T09:32:00.000Z",
    });
    const lines = [
      t("status.agent.hxAuto.kept.writing", { model: "GLM-5.3-Flash Free" }),
      t("status.agent.hxAuto.switched.vision", { model: "Nemotron 3.5 Super VL Free" }),
      t("status.agent.hxAuto.switched.reasoning", { model: "Claude Opus 5.5" }),
    ];
    return (
      <main class="foundation-story hx-highlight-frame">
        {lines.map((text) => (
          <ChatActionMarker marker={line(text)} agents={[]} onSelectAgent={fn()} />
        ))}
      </main>
    );
  },
};

function proposal(): UiConfirmSpec {
  if (zh())
    return {
      type: "confirm",
      title: "调研三家竞品的定价：建议三个智能体分工",
      fields: [
        { label: "研究员", value: "分别查三家的公开定价，整理成表 · GLM-5.3-Flash Free（免费）" },
        { label: "撰写", value: "写一页对比结论 · DeepSeek V4 Pro（按量付费）" },
        { label: "检查", value: "核对每个数字和出处 · Claude Opus 5.5（订阅）" },
        { label: "时间", value: "约 25 分钟" },
      ],
      preview:
        "**步骤**\n1. 查三家的定价页 · 研究员\n2. 整理成对比表 · 研究员\n3. 写对比结论 · 撰写\n4. 核对数字 · 检查\n\n**要用到**：浏览器、表格\n\n**要你确认**：发出前看一遍结论\n\n**花费**：免费模型 1 个角色，订阅或付费模型 2 个角色",
      actions: [
        { id: "start", label: "开始", style: "primary" },
        { id: "adjust", label: "改一改" },
        { id: "one", label: "就用一个智能体" },
        { id: "cancel", label: "取消", style: "ghost" },
      ],
    };
  return {
    type: "confirm",
    title: "Research three competitors' prices: three agents share the work",
    fields: [
      { label: "Researcher", value: "Find each public price list and put it in a table · GLM-5.3-Flash Free (free)" },
      { label: "Writer", value: "Write one page of conclusions · DeepSeek V4 Pro (paid)" },
      { label: "Checker", value: "Check each figure and its source · Claude Opus 5.5 (subscription)" },
      { label: "Time", value: "about 25 min" },
    ],
    preview:
      "**Steps**\n1. Read the three price pages · Researcher\n2. Make the comparison table · Researcher\n3. Write the conclusions · Writer\n4. Check the figures · Checker\n\n**Uses**: browser, spreadsheet\n\n**Waits for you**: read the conclusions before they go out\n\n**Cost**: 1 of 3 roles on free models",
    actions: [
      { id: "start", label: "Start", style: "primary" },
      { id: "adjust", label: "Change it" },
      { id: "one", label: "Use one agent" },
      { id: "cancel", label: "Cancel", style: "ghost" },
    ],
  };
}

/** The proposal card before bigger work. */
export const ProposalCard: Story = {
  render: () => (
    <main class="foundation-story hx-highlight-frame">
      <UiConfirmBlock
        spec={proposal()}
        onRespond={fn()}
        disabled={false}
        busy={false}
        renderPreview={(markdown) => (
          <div class="message-markdown">
            <MarkdownMessageText imagesAsLinks body={markdown} agents={[]} onSelectAgent={fn()} onOpenLink={fn()} />
          </div>
        )}
      />
    </main>
  ),
};

// ---------------------------------------------------------------- v1.6.5: every OpenCode service

/** Add provider, with the OpenCode group on top. */
export const OpenCodeInAddProvider: Story = {
  render: () => <CustomProviderPresetDialog open={true} onChoose={fn()} onCancel={fn()} onOpenCode={fn()} />,
};

const NO_FIELDS = { fields: [], envNames: [] } as const;
const key = (label: string | null = null) => ({ kind: "key" as const, id: null, label, ...NO_FIELDS });
const oauth = (id: string, label: string) => ({ kind: "oauth" as const, id, label, ...NO_FIELDS });

const SERVICES: HxOcIntegration[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    methods: [key()],
    connections: [{ kind: "credential", id: "cred_1", label: "HXBot", method: "key" }],
  },
  {
    id: "opencode",
    name: "OpenCode Console",
    methods: [key("API key (service account)"), oauth("device", "OpenCode Console account")],
    connections: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    methods: [
      key(),
      oauth("chatgpt-token-sharing", "Sign in with ChatGPT"),
      oauth("chatgpt-browser", "Codex browser (legacy)"),
    ],
    connections: [],
  },
  { id: "anthropic", name: "Anthropic", methods: [key()], connections: [] },
  { id: "google", name: "Google", methods: [key()], connections: [] },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    methods: [oauth("device", "Login with GitHub Copilot")],
    connections: [],
  },
  { id: "moonshotai", name: "Moonshot AI", methods: [key()], connections: [] },
  { id: "zhipuai", name: "Zhipu AI", methods: [key()], connections: [] },
  { id: "alibaba", name: "Alibaba", methods: [key()], connections: [] },
  { id: "xai", name: "xAI", methods: [key(), oauth("device", "SuperGrok Subscription")], connections: [] },
  { id: "openrouter", name: "OpenRouter", methods: [key()], connections: [] },
];

const CATALOG: HxOcCatalog = {
  state: "ready",
  version: "2.2.5",
  message: null,
  integrations: SERVICES,
  freeModels: 8,
  models: { deepseek: 2 },
};

const OPENCODE_PORT: HxOpenCodePort = {
  hxOpenCodeCatalog: async () => CATALOG,
  hxOpenCodeConnectKey: async () => CATALOG,
  hxOpenCodeConnectExternal: async () => CATALOG,
  hxOpenCodeStartSignIn: async () => ({
    integrationId: "openai",
    attemptId: "con_1",
    url: "https://example.com",
    instructions: "",
    mode: "auto",
    expiresAt: Date.now() + 600_000,
  }),
  hxOpenCodeSignInStatus: async () => ({ status: "pending", message: null }),
  hxOpenCodeCompleteSignIn: async () => ({ status: "pending", message: null }),
  hxOpenCodeCancelSignIn: async () => undefined,
  hxOpenCodeDisconnect: async () => CATALOG,
  openUrl: async () => undefined,
};

/** All OpenCode services: free models on top, a connected service, the ways in of one service. */
export const OpenCodeServices: Story = {
  render: () => <HxOpenCodeDialog open={true} onClose={fn()} port={OPENCODE_PORT} />,
};

// ---------------------------------------------------------------- v1.6.6: teams of agents

function teamProposal(): UiConfirmSpec {
  if (zh())
    return {
      type: "confirm",
      title: "新品发布：推广文案和海报，建议三个智能体分工",
      fields: [
        { label: "规划", value: "定卖点和口径，最后检查 · Claude Opus 5.5（订阅） · 由 方案老李 来做" },
        { label: "写作者", value: "写公众号推文和朋友圈文案 · GLM-5.3-Flash Free（免费） · 由 文案小王 来做" },
        { label: "设计师", value: "按文案画三张海报 · Nemotron 3.5 Super VL Free（免费） · 新建一个成员" },
        { label: "时间", value: "约 40 分钟" },
      ],
      preview:
        "**步骤**\n1. 定卖点和口径 · 规划\n2. 写推文和文案 · 写作者\n3. 画三张海报 · 设计师（与上一步同时）\n4. 检查文案和海报 · 规划\n\n**要用到**：浏览器、图片\n\n**要你确认**：发布前看一遍\n\n**花费**：免费模型 2 个角色，订阅或付费模型 1 个角色",
      actions: [
        { id: "start", label: "开始", style: "primary" },
        { id: "adjust", label: "改一改" },
        { id: "one", label: "就用一个智能体" },
        { id: "cancel", label: "取消", style: "ghost" },
      ],
    };
  return {
    type: "confirm",
    title: "Product launch: posts and posters, three agents share the work",
    fields: [
      {
        label: "Planner",
        value: "Set the key points, check at the end · Claude Opus 5.5 (subscription) · Leo takes it",
      },
      {
        label: "Writer",
        value: "Write the blog post and the social posts · GLM-5.3-Flash Free (free) · Wendy takes it",
      },
      {
        label: "Designer",
        value: "Draw three posters from the text · Nemotron 3.5 Super VL Free (free) · a new member",
      },
      { label: "Time", value: "about 40 min" },
    ],
    preview:
      "**Steps**\n1. Set the key points · Planner\n2. Write the posts · Writer\n3. Draw three posters · Designer (at the same time as the step before)\n4. Check the posts and posters · Planner\n\n**Uses**: browser, images\n\n**Waits for you**: read it before it goes out\n\n**Cost**: 2 of 3 roles on free models",
    actions: [
      { id: "start", label: "Start", style: "primary" },
      { id: "adjust", label: "Change it" },
      { id: "one", label: "Use one agent" },
      { id: "cancel", label: "Cancel", style: "ghost" },
    ],
  };
}

/** The proposal card of a team: it names who takes each role. */
export const TeamCard: Story = {
  render: () => (
    <main class="foundation-story hx-highlight-frame">
      <UiConfirmBlock
        spec={teamProposal()}
        onRespond={fn()}
        disabled={false}
        busy={false}
        renderPreview={(markdown) => (
          <div class="message-markdown">
            <MarkdownMessageText imagesAsLinks body={markdown} agents={[]} onSelectAgent={fn()} onOpenLink={fn()} />
          </div>
        )}
      />
    </main>
  ),
};

/** The lines of a team in the starter's chat: the team, the handoffs, the results, the end. */
export const TeamProgress: Story = {
  render: () => {
    const { t } = useI18n();
    const chinese = zh();
    const line = (text: string) => ({ kind: "channel-change" as const, text, timestamp: "2026-11-14T10:12:00.000Z" });
    const lines = [
      t("status.agent.hxTeam.started", {
        members: chinese ? "方案老李、文案小王、设计师" : "Leo, Wendy, Designer",
        lead: chinese ? "方案老李" : "Leo",
      }),
      t("status.agent.hxTeam.assigned", {
        from: chinese ? "方案老李" : "Leo",
        to: chinese ? "文案小王" : "Wendy",
        task: chinese ? "写公众号推文和朋友圈文案" : "Write the blog post and the social posts",
        count: 1,
        limit: 20,
      }),
      t("status.agent.hxTeam.assigned", {
        from: chinese ? "方案老李" : "Leo",
        to: chinese ? "设计师" : "Designer",
        task: chinese ? "按文案画三张海报" : "Draw three posters from the text",
        count: 2,
        limit: 20,
      }),
      t("status.agent.hxTeam.returned", { name: chinese ? "文案小王" : "Wendy", done: 2, steps: 4 }),
      t("status.agent.hxTeam.message", { name: chinese ? "方案老李" : "Leo" }),
      t("status.agent.hxTeam.returned", { name: chinese ? "设计师" : "Designer", done: 3, steps: 4 }),
      t("status.agent.hxTeam.done", { minutes: 34 }),
      t("status.agent.hxTeam.collapsed", { names: chinese ? "设计师" : "Designer" }),
    ];
    return (
      <main class="foundation-story hx-highlight-frame">
        {lines.map((text) => (
          <ChatActionMarker marker={line(text)} agents={[]} onSelectAgent={fn()} />
        ))}
      </main>
    );
  },
};

/** Agent settings › the proposal card and the limits of a team. */
export const TeamSettings: Story = {
  render: () => {
    const view: HxAutoModelView = { ...AUTO_VIEW, settings: { ...HX_AUTO_DEFAULTS, enabled: false } };
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="agent-settings-page hx-highlight-panel">
          <HxAutoModelSection
            agentId="a1"
            calls={{ view: async () => view, update: async (_agent, settings) => ({ ...view, settings }) }}
          />
        </div>
      </main>
    );
  },
};

// ---------------------------------------------------------------- v1.6.7: steps in apps, bigger teams

/** An agent works in an app step by step: the plan card in the chat, with the stop keys. */
export const ComputerSteps: Story = {
  render: () => {
    const { t } = useI18n();
    const chinese = zh();
    const steps = chinese
      ? ["打开备忘录", "新建一条备忘录", "输入明天上午 10 点的产品评审会", "核对内容已经保存"]
      : [
          "Open Notes",
          "Make a new note",
          "Type the product review at 10 a.m. tomorrow",
          "Check that the note is saved",
        ];
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="message-markdown">
          <MarkdownMessageText
            body={
              chinese
                ? "在备忘录里新建一条，写上明天上午 10 点的产品评审会。"
                : "Make a note in Notes for the product review at 10 a.m. tomorrow."
            }
            agents={[]}
            onSelectAgent={fn()}
            onOpenLink={fn()}
          />
        </div>
        <TaskList
          class="hx-highlight-wide"
          title={t("status.agent.hxComputer.plan", { app: chinese ? "备忘录" : "Notes", keys: "⌃⌥Esc" })}
          items={steps.map((label, index) => ({
            id: String(index),
            label,
            state: index < 2 ? "done" : index === 2 ? "active" : "pending",
          }))}
        />
      </main>
    );
  },
};

/** The progress card of a team in the starter's chat. */
export const TeamProgressCard: Story = {
  render: () => {
    const { t } = useI18n();
    const chinese = zh();
    const steps = chinese
      ? ["定方案 · 方案老李", "写推文和朋友圈文案 · 文案小王", "按文案画三张海报 · 设计师", "检查并交回 · 方案老李"]
      : [
          "Make the plan · Leo",
          "Write the blog and social posts · Wendy",
          "Draw three posters · Designer",
          "Check and send back · Leo",
        ];
    return (
      <main class="foundation-story hx-highlight-frame">
        <TaskList
          class="hx-highlight-wide"
          title={t("status.agent.hxTeam.progress", { count: 3, limit: 80, minutes: 12, max: 240 })}
          items={steps.map((label, index) => ({
            id: String(index),
            label,
            state: index < 2 ? "done" : index === 2 ? "active" : "pending",
          }))}
        />
      </main>
    );
  },
};

/** Agent settings › auto model on by default, and the limits of a team as one line. */
export const TeamSummary: Story = {
  render: () => {
    const view: HxAutoModelView = { ...AUTO_VIEW, settings: HX_AUTO_DEFAULTS };
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="agent-settings-page hx-highlight-panel">
          <HxAutoModelSection
            agentId="a1"
            calls={{ view: async () => view, update: async (_agent, settings) => ({ ...view, settings }) }}
          />
        </div>
      </main>
    );
  },
};

// ---------------------------------------------------------------- v1.6.8: Mac permissions, installing apps

/** Accessibility is on; Screen Recording is not yet, and its Grant button is where HXBot takes over. */
const GRANT_STATE: ComputerUseState = {
  status: "ready",
  permissions: [
    { id: "screen-recording", granted: false },
    { id: "accessibility", granted: true },
  ],
  message: null,
};

function useComputerUseMock(): void {
  const previousApi = window.hxbot;
  const mock = createMockHxBot();
  mock.api.computerUse.getState = async () => GRANT_STATE;
  mock.api.computerUse.getPermissionApp = async () => ({ name: "HXBot", iconDataUrl: null });
  window.hxbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.hxbot = previousApi;
  });
}

/** Settings › Computer Use: what each grant is for, and who turns it on. */
export const ComputerGrants: Story = {
  render: () => {
    useComputerUseMock();
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="hx-highlight-settings">
          <ComputerUseSetup variant="settings" />
        </div>
      </main>
    );
  },
};

/** The steps window beside System Settings: HXBot turns the Screen Recording switch on itself. */
export const GrantSteps: Story = {
  render: () => {
    useComputerUseMock();
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="hx-highlight-window">
          <ComputerUsePermissionHelp permission="screen-recording" />
        </div>
      </main>
    );
  },
};

function installSteps(): AgentStep[] {
  if (zh())
    return [
      { id: "i1", kind: "progress", text: "computer_install：~/Downloads/Claude.dmg → Claude 2.0" },
      { id: "i2", kind: "progress", text: "签名：Developer ID Application: Anthropic PBC · 已公证" },
      { id: "i3", kind: "progress", text: "已经装了 Claude 1.9：先问你，你回答“替换”" },
      { id: "i4", kind: "progress", text: "装好 Claude 2.0，读回版本一致；1.9 放进了废纸篓" },
    ];
  return [
    { id: "i1", kind: "progress", text: "computer_install: ~/Downloads/Claude.dmg → Claude 2.0" },
    { id: "i2", kind: "progress", text: "Signature: Developer ID Application: Anthropic PBC · notarized" },
    { id: "i3", kind: "progress", text: "Claude 1.9 is installed: it asked you, and you said “replace”" },
    { id: "i4", kind: "progress", text: "Claude 2.0 is installed and reads back right; 1.9 is in the Trash" },
  ];
}

/** An agent puts a downloaded app into Applications: HXBot installs it, asks before it replaces. */
export const ComputerInstall: Story = {
  render: () => {
    const chinese = zh();
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="message-markdown">
          <MarkdownMessageText
            body={
              chinese ? "把下载好的 Claude 装进“应用程序”文件夹。" : "Put the Claude I downloaded into Applications."
            }
            agents={[]}
            onSelectAgent={fn()}
            onOpenLink={fn()}
          />
        </div>
        <AgentStepsDisclosure steps={installSteps()} defaultOpen={true} facts={{ durationMs: 8_400, failed: 0 }} />
        <div class="message-markdown">
          <MarkdownMessageText
            body={
              chinese
                ? "装好了：Claude 2.0 在“应用程序”文件夹里，第一次打开时 macOS 会照常检查。"
                : "Done: Claude 2.0 is in Applications. macOS checks it as usual the first time it opens."
            }
            agents={[]}
            onSelectAgent={fn()}
            onOpenLink={fn()}
          />
        </div>
      </main>
    );
  },
};

function appSteps(): AgentStep[] {
  if (zh())
    return [
      { id: "a1", kind: "progress", text: "computer_app 列出运行中的应用：Microsoft Excel、访达、备忘录" },
      { id: "a2", kind: "progress", text: "computer_run 运行 AppleScript：Excel 把“销售.xlsx”另存为“销售.pdf”" },
      { id: "a3", kind: "progress", text: "窗口放到左半边：直达不行，改用命令，放好了" },
      { id: "a4", kind: "progress", text: "退出 Excel：有没保存的改动，Excel 自己问要不要保存，交给你点" },
    ];
  return [
    { id: "a1", kind: "progress", text: "computer_app lists the running apps: Microsoft Excel, Finder, Notes" },
    { id: "a2", kind: "progress", text: "computer_run runs an AppleScript: Excel saves Sales.xlsx as Sales.pdf" },
    { id: "a3", kind: "progress", text: "Window to the left half: the direct way did not work, so a command did it" },
    { id: "a4", kind: "progress", text: "Quit Excel: it has unsaved changes and asks whether to save, so you choose" },
  ];
}

/** v1.6.9: app commands and scripts in HXBot itself, with the next route when one does not work. */
export const ComputerApps: Story = {
  render: () => {
    const chinese = zh();
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="message-markdown">
          <MarkdownMessageText
            body={
              chinese
                ? "把 Excel 里的“销售.xlsx”另存成 PDF，窗口放左边，然后退出 Excel。"
                : "Save Sales.xlsx in Excel as a PDF, put the window on the left, then quit Excel."
            }
            agents={[]}
            onSelectAgent={fn()}
            onOpenLink={fn()}
          />
        </div>
        <AgentStepsDisclosure steps={appSteps()} defaultOpen={true} facts={{ durationMs: 6_200, failed: 0 }} />
        <div class="message-markdown">
          <MarkdownMessageText
            body={
              chinese
                ? "“销售.pdf”已经存在“文稿”里。Excel 在问要不要保存改动，请你在它的窗口里选；要强制退出的话告诉我。"
                : "Sales.pdf is in Documents. Excel asks whether to save its changes: choose in its window, or tell me to force quit."
            }
            agents={[]}
            onSelectAgent={fn()}
            onOpenLink={fn()}
          />
        </div>
      </main>
    );
  },
};

function quietSteps(): AgentStep[] {
  if (zh())
    return [
      { id: "q1", kind: "progress", text: "computer_look 读记事本的窗口：找到正文输入框" },
      { id: "q2", kind: "progress", text: "点正文输入框：在后台点好了，没有把记事本拉到前面" },
      { id: "q3", kind: "progress", text: "输入文字之前：你切到了别的应用，按键没有发出去" },
      { id: "q4", kind: "progress", text: "操作结束：松开了 Ctrl、Shift、Alt，别的应用的快捷键照常" },
    ];
  return [
    { id: "q1", kind: "progress", text: "computer_look reads the Notepad window: the text box is there" },
    { id: "q2", kind: "progress", text: "Click the text box: done in the background, Notepad stays behind" },
    { id: "q3", kind: "progress", text: "Before typing: you moved to another app, so no key was sent" },
    { id: "q4", kind: "progress", text: "Work done: Ctrl, Shift and Alt let go, other apps' shortcuts work" },
  ];
}

/** v1.7.0: HXBot does not disturb other apps. */
export const ComputerQuiet: Story = {
  render: () => {
    const chinese = zh();
    return (
      <main class="foundation-story hx-highlight-frame">
        <div class="message-markdown">
          <MarkdownMessageText
            body={
              chinese ? "把这段会议纪要填进记事本里，然后保存。" : "Put these meeting notes into Notepad, then save."
            }
            agents={[]}
            onSelectAgent={fn()}
            onOpenLink={fn()}
          />
        </div>
        <AgentStepsDisclosure steps={quietSteps()} defaultOpen={true} facts={{ durationMs: 3_400, failed: 0 }} />
        <div class="message-markdown">
          <MarkdownMessageText
            body={
              chinese
                ? "你正在用别的应用，我没有往那里打字，也没有把记事本拉到前面。回到记事本后告诉我，我接着填。"
                : "You are working in another app, so I typed nothing there and did not pull Notepad to the front. Tell me when you are back in Notepad, and I go on."
            }
            agents={[]}
            onSelectAgent={fn()}
            onOpenLink={fn()}
          />
        </div>
      </main>
    );
  },
};
