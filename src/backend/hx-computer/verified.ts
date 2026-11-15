// HXBot 电脑操控：哪些设置的“直接修改”已经在真实的电脑上验证过，按系统、按设置记。
// 依据是 GitHub 的真系统检查（.github/workflows/hx-computer-check.yml，客户端构建 6.8 节）：
// 一项设置在这个系统的每一台测到它的机器上，读、原样写回、真改、换一条路核对、改回、一次启动的做法全部通过，
// 并且至少有一台机器测到了它，才写进这里。成绩单最后的“可以标成已验证的设置”就是这张表的来源。
// 这里的设置，助手不用等这台电脑自检就直接改；不在这里的（例如虚拟机上测不了的音量、亮度），
// 照旧要这台电脑的自检通过了才直接改，没通过就打开设置页由 Computer Use 去改。
// 改之后仍然读回核对，对不上就写回原值、七天内改走设置页：GitHub 上通过不等于每台电脑上都通过。
// 打开应用和设置页、在目录里查、读取设置的值不改变任何东西，不受这里限制。
import type { HxComputerPlatform } from "@hxbot/contracts/hx-computer";

/**
 * The settings whose direct change passed on every real machine of the system that could test it.
 * Each list says which run of the check it comes from. Empty: nothing of that system is verified,
 * and every setting waits for the self-test of the computer.
 */
export const HX_COMPUTER_VERIFIED: Readonly<Record<HxComputerPlatform, readonly string[]>> = {
  // Run 3 of great-unicorn-ai/hxbot-check (2026-11-14): macos-15 (macOS 15.8.2) and macos-26
  // (macOS 26.7.2), each setting read, written back, changed, read another way, changed back and
  // changed in one process, with no failure on either machine.
  mac: [
    "dark-mode",
    "volume",
    "mute",
    "alert-volume",
    "input-volume",
    "dock-autohide",
    "dock-magnification",
    "dock-recents",
    "menu-bar-autohide",
    "dock-position",
    "dock-minimize-effect",
    "dock-size",
    "dock-indicators",
    "dock-minimize-into-app",
    "dock-launch-animation",
    "dock-magnification-size",
  ],
  // Run 3, the same on windows-2025 (Server 2025), windows-2022 (Server 2022) and windows-11-arm
  // (Windows 11 Enterprise, ARM). Not the screen brightness: none of them has a screen whose
  // brightness can be set, so it still waits for the self-test of each computer.
  windows: [
    "dark-mode",
    "app-dark-mode",
    "system-dark-mode",
    "transparency",
    "clipboard-history",
    "taskbar-alignment",
    "task-view-button",
    "clock-seconds",
    "accent-title-bars",
    "accent-start-taskbar",
    "notifications",
    "game-mode",
    "storage-sense",
    "screen-off-minutes",
    "sleep-minutes",
  ],
};
