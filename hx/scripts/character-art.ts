// HXBot：把原版的毛绒图片换成 HXBot 已设计的角色（长颈鹿、小猫等，与智能体头像同一套图形）。
//
// 只换图片，不改代码：生成的文件与原图同名、同尺寸、同位置，直接覆盖 packages/ui/src/assets/plush/ 里的原图，
// 所以用到它们的组件和样式（吉祥物、加载动画、搜索无结果、市场“没有匹配”、侧边栏小球和徽标）一行都不用改。
//
//   body-lilac.webp      吉祥物的身体 → 长颈鹿（不带圆形底色，眼睛画在身体图里）
//   eye-left/right.webp  吉祥物的两只眼睛 → 透明（长颈鹿只有一只小眼睛，已画在身体图里）
//   ball-*.webp          三个毛绒小球 → 同色的扁平小球
//   felt-pill-*.webp     毛绒徽标底 → 同色的扁平圆底
//   felt-x-ball.webp     毛绒叉号球 → 同色的扁平叉号球
//   fishing(-still)      钓鱼的毛绒角色 → 小猫钓鱼（8 秒循环，带透明通道的 VP9；静止图是第一帧）
//
// 用法（仓库根目录）：bun hx/scripts/character-art.ts
// 需要 rsvg-convert（librsvg）和带 libvpx-vp9、libwebp 的 ffmpeg。生成的图片已提交，平时不需要运行。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HX_ANIMALS, type HxAnimalEye, hxAnimalSvg } from "../../packages/brand/src/hx-animals";

const ROOT = resolve(import.meta.dir, "../..");
const OUT = join(ROOT, "packages/ui/src/assets/plush");
const WORK = mkdtempSync(join(tmpdir(), "hx-character-art-"));

function run(command: string, args: string[]): void {
  const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${command} failed: ${result.stderr.toString().slice(-600)}`);
}

function animal(id: string) {
  const found = HX_ANIMALS.find((item) => item.id === id);
  if (!found) throw new Error(`No HXBot animal: ${id}`);
  return found;
}

/** An animal picture as a nested `<svg>` at a place in a larger picture. `flip` turns it to face right. */
function placed(svg: string, x: number, y: number, size: number, flip = false): string {
  const inner = svg.replace('width="100%" height="100%"', `width="${size}" height="${size}"`);
  return flip
    ? `<g transform="translate(${x + size} ${y}) scale(-1 1)">${inner}</g>`
    : `<g transform="translate(${x} ${y})">${inner}</g>`;
}

function frame(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function png(name: string, svg: string): string {
  const source = join(WORK, `${name}.svg`);
  const target = join(WORK, `${name}.png`);
  writeFileSync(source, svg);
  run("rsvg-convert", ["-o", target, source]);
  return target;
}

function webp(name: string, svg: string): void {
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    png(name, svg),
    "-c:v",
    "libwebp",
    "-lossless",
    "1",
    join(OUT, `${name}.webp`),
  ]);
}

// ---------------------------------------------------------------- 吉祥物：长颈鹿（与标志、头像同一只）
const giraffe = animal("giraffe");
// The plush body filled y 28–486 of its 512 box. The giraffe stands as tall, in the middle, with no
// disc behind it: it is 0.738 of its own picture tall and starts 0.0864 from the top.
webp("body-lilac", frame(512, 512, placed(hxAnimalSvg(giraffe, giraffe.hue, { background: false }), -54, -26, 620)));
// The giraffe's one small eye is in the body picture, so the two eye layers are empty.
webp("eye-left", frame(512, 512, ""));
webp("eye-right", frame(512, 512, ""));

// ---------------------------------------------------------------- 小球、徽标底、叉号球：同色、扁平
function ball(color: string, shade: string): string {
  // The felt ball was a circle of about 102 pixels at (63.5, 62) of its 128 × 126 box.
  return frame(
    128,
    126,
    `<circle cx="63.5" cy="62" r="51" fill="${color}"/><circle cx="76" cy="76" r="9" fill="${shade}"/><circle cx="52" cy="50" r="6" fill="${shade}"/><circle cx="80" cy="46" r="4.5" fill="${shade}"/>`,
  );
}
webp("ball-lilac", ball("#b88bd2", "#9466b8"));
webp("ball-mint", ball("#77bb98", "#4f9a74"));
webp("ball-pink", ball("#d9517f", "#b3365f"));
// The felt pills are discs of 100 pixels at (58, 57.5) of a 116 box; CSS stretches them into pills.
webp("felt-pill-amber", frame(116, 116, '<circle cx="58" cy="57.5" r="50" fill="#e87a0e"/>'));
webp("felt-pill-lilac", frame(116, 116, '<circle cx="58" cy="57.5" r="50" fill="#c094db"/>'));
webp(
  "felt-x-ball",
  frame(
    128,
    128,
    '<circle cx="64.5" cy="64" r="60" fill="#e0356b"/><path d="M42 41.5 L87 86.5 M87 41.5 L42 86.5" stroke="#f4ecdd" stroke-width="17" stroke-linecap="round"/>',
  ),
);

// ---------------------------------------------------------------- 小猫钓鱼（市场“没有匹配”）
const cat = animal("cat");
const FRAMES = 193; // 8.04 s at 24 frames a second, as the loop it replaces
const TAU = Math.PI * 2;

function fishing(index: number): string {
  const t = index / FRAMES;
  // A nibble: the float dips once in each loop, and the cat opens its eye wide.
  const nibble = t > 0.55 && t < 0.7 ? Math.sin((Math.PI * (t - 0.55)) / 0.15) ** 2 : 0;
  const bob = 2.5 * Math.sin(TAU * 3 * t) + 10 * nibble;
  const eye: HxAnimalEye = nibble > 0.05 ? "wide" : t > 0.2 && t < 0.225 ? "happy" : "open";
  const tipY = 196 + 1.2 * Math.sin(TAU * 3 * t) + 7 * nibble;
  const floatY = 352 + bob;
  const ring = (offset: number) => {
    const phase = (3 * t + offset) % 1;
    return `<ellipse cx="372" cy="358" rx="${(10 + 30 * phase).toFixed(2)}" ry="${(4 + 11 * phase).toFixed(2)}" fill="none" stroke="#d3e8fb" stroke-width="2.5" opacity="${(0.85 * (1 - phase)).toFixed(3)}"/>`;
  };
  const stones = [
    [118, 352, 26, 15, "#9aa1ab"],
    [140, 322, 22, 13, "#b4bac3"],
    [330, 318, 24, 13, "#b4bac3"],
    [378, 330, 22, 13, "#9aa1ab"],
    [404, 362, 22, 15, "#b4bac3"],
    [388, 402, 26, 14, "#9aa1ab"],
    [334, 424, 28, 13, "#b4bac3"],
    [262, 432, 30, 12, "#9aa1ab"],
    [190, 426, 28, 13, "#b4bac3"],
    [134, 398, 26, 15, "#9aa1ab"],
  ]
    .map(([cx, cy, rx, ry, fill]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`)
    .join("");
  const waves = [0, 0.33, 0.66]
    .map((offset, row) => {
      const shift = 8 * Math.sin(TAU * (t + offset));
      const y = 372 + (row - 1) * 22;
      const x = 190 + row * 28 + shift;
      return `<path d="M${x.toFixed(1)} ${y} q14 -7 28 0 t28 0" fill="none" stroke="#7fb6ec" stroke-width="3" stroke-linecap="round"/>`;
    })
    .join("");
  return frame(
    480,
    480,
    [
      // The pond with its stones.
      '<ellipse cx="258" cy="374" rx="150" ry="58" fill="#3f86d0"/>',
      waves,
      ring(0),
      ring(0.5),
      stones,
      // The basket beside the cat.
      '<path d="M88 300 q22 -34 44 0" fill="none" stroke="#8a5a2b" stroke-width="5" stroke-linecap="round"/>',
      '<path d="M82 300 h56 l-6 32 q-22 8 -44 0 z" fill="#b9793a"/>',
      '<path d="M86 311 h48 M89 322 h42" stroke="#8a5a2b" stroke-width="3" stroke-linecap="round"/>',
      // The cat, turned to the pond.
      placed(hxAnimalSvg(cat, cat.hue, { background: false, eye }), 88, 150, 210, true),
      // The rod, the line and the float.
      `<path d="M214 276 Q300 236 372 ${tipY.toFixed(2)}" fill="none" stroke="#8a5a2b" stroke-width="5" stroke-linecap="round"/>`,
      `<path d="M372 ${tipY.toFixed(2)} L372 ${(floatY - 8).toFixed(2)}" stroke="#6b7280" stroke-width="1.6"/>`,
      `<circle cx="372" cy="${floatY.toFixed(2)}" r="9" fill="#ffffff"/>`,
      `<path d="M363 ${floatY.toFixed(2)} a9 9 0 0 1 18 0 z" fill="#e5484d"/>`,
    ].join(""),
  );
}

const frames = join(WORK, "fishing");
mkdirSync(frames);
for (let index = 0; index < FRAMES; index += 1) {
  const source = join(frames, `f-${String(index).padStart(3, "0")}.svg`);
  writeFileSync(source, fishing(index));
  run("rsvg-convert", ["-o", source.replace(/\.svg$/u, ".png"), source]);
}
webp("fishing-still", fishing(0));
run("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-framerate",
  "24",
  "-i",
  join(frames, "f-%03d.png"),
  "-c:v",
  "libvpx-vp9",
  "-pix_fmt",
  "yuva420p",
  "-b:v",
  "0",
  "-crf",
  "34",
  "-auto-alt-ref",
  "0",
  "-an",
  join(OUT, "fishing.webm"),
]);

rmSync(WORK, { recursive: true, force: true });
console.log(`已生成 11 个文件：${OUT}`);
