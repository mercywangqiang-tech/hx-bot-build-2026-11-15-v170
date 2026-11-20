// HXBot v1.7.5 (UI-27-A1): frame-by-frame check of every start film that ships (desktop, web, phones).
//   bun scripts/hx-boot-film-check.ts
// For each film it decodes every frame with ffmpeg (ffprobe and ffmpeg must be on PATH) and checks:
//   - the frame count, the frame rate and the length (the supplied films: 377 frames at 24 fps,
//     15.708 s; the spec's 60 fps and 14.8 s describe a film that was not supplied: no frame is made up);
//   - no skipped frame: every frame is 1/24 s after the one before it;
//   - no flash: no frame is much lighter or darker than both frames around it (a one-frame spike);
//   - no black frame and no empty frame (a frame of one flat tone in the middle of the film);
//   - the last 3 s are the logo: each of the last 72 frames matches the film's logo picture;
//   - the backdrop is white once the opening close-up has pulled back (frame 84, 3.5 s): the corners of
//     every frame, so no stray mark stays on the white (v1.7.5: the blur box of the source at 12 s).
// Writes .hxbot-build/hx-boot-film-check/report.json. Exits 1 on any failure.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".hxbot-build/hx-boot-film-check");
const FPS = 24;
const FRAMES = 377;
/** The size each frame is reduced to for the checks (gray, 8 bit). */
const W = 96;
const ASPECTS = ["16x9", "4x3", "9x16"] as const;
/** The blurred-out watermark of the source, in each film, as fractions: x from, x to, y from, y to. */
const BLUR_BOX: Readonly<Record<(typeof ASPECTS)[number], readonly [number, number, number, number]>> = {
  "16x9": [220 / 2560, 500 / 2560, 55 / 1440, 185 / 1440],
  // The 4:3 film is the middle 1920 of the 2560: the box starts left of it.
  "4x3": [0, 180 / 1920, 55 / 1440, 185 / 1440],
  // The 9:16 film has the 4:3 picture at 1180x886 in the middle of 1440x2560.
  "9x16": [
    (130 + 0) / 1440,
    (130 + 180 * (1180 / 1920)) / 1440,
    (837 + 55 * (886 / 1440)) / 2560,
    (837 + 185 * (886 / 1440)) / 2560,
  ],
};
const aspectOf = (file: string) => ASPECTS.find((aspect) => file.includes(`-${aspect}`)) ?? "16x9";
/** The first frame after the opening close-up: before it, the giraffe fills the corners. */
const CLOSE_UP_END = 84;

interface Film {
  readonly where: string;
  readonly file: string;
  readonly logo: string;
}

function films(): Film[] {
  const list: Film[] = [];
  for (const aspect of ASPECTS) {
    list.push({
      where: "desktop",
      file: `src/renderer/src/assets/hx-boot/hxbot-boot-${aspect}.mp4`,
      logo: `src/renderer/src/assets/hx-boot/hxbot-boot-${aspect}-logo.png`,
    });
    list.push({
      where: "phones",
      file: `apps/mobile/assets/hx-boot/hxbot-boot-${aspect}.mp4`,
      logo: `src/renderer/src/assets/hx-boot/hxbot-boot-${aspect}-logo.png`,
    });
    for (const kind of ["", "-av1"]) {
      list.push({
        where: "web client",
        file: `src/renderer/src/assets/hx-boot/web/hxbot-boot-${aspect}${kind}.mp4`,
        logo: `src/renderer/src/assets/hx-boot/web/hxbot-boot-${aspect}-logo.png`,
      });
      list.push({
        where: "bot.hxallai.com",
        file: `hx/server/portal/assets/boot/hxbot-boot-${aspect}${kind}.mp4`,
        logo: `hx/server/portal/assets/boot/hxbot-boot-${aspect}-logo.png`,
      });
    }
  }
  return list;
}

function probe(file: string): {
  width: number;
  height: number;
  rate: string;
  frames: number;
  duration: number;
  codec: string;
} {
  const text = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration",
      "-of",
      "default=noprint_wrappers=1",
      file,
    ],
    { encoding: "utf8" },
  );
  const value = (key: string) =>
    text
      .split("\n")
      .find((line) => line.startsWith(`${key}=`))
      ?.slice(key.length + 1)
      .trim() ?? "";
  return {
    codec: value("codec_name"),
    width: Number(value("width")),
    height: Number(value("height")),
    rate: value("r_frame_rate"),
    frames: Number(value("nb_read_frames")),
    duration: Number(value("duration")),
  };
}

/** The presentation time of every frame, in seconds. */
function times(file: string): number[] {
  const text = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return text
    .split("\n")
    .map((line) => Number.parseFloat(line))
    .filter((value) => Number.isFinite(value));
}

/** Every frame, reduced to W pixels wide, in gray. */
function frames(file: string, width: number, height: number): Uint8Array[] {
  const h = Math.max(2, Math.round((W * height) / width / 2) * 2);
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-vf", `scale=${W}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-"],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  const size = W * h;
  const list: Uint8Array[] = [];
  for (let offset = 0; offset + size <= raw.length; offset += size) list.push(raw.subarray(offset, offset + size));
  return list;
}

function picture(file: string, width: number, height: number): Uint8Array {
  const h = Math.max(2, Math.round((W * height) / width / 2) * 2);
  return execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    `scale=${W}:${h}:flags=area,format=gray`,
    "-f",
    "rawvideo",
    "-",
  ]);
}

const mean = (frame: Uint8Array) => frame.reduce((sum, value) => sum + value, 0) / frame.length;
const spread = (frame: Uint8Array) => {
  const m = mean(frame);
  return Math.sqrt(frame.reduce((sum, value) => sum + (value - m) ** 2, 0) / frame.length);
};
const difference = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  return sum / a.length;
};
/** The darkest of the four 6x6 corners. */
const corners = (frame: Uint8Array) => {
  const h = frame.length / W;
  let min = 255;
  for (const [x0, y0] of [
    [0, 0],
    [W - 6, 0],
    [0, h - 6],
    [W - 6, h - 6],
  ] as const)
    for (let y = y0; y < y0 + 6; y += 1)
      for (let x = x0; x < x0 + 6; x += 1) min = Math.min(min, frame[y * W + x] ?? 0);
  return min;
};

interface Check {
  readonly film: string;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const checks: Check[] = [];
function check(film: string, name: string, ok: boolean, detail: string | number | object = "") {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  checks.push({ film, name, ok, detail: text });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${film}: ${name}${text ? `  ${text}` : ""}\n`);
}

mkdirSync(OUT, { recursive: true });
const summaries: object[] = [];
for (const film of films()) {
  const label = `${film.where} ${film.file.split("/").at(-1)}`;
  if (!existsSync(join(ROOT, film.file))) {
    check(label, "is there", false, film.file);
    continue;
  }
  const info = probe(join(ROOT, film.file));
  check(
    label,
    `${FRAMES} frames at ${FPS} fps, ${(FRAMES / FPS).toFixed(3)} s`,
    info.frames === FRAMES && info.rate === `${FPS}/1` && Math.abs(info.duration - FRAMES / FPS) < 0.05,
    info,
  );
  const at = times(join(ROOT, film.file));
  const gaps = at.slice(1).map((value, index) => value - (at[index] ?? 0));
  const skipped = gaps.filter((gap) => Math.abs(gap - 1 / FPS) > 0.5 / FPS).length;
  check(
    label,
    "no skipped or doubled frame (every frame 1/24 s after the last)",
    at.length === FRAMES && skipped === 0,
    { frames: at.length, uneven: skipped },
  );
  const list = frames(join(ROOT, film.file), info.width, info.height);
  const light = list.map(mean);
  const spikes: number[] = [];
  for (let index = 1; index + 1 < light.length; index += 1) {
    const here = light[index] ?? 0;
    const before = light[index - 1] ?? 0;
    const after = light[index + 1] ?? 0;
    // A flash: one frame that leaves both neighbours by far, the same way.
    if ((here - before > 25 && here - after > 25) || (before - here > 25 && after - here > 25)) spikes.push(index);
  }
  check(
    label,
    "no flash (no one-frame jump in lightness)",
    spikes.length === 0,
    spikes.length
      ? { frames: spikes, light: spikes.map((i) => light[i]?.toFixed(1)) }
      : `largest step ${Math.max(...light.slice(1).map((v, i) => Math.abs(v - (light[i] ?? 0)))).toFixed(1)} of 255`,
  );
  const black = list
    .map((frame, index) => [index, mean(frame)] as const)
    .filter(([, value]) => value < 20)
    .map(([index]) => index);
  check(label, "no black frame", black.length === 0, black.length ? black : "");
  const flat = list
    .map((frame, index) => [index, spread(frame)] as const)
    .filter(([index, value]) => index > 0 && index < FRAMES - 72 && value < 1)
    .map(([index]) => index);
  check(label, "no empty frame before the logo", flat.length === 0, flat.length ? flat : "");
  const logo = picture(join(ROOT, film.logo), info.width, info.height);
  const tail = list.slice(-72).map((frame) => difference(frame, logo));
  check(
    label,
    "the last 3 s (72 frames) are the logo",
    tail.length === 72 && Math.max(...tail) < 4,
    `largest difference ${Math.max(...tail).toFixed(2)} of 255`,
  );
  const dark = list
    .map((frame, index) => [index, corners(frame)] as const)
    .filter(([index, value]) => index >= CLOSE_UP_END && value < 240);
  check(
    label,
    "a white backdrop after the close-up (the corners of every frame from 3.5 s)",
    dark.length === 0,
    dark.length ? dark.slice(0, 10) : "",
  );
  // v1.7.5: where the source had a blurred-out watermark (x 220-500, y 55-185 of the 2560x1440 master),
  // nothing but white once the close-up has gone: it left a blue patch at 12 s before the clean-up.
  const [bx0, bx1, by0, by1] = BLUR_BOX[aspectOf(film.file)];
  const h = list[0] ? list[0].length / W : 0;
  const marked = list
    .map((frame, index) => {
      let min = 255;
      for (let y = Math.floor(by0 * h); y < Math.ceil(by1 * h); y += 1)
        for (let x = Math.floor(bx0 * W); x < Math.ceil(bx1 * W); x += 1) min = Math.min(min, frame[y * W + x] ?? 255);
      return [index, min] as const;
    })
    .filter(([index, min]) => index >= CLOSE_UP_END && min < 240);
  check(
    label,
    "no mark where the source's blurred watermark was",
    marked.length === 0,
    marked.length ? marked.slice(0, 10) : "",
  );
  summaries.push({ film: film.file, ...info, firstLight: light[0], lastLight: light.at(-1) });
}

const failed = checks.filter((entry) => !entry.ok);
writeFileSync(
  join(OUT, "report.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), films: summaries, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2)}\n`,
);
process.stdout.write(
  `\n${checks.length - failed.length}/${checks.length} checks passed; report: ${join(OUT, "report.json")}\n`,
);
if (failed.length > 0) process.exit(1);
