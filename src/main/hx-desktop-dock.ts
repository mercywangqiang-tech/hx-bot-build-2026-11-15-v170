/** The parts of Electron's `app` that `hxDesktopInDock` uses. */
export interface HxDesktopDockApp {
  setActivationPolicy(policy: "regular" | "accessory" | "prohibited"): void;
  once(event: "will-finish-launching", listener: () => void): unknown;
}

/**
 * HXBot（v1.7.3 紧急修正）：用户 2026-11-19“还是在 mac 程序坞中出现第二个应用！”
 *
 * v1.7.2 让本机服务器子进程在启动以后再把自己藏起来；可是子进程用的是 HXBot 自己的程序，macOS 在它启动的一刻就按
 * HXBot 的 Info.plist 给它一个程序坞图标，藏之前总有一下，服务器重启一次就再冒一次。现在 Info.plist 写明 LSUIElement
 * （electron-builder.yml），HXBot 的任何进程启动时都没有程序坞图标，子进程从头到尾都不会有；桌面端自己在启动完成之前
 * 切回普通应用，程序坞图标和菜单栏和原来一样。
 */
export function hxDesktopInDock(app: HxDesktopDockApp): void {
  const regular = () => {
    try {
      app.setActivationPolicy("regular");
    } catch {
      // The second call, at will-finish-launching, still runs; `presentApplication` sets it a third time at `ready`.
    }
  };
  regular();
  app.once("will-finish-launching", regular);
}
