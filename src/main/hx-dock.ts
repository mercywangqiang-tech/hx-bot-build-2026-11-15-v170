// HXBot（v1.7.2）：本机服务器子进程不在程序坞里出现。
//
// 用户 2026-11-18：“在windows 和mac的程序坞出现多个HXBot的图表！这个一定要修正！”（一打开就多个，用着用着变多）
// “这台电脑上的服务器”每个都是一个 HXBot 子进程（local-servers.ts 用 HXBot 自己的程序启动它）。上游在启动
// 最早的时候调一次 app.dock.hide()；这时 macOS 还在激活这个应用，隐藏会被悄悄丢掉（Gitify #3100 在真机上
// 复现过同样的竞争），图标就整场留在程序坞里：几个服务器几个 HXBot 图标，新建、重启服务器再多一个。
// 这里先把应用设成“附属应用”（accessory：没有程序坞图标、没有菜单栏）再隐藏，就绪以后再做一遍，之后 30 秒里
// 隔一会儿看一次，图标还在就再隐藏。

/** The parts of Electron's `app` this needs, so the test drives it without Electron. */
export interface HxDockApp {
  setActivationPolicy(policy: "regular" | "accessory" | "prohibited"): void;
  whenReady(): Promise<unknown>;
  readonly dock?: { hide(): void; isVisible(): boolean } | undefined;
}

/** After `ready`: when to look again, in milliseconds. A hide lost to the activation shows at one of them. */
export const HX_DOCK_CHECKS_MS = [0, 250, 1_000, 2_500, 5_000, 10_000, 20_000, 30_000] as const;

type Schedule = (run: () => void, ms: number) => { unref?: () => unknown };

function hide(app: HxDockApp): void {
  try {
    app.setActivationPolicy("accessory");
  } catch {
    // Not every build of Electron takes the policy before `ready`; the hide below still runs.
  }
  app.dock?.hide();
}

/**
 * Keeps this process out of the Dock: at once, again at `ready`, and at each of `HX_DOCK_CHECKS_MS`
 * after it while the Dock still shows it. `onShown` is told each time a check finds the icon back.
 */
export function hxKeepOutOfDock(
  app: HxDockApp,
  options: { schedule?: Schedule; onShown?: (afterMs: number) => void } = {},
): void {
  const schedule: Schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  hide(app);
  void app.whenReady().then(() => {
    hide(app);
    for (const ms of HX_DOCK_CHECKS_MS) {
      const timer = schedule(() => {
        if (!app.dock?.isVisible()) return;
        options.onShown?.(ms);
        hide(app);
      }, ms);
      // A check must not hold a quit open.
      timer.unref?.();
    }
  });
}

/** The parts of a `BrowserWindow` that `hxKeepChildWindowsHidden` uses. */
export interface HxChildWindow {
  setSkipTaskbar(skip: boolean): void;
  hide(): void;
  isDestroyed(): boolean;
  on(event: "show", listener: () => void): unknown;
}

/** The part of Electron's `app` that `hxKeepChildWindowsHidden` uses. */
export interface HxWindowsApp {
  on(event: "browser-window-created", listener: (event: unknown, window: HxChildWindow) => void): unknown;
}

/**
 * A local server child shows no window on any system: each window it makes stays off the taskbar, and a
 * window that something shows is hidden again. The child is a server with no interface of its own; a
 * shown window was an empty HXBot window and one more HXBot button in the Windows taskbar.
 */
export function hxKeepChildWindowsHidden(app: HxWindowsApp): void {
  app.on("browser-window-created", (_event, window) => {
    window.setSkipTaskbar(true);
    window.on("show", () => {
      if (!window.isDestroyed()) window.hide();
    });
  });
}
