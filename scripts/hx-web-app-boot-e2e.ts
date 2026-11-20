// HXBot v1.7.5 (UI-27): end-to-end check of the start film of the web client (bot.hxallai.com/app) in
// real Chrome, on the built site, signed out.
//   bun run api:build && bun scripts/hx-web-app-boot-e2e.ts [--browser-executable=<path>]
// Starts `vite preview` of the last build (no secrets) behind a local proxy that answers the session
// check as production answers a visitor with no cookie, then checks:
//   - first visit: while the code loads, the page shows the film's first frame where the film will sit;
//     the film for the window's shape plays muted (AV1 where Chrome plays it), is counted when it
//     starts, plays to its end with the logo and the name whole, and goes into the sign-in screen;
//   - keys and clicks while the film covers the app do not reach the app (nothing is typed into the
//     sign-in form); after 1 s a key or a tap skips within 300 ms, and the rest of that press stays off
//     the app; the app then takes input;
//   - next visit, a play recorded by bot.hxallai.com, reduced motion, a background tab, blocked storage:
//     no film, the logo, then the app;
//   - a film that cannot load: the logo at once; one that does not start within 3 s (it comes over the
//     network, its first frame shows): the logo then; a slow film can be skipped 2 s after it came;
//     the app follows, nothing is counted, and the next visit plays the film;
//   - Chrome without AV1 plays the H.264 film; 1024x768 gets the 4:3 film, a phone the 9:16 film.
// Writes .hxbot-build/hx-web-app-boot-e2e/report.json and screenshots beside it. Exits 1 on a failure.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { resolve } from "node:path";
import { HX_WEB_BOOT_PLAYED_KEY, hxBootFit } from "@hxbot/contracts/hx-boot";
import { type Browser, type BrowserContext, type BrowserContextOptions, chromium, type Page } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const API_DIR = resolve(ROOT, "apps/auth-api");
const OUT = resolve(ROOT, ".hxbot-build/hx-web-app-boot-e2e");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");
const FILM_SECONDS = 377 / 24;
const SIGNED_OUT = JSON.stringify({ error: { code: "sign_in_required", message: "Sign in is required." } });

// ---------------------------------------------------------------------------------------------------
// The site: `vite preview` of the build, behind a proxy.

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address: AddressInfo | string | null = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function startPreview(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child: ChildProcess = spawn(
    "bunx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: API_DIR, detached: true, stdio: "ignore" },
  );
  const stop = () => {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  };
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("vite preview stopped during startup");
    const ok = await fetch(`${url}/app`, { signal: AbortSignal.timeout(2_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) break;
    if (Date.now() > deadline) {
      stop();
      throw new Error(`${url}/app did not answer in 60 s`);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return { url, stop };
}

const HOP = new Set(["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive"]);
const sockets = new Set<Socket>();

async function startProxy(upstream: string): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? "/";
      if (path === "/api/browser/session") {
        response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }).end(SIGNED_OUT);
        return;
      }
      const headers: Record<string, string> = {};
      if (typeof request.headers.range === "string") headers.range = request.headers.range;
      const answer = await fetch(`${upstream}${path}`, { redirect: "manual", headers });
      const out: [string, string][] = [];
      answer.headers.forEach((value, name) => {
        if (!HOP.has(name)) out.push([name, value]);
      });
      // Streamed as it comes, as the edge sends it: a film starts to play from its first bytes.
      response.writeHead(answer.status, out.flat());
      if (answer.body === null) {
        response.end();
        return;
      }
      const reader = answer.body.getReader();
      response.on("close", () => void reader.cancel().catch(() => undefined));
      for (;;) {
        const { done, value } = await reader.read();
        if (done || response.destroyed) break;
        response.write(value);
      }
      response.end();
    })().catch(() => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${address.port}`, server };
}

// ---------------------------------------------------------------------------------------------------
// What the page does, recorded from before the page's own scripts run.

interface AppEvent {
  readonly event: string;
  readonly t: number;
  readonly src?: string | null;
  readonly position?: string;
  readonly stage?: string;
  readonly aspect?: string;
  readonly muted?: boolean;
  readonly currentTime?: number;
  readonly key?: string;
}

const RECORDER = `(() => {
  if (window.__hxApp) return;
  const log = { events: [] };
  window.__hxApp = log;
  const add = (event, extra) => log.events.push(Object.assign({ event, t: Math.round(performance.now()) }, extra || {}));
  const films = new WeakSet();
  let stillSeen = false, screenSeen = false, lastStage = null;
  const scan = () => {
    const still = document.querySelector("main.hx-boot:not([data-stage]) img");
    if (still && !stillSeen) {
      stillSeen = true;
      add("still", { src: still.getAttribute("src"), position: still.parentElement.style.getPropertyValue("--hx-boot-position") });
    }
    const screen = document.querySelector("main.hx-boot[data-stage]");
    if (screen) {
      if (!screenSeen) {
        screenSeen = true;
        const poster = screen.querySelector('[data-hx-boot="poster"]');
        add("screen", { stage: screen.dataset.stage, aspect: screen.dataset.aspect, position: screen.style.getPropertyValue("--hx-boot-position"), src: poster ? poster.getAttribute("src") : null });
      }
      if (screen.dataset.stage !== lastStage) { lastStage = screen.dataset.stage; add("stage", { stage: lastStage }); }
    } else if (screenSeen && lastStage !== "gone") {
      lastStage = "gone";
      add("gone");
    }
    const video = document.querySelector('video[data-hx-boot="film"]');
    if (video && !films.has(video)) {
      films.add(video);
      add("film", { src: video.getAttribute("src"), muted: video.muted });
      for (const name of ["playing", "ended", "error"]) video.addEventListener(name, () => add(name, { currentTime: video.currentTime }));
    }
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-stage", "src", "class"] });
  window.addEventListener("keydown", (event) => add("key", { key: event.key }), true);
  window.addEventListener("pointerdown", () => add("pointer"), true);
  document.addEventListener("keydown", (event) => add("key-reached-page", { key: event.key }));
  document.addEventListener("keyup", (event) => add("keyup-reached-page", { key: event.key }));
  document.addEventListener("pointerdown", () => add("pointer-reached-page"));
  document.addEventListener("click", () => add("click-reached-page"));
})();`;

const preset = (value: string) =>
  `try { localStorage.setItem(${JSON.stringify(HX_WEB_BOOT_PLAYED_KEY)}, ${JSON.stringify(value)}); } catch {}`;
const NO_AV1 = `(() => {
  const original = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) { return /av01/.test(type) ? "" : original.call(this, type); };
})();`;
const HIDDEN_TAB = `Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => "hidden" });
Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => true });`;
const BLOCKED_STORAGE = `Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });`;

// ---------------------------------------------------------------------------------------------------
// The report.

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const checks: Check[] = [];
const facts: Record<string, string | number | boolean | null> = {};

function check(name: string, ok: boolean, detail: string | number | boolean | null | object = "") {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  checks.push({ name, ok, detail: text });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${text ? `  ${text}` : ""}\n`);
}

async function step(name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (error) {
    check(
      `${name}: finished without an error`,
      false,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
}

// ---------------------------------------------------------------------------------------------------
// Helpers.

let origin = "";
let browser: Browser;
let probe: Page;

interface Opened {
  readonly page: Page;
  readonly errors: string[];
  readonly films: string[];
}

async function context(options: BrowserContextOptions = {}): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", ...options });
}

async function open(ctx: BrowserContext, init: readonly string[] = []): Promise<Opened> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  const films: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith(".mp4")) films.push(request.url());
  });
  await page.addInitScript(RECORDER);
  for (const script of init) await page.addInitScript(script);
  await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded" });
  return { page, errors, films };
}

async function appEvents(page: Page): Promise<readonly AppEvent[]> {
  return (await page.evaluate<{ events: AppEvent[] } | undefined>("window.__hxApp"))?.events ?? [];
}

async function until(page: Page, event: string, timeout = 15_000): Promise<AppEvent> {
  try {
    await page.waitForFunction(
      `window.__hxApp !== undefined && window.__hxApp.events.some((e) => e.event === ${JSON.stringify(event)})`,
      undefined,
      { timeout },
    );
  } catch {
    throw new Error(
      `no "${event}" in ${timeout} ms; the page did: ${JSON.stringify(await appEvents(page).catch(() => []))}`,
    );
  }
  const found = (await appEvents(page)).find((entry) => entry.event === event);
  if (found === undefined) throw new Error(`no ${event}`);
  return found;
}

const find = (events: readonly AppEvent[], event: string) => events.find((entry) => entry.event === event);

async function played(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `(() => { try { return localStorage.getItem(${JSON.stringify(HX_WEB_BOOT_PLAYED_KEY)}); } catch { return null; } })()`,
  );
}

/** The sign-in screen is in front: the e-mail field is the topmost element at its centre. */
async function signInInFront(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(`(() => {
    const input = document.querySelector('input[type="email"]');
    if (!input) return false;
    const box = input.getBoundingClientRect();
    if (box.width === 0) return false;
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top === input || input.contains(top) || (top !== null && top.contains(input));
  })()`);
}

async function emailValue(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `(() => { const input = document.querySelector('input[type="email"]'); return input ? input.value : null; })()`,
  );
}

interface Ink {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly inked: number;
  readonly orange: number;
  readonly edge: number;
}

async function ink(png: Buffer): Promise<Ink> {
  return probe.evaluate<Ink>(`(async () => {
    const image = new Image();
    image.src = "data:image/png;base64,${png.toString("base64")}";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let left = Infinity, top = Infinity, right = -1, bottom = -1, inked = 0, orange = 0, edge = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 235 || g < 235 || b < 235) {
        inked++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) edge++;
      }
      if (r > 180 && g > 110 && g < 190 && b < 120 && r - b > 90) orange++;
    }
    return { left, top, right, bottom, inked, orange, edge };
  })()`);
}

// ---------------------------------------------------------------------------------------------------
// The cases.

async function firstVisit(): Promise<BrowserContext> {
  const ctx = await context();
  const { page, errors } = await open(ctx);
  const film = await until(page, "film", 15_000);
  const av1 = await page.evaluate<string>(
    `document.createElement("video").canPlayType('video/mp4; codecs="av01.0.05M.08"')`,
  );
  const events0 = await appEvents(page);
  const still = find(events0, "still");
  facts.stillSeen = still !== undefined;
  check(
    "first visit: while the code loads, the film's first frame shows where the film will sit",
    still === undefined ||
      ((still.src ?? "").includes("hxbot-boot-16x9-first") &&
        still.position === hxBootFit("16x9", 1440, 900).objectPosition),
    still ?? "the client mounted before the still",
  );
  const screen = find(events0, "screen");
  check(
    "first visit: the screen takes the 16:9 film, placed as hxBootFit says",
    screen?.aspect === "16x9" && screen.position === hxBootFit("16x9", 1440, 900).objectPosition,
    screen ?? "",
  );
  check(
    "first visit: the 16:9 web film, AV1 when Chrome plays AV1, muted",
    (film.src ?? "").includes(av1 === "probably" ? "hxbot-boot-16x9-av1" : "hxbot-boot-16x9-") && film.muted === true,
    `${film.src} (av1: ${av1})`,
  );
  const playing = await until(page, "playing", 10_000);
  const kept = await played(page);
  check(
    "first visit: counted in this browser when the film starts",
    kept !== null && Math.abs(Number(kept) - Date.now()) < 30_000,
    `${kept}`,
  );

  // Keys and a click while the film covers the app: nothing reaches the app.
  await page.keyboard.type("ab");
  await page.mouse.click(720, 450);
  const early = await appEvents(page);
  check(
    "first second: keys and a click do not reach the app and do not skip",
    find(early, "key-reached-page") === undefined &&
      find(early, "keyup-reached-page") === undefined &&
      find(early, "pointer-reached-page") === undefined &&
      find(early, "click-reached-page") === undefined &&
      find(early, "gone") === undefined,
    early.map((entry) => entry.event).join(","),
  );

  await page.waitForFunction(
    `(() => { const v = document.querySelector('video[data-hx-boot="film"]'); return v !== null && v.currentTime >= 14.6; })()`,
    undefined,
    { timeout: 25_000 },
  );
  const seen = await ink(await page.screenshot({ path: resolve(OUT, "first-visit-logo.png") }));
  check("first visit: the logo and the name are whole at the end", seen.edge === 0 && seen.orange > 500, seen);
  const gone = await until(page, "gone", 10_000);
  const events = await appEvents(page);
  const ended = find(events, "ended");
  check(
    "first visit: the film plays to its end",
    ended !== undefined && (ended.currentTime ?? 0) >= FILM_SECONDS - 0.1,
    ended ?? "no ended",
  );
  const wall = ended ? (ended.t - playing.t) / 1000 : 0;
  facts.firstVisitWallSeconds = Number(wall.toFixed(2));
  check(
    "first visit: in real time, no stall (15.7 s ± 1.5 s)",
    Math.abs(wall - FILM_SECONDS) < 1.5,
    `${wall.toFixed(2)} s`,
  );
  check("first visit: it goes into the app within 400 ms of its end", ended !== undefined && gone.t - ended.t <= 400, {
    ended: ended?.t,
    gone: gone.t,
  });
  check("first visit: the sign-in screen is in front", await signInInFront(page));
  check(
    "first visit: nothing typed during the film reached the sign-in form",
    (await emailValue(page)) === "",
    `${await emailValue(page)}`,
  );
  await page.locator('input[type="email"]').click();
  await page.keyboard.type("a@b.cn");
  check("first visit: the app then takes input", (await emailValue(page)) === "a@b.cn", `${await emailValue(page)}`);
  await page.screenshot({ path: resolve(OUT, "first-visit-after.png") });
  check("first visit: no script error", errors.length === 0, errors.join(" | "));
  await page.close();
  return ctx;
}

async function noFilmCase(
  name: string,
  ctx: BrowserContext,
  init: readonly string[],
  counted: "none" | "kept",
  app: "sign-in" | "any" = "sign-in",
) {
  const { page, errors, films } = await open(ctx, init);
  const gone = await until(page, "gone", 15_000);
  await page.screenshot({ path: resolve(OUT, `${name.replace(/[^a-z0-9]+/giu, "-")}.png`) });
  const events = await appEvents(page);
  const screen = find(events, "screen");
  check(
    `${name}: no film, the logo`,
    find(events, "film") === undefined && screen?.stage === "logo" && (screen.src ?? "").includes("-logo"),
    screen ?? "",
  );
  check(`${name}: no film is fetched`, films.length === 0, films.join(","));
  if (app === "sign-in")
    check(`${name}: the app is in front after the logo`, await signInInFront(page), { gone: gone.t });
  else {
    // The screen leaves whatever the app shows; with storage blocked the web client itself (not the
    // film) shows "service unavailable", as it did before v1.7.5 (it needs storage for its keys).
    const shows = (await page.locator("body").innerText()).replace(/\s+/gu, " ").slice(0, 80);
    facts[`${name}: the app shows`] = shows;
    check(`${name}: the screen leaves and does not cover the app`, (await page.locator("main.hx-boot").count()) === 0, {
      gone: gone.t,
      shows,
    });
  }
  if (counted === "none") check(`${name}: nothing is counted`, (await played(page)) === null);
  check(`${name}: no script error`, errors.length === 0, errors.join(" | "));
  await page.close();
}

async function skipCase(name: string, viewport: { width: number; height: number }, aspect: string, how: "key" | "tap") {
  const ctx = await context({ viewport, hasTouch: how === "tap" });
  const { page, errors } = await open(ctx);
  const film = await until(page, "film", 15_000);
  const screen = find(await appEvents(page), "screen");
  check(`${name}: the ${aspect} film`, (film.src ?? "").includes(`hxbot-boot-${aspect}`), film.src ?? "");
  check(
    `${name}: placed as hxBootFit says`,
    screen?.position ===
      hxBootFit(aspect === "16x9" ? "16x9" : aspect === "4x3" ? "4x3" : "9x16", viewport.width, viewport.height)
        .objectPosition,
    screen ?? "",
  );
  await until(page, "playing", 10_000);
  await page.waitForFunction(
    `(() => { const v = document.querySelector('video[data-hx-boot="film"]'); return v !== null && v.currentTime >= 1.3; })()`,
    undefined,
    { timeout: 10_000 },
  );
  if (how === "key") await page.keyboard.press("Space");
  else await page.mouse.click(viewport.width / 2, viewport.height / 2);
  const gone = await until(page, "gone", 2_000);
  const events = await appEvents(page);
  const input = [...events].reverse().find((entry) => entry.event === (how === "key" ? "key" : "pointer"));
  check(`${name}: skips within 300 ms`, input !== undefined && gone.t - input.t <= 300, {
    input: input?.t,
    gone: gone.t,
  });
  const reached = events.filter((entry) => entry.event.endsWith("reached-page"));
  check(`${name}: the press that skips does not reach the app`, reached.length === 0, reached);
  check(`${name}: the sign-in screen is in front`, await signInInFront(page));
  await page.locator('input[type="email"]').click();
  await page.keyboard.type("x@y.cn");
  check(`${name}: the app then takes input`, (await emailValue(page)) === "x@y.cn", `${await emailValue(page)}`);
  check(`${name}: counted`, (await played(page)) !== null);
  check(`${name}: no script error`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

async function brokenFilm(name: string, handle: "abort" | "slow", limit: number, pressAt?: number) {
  const ctx = await context();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\.mp4(\?.*)?$/u, async (route) => {
    if (handle === "abort") {
      await route.abort();
      return;
    }
    await new Promise((done) => setTimeout(done, 5_000));
    await route.continue().catch(() => undefined);
  });
  await page.addInitScript(RECORDER);
  await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded" });
  const shown = await until(page, "film", 15_000);
  if (pressAt !== undefined) {
    await page.keyboard.press("Space");
    check(`${name}: a press in the first 2 s does nothing`, find(await appEvents(page), "gone") === undefined);
    await page.waitForFunction(`performance.now() >= ${shown.t + pressAt}`, undefined, { timeout: 5_000 });
    await page.keyboard.press("Space");
  }
  const gone = await until(page, "gone", 10_000);
  const events = await appEvents(page);
  const film = find(events, "film");
  const moved = events.find(
    (entry) => entry.event === "stage" && (entry.stage === "logo" || entry.stage === "leaving"),
  );
  check(
    `${name}: the screen moves on within ${limit} ms of the film`,
    film !== undefined && moved !== undefined && moved.t - film.t <= limit,
    {
      film: film?.t,
      moved: moved?.t,
      gone: gone.t,
    },
  );
  if (pressAt !== undefined) {
    const key = [...events].reverse().find((entry) => entry.event === "key");
    check(`${name}: the press goes in within 300 ms`, key !== undefined && gone.t - key.t <= 300, {
      key: key?.t,
      gone: gone.t,
    });
  }
  check(`${name}: the app is in front`, await signInInFront(page));
  check(`${name}: a film that never started is not counted`, (await played(page)) === null);
  check(`${name}: no script error`, errors.length === 0, errors.join(" | "));
  await page.unroute(/\.mp4(\?.*)?$/u);
  await page.close();
  const again = await open(ctx);
  await until(again.page, "playing", 15_000);
  check(`${name}: the next visit plays the film`, true);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------

async function main() {
  if (!existsSync(resolve(API_DIR, "dist/client"))) throw new Error("No build: run `bun run api:build` first.");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const preview = await startPreview();
  const proxy = await startProxy(preview.url);
  origin = proxy.url;
  browser = await chromium.launch(browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" });
  const version = browser.version();
  probe = await browser.newPage();
  const started = Date.now();
  try {
    const visited: { context: BrowserContext | null } = { context: null };
    await step("first visit", async () => {
      visited.context = await firstVisit();
    });
    await step("next visit", async () => {
      if (visited.context !== null) await noFilmCase("next visit", visited.context, [], "kept");
    });
    await step("played on bot.hxallai.com", async () => {
      const ctx = await context();
      await noFilmCase("played on bot.hxallai.com a minute ago", ctx, [preset(String(Date.now() - 60_000))], "kept");
      await ctx.close();
    });
    await step("reduced motion", async () => {
      const ctx = await context({ reducedMotion: "reduce" });
      await noFilmCase("reduced motion", ctx, [], "none");
      await ctx.close();
    });
    await step("background tab", async () => {
      const ctx = await context();
      await noFilmCase("a page opened in a background tab", ctx, [HIDDEN_TAB], "none");
      await ctx.close();
    });
    await step("blocked storage", async () => {
      const ctx = await context();
      await noFilmCase("blocked storage", ctx, [BLOCKED_STORAGE], "none", "any");
      await ctx.close();
    });
    await step("skip by key, 4:3", () => skipCase("1024x768, skip by key", { width: 1024, height: 768 }, "4x3", "key"));
    await step("skip by tap, phone", () =>
      skipCase("phone 393x852, skip by tap", { width: 393, height: 852 }, "9x16", "tap"),
    );
    await step("film cannot load", () => brokenFilm("a film that cannot load", "abort", 400));
    await step("film too slow", () => brokenFilm("a film that does not start within 3 s", "slow", 3_400));
    await step("film slow, skipped", () => brokenFilm("a slow film, skipped after 2 s", "slow", 2_500, 2_100));
    await step("no AV1", async () => {
      const ctx = await context();
      const { page } = await open(ctx, [NO_AV1]);
      const film = await until(page, "film", 15_000);
      await until(page, "playing", 10_000);
      check(
        "Chrome without AV1: the H.264 film plays",
        (film.src ?? "").includes("hxbot-boot-16x9-") && !(film.src ?? "").includes("av1"),
        film.src ?? "",
      );
      await ctx.close();
    });
  } finally {
    await browser.close();
    for (const socket of sockets) socket.destroy();
    proxy.server.close();
    preview.stop();
  }
  const failed = checks.filter((entry) => !entry.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    browser: version,
    facts,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\n${report.passed}/${checks.length} checks passed; report: ${resolve(OUT, "report.json")}\n`);
  if (failed.length > 0) process.exit(1);
}

await main();
