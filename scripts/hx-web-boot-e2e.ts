// HXBot v1.7.5 (UI-27): end-to-end check of the start film on bot.hxallai.com
// (hx/server/portal/index.html) in real Chrome, with the real web films.
//   bun scripts/hx-web-boot-e2e.ts [--browser-executable=<path>]
// Serves the portal folder the way nginx does ("/" and "/en/" give index.html, "/hx-portal/" gives
// hx/server/portal/assets/, with byte ranges), then checks:
//   - the first visit plays the film over the page before the page shows, muted, the film for the
//     window's shape (AV1 where Chrome plays it), placed as hxBootFit says; it plays to the end
//     (15.7 s, no stall) and fades out to the page, which is then usable;
//   - the play is kept in this browser: no film on the next visit, on /en/, or within 30 days; a film
//     again after 30 days and when the record is damaged; none when the time is in the future;
//   - in each window shape (16:9, 4:3, 9:16, ultra-wide, square-ish, phone) the logo and the name at
//     the end are whole: nothing that is not white touches the window's edge;
//   - a click or a key in the first second does not skip and does not reach the page; after 1 s it
//     skips within 300 ms and the page takes clicks at once; browser shortcuts are never taken;
//   - no film with reduced motion, a data saver, 2G, blocked storage, a background tab, or no script;
//   - a missing, slow, broken or stalled film never holds the page: it fades at once (missing, broken),
//     after 3 s (a film that has not started: it comes over the network, its first frame shows), or at
//     the 20 s limit (stalled); a slow film can be skipped 2 s after it came; a film that never started
//     is not counted;
//   - Chrome without AV1 plays the H.264 film;
//   - each of the six web films decodes in Chrome: 15.708 s, the right size, a white backdrop in every
//     sampled frame, and its last frame is the logo picture.
// Writes .hxbot-build/hx-web-boot-e2e/report.json and screenshots beside it. Exits 1 on any failure.
import { createReadStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { extname, normalize, resolve, sep } from "node:path";
import {
  HX_BOOT_ASPECTS,
  HX_WEB_BOOT_PLAYED_KEY,
  HX_WEB_BOOT_REPLAY_MS,
  hxBootAspect,
  hxBootFit,
} from "@hxbot/contracts/hx-boot";
import { type Browser, type BrowserContext, type BrowserContextOptions, chromium, type Page } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const PORTAL = resolve(ROOT, "hx/server/portal");
const ASSETS = resolve(PORTAL, "assets");
const OUT = resolve(ROOT, ".hxbot-build/hx-web-boot-e2e");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");

const FILM_SECONDS = 377 / 24;
const STALL_FRACTION = 0.45;

// ---------------------------------------------------------------------------------------------------
// The server: the portal as nginx serves it, and ways to break the film.

type FilmMode = "normal" | "missing" | "slow" | "garbage" | "stall";
let filmMode: FilmMode = "normal";
/** The slow film's late answer: a later visit waits for it, as Chrome holds a second request to the same address until then. */
let slowAnswer: Promise<void> = Promise.resolve();
const filmRequests: string[] = [];
const sockets = new Set<Socket>();

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendFile(request: IncomingMessage, response: ServerResponse, file: string, cutoff?: number) {
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1] === "" && range[2] !== "") {
      start = Math.max(0, size - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== "") end = Math.min(Number(range[2]), size - 1);
    }
    if (start >= size || start > end) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` });
      response.end();
      return;
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "no-store",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (cutoff === undefined) {
    createReadStream(file, { start, end }).pipe(response);
    return;
  }
  // A stalled film: the bytes up to the cut, then nothing more, and the response never ends.
  if (start < cutoff) response.write(readFileSync(file).subarray(start, Math.min(end + 1, cutoff)));
}

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  if (path === "/" || path === "/en/") {
    sendFile(request, response, resolve(PORTAL, "index.html"));
    return;
  }
  if (path === "/blank") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>probe</title><body></body>");
    return;
  }
  if (path.startsWith("/hx-portal/")) {
    const file = normalize(resolve(ASSETS, `.${path.slice("/hx-portal".length)}`));
    if (!file.startsWith(ASSETS + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (file.endsWith(".mp4")) {
      filmRequests.push(path);
      if (filmMode === "missing") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (filmMode === "garbage") {
        const bytes = Buffer.alloc(256 * 1024, 0x5a);
        response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) });
        response.end(bytes);
        return;
      }
      if (filmMode === "slow") {
        slowAnswer = new Promise((done) => {
          setTimeout(() => {
            if (!response.destroyed) sendFile(request, response, file);
            response.once("close", () => done());
            if (response.destroyed) done();
          }, 5_000);
        });
        return;
      }
      if (filmMode === "stall") {
        sendFile(request, response, file, Math.floor(statSync(file).size * STALL_FRACTION));
        return;
      }
    }
    try {
      sendFile(request, response, file);
    } catch {
      response.writeHead(404);
      response.end();
    }
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end("{}");
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

// ---------------------------------------------------------------------------------------------------
// What the page does, recorded from before the page's own scripts run.

interface BootEvent {
  readonly event: string;
  readonly t: number;
  readonly currentTime?: number;
  readonly duration?: number;
  readonly header?: boolean;
  readonly src?: string | null;
  readonly first?: string | null;
  readonly position?: string;
  readonly muted?: boolean | null;
  readonly inline?: boolean | null;
  readonly key?: string;
  readonly prevented?: boolean;
  readonly frames?: number | null;
  readonly dropped?: number | null;
  readonly target?: string;
}

const RECORDER = `(() => {
  if (window.__hxBoot) return;
  const log = { events: [] };
  window.__hxBoot = log;
  const add = (event, extra) => log.events.push(Object.assign({ event, t: Math.round(performance.now()) }, extra || {}));
  const watch = (box) => {
    const video = box.querySelector("video");
    const first = box.querySelector("img");
    add("shown", {
      header: document.querySelector("header") !== null,
      src: video ? video.currentSrc || video.src : null,
      first: first ? first.src : null,
      position: box.style.getPropertyValue("--hx-boot-position"),
      muted: video ? video.muted : null,
      inline: video ? video.playsInline : null,
    });
    if (!video) return;
    for (const name of ["playing", "ended", "error", "seeked", "waiting"])
      video.addEventListener(name, () => {
        const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
        add(name, {
          currentTime: video.currentTime,
          duration: video.duration,
          frames: quality ? quality.totalVideoFrames : null,
          dropped: quality ? quality.droppedVideoFrames : null,
        });
      });
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes)
        if (node.nodeType === 1 && node.classList.contains("hx-boot")) watch(node);
      for (const node of record.removedNodes)
        if (node.nodeType === 1 && node.classList.contains("hx-boot")) add("removed");
      if (record.type === "attributes" && record.target.classList && record.target.classList.contains("hx-boot-out")
        && !log.events.some((e) => e.event === "out")) add("out");
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("keydown", (event) => add("key", { key: event.key }), true);
  window.addEventListener("pointerdown", () => add("pointer"), true);
  document.addEventListener("keydown", (event) => add("key-reached-page", { key: event.key, prevented: event.defaultPrevented }));
  document.addEventListener("pointerdown", () => add("pointer-reached-page"));
  document.addEventListener("keyup", (event) => add("keyup-reached-page", { key: event.key }));
  document.addEventListener("click", (event) => add("click-reached-page", { target: event.target && event.target.className !== undefined ? String(event.target.className || event.target.tagName) : "" }));
})();`;

const preset = (value: string) =>
  `try { localStorage.setItem(${JSON.stringify(HX_WEB_BOOT_PLAYED_KEY)}, ${JSON.stringify(value)}); } catch {}`;
const NO_AV1 = `(() => {
  const original = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) { return /av01/.test(type) ? "" : original.call(this, type); };
})();`;
const connection = (value: { saveData?: boolean; effectiveType?: string }) =>
  `Object.defineProperty(Navigator.prototype, "connection", { configurable: true, get: () => (${JSON.stringify(value)}) });`;
const BLOCKED_STORAGE = `Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });`;
const HIDDEN_TAB = `Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => "hidden" });
Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => true });`;

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

interface Opened {
  readonly page: Page;
  readonly errors: string[];
}

async function open(context: BrowserContext, path = "/", init: readonly string[] = []): Promise<Opened> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(RECORDER);
  for (const script of init) await page.addInitScript(script);
  await page.goto(origin + path, { waitUntil: "domcontentloaded" });
  return { page, errors };
}

async function bootEvents(page: Page): Promise<readonly BootEvent[]> {
  return (await page.evaluate<{ events: BootEvent[] } | undefined>("window.__hxBoot"))?.events ?? [];
}

async function until(page: Page, event: string, timeout = 10_000): Promise<BootEvent> {
  await page.waitForFunction(
    `window.__hxBoot !== undefined && window.__hxBoot.events.some((e) => e.event === ${JSON.stringify(event)})`,
    undefined,
    { timeout },
  );
  const found = (await bootEvents(page)).find((entry) => entry.event === event);
  if (found === undefined) throw new Error(`no ${event}`);
  return found;
}

const find = (events: readonly BootEvent[], event: string) => events.find((entry) => entry.event === event);

async function played(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `(() => { try { return localStorage.getItem(${JSON.stringify(HX_WEB_BOOT_PLAYED_KEY)}); } catch { return null; } })()`,
  );
}

async function context(options: BrowserContextOptions = {}): Promise<BrowserContext> {
  // The page's main audience reads Chinese; the language button then reads "English".
  return browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", ...options });
}

/** Pixels in a screenshot that are not white: their box, whether any touch the edge, and the orange of the logo. */
interface Ink {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly inked: number;
  readonly orange: number;
  readonly edge: number;
}

let probe: Page;

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
    return { width: image.width, height: image.height, left, top, right, bottom, inked, orange, edge };
  })()`);
}

// ---------------------------------------------------------------------------------------------------
// The cases.

async function firstVisit(): Promise<BrowserContext> {
  const ctx = await context();
  const { page, errors } = await open(ctx);
  const shown = await until(page, "shown", 5_000);
  const av1 = await page.evaluate<string>(
    `document.createElement("video").canPlayType('video/mp4; codecs="av01.0.05M.08"')`,
  );
  facts.chromeAv1 = av1;
  check("first visit: the film covers the page before the page's content is built", shown.header === false, shown);
  check(
    "first visit: the 16:9 film for 1440x900, AV1 when Chrome plays AV1",
    (shown.src ?? "").endsWith(
      av1 === "probably" ? "/hx-portal/boot/hxbot-boot-16x9-av1.mp4" : "/hx-portal/boot/hxbot-boot-16x9.mp4",
    ),
    `${shown.src} (canPlayType av1: ${av1})`,
  );
  check(
    "first visit: the first frame under the film is the 16:9 one",
    (shown.first ?? "").endsWith("hxbot-boot-16x9-first.jpg"),
    shown.first ?? "",
  );
  check(
    "first visit: muted and inline (the only autoplay a browser allows)",
    shown.muted === true && shown.inline === true,
    shown,
  );
  check(
    "first visit: placed as hxBootFit says",
    shown.position === hxBootFit("16x9", 1440, 900).objectPosition,
    `${shown.position}`,
  );

  const playing = await until(page, "playing", 5_000);
  const kept = await played(page);
  check(
    "first visit: the play is kept in this browser when the film starts",
    kept !== null && Math.abs(Number(kept) - Date.now()) < 20_000,
    `${kept}`,
  );

  // A click and a key in the first second: no skip, and they do not reach the page under the film.
  await page.keyboard.press("Space");
  await page.mouse.click(720, 450);
  const early = await page.evaluate<number>(`document.querySelector(".hx-boot video").currentTime`);
  const afterEarly = await bootEvents(page);
  check(
    "first second: a key and a click do not skip",
    find(afterEarly, "out") === undefined && early < 1,
    `currentTime ${early}`,
  );
  check(
    "first second: the key and the click do not reach the covered page",
    find(afterEarly, "key") !== undefined &&
      find(afterEarly, "pointer") !== undefined &&
      find(afterEarly, "key-reached-page") === undefined &&
      find(afterEarly, "keyup-reached-page") === undefined &&
      find(afterEarly, "pointer-reached-page") === undefined &&
      find(afterEarly, "click-reached-page") === undefined,
    afterEarly.map((entry) => entry.event).join(","),
  );
  check("first second: the page under the film did not scroll", (await page.evaluate<number>("window.scrollY")) === 0);

  // The logo at the end, whole.
  await page.waitForFunction(
    `document.querySelector(".hx-boot video") && document.querySelector(".hx-boot video").currentTime >= 14.6`,
    undefined,
    {
      timeout: 20_000,
    },
  );
  const endShot = await page.screenshot({ path: resolve(OUT, "first-visit-1440x900-logo.png") });
  const end = await ink(endShot);
  check(
    "first visit: the logo and the name are whole at the end (nothing touches the edge)",
    end.edge === 0 && end.inked > 2_000,
    end,
  );
  check("first visit: the logo's orange is on the screen", end.orange > 500, end.orange);

  const removed = await until(page, "removed", 10_000);
  const events = await bootEvents(page);
  const ended = find(events, "ended");
  const out = find(events, "out");
  check(
    "first visit: the film plays to its end",
    ended !== undefined && (ended.currentTime ?? 0) >= FILM_SECONDS - 0.1,
    ended ?? "no ended",
  );
  const wall = ended ? (ended.t - playing.t) / 1000 : 0;
  check(
    "first visit: it plays in real time with no stall (15.7 s ± 1.5 s)",
    Math.abs(wall - FILM_SECONDS) < 1.5,
    `${wall.toFixed(2)} s`,
  );
  check(
    "first visit: it starts to fade as it ends, and is gone 0.4–0.9 s later",
    out !== undefined &&
      ended !== undefined &&
      out.t - ended.t < 100 &&
      removed.t - out.t >= 400 &&
      removed.t - out.t <= 900,
    { ended: ended?.t, out: out?.t, removed: removed.t },
  );
  facts.firstVisitWallSeconds = Number(wall.toFixed(2));
  facts.firstVisitFrames = ended?.frames ?? null;
  facts.firstVisitDroppedFrames = ended?.dropped ?? null;
  check(
    "first visit: Chrome decoded the whole film (377 frames)",
    ended?.frames === null || ended?.frames === undefined || ended.frames >= 370,
    { frames: ended?.frames, dropped: ended?.dropped },
  );
  await page.getByRole("button", { name: "English" }).click({ timeout: 3_000 });
  check("after the film: the page takes clicks", (await page.getByRole("button", { name: "中文" }).count()) > 0);
  await page.screenshot({ path: resolve(OUT, "first-visit-after.png") });
  check("first visit: no script error on the page", errors.length === 0, errors.join(" | "));
  await page.close();
  return ctx;
}

async function sameBrowser(ctx: BrowserContext) {
  for (const path of ["/", "/en/"]) {
    const before = filmRequests.length;
    const { page, errors } = await open(ctx, path);
    await page.waitForLoadState("load");
    const events = await bootEvents(page);
    check(
      `next visit (${path}): no film, played within 30 days`,
      find(events, "shown") === undefined,
      events.map((entry) => entry.event).join(","),
    );
    check(`next visit (${path}): the page shows`, await page.locator("header").isVisible());
    check(
      `next visit (${path}): no film is fetched`,
      filmRequests.length === before,
      filmRequests.slice(before).join(","),
    );
    check(`next visit (${path}): no script error`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}

async function replayRule() {
  const now = Date.now();
  const cases: readonly (readonly [string, string, boolean])[] = [
    ["played 30 days and 1 minute ago", String(now - HX_WEB_BOOT_REPLAY_MS - 60_000), true],
    ["played 29 days 23 hours ago", String(now - HX_WEB_BOOT_REPLAY_MS + 3_600_000), false],
    ["played a minute ago", String(now - 60_000), false],
    ["a time an hour in the future (clock set back)", String(now + 3_600_000), false],
    ["a damaged record", "not-a-time", true],
    ["an empty record", "", true],
    ["a negative time", "-5", true],
  ];
  for (const [name, value, plays] of cases) {
    const ctx = await context();
    const { page, errors } = await open(ctx, "/", [preset(value)]);
    if (plays) {
      await until(page, "playing", 5_000);
    } else {
      await page.waitForLoadState("load");
    }
    const events = await bootEvents(page);
    check(
      `30-day rule, ${name}: ${plays ? "plays" : "no film"}`,
      (find(events, "shown") !== undefined) === plays,
      events.map((entry) => entry.event).join(","),
    );
    check(`30-day rule, ${name}: no script error`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
}

const SHAPES: readonly (readonly [number, number])[] = [
  [1440, 900],
  [1024, 768],
  [900, 1600],
  [393, 852],
  [2560, 1080],
  [3440, 1440],
  [1920, 1200],
  [1600, 1000],
  [1200, 1000],
  [1199, 1000],
  [768, 1024],
  [1280, 1280],
];

async function shapes() {
  for (const [width, height] of SHAPES) {
    const aspect = hxBootAspect(width, height);
    const ctx = await context({ viewport: { width, height } });
    const { page, errors } = await open(ctx);
    const shown = await until(page, "shown", 5_000);
    await until(page, "playing", 5_000);
    check(
      `${width}x${height}: the ${aspect} film`,
      (shown.src ?? "").includes(`/hxbot-boot-${aspect}`),
      shown.src ?? "",
    );
    check(
      `${width}x${height}: placed as hxBootFit says`,
      shown.position === hxBootFit(aspect, width, height).objectPosition,
      `${shown.position}`,
    );
    await page.evaluate(`new Promise((done) => {
      const video = document.querySelector(".hx-boot video");
      video.pause();
      video.addEventListener("seeked", () => requestAnimationFrame(() => requestAnimationFrame(done)), { once: true });
      video.currentTime = 14.9;
    })`);
    const shot = await page.screenshot({ path: resolve(OUT, `shape-${width}x${height}-logo.png`) });
    const seen = await ink(shot);
    check(`${width}x${height}: the logo and the name are whole at the end`, seen.edge === 0 && seen.inked > 500, seen);
    check(`${width}x${height}: the logo's orange is on the screen`, seen.orange > 100, seen.orange);
    await page.evaluate(`document.querySelector(".hx-boot video").play()`);
    await until(page, "removed", 5_000);
    check(`${width}x${height}: no script error`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
}

async function skipping() {
  for (const how of ["key", "click"] as const) {
    const ctx = await context();
    const { page } = await open(ctx);
    await until(page, "playing", 5_000);
    await page.waitForFunction(`document.querySelector(".hx-boot video").currentTime >= 1.3`, undefined, {
      timeout: 5_000,
    });
    // A browser shortcut is never taken, and does not skip.
    await page.keyboard.press("Control+Shift+KeyY");
    const shortcut = await bootEvents(page);
    check(
      `skip by ${how}: a browser shortcut does not skip and is left to the browser`,
      find(shortcut, "out") === undefined && find(shortcut, "key-reached-page")?.prevented === false,
      shortcut.filter((entry) => entry.event.startsWith("key")),
    );
    if (how === "key") await page.keyboard.press("Space");
    else await page.mouse.click(300, 300);
    const out = await until(page, "out", 2_000);
    const events = await bootEvents(page);
    const input = [...events].reverse().find((entry) => entry.event === (how === "key" ? "key" : "pointer"));
    check(`skip by ${how} after 1 s: the film goes within 300 ms`, input !== undefined && out.t - input.t <= 300, {
      input: input?.t,
      out: out.t,
    });
    const under = await page.evaluate<string>(
      `(() => { const e = document.elementFromPoint(720, 450); return e ? e.className || e.tagName : ""; })()`,
    );
    check(
      `skip by ${how}: the page takes clicks as soon as the fade starts`,
      !String(under).includes("hx-boot"),
      under,
    );
    await until(page, "removed", 2_000);
    const after = await bootEvents(page);
    const reached = after.filter(
      (entry) =>
        (entry.event === "key-reached-page" && entry.key === " ") ||
        (entry.event === "keyup-reached-page" && entry.key === " ") ||
        entry.event === "pointer-reached-page" ||
        entry.event === "click-reached-page",
    );
    check(
      `skip by ${how}: the skipping input does not reach the page (no click, no key up)`,
      reached.length === 0,
      reached,
    );
    check(`skip by ${how}: the play stays counted`, (await played(page)) !== null);
    await ctx.close();
  }
}

async function noFilm() {
  const cases: readonly (readonly [string, BrowserContextOptions, readonly string[]])[] = [
    ["reduced motion", { reducedMotion: "reduce" }, []],
    ["a data saver", {}, [connection({ saveData: true, effectiveType: "4g" })]],
    ["a 2G connection", {}, [connection({ effectiveType: "2g" })]],
    ["a slow-2G connection", {}, [connection({ effectiveType: "slow-2g" })]],
    ["blocked storage", {}, [BLOCKED_STORAGE]],
    ["a page opened in a background tab", {}, [HIDDEN_TAB]],
  ];
  for (const [name, options, init] of cases) {
    const ctx = await context(options);
    const before = filmRequests.length;
    const { page, errors } = await open(ctx, "/", init);
    await page.waitForLoadState("load");
    const events = await bootEvents(page);
    check(`${name}: no film`, find(events, "shown") === undefined, events.map((entry) => entry.event).join(","));
    check(`${name}: no film is fetched`, filmRequests.length === before, filmRequests.slice(before).join(","));
    check(`${name}: the page shows`, await page.locator("header").isVisible());
    check(`${name}: nothing is counted`, (await played(page)) === null);
    check(
      `${name}: no error from the film's script`,
      !errors.some((message) => /hx-boot|canPlayType|localStorage/u.test(message)),
      errors.join(" | "),
    );
    await ctx.close();
  }
  const ctx = await context({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${origin}/`);
  check(
    "no script: no film, and the page shows",
    (await page.locator(".hx-boot").count()) === 0 && (await page.locator("header").isVisible()),
  );
  await page.screenshot({ path: resolve(OUT, "no-script.png") });
  await ctx.close();

  const third = await context();
  const { page: g3 } = await open(third, "/", [connection({ effectiveType: "3g" })]);
  await until(g3, "playing", 8_000);
  check("a 3G connection: the film plays", true);
  await third.close();
}

async function brokenFilms() {
  const cases: readonly (readonly [FilmMode, string, number])[] = [
    ["missing", "a missing film (404)", 1_300],
    ["slow", "a film that does not start within 3 s", 3_400],
    ["garbage", "a broken film", 1_300],
  ];
  for (const [mode, name, limit] of cases) {
    filmMode = mode;
    const ctx = await context();
    try {
      const { page, errors } = await open(ctx);
      const shown = await until(page, "shown", 5_000);
      const removed = await until(page, "removed", 5_000);
      const events = await bootEvents(page);
      const out = find(events, "out");
      check(`${name}: the page shows in time`, out !== undefined && out.t - shown.t <= limit, {
        shown: shown.t,
        out: out?.t,
        removed: removed.t,
      });
      check(`${name}: a film that never started is not counted`, (await played(page)) === null);
      await page.getByRole("button", { name: "English" }).click({ timeout: 3_000 });
      check(`${name}: the page takes clicks`, (await page.getByRole("button", { name: "中文" }).count()) > 0);
      check(`${name}: no script error`, errors.length === 0, errors.join(" | "));
    } finally {
      filmMode = "normal";
    }
    // The next visit tries again, and now plays.
    await slowAnswer;
    const again = await open(ctx);
    await until(again.page, "playing", 5_000);
    check(`${name}: the next visit plays the film`, true);
    await ctx.close();
  }

  // A slow film: a press before 2 s does nothing, a press after 2 s goes in.
  filmMode = "slow";
  const slow = await context();
  try {
    const { page } = await open(slow);
    const shown = await until(page, "shown", 5_000);
    await page.keyboard.press("Space");
    const early = await bootEvents(page);
    check(
      "a slow film: a press in the first 2 s does not skip",
      find(early, "out") === undefined,
      early.map((entry) => entry.event).join(","),
    );
    await page.waitForFunction(`performance.now() >= ${shown.t + 2_100}`, undefined, { timeout: 5_000 });
    await page.keyboard.press("Space");
    const out = await until(page, "out", 1_000);
    const key = [...(await bootEvents(page))].reverse().find((entry) => entry.event === "key");
    check(
      "a slow film: a press 2 s after it came goes in within 300 ms",
      key !== undefined && out.t - key.t <= 300 && find(await bootEvents(page), "playing") === undefined,
      { key: key?.t, out: out.t },
    );
  } finally {
    filmMode = "normal";
  }
  await slow.close();
  await slowAnswer;

  filmMode = "stall";
  const ctx = await context();
  const { page } = await open(ctx);
  const shown = await until(page, "shown", 5_000);
  await until(page, "playing", 5_000);
  const removed = await until(page, "removed", 30_000).finally(() => {
    filmMode = "normal";
  });
  const events = await bootEvents(page);
  const out = find(events, "out");
  check(
    "a film that stalls: the page shows at the 20 s limit",
    out !== undefined && out.t - shown.t >= 19_000 && out.t - shown.t <= 21_500 && find(events, "ended") === undefined,
    { shown: shown.t, out: out?.t, removed: removed.t, waiting: find(events, "waiting")?.t },
  );
  check("a film that stalls: it started, so it counts as played", (await played(page)) !== null);
  await ctx.close();
}

async function noAv1() {
  const ctx = await context();
  const { page, errors } = await open(ctx, "/", [NO_AV1]);
  const shown = await until(page, "shown", 5_000);
  await until(page, "playing", 5_000);
  check(
    "Chrome without AV1: the H.264 film",
    (shown.src ?? "").endsWith("/hx-portal/boot/hxbot-boot-16x9.mp4"),
    shown.src ?? "",
  );
  await page.evaluate(`new Promise((done) => {
    const video = document.querySelector(".hx-boot video");
    video.pause();
    video.addEventListener("seeked", () => requestAnimationFrame(() => requestAnimationFrame(done)), { once: true });
    video.currentTime = 14.9;
  })`);
  const seen = await ink(await page.screenshot({ path: resolve(OUT, "h264-logo.png") }));
  check(
    "Chrome without AV1: the H.264 film shows the logo whole at the end",
    seen.edge === 0 && seen.orange > 500,
    seen,
  );
  check("Chrome without AV1: no script error", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

async function firstVisitEnglish() {
  const ctx = await context();
  const { page } = await open(ctx, "/en/");
  await until(page, "playing", 5_000);
  check("first visit to /en/: the film plays", true);
  const second = await open(ctx, "/");
  await second.page.waitForLoadState("load");
  check("after /en/: / does not play it again", find(await bootEvents(second.page), "shown") === undefined);
  await ctx.close();
}

interface FilmFacts {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly corners: readonly { readonly at: number; readonly min: number; readonly sides: number }[];
  readonly logoDiff: number;
  readonly ended: boolean;
  readonly error: string | null;
}

async function films() {
  const page = await browser.newPage();
  await page.goto(`${origin}/blank`);
  const av1 = await page.evaluate<string>(
    `document.createElement("video").canPlayType('video/mp4; codecs="av01.0.05M.08"')`,
  );
  for (const aspect of HX_BOOT_ASPECTS) {
    for (const kind of ["", "-av1"] as const) {
      if (kind === "-av1" && av1 !== "probably") {
        check(`film ${aspect}${kind}: decodes in Chrome`, false, "this Chrome does not play AV1");
        continue;
      }
      const name = `hxbot-boot-${aspect}${kind}.mp4`;
      const result = await page.evaluate<FilmFacts>(`(async () => {
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.src = "/hx-portal/boot/${name}";
        let error = null;
        video.addEventListener("error", () => { error = String(video.error && video.error.code); });
        document.body.appendChild(video);
        await new Promise((done) => { video.addEventListener("loadeddata", done, { once: true }); video.addEventListener("error", done, { once: true }); });
        if (error) return { duration: 0, width: 0, height: 0, corners: [], logoDiff: 255, ended: false, error };
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const seek = (at) => new Promise((done) => { video.addEventListener("seeked", done, { once: true }); video.currentTime = at; });
        const darkest = (areas) => {
          let min = 255;
          for (const [x, y, w, h] of areas) {
            const data = context.getImageData(x, y, w, h).data;
            for (let i = 0; i < data.length; i += 4) min = Math.min(min, data[i], data[i + 1], data[i + 2]);
          }
          return min;
        };
        const w = canvas.width, h = canvas.height, size = 12;
        const corners = [];
        for (const at of [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5, 15, 15.65]) {
          await seek(at);
          context.drawImage(video, 0, 0);
          corners.push({
            at,
            min: darkest([[0, 0, size, size], [w - size, 0, size, size], [0, h - size, size, size], [w - size, h - size, size, size]]),
            sides: darkest([[0, Math.round(h * 0.45), 8, Math.round(h * 0.15)], [w - 8, Math.round(h * 0.45), 8, Math.round(h * 0.15)]]),
          });
        }
        await seek(${FILM_SECONDS - 0.02});
        context.drawImage(video, 0, 0);
        const last = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const logo = new Image();
        logo.src = "/hx-portal/boot/hxbot-boot-${aspect}-logo.png";
        await logo.decode();
        const other = document.createElement("canvas");
        other.width = canvas.width;
        other.height = canvas.height;
        const otherContext = other.getContext("2d", { willReadFrequently: true });
        otherContext.drawImage(logo, 0, 0, canvas.width, canvas.height);
        const picture = otherContext.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let i = 0; i < last.length; i += 4) sum += Math.abs(last[i] - picture[i]) + Math.abs(last[i + 1] - picture[i + 1]) + Math.abs(last[i + 2] - picture[i + 2]);
        const logoDiff = sum / ((last.length / 4) * 3);
        await seek(0);
        video.playbackRate = 4;
        const ended = await Promise.race([
          new Promise((done) => video.addEventListener("ended", () => done(true), { once: true })),
          new Promise((done) => setTimeout(() => done(false), 12000)),
          video.play().then(() => new Promise(() => {})),
        ]);
        video.remove();
        return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, corners, logoDiff, ended, error };
      })()`);
      const [w, h] = aspect === "16x9" ? [1280, 720] : aspect === "4x3" ? [960, 720] : [720, 1280];
      check(`film ${name}: decodes in Chrome`, result.error === null, result.error ?? "");
      check(`film ${name}: 15.708 s`, Math.abs(result.duration - FILM_SECONDS) < 0.05, result.duration);
      check(`film ${name}: ${w}x${h}`, result.width === w && result.height === h, `${result.width}x${result.height}`);
      // 0–3 s is the giraffe's close-up: in the 16:9 film its head fills the corners and the backdrop
      // shows at the sides; the 4:3 film (cut from the 16:9) is all giraffe there; the 9:16 film keeps
      // white corners. From 3 s on, every corner of every film is the white backdrop.
      const backdrop = result.corners.every((entry) => {
        if (entry.at >= 3 || aspect === "9x16") return entry.min >= 245;
        return aspect === "16x9" ? entry.sides >= 245 : true;
      });
      check(
        `film ${name}: a white backdrop in every sampled frame`,
        result.corners.length === 12 && backdrop,
        result.corners,
      );
      check(`film ${name}: the last frame is the logo picture`, result.logoDiff < 3, result.logoDiff.toFixed(3));
      check(`film ${name}: plays to its end`, result.ended);
    }
  }
  await page.close();
}

// ---------------------------------------------------------------------------------------------------

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch(browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" });
  probe = await browser.newPage();
  const version = browser.version();
  const started = Date.now();
  try {
    const visited: { context: BrowserContext | null } = { context: null };
    await step("first visit", async () => {
      visited.context = await firstVisit();
    });
    await step("same browser", async () => {
      if (visited.context !== null) await sameBrowser(visited.context);
    });
    await step("30-day rule", replayRule);
    await step("English page", firstVisitEnglish);
    await step("window shapes", shapes);
    await step("skipping", skipping);
    await step("no film", noFilm);
    await step("broken films", brokenFilms);
    await step("no AV1", noAv1);
    await step("films", films);
  } finally {
    await browser.close();
    for (const socket of sockets) socket.destroy();
    server.close();
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
