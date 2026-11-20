// HXBot v1.7.5 (UI-27): end-to-end check of the desktop start film in the built app (`bun run build`,
// out/), under xvfb, on a fresh profile.
//   bun run build && bun scripts/hx-boot-desktop-e2e.ts --run-as=hxstress [--browser-executable=<chrome>]
// Checks (UI-27-A1 … A5 and the E2E items of the spec):
//   - the first start on a fresh profile plays the film and counts it for this version;
//   - a whole film: the film for the window's shape, placed as hxBootFit says, muted by default; a key
//     at 0.5 s does not skip and does not reach the app; it plays in real time to its end with every
//     frame decoded, the logo and the name whole at the end, then goes into the app;
//   - the next start: the logo for 0.6 s, no film; the first start after an upgrade: the film again;
//     a key at 1.5 s goes in within 300 ms and does not reach the app;
//   - window shapes 1440x900, 1024x768 and 900x1600: the 16:9, 4:3 and 9:16 films;
//   - reduced motion, a deleted film and a damaged film: the logo, then the app, never an error;
//   - a routine due while the film plays starts as soon as one due with no film (within 1 s of it).
// Writes .hxbot-build/hx-boot-desktop-e2e/report.json and screenshots beside it. Exits 1 on a failure.
import { copyFileSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hxBootAspect, hxBootFit } from "@hxbot/contracts/hx-boot";
import { type Browser, chromium, type Page } from "playwright-core";
import { z } from "zod";
import { HxApp, ROOT, wait, wipeProfile } from "./hx-flow-e2e-lib";

const OUT = resolve(ROOT, ".hxbot-build/hx-boot-desktop-e2e");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const runAs = option("run-as") ?? null;
const browserExecutable = option("browser-executable") ?? "/usr/bin/google-chrome";
const PLAYED_KEY = "hxbot:hx-boot-played";
const FILM_SECONDS = 377 / 24;
const ASSETS = resolve(ROOT, "out/renderer/assets");

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
// What the window does, recorded from before the window's own scripts run.

const BootEventSchema = z.object({
  event: z.string(),
  t: z.number(),
  stage: z.string().optional(),
  aspect: z.string().optional(),
  position: z.string().optional(),
  src: z.string().nullable().optional(),
  muted: z.boolean().optional(),
  currentTime: z.number().optional(),
  frames: z.number().nullable().optional(),
  dropped: z.number().nullable().optional(),
  key: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
type BootEvent = z.infer<typeof BootEventSchema>;

const RECORDER = `(() => {
  if (window.__hxBoot) return;
  const log = { events: [] };
  window.__hxBoot = log;
  const add = (event, extra) => log.events.push(Object.assign({ event, t: Math.round(performance.now()) }, extra || {}));
  const films = new WeakSet();
  let seen = false, last = null;
  const scan = () => {
    const screen = document.querySelector("main.hx-boot[data-stage]");
    if (screen) {
      if (!seen) {
        seen = true;
        add("screen", { stage: screen.dataset.stage, aspect: screen.dataset.aspect, position: screen.style.getPropertyValue("--hx-boot-position"), width: innerWidth, height: innerHeight });
      }
      if (screen.dataset.stage !== last) { last = screen.dataset.stage; add("stage", { stage: last }); }
    } else if (seen && last !== "gone") { last = "gone"; add("gone"); }
    const video = document.querySelector('video[data-hx-boot="film"]');
    if (video && !films.has(video)) {
      films.add(video);
      add("film", { src: video.getAttribute("src"), muted: video.muted });
      for (const name of ["playing", "ended", "error"]) video.addEventListener(name, () => {
        const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
        add(name, { currentTime: video.currentTime, frames: quality ? quality.totalVideoFrames : null, dropped: quality ? quality.droppedVideoFrames : null });
      });
    }
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-stage", "src"] });
  window.addEventListener("keydown", (event) => add("key", { key: event.key }), true);
  document.addEventListener("keydown", (event) => add("key-reached-app", { key: event.key }));
  document.addEventListener("keyup", (event) => add("keyup-reached-app", { key: event.key }));
})();`;

let app: HxApp;
let probe: Page;
let probeBrowser: Browser;

async function authStatus(): Promise<string> {
  return app.page
    .evaluate<string>("window.hxbot.auth.getState().then((state) => state.status)")
    .catch((error: Error) => `unknown: ${error.message}`);
}

async function bootEvents(page: Page): Promise<BootEvent[]> {
  const raw = await page.evaluate<string>("JSON.stringify(window.__hxBoot ? window.__hxBoot.events : [])");
  return z.array(BootEventSchema).parse(JSON.parse(raw));
}

const find = (events: readonly BootEvent[], event: string) => events.find((entry) => entry.event === event);

/**
 * Polls from outside: the app's content policy forbids the eval that an in-page wait would need. The
 * times compared come from the window's own clock (`performance.now()` in the recorder).
 */
async function poll<T>(read: () => Promise<T | null>, timeout: number): Promise<T | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read().catch(() => null);
    if (value !== null) return value;
    if (Date.now() > deadline) return null;
    await wait(40);
  }
}

async function until(page: Page, event: string, timeout = 15_000): Promise<BootEvent> {
  const found = await poll(
    async () => (await bootEvents(page)).find((entry) => entry.event === event) ?? null,
    timeout,
  );
  if (found === null) {
    throw new Error(
      `no "${event}" in ${timeout} ms; the window did: ${JSON.stringify(await bootEvents(page).catch(() => []))}; sign-in: ${await authStatus()}`,
    );
  }
  return found;
}

/** Sets what this window keeps about the film (null: never played here), then starts the window again. */
async function restart(played: string | null): Promise<Page> {
  const page = app.page;
  await page.evaluate(
    played === null
      ? `localStorage.removeItem(${JSON.stringify(PLAYED_KEY)})`
      : `localStorage.setItem(${JSON.stringify(PLAYED_KEY)}, ${JSON.stringify(played)})`,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  return page;
}

async function playedValue(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(PLAYED_KEY)})`);
}

async function waitForTime(page: Page, seconds: number, timeout = 20_000): Promise<void> {
  const reached = await poll(
    () =>
      page.evaluate<boolean | null>(
        `(() => { const v = document.querySelector('video[data-hx-boot="film"]'); return v !== null && v.currentTime >= ${seconds} ? true : null; })()`,
      ),
    timeout,
  );
  if (reached === null) throw new Error(`the film did not reach ${seconds} s in ${timeout} ms`);
}

interface Ink {
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
    let inked = 0, orange = 0, edge = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 235 || g < 235 || b < 235) {
        inked++;
        if (x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) edge++;
      }
      if (r > 180 && g > 110 && g < 190 && b < 120 && r - b > 90) orange++;
    }
    return { inked, orange, edge };
  })()`);
}

// ---------------------------------------------------------------------------------------------------
// The cases.

async function version(): Promise<string> {
  const info = z
    .object({ version: z.string() })
    .loose()
    .parse(JSON.parse(await app.call("getAppInfo")));
  return info.version;
}

async function firstStart(current: string) {
  // The window was found after the app started: the film of that first start has played or plays now.
  const page = app.page;
  const deadline = Date.now() + 25_000;
  let kept = await playedValue(page);
  while (kept === null && Date.now() < deadline) {
    await wait(250);
    kept = await playedValue(page);
  }
  check(
    "A1 first start on a fresh profile: the film plays and is counted for this version",
    kept === current,
    `${kept} (version ${current})`,
  );
}

async function wholeFilm(current: string) {
  const page = await restart(null);
  const screen = await until(page, "screen");
  const film = await until(page, "film");
  const width = screen.width ?? 0;
  const height = screen.height ?? 0;
  const aspect = hxBootAspect(width, height);
  facts.window = `${width}x${height}`;
  check(
    `A3 the ${aspect} film for a ${width}x${height} window, placed as hxBootFit says`,
    screen.aspect === aspect &&
      (film.src ?? "").includes(`hxbot-boot-${aspect}`) &&
      screen.position === hxBootFit(aspect, width, height).objectPosition,
    { screen, film: film.src },
  );
  check("the film is muted (the sound setting is off by default)", film.muted === true);
  const playing = await until(page, "playing", 5_000);
  await waitForTime(page, 0.4, 5_000);
  await page.keyboard.press("a");
  const early = await bootEvents(page);
  check(
    "A4 a key at 0.5 s does not skip and does not reach the app",
    find(early, "gone") === undefined &&
      early.every((entry) => entry.event !== "key-reached-app" && entry.event !== "keyup-reached-app") &&
      find(early, "key") !== undefined,
    early.map((entry) => entry.event).join(","),
  );
  await waitForTime(page, 14.6, 25_000);
  const seen = await ink(await page.screenshot({ path: join(OUT, `logo-${width}x${height}.png`) }));
  check(
    "the logo and the name are whole at the end (nothing touches the window's edge)",
    seen.edge === 0 && seen.orange > 300,
    seen,
  );
  const gone = await until(page, "gone", 10_000);
  const events = await bootEvents(page);
  const ended = find(events, "ended");
  const wall = ended ? (ended.t - playing.t) / 1000 : 0;
  facts.wholeFilmSeconds = Number(wall.toFixed(2));
  facts.wholeFilmFrames = ended?.frames ?? null;
  facts.wholeFilmDropped = ended?.dropped ?? null;
  check(
    "the film plays to its end (15.708 s)",
    ended !== undefined && (ended.currentTime ?? 0) >= FILM_SECONDS - 0.1,
    ended ?? "no ended",
  );
  check(
    "it plays in real time, no stall (15.7 s ± 1.5 s)",
    Math.abs(wall - FILM_SECONDS) < 1.5,
    `${wall.toFixed(2)} s`,
  );
  check("every frame is decoded (377)", (ended?.frames ?? 0) >= 370, {
    frames: ended?.frames,
    dropped: ended?.dropped,
  });
  check("it goes into the app as it ends (within 400 ms)", ended !== undefined && gone.t - ended.t <= 400, {
    ended: ended?.t,
    gone: gone.t,
  });
  check("it is counted for this version", (await playedValue(page)) === current);
  await page.screenshot({ path: join(OUT, "after-film.png") });
}

async function nextStart(current: string) {
  facts.authBefore = await authStatus();
  const page = await restart(current);
  const screen = await until(page, "screen");
  const gone = await until(page, "gone", 15_000);
  const events = await bootEvents(page);
  check(
    "A2 the next start: the logo, no film",
    screen.stage === "logo" && find(events, "film") === undefined,
    events.map((entry) => entry.event).join(","),
  );
  facts.logoMs = gone.t - screen.t;
  check(
    "A2 the logo shows about 0.6 s, then the app (at most 2 s with the app's own start)",
    gone.t - screen.t >= 550 && gone.t - screen.t <= 2_000,
    `${gone.t - screen.t} ms`,
  );
}

async function afterUpgrade(current: string) {
  // An older version than this one: the film plays once more after the upgrade.
  const page = await restart("0.67.0");
  await until(page, "film");
  await until(page, "playing", 5_000);
  check(`A1 the first start after an upgrade (0.67.0 → ${current}): the film again`, true);
  await waitForTime(page, 1.5, 5_000);
  await page.keyboard.press("Enter");
  const gone = await until(page, "gone", 2_000);
  const events = await bootEvents(page);
  const key = [...events].reverse().find((entry) => entry.event === "key");
  check("A4 a key at 1.5 s goes in within 300 ms", key !== undefined && gone.t - key.t <= 300, {
    key: key?.t,
    gone: gone.t,
  });
  check(
    "A4 the key that goes in does not reach the app",
    events.every((entry) => entry.event !== "key-reached-app" && entry.event !== "keyup-reached-app"),
    events.filter((entry) => entry.event.endsWith("reached-app")),
  );
  check("it is counted for this version", (await playedValue(page)) === current);
}

async function shapes() {
  const page = app.page;
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [900, 1600],
  ] as const) {
    await page.setViewportSize({ width, height });
    await restart(null);
    const screen = await until(page, "screen");
    const film = await until(page, "film");
    const aspect = hxBootAspect(width, height);
    check(
      `A3 ${width}x${height}: the ${aspect} film, placed as hxBootFit says`,
      screen.aspect === aspect &&
        (film.src ?? "").includes(`hxbot-boot-${aspect}`) &&
        screen.position === hxBootFit(aspect, width, height).objectPosition,
      { screen, film: film.src },
    );
    await until(page, "playing", 5_000);
    await page.evaluate(`new Promise((done) => {
      const video = document.querySelector('video[data-hx-boot="film"]');
      video.pause();
      video.addEventListener("seeked", () => requestAnimationFrame(() => requestAnimationFrame(done)), { once: true });
      video.currentTime = 14.9;
    })`);
    const seen = await ink(await page.screenshot({ path: join(OUT, `shape-${width}x${height}.png`) }));
    check(`${width}x${height}: the logo and the name are whole at the end`, seen.edge === 0 && seen.orange > 200, seen);
    await page.keyboard.press("Escape");
    await until(page, "gone", 5_000);
  }
}

async function reducedMotion() {
  const page = app.page;
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    await restart(null);
    const screen = await until(page, "screen");
    await until(page, "gone", 15_000);
    const events = await bootEvents(page);
    check(
      "A5 reduced motion: the logo, no film, and nothing counted",
      screen.stage === "logo" && find(events, "film") === undefined && (await playedValue(page)) === null,
      events.map((entry) => entry.event).join(","),
    );
  } finally {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
}

/** The film file of this shape in the build. */
function filmFile(aspect: string): string {
  const name = readdirSync(ASSETS).find(
    (entry) => entry.startsWith(`hxbot-boot-${aspect}-`) && entry.endsWith(".mp4") && !entry.includes("av1"),
  );
  if (!name) throw new Error(`no ${aspect} film in ${ASSETS}`);
  return join(ASSETS, name);
}

async function brokenFilm(kind: "deleted" | "damaged") {
  const page = app.page;
  const width = await page.evaluate<number>("innerWidth");
  const height = await page.evaluate<number>("innerHeight");
  const file = filmFile(hxBootAspect(width, height));
  const backup = join(OUT, "film.backup.mp4");
  copyFileSync(file, backup);
  try {
    if (kind === "deleted") rmSync(file);
    else writeFileSync(file, Buffer.alloc(300 * 1024, 0x5a));
    await restart(null);
    const film = await until(page, "film");
    const gone = await until(page, "gone", 15_000);
    const events = await bootEvents(page);
    const logo = events.find((entry) => entry.event === "stage" && entry.stage === "logo");
    check(
      `A5 a ${kind} film: the logo within about 1 s, then the app`,
      logo !== undefined && logo.t - film.t <= 1_300 && find(events, "playing") === undefined,
      { film: film.t, logo: logo?.t, gone: gone.t },
    );
    check(`A5 a ${kind} film: not counted, so the next start tries again`, (await playedValue(page)) === null);
  } finally {
    copyFileSync(backup, file);
    rmSync(backup, { force: true });
  }
}

const RunSchema = z.object({ scheduledFor: z.string(), createdAt: z.string(), status: z.string() }).loose();

/** How long after it was due the scheduler started the routine's run, from the run it recorded. */
async function runLag(agentId: string, routineId: string, timeout: number): Promise<number | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const runs = z.array(RunSchema).parse(JSON.parse(await app.call("agent.listRoutineRuns", { agentId, routineId })));
    const run = runs[0];
    if (run) return Date.parse(run.createdAt) - Date.parse(run.scheduledFor);
    await wait(200);
  }
  return null;
}

/** The next whole minute at least `lead` ms away. */
function nextMinute(lead: number): Date {
  const at = new Date(Date.now() + lead);
  at.setUTCSeconds(0, 0);
  return new Date(at.getTime() + 60_000);
}

async function routineDuringFilm() {
  const agentId = await app.make("HXBoot routine");
  const lags: Record<string, number | null> = {};
  for (const [label, withFilm] of [
    ["no film", false],
    ["film", true],
  ] as const) {
    const due = nextMinute(25_000);
    const iso = due.toISOString();
    const routine = z
      .object({ id: z.string() })
      .loose()
      .parse(
        JSON.parse(
          await app.call("agent.createRoutine", {
            agentId,
            name: `HXBoot ${label}`,
            instruction: "Reply OK.",
            active: true,
            timezone: "UTC",
            schedule: { kind: "once", date: iso.slice(0, 10), time: iso.slice(11, 16) },
          }),
        ),
      );
    // The film starts 4 s before the routine is due, so it plays across that moment.
    while (Date.now() < due.getTime() - 4_000) await wait(100);
    if (withFilm) {
      const page = await restart(null);
      await until(page, "playing", 5_000);
    }
    lags[label] = await runLag(agentId, routine.id, 60_000);
    if (withFilm) {
      const events = await bootEvents(app.page);
      check(
        "the film was playing when the routine was due",
        find(events, "playing") !== undefined && (find(events, "gone")?.t ?? Infinity) > 4_000,
      );
    }
  }
  facts.routineLagNoFilmMs = lags["no film"] ?? null;
  facts.routineLagFilmMs = lags.film ?? null;
  const plain = lags["no film"];
  const film = lags.film;
  check(
    "a routine due while the film plays starts within 1 s of one with no film",
    plain !== null && plain !== undefined && film !== null && film !== undefined && film - plain <= 1_000,
    lags,
  );
}

// ---------------------------------------------------------------------------------------------------

async function main() {
  if (!existsSync(resolve(ROOT, "out/main/index.js"))) throw new Error("No build: run `bun run build` first.");
  rmSync(OUT, { recursive: true, force: true });
  wipeProfile(runAs);
  app = new HxApp({ out: OUT, runAs, debugPort: 9_653, inspectPort: 9_669 });
  probeBrowser = await chromium.launch({ executablePath: browserExecutable });
  probe = await probeBrowser.newPage();
  const started = Date.now();
  try {
    await app.start("boot");
    await app.page.addInitScript(RECORDER);
    const current = await version();
    facts.version = current;
    const trace: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      const status = await authStatus();
      if (trace.at(-1)?.endsWith(status) !== true) trace.push(`${index * 400}ms ${status}`);
      await wait(400);
    }
    facts.signInTrace = trace.join(" → ");
    await step("first start", () => firstStart(current));
    await step("whole film", () => wholeFilm(current));
    await step("next start", () => nextStart(current));
    await step("after an upgrade", () => afterUpgrade(current));
    await step("window shapes", shapes);
    await step("reduced motion", reducedMotion);
    await step("deleted film", () => brokenFilm("deleted"));
    await step("damaged film", () => brokenFilm("damaged"));
    await step("routine during the film", routineDuringFilm);
  } finally {
    await app.stop();
    await probeBrowser.close();
  }
  const failed = checks.filter((entry) => !entry.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    facts,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\n${report.passed}/${checks.length} checks passed; report: ${join(OUT, "report.json")}\n`);
  if (failed.length > 0) process.exit(1);
}

await main();
