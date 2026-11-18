/**
 * HXBot：桌面端“更新 HXBot”的窗口（HxForcedUpdate）。v1.7.1 起只在账号服务拒绝了这个版本（426）时出现，
 * 挡住窗口、不能关；别的版本打开时自动装，不弹这个窗口（hx-update-policy.ts）。
 */

import type { UpdateStatus } from "@hxbot/contracts/ipc";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { HxForcedUpdate } from "../src/features/updates/HxForcedUpdate";

const NOTES = JSON.stringify({
  version: "0.67.3",
  zh: [
    "设置窗口重新整理：左侧分成“设置”“功能”“数据与安全”三组，想找的设置一眼就能找到。",
    "新增“获取帮助”：一键打开使用指南，或者给我们写邮件反馈。",
    "“更新”改名为“关于”：除了版本和更新，还能直接打开官网、服务条款和隐私政策。",
  ],
  en: [
    "Settings, tidied up: Settings, Features and Data & security, so you find what you need at a glance.",
    "New Get help: open the user guide or send us feedback in one click.",
    "Updates is now About: your version and updates, plus the website, the Terms of Service and the Privacy Policy.",
  ],
});

function window_(status: Partial<UpdateStatus>) {
  return () => {
    const [current] = createSignal<UpdateStatus>({
      phase: "ready",
      currentVersion: "0.67.2",
      availableVersion: "0.67.3",
      progress: null,
      checkedAt: null,
      message: null,
      errorCode: null,
      hxReleaseNotes: NOTES,
      ...status,
    });
    return <HxForcedUpdate updates={{ status: current, runAction: () => Promise.resolve() }} />;
  };
}

const meta = {
  title: "Updates/HxUpdateWindow",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The account service refused this version and the new one is still downloading. */
export const RefusedDownloading: Story = {
  render: window_({ phase: "downloading", availableVersion: "0.67.10", progress: 45, hxRequired: true }),
};

/** The account service refused this version: the update must be installed. */
export const Refused: Story = { render: window_({ phase: "ready", availableVersion: "0.67.10", hxRequired: true }) };
