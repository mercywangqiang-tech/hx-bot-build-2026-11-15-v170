// HXBot（v1.6.8，复盘 F3、F6）：最大权限下，哪些模型的命令还在 macOS 的进程沙盒里，沙盒放开哪些包管理器的
// 文件夹，以及给沙盒里的模型的一句说明。
//
// - OpenCode 在最大权限下每个工具都先问 HXBot（hub.ts 的 hxOpenCodeOnDemand），由 HXBot 按规则回答，和 Codex、
//   Claude 一样，所以在 macOS 上也不进沙盒（Windows、Linux 本来就不进）。自动选择模型常选 OpenCode，复盘里
//   “换到 OpenCode 就被拦”的 ps、brew、截屏、复制到“应用程序”文件夹由此不再碰壁。
// - 其他用沙盒的模型不是每次写入都问 HXBot，沙盒保留，但放开 Homebrew、npm、pip、cargo、bun 这些包管理器的
//   安装和缓存文件夹；装应用用 computer_install、截屏用 capture_screen，v1.6.9 起控制别的应用用 computer_app、
//   运行 AppleScript、JXA、快捷指令用 computer_run（都由 HXBot 主程序做）。
import { homedir } from "node:os";
import { join } from "node:path";
import { type AgentProviderId, agentProviderDescriptor } from "@hxbot/contracts/agent-providers";

/** Providers that ask HXBot before every tool at 最大权限, so the grants hold them without a sandbox. */
const ASKS_BEFORE_EVERY_TOOL: ReadonlySet<AgentProviderId> = new Set(["opencode"]);

/** Whether the provider's own commands run in macOS's process sandbox at 最大权限. */
export function hxProcessSandboxed(provider: AgentProviderId, platform: NodeJS.Platform = process.platform): boolean {
  return (
    platform === "darwin" &&
    agentProviderDescriptor(provider).workspaceEnforcement === "confined-process" &&
    !ASKS_BEFORE_EVERY_TOOL.has(provider)
  );
}

/** Where package managers install and keep their caches on a Mac: writable in the sandbox. */
export function hxPackageFolders(platform: NodeJS.Platform = process.platform, home: string = homedir()): string[] {
  if (platform !== "darwin") return [];
  const usrLocal = [
    "Homebrew",
    "Cellar",
    "Caskroom",
    "var/homebrew",
    "bin",
    "sbin",
    "lib",
    "include",
    "share",
    "opt",
    "etc",
  ];
  const inHome = [
    "Library/Caches/Homebrew",
    "Library/Logs/Homebrew",
    ".npm",
    ".cache/pip",
    "Library/Caches/pip",
    ".cargo",
    ".rustup",
    ".bun",
    "Library/pnpm",
    "Library/Caches/pnpm",
  ];
  return ["/opt/homebrew", ...usrLocal.map((path) => `/usr/local/${path}`), ...inHome.map((path) => join(home, path))];
}

/** One sentence for a provider in the sandbox: what the sandbox refuses, and what to do instead. */
export function hxSandboxInstruction(
  provider: AgentProviderId,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return hxProcessSandboxed(provider, platform)
    ? [
        "Your own commands run in a macOS sandbox: they cannot write outside your folders, the temporary folders and the package managers' folders (Operation not permitted). Do not try another way: install apps with hxbot.computer_install, take screenshots with hxbot.capture_screen, control other apps with hxbot.computer_app, run AppleScript, JXA or Shortcuts with hxbot.computer_run, and tell the user which command macOS refused and why.",
      ]
    : [];
}
