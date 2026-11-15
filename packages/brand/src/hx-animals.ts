// HXBot：智能体头像——30 种小动物，与 HXBot 长颈鹿同一画风（扁平剪影、斑纹点缀、一只小眼睛），
// 每种都能换颜色。这里只有图形数据，桌面端、网页版、手机端各自用它画图。
//
// Each animal faces left on a 100 by 100 box with its feet near y = 88, like the giraffe of the
// logo. A part has a role, and the role decides its colour from the agent's hue:
//   body    the main colour            accent  a darker shade: spots, stripes, mane, ears
//   light   a pale tint: belly, muzzle  soft    a mid tint: horns, skin, wool
//   dark    near black: nose, hooves    beak    warm yellow: beaks, feet
//   white   eyes of frogs and owls, teeth, glints
// A role written as "line:accent" draws only the outline of the part in that colour.
import { HX_GIRAFFE } from "./app-logo-shape";
import {
  AVATAR_EXPRESSIONS,
  type BloubAvatarProfile,
  bloubAvatarProfile,
  SUPPORTED_AVATAR_SILHOUETTES,
} from "./bloub-avatar";

export type HxAnimalRole = "body" | "accent" | "light" | "soft" | "dark" | "beak" | "white";
export type HxAnimalPart = readonly [
  tag: "circle" | "ellipse" | "rect" | "path",
  role: HxAnimalRole | `line:${HxAnimalRole}`,
  attributes: Readonly<Record<string, number | string>>,
];

export interface HxAnimal {
  id: string;
  /** Names for the gallery and for a screen reader. */
  zh: string;
  en: string;
  /** The hue that shows the animal at its most natural, in degrees. */
  hue: number;
  parts: readonly HxAnimalPart[];
  /** Where its eye is. Every animal has one dark eye with a glint, except those that draw their own. */
  eye?: readonly [x: number, y: number];
}

const L = (role: HxAnimalRole) => `line:${role}` as const;

/** The giraffe of the logo, scaled into the box. */
const GIRAFFE_SCALE = 90 / HX_GIRAFFE.height;
const GIRAFFE_LEFT = (100 - HX_GIRAFFE.width * GIRAFFE_SCALE) / 2;
const GIRAFFE_TRANSFORM = `translate(${GIRAFFE_LEFT.toFixed(2)} 2) scale(${GIRAFFE_SCALE.toFixed(5)})`;

const legs = (xs: readonly number[], y: number, width: number, height: number, role: HxAnimalRole = "body") =>
  xs.map((x): HxAnimalPart => ["rect", role, { x, y, width, height, rx: Math.min(width / 2, 3.5) }]);

export const HX_ANIMALS: readonly HxAnimal[] = [
  {
    id: "giraffe",
    zh: "长颈鹿",
    en: "Giraffe",
    hue: 32,
    parts: [
      ["path", "body", { d: HX_GIRAFFE.body, transform: GIRAFFE_TRANSFORM }],
      ["path", "accent", { d: HX_GIRAFFE.spots.join(""), transform: GIRAFFE_TRANSFORM }],
    ],
    eye: [GIRAFFE_LEFT + HX_GIRAFFE.eye.cx * GIRAFFE_SCALE, 2 + HX_GIRAFFE.eye.cy * GIRAFFE_SCALE + 0.4],
  },
  {
    id: "rhino",
    zh: "小犀牛",
    en: "Rhino",
    hue: 210,
    parts: [
      ...legs([38, 49, 64, 75], 62, 9, 24),
      ["ellipse", "body", { cx: 59, cy: 54, rx: 28, ry: 19 }],
      ["path", "body", { d: "M46 42 L24 42 Q12 46 12 56 Q14 64 24 65 L44 67 Z" }],
      ["path", "soft", { d: "M16 46 L10 28 L25 43 Z" }],
      ["path", "soft", { d: "M27 42 L26 33 L33 41 Z" }],
      ["path", "accent", { d: "M38 38 L41 28 L46 39 Z" }],
      ["path", L("accent"), { d: "M53 37 Q48 54 53 71 M70 37 Q66 54 70 71", "stroke-width": 3 }],
      ["circle", "dark", { cx: 16, cy: 58, r: 1.6 }],
    ],
    eye: [31, 49],
  },
  {
    id: "pig",
    zh: "小猪",
    en: "Pig",
    hue: 340,
    parts: [
      ...legs([37, 46, 64, 73], 68, 8, 18),
      ["ellipse", "body", { cx: 57, cy: 57, rx: 30, ry: 20 }],
      ["circle", "body", { cx: 30, cy: 50, r: 16 }],
      ["rect", "light", { x: 9, y: 46, width: 11, height: 12, rx: 4.5 }],
      ["circle", "accent", { cx: 13, cy: 50, r: 1.4 }],
      ["circle", "accent", { cx: 13, cy: 54.5, r: 1.4 }],
      ["path", "accent", { d: "M30 37 L37 25 L41 40 Z" }],
      ["path", L("accent"), { d: "M86 50 q7 -5 5 2 q-2 6 5 3", "stroke-width": 2.4 }],
    ],
    eye: [26, 45],
  },
  {
    id: "pony",
    zh: "小马",
    en: "Pony",
    hue: 25,
    parts: [
      ...legs([41, 49, 65, 73], 60, 6.5, 23),
      ...legs([41, 49, 65, 73], 82, 6.5, 5, "dark"),
      ["ellipse", "body", { cx: 58, cy: 55, rx: 24, ry: 14 }],
      ["path", "body", { d: "M37 52 L29 27 L42 21 L50 49 Z" }],
      ["ellipse", "body", { cx: 25, cy: 27, rx: 13, ry: 8, transform: "rotate(-22 25 27)" }],
      ["path", "accent", { d: "M33 16 L35 7 L40 17 Z" }],
      ["path", "accent", { d: "M38 17 Q48 24 50 50 L54 49 Q52 22 40 14 Z" }],
      ["path", "accent", { d: "M81 50 Q95 56 90 78 Q86 66 79 58 Z" }],
      ["circle", "dark", { cx: 14, cy: 31, r: 1.4 }],
    ],
    eye: [24, 24],
  },
  {
    id: "elephant",
    zh: "小象",
    en: "Elephant",
    hue: 220,
    parts: [
      ...legs([37, 48, 64, 75], 62, 10, 24),
      ["ellipse", "body", { cx: 59, cy: 51, rx: 28, ry: 22 }],
      ["circle", "body", { cx: 31, cy: 44, r: 17 }],
      ["path", L("body"), { d: "M18 50 Q10 64 16 80", "stroke-width": 9, "stroke-linecap": "round" }],
      ["ellipse", "accent", { cx: 40, cy: 44, rx: 10, ry: 15 }],
      ["path", L("white"), { d: "M22 57 Q19 63 24 65", "stroke-width": 2.6, "stroke-linecap": "round" }],
      ["path", L("accent"), { d: "M86 48 Q92 54 90 62", "stroke-width": 2.2, "stroke-linecap": "round" }],
    ],
    eye: [26, 40],
  },
  {
    id: "fish",
    zh: "小鱼",
    en: "Fish",
    hue: 195,
    parts: [
      ["path", "accent", { d: "M72 50 L94 30 L90 50 L94 70 Z" }],
      ["path", "accent", { d: "M38 33 Q50 18 64 33 Z" }],
      ["path", "accent", { d: "M44 66 Q52 78 60 67 Z" }],
      ["ellipse", "body", { cx: 47, cy: 50, rx: 30, ry: 20 }],
      ["path", L("accent"), { d: "M48 31 Q42 50 48 69 M60 33 Q55 50 60 67", "stroke-width": 4 }],
      ["path", L("accent"), { d: "M18 54 q4 3 8 0", "stroke-width": 2, "stroke-linecap": "round" }],
    ],
    eye: [29, 45],
  },
  {
    id: "cat",
    zh: "小猫",
    en: "Cat",
    hue: 40,
    parts: [
      ["path", L("body"), { d: "M68 82 Q86 80 84 62", "stroke-width": 6, "stroke-linecap": "round" }],
      ["path", "body", { d: "M36 87 Q28 62 42 48 L60 48 Q74 62 68 87 Z" }],
      ["ellipse", "light", { cx: 52, cy: 72, rx: 9, ry: 13 }],
      ["circle", "body", { cx: 40, cy: 36, r: 15 }],
      ["path", "body", { d: "M28 30 L26 14 L38 24 Z" }],
      ["path", "body", { d: "M46 22 L54 12 L54 30 Z" }],
      ["path", "accent", { d: "M29 26 L28 18 L34 23 Z" }],
      ["path", L("accent"), { d: "M40 22 L40 28 M46 24 L44 29", "stroke-width": 2.2, "stroke-linecap": "round" }],
      ["path", "dark", { d: "M26 40 L30 40 L28 43 Z" }],
    ],
    eye: [33, 34],
  },
  {
    id: "dog",
    zh: "小狗",
    en: "Dog",
    hue: 30,
    parts: [
      ["path", L("body"), { d: "M72 72 Q86 66 82 52", "stroke-width": 5.5, "stroke-linecap": "round" }],
      ["path", "body", { d: "M44 87 Q38 62 52 50 L66 50 Q78 64 74 87 Z" }],
      ...legs([44], 66, 8, 21),
      ["circle", "body", { cx: 40, cy: 38, r: 14 }],
      ["ellipse", "light", { cx: 26, cy: 43, rx: 10, ry: 7 }],
      ["circle", "dark", { cx: 17, cy: 41, r: 3.2 }],
      ["path", "accent", { d: "M44 27 Q56 28 54 48 Q45 42 41 30 Z" }],
    ],
    eye: [34, 35],
  },
  {
    id: "rabbit",
    zh: "小兔",
    en: "Rabbit",
    hue: 280,
    parts: [
      ["ellipse", "body", { cx: 38, cy: 22, rx: 4.8, ry: 15, transform: "rotate(-12 38 22)" }],
      ["ellipse", "body", { cx: 47, cy: 23, rx: 4.8, ry: 14, transform: "rotate(10 47 23)" }],
      ["ellipse", "light", { cx: 38, cy: 22, rx: 2, ry: 10, transform: "rotate(-12 38 22)" }],
      ["ellipse", "body", { cx: 57, cy: 66, rx: 23, ry: 19 }],
      ["circle", "light", { cx: 80, cy: 63, r: 6 }],
      ["circle", "body", { cx: 35, cy: 48, r: 13 }],
      ["ellipse", "body", { cx: 42, cy: 84, rx: 11, ry: 4.5 }],
      ["circle", "dark", { cx: 23, cy: 49, r: 1.8 }],
    ],
    eye: [31, 45],
  },
  {
    id: "bear",
    zh: "小熊",
    en: "Bear",
    hue: 22,
    parts: [
      ...legs([38, 48, 64, 74], 62, 10, 24),
      ["ellipse", "body", { cx: 58, cy: 53, rx: 27, ry: 20 }],
      ["circle", "body", { cx: 37, cy: 33, r: 5.5 }],
      ["circle", "accent", { cx: 37, cy: 33, r: 2.6 }],
      ["circle", "body", { cx: 30, cy: 46, r: 15 }],
      ["ellipse", "light", { cx: 18, cy: 50, rx: 8, ry: 6.5 }],
      ["circle", "dark", { cx: 12, cy: 48, r: 2.8 }],
    ],
    eye: [27, 42],
  },
  {
    id: "fox",
    zh: "狐狸",
    en: "Fox",
    hue: 18,
    parts: [
      ["path", "body", { d: "M66 86 Q98 82 88 54 Q82 72 64 74 Z" }],
      ["circle", "light", { cx: 89, cy: 60, r: 5 }],
      ["path", "body", { d: "M40 87 Q34 62 48 50 L62 52 Q72 66 68 87 Z" }],
      ["path", "light", { d: "M40 56 Q47 70 44 86 L52 86 Q54 68 48 56 Z" }],
      ["path", "body", { d: "M14 46 L40 32 L52 46 L38 57 Z" }],
      ["path", "light", { d: "M14 46 L30 50 L38 57 Z" }],
      ["path", "body", { d: "M38 33 L41 17 L50 35 Z" }],
      ["path", "accent", { d: "M40 31 L42 22 L46 33 Z" }],
      ["circle", "dark", { cx: 14.5, cy: 46, r: 2 }],
    ],
    eye: [33, 42],
  },
  {
    id: "deer",
    zh: "小鹿",
    en: "Deer",
    hue: 28,
    parts: [
      ...legs([43, 50, 65, 72], 57, 5, 29),
      ["ellipse", "body", { cx: 58, cy: 52, rx: 22, ry: 13 }],
      ["path", "body", { d: "M40 49 L34 28 L44 25 L49 46 Z" }],
      ["ellipse", "body", { cx: 29, cy: 29, rx: 11, ry: 7, transform: "rotate(-15 29 29)" }],
      [
        "path",
        L("accent"),
        { d: "M35 22 L31 9 M33 15 L26 11 M41 22 L43 9 M42 15 L49 11", "stroke-width": 2.6, "stroke-linecap": "round" },
      ],
      ["circle", "light", { cx: 54, cy: 47, r: 2 }],
      ["circle", "light", { cx: 62, cy: 45, r: 2 }],
      ["circle", "light", { cx: 69, cy: 50, r: 2 }],
      ["circle", "light", { cx: 58, cy: 54, r: 2 }],
      ["circle", "dark", { cx: 19, cy: 32, r: 1.6 }],
    ],
    eye: [27, 27],
  },
  {
    id: "cow",
    zh: "奶牛",
    en: "Cow",
    hue: 0,
    parts: [
      ...legs([38, 47, 68, 77], 62, 7.5, 24),
      ...legs([38, 47, 68, 77], 82, 7.5, 4, "dark"),
      ["rect", "body", { x: 34, y: 38, width: 52, height: 30, rx: 13 }],
      ["path", "light", { d: "M50 38 Q60 44 56 54 Q66 58 72 50 L74 38 Z" }],
      ["path", "light", { d: "M40 60 Q48 54 54 62 Q52 68 44 68 Z" }],
      ["rect", "body", { x: 12, y: 32, width: 26, height: 24, rx: 9 }],
      ["ellipse", "light", { cx: 17, cy: 52, rx: 10, ry: 7 }],
      ["circle", "dark", { cx: 13, cy: 51, r: 1.4 }],
      ["circle", "dark", { cx: 19, cy: 51, r: 1.4 }],
      ["path", "light", { d: "M22 33 L19 24 L27 31 Z" }],
      ["ellipse", "accent", { cx: 36, cy: 36, rx: 6, ry: 3, transform: "rotate(25 36 36)" }],
    ],
    eye: [24, 40],
  },
  {
    id: "sheep",
    zh: "小羊",
    en: "Sheep",
    hue: 260,
    parts: [
      ...legs([47, 55, 67, 75], 64, 5.5, 22, "accent"),
      ["circle", "soft", { cx: 48, cy: 52, r: 13 }],
      ["circle", "soft", { cx: 61, cy: 46, r: 13 }],
      ["circle", "soft", { cx: 74, cy: 52, r: 12 }],
      ["circle", "soft", { cx: 55, cy: 62, r: 12 }],
      ["circle", "soft", { cx: 70, cy: 62, r: 12 }],
      ["ellipse", "body", { cx: 31, cy: 50, rx: 11, ry: 13 }],
      ["circle", "soft", { cx: 36, cy: 38, r: 7 }],
      ["ellipse", "accent", { cx: 41, cy: 47, rx: 6.5, ry: 3, transform: "rotate(25 41 47)" }],
    ],
    eye: [27, 48],
  },
  {
    id: "duck",
    zh: "小鸭",
    en: "Duck",
    hue: 52,
    parts: [
      ["path", "beak", { d: "M50 74 L46 86 L54 86 Z M60 74 L58 86 L66 86 Z" }],
      ["path", "body", { d: "M78 54 L92 46 L88 60 Z" }],
      ["ellipse", "body", { cx: 57, cy: 60, rx: 27, ry: 16 }],
      ["rect", "body", { x: 28, y: 38, width: 11, height: 20, rx: 5 }],
      ["circle", "body", { cx: 33, cy: 35, r: 12 }],
      ["path", "beak", { d: "M23 34 L8 39 L22 44 Z" }],
      ["path", "accent", { d: "M50 52 Q66 45 77 58 Q64 66 50 58 Z" }],
    ],
    eye: [31, 32],
  },
  {
    id: "chick",
    zh: "小鸡",
    en: "Chick",
    hue: 48,
    parts: [
      [
        "path",
        L("beak"),
        {
          d: "M46 78 L44 87 M44 87 L40 88 M44 87 L48 88 M58 78 L58 87 M58 87 L54 88 M58 87 L62 88",
          "stroke-width": 2.2,
          "stroke-linecap": "round",
        },
      ],
      ["circle", "body", { cx: 52, cy: 56, r: 24 }],
      [
        "path",
        L("body"),
        { d: "M50 33 Q47 26 52 23 M52 33 Q55 27 58 27", "stroke-width": 3, "stroke-linecap": "round" },
      ],
      ["path", "beak", { d: "M29 50 L20 54 L29 58 Z" }],
      ["ellipse", "accent", { cx: 60, cy: 60, rx: 11, ry: 7, transform: "rotate(-15 60 60)" }],
    ],
    eye: [38, 48],
  },
  {
    id: "penguin",
    zh: "企鹅",
    en: "Penguin",
    hue: 230,
    parts: [
      ["ellipse", "beak", { cx: 44, cy: 87, rx: 7, ry: 2.6 }],
      ["ellipse", "beak", { cx: 58, cy: 87, rx: 7, ry: 2.6 }],
      ["ellipse", "body", { cx: 51, cy: 54, rx: 21, ry: 32 }],
      ["ellipse", "light", { cx: 46, cy: 60, rx: 13, ry: 23 }],
      ["path", "beak", { d: "M30 40 L20 43 L30 47 Z" }],
      ["path", "accent", { d: "M66 46 Q78 58 72 74 Q64 64 64 50 Z" }],
    ],
    eye: [38, 38],
  },
  {
    id: "turtle",
    zh: "乌龟",
    en: "Turtle",
    hue: 140,
    parts: [
      ["ellipse", "soft", { cx: 36, cy: 74, rx: 6, ry: 9 }],
      ["ellipse", "soft", { cx: 72, cy: 74, rx: 6, ry: 9 }],
      ["path", "soft", { d: "M80 62 L92 66 L80 70 Z" }],
      ["circle", "soft", { cx: 18, cy: 58, r: 9 }],
      ["path", "body", { d: "M26 66 A28 26 0 0 1 84 66 Z" }],
      [
        "path",
        L("accent"),
        {
          d: "M42 66 L46 52 L64 52 L68 66 M46 52 L50 42 M64 52 L60 42 M34 56 L46 52 M76 56 L64 52",
          "stroke-width": 2.6,
          "stroke-linejoin": "round",
        },
      ],
      ["rect", "accent", { x: 24, y: 64, width: 62, height: 5, rx: 2.5 }],
    ],
    eye: [15, 56],
  },
  {
    id: "snail",
    zh: "蜗牛",
    en: "Snail",
    hue: 300,
    parts: [
      ["path", "soft", { d: "M14 80 Q20 64 34 64 L80 68 Q90 74 82 80 Z" }],
      ["path", L("soft"), { d: "M24 66 L19 46 M30 65 L32 45", "stroke-width": 2.6, "stroke-linecap": "round" }],
      ["circle", "dark", { cx: 19, cy: 45, r: 2.4 }],
      ["circle", "dark", { cx: 32, cy: 44, r: 2.4 }],
      ["circle", "body", { cx: 60, cy: 50, r: 21 }],
      [
        "path",
        L("accent"),
        {
          d: "M60 50 m0 -3 a3 3 0 1 1 -3 3 a7 7 0 1 1 7 7 a11 11 0 1 1 -11 -11 a15 15 0 1 1 15 15",
          "stroke-width": 3,
          "stroke-linecap": "round",
        },
      ],
    ],
  },
  {
    id: "dinosaur",
    zh: "小恐龙",
    en: "Dinosaur",
    hue: 110,
    parts: [
      ...legs([46, 54, 66, 74], 64, 7.5, 22),
      ["path", "body", { d: "M80 56 Q96 66 99 78 Q88 74 76 66 Z" }],
      ["path", "accent", { d: "M48 42 L52 34 L56 42 Z M58 40 L62 31 L66 40 Z M68 42 L72 34 L76 44 Z" }],
      ["ellipse", "body", { cx: 61, cy: 57, rx: 24, ry: 16 }],
      ["path", "body", { d: "M44 52 Q36 32 27 23 L35 17 Q46 30 55 48 Z" }],
      ["ellipse", "body", { cx: 26, cy: 20, rx: 10, ry: 7 }],
      ["ellipse", "light", { cx: 60, cy: 64, rx: 14, ry: 6 }],
    ],
    eye: [24, 17],
  },
  {
    id: "crocodile",
    zh: "小鳄鱼",
    en: "Crocodile",
    hue: 125,
    parts: [
      ...legs([36, 46, 66, 76], 64, 7, 14),
      ["path", "body", { d: "M82 55 L99 50 L86 67 Z" }],
      ["path", "accent", { d: "M40 50 l3 -5 l3 5 Z M50 50 l3 -5 l3 5 Z M60 50 l3 -5 l3 5 Z M70 50 l3 -5 l3 5 Z" }],
      ["rect", "body", { x: 26, y: 49, width: 60, height: 19, rx: 9.5 }],
      ["rect", "body", { x: 5, y: 52, width: 28, height: 12, rx: 5 }],
      ["path", "white", { d: "M9 64 l2 3 l2 -3 Z M15 64 l2 3 l2 -3 Z M21 64 l2 3 l2 -3 Z" }],
      ["circle", "body", { cx: 31, cy: 48, r: 5.5 }],
      ["circle", "dark", { cx: 8, cy: 54, r: 1.2 }],
    ],
    eye: [31, 47],
  },
  {
    id: "hippo",
    zh: "河马",
    en: "Hippo",
    hue: 250,
    parts: [
      ...legs([38, 50, 66, 78], 66, 10, 20),
      ["ellipse", "body", { cx: 60, cy: 56, rx: 30, ry: 22 }],
      ["rect", "body", { x: 9, y: 40, width: 36, height: 26, rx: 12 }],
      ["circle", "body", { cx: 31, cy: 40, r: 6.5 }],
      ["circle", "body", { cx: 40, cy: 36, r: 4 }],
      ["circle", "accent", { cx: 40, cy: 36, r: 1.8 }],
      ["ellipse", "light", { cx: 62, cy: 66, rx: 18, ry: 7 }],
      ["circle", "dark", { cx: 14, cy: 46, r: 1.6 }],
      ["circle", "dark", { cx: 20, cy: 46, r: 1.6 }],
    ],
    eye: [31, 39],
  },
  {
    id: "camel",
    zh: "骆驼",
    en: "Camel",
    hue: 35,
    parts: [
      ...legs([41, 48, 63, 70], 57, 5, 29),
      ["circle", "body", { cx: 50, cy: 44, r: 10 }],
      ["circle", "body", { cx: 67, cy: 44, r: 9 }],
      ["ellipse", "body", { cx: 57, cy: 54, rx: 22, ry: 12 }],
      ["path", "body", { d: "M40 52 Q29 42 27 29 L35 26 Q37 40 47 49 Z" }],
      ["ellipse", "body", { cx: 24, cy: 27, rx: 10, ry: 6 }],
      ["path", "accent", { d: "M44 40 Q50 34 56 40 Z M62 41 Q67 36 72 41 Z" }],
      ["circle", "dark", { cx: 15, cy: 28, r: 1.4 }],
    ],
    eye: [22, 25],
  },
  {
    id: "zebra",
    zh: "斑马",
    en: "Zebra",
    hue: 200,
    parts: [
      ...legs([41, 49, 65, 73], 60, 6.5, 23, "soft"),
      ...legs([41, 49, 65, 73], 82, 6.5, 5, "dark"),
      ["ellipse", "soft", { cx: 58, cy: 55, rx: 24, ry: 14 }],
      ["path", "soft", { d: "M37 52 L29 27 L42 21 L50 49 Z" }],
      ["ellipse", "soft", { cx: 25, cy: 27, rx: 13, ry: 8, transform: "rotate(-22 25 27)" }],
      [
        "path",
        L("body"),
        {
          d: "M50 42 Q46 55 51 68 M59 41 Q55 55 60 69 M68 42 Q65 55 69 68 M38 34 L46 32 M36 41 L46 40",
          "stroke-width": 3.4,
          "stroke-linecap": "round",
        },
      ],
      ["path", "body", { d: "M38 17 Q48 24 50 50 L54 49 Q52 22 40 14 Z" }],
      ["path", "body", { d: "M81 50 Q92 54 89 72 Q85 62 79 58 Z" }],
      ["path", "body", { d: "M33 16 L35 7 L40 17 Z" }],
      ["circle", "dark", { cx: 14, cy: 31, r: 1.4 }],
    ],
    eye: [24, 24],
  },
  {
    id: "lion",
    zh: "小狮子",
    en: "Lion",
    hue: 38,
    parts: [
      ["path", L("body"), { d: "M68 82 Q86 82 86 66", "stroke-width": 4.5, "stroke-linecap": "round" }],
      ["circle", "accent", { cx: 86, cy: 64, r: 5 }],
      ["path", "body", { d: "M40 87 Q34 64 46 52 L62 52 Q74 64 70 87 Z" }],
      ["circle", "accent", { cx: 38, cy: 40, r: 19 }],
      ["circle", "body", { cx: 34, cy: 42, r: 12 }],
      ["ellipse", "light", { cx: 27, cy: 47, rx: 6.5, ry: 5 }],
      ["circle", "dark", { cx: 23, cy: 45, r: 2.2 }],
    ],
    eye: [30, 39],
  },
  {
    id: "squirrel",
    zh: "松鼠",
    en: "Squirrel",
    hue: 15,
    parts: [
      ["path", "accent", { d: "M56 82 Q92 80 86 42 Q82 22 66 28 Q80 42 72 60 Q66 72 54 72 Z" }],
      ["ellipse", "body", { cx: 46, cy: 64, rx: 14, ry: 19 }],
      ["ellipse", "light", { cx: 42, cy: 68, rx: 7, ry: 12 }],
      ["ellipse", "body", { cx: 46, cy: 85, rx: 10, ry: 3.5 }],
      ["circle", "body", { cx: 37, cy: 41, r: 11 }],
      ["path", "body", { d: "M38 32 L41 21 L46 34 Z" }],
      ["circle", "dark", { cx: 27, cy: 43, r: 1.6 }],
    ],
    eye: [33, 39],
  },
  {
    id: "owl",
    zh: "猫头鹰",
    en: "Owl",
    hue: 270,
    parts: [
      [
        "path",
        L("beak"),
        {
          d: "M42 84 L40 89 M46 84 L46 89 M56 84 L56 89 M60 84 L62 89",
          "stroke-width": 2.4,
          "stroke-linecap": "round",
        },
      ],
      ["path", "body", { d: "M30 24 L36 34 L42 28 Z M70 24 L64 34 L58 28 Z" }],
      ["ellipse", "body", { cx: 50, cy: 56, rx: 24, ry: 29 }],
      ["ellipse", "accent", { cx: 28, cy: 60, rx: 6, ry: 15 }],
      ["ellipse", "accent", { cx: 72, cy: 60, rx: 6, ry: 15 }],
      ["ellipse", "light", { cx: 50, cy: 68, rx: 13, ry: 14 }],
      ["path", L("accent"), { d: "M44 64 l3 3 l3 -3 l3 3 l3 -3 M44 72 l3 3 l3 -3 l3 3 l3 -3", "stroke-width": 1.8 }],
      ["circle", "light", { cx: 41, cy: 43, r: 9.5 }],
      ["circle", "light", { cx: 59, cy: 43, r: 9.5 }],
      ["circle", "dark", { cx: 41, cy: 43, r: 4.2 }],
      ["circle", "dark", { cx: 59, cy: 43, r: 4.2 }],
      ["circle", "white", { cx: 39.8, cy: 41.8, r: 1.4 }],
      ["circle", "white", { cx: 57.8, cy: 41.8, r: 1.4 }],
      ["path", "beak", { d: "M47 50 L53 50 L50 57 Z" }],
    ],
  },
  {
    id: "frog",
    zh: "青蛙",
    en: "Frog",
    hue: 95,
    parts: [
      ["ellipse", "accent", { cx: 28, cy: 80, rx: 12, ry: 6 }],
      ["ellipse", "accent", { cx: 72, cy: 80, rx: 12, ry: 6 }],
      ["ellipse", "body", { cx: 50, cy: 64, rx: 28, ry: 20 }],
      ["ellipse", "light", { cx: 50, cy: 70, rx: 16, ry: 12 }],
      ["ellipse", "body", { cx: 50, cy: 47, rx: 25, ry: 15 }],
      ["circle", "body", { cx: 35, cy: 36, r: 10 }],
      ["circle", "body", { cx: 65, cy: 36, r: 10 }],
      ["circle", "white", { cx: 35, cy: 35, r: 6.5 }],
      ["circle", "white", { cx: 65, cy: 35, r: 6.5 }],
      ["circle", "dark", { cx: 35, cy: 36, r: 3.4 }],
      ["circle", "dark", { cx: 65, cy: 36, r: 3.4 }],
      ["path", L("accent"), { d: "M38 52 Q50 60 62 52", "stroke-width": 2.6, "stroke-linecap": "round" }],
    ],
  },
  {
    id: "dolphin",
    zh: "海豚",
    en: "Dolphin",
    hue: 205,
    parts: [
      ["path", "accent", { d: "M48 38 L57 22 L64 40 Z" }],
      ["path", "accent", { d: "M80 44 L98 34 L93 49 L98 62 Z" }],
      ["ellipse", "body", { cx: 52, cy: 50, rx: 34, ry: 13, transform: "rotate(-8 52 50)" }],
      ["ellipse", "body", { cx: 15, cy: 57, rx: 9, ry: 4.5, transform: "rotate(-8 15 57)" }],
      ["path", "light", { d: "M22 58 Q48 66 78 50 Q52 72 22 62 Z" }],
      ["path", "accent", { d: "M44 58 L36 72 L52 62 Z" }],
    ],
    eye: [27, 50],
  },
  {
    id: "whale",
    zh: "小鲸鱼",
    en: "Whale",
    hue: 225,
    parts: [
      [
        "path",
        L("soft"),
        { d: "M36 32 Q32 22 26 20 M36 32 Q40 22 46 20 M36 32 L36 20", "stroke-width": 2.6, "stroke-linecap": "round" },
      ],
      ["path", "body", { d: "M74 54 Q86 38 97 34 Q92 47 99 56 Q87 56 77 63 Z" }],
      ["ellipse", "body", { cx: 46, cy: 56, rx: 32, ry: 20 }],
      ["path", "light", { d: "M15 60 Q44 70 76 60 Q70 76 46 76 Q22 76 15 60 Z" }],
      ["path", "accent", { d: "M44 64 L34 76 L54 68 Z" }],
      ["path", L("accent"), { d: "M14 58 Q22 62 32 60", "stroke-width": 2, "stroke-linecap": "round" }],
    ],
    eye: [25, 53],
  },
];

/** The default hues of the agent avatar colours. */
export const HX_ANIMAL_HUES = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const;

export type HxAnimalColors = Record<HxAnimalRole | "background", string>;

function hexFromHsl(h: number, s: number, l: number): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const value = lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function hslFromHex(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match?.[1] ? Number.parseInt(match[1], 16) : 0x999999;
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

const FIXED = { dark: "#33241c", beak: "#f2a93b", white: "#ffffff" } as const;
const ROLES: readonly HxAnimalRole[] = ["body", "accent", "light", "soft", "dark", "beak", "white"];

/** The colours of the roles for a hue, as `#rrggbb`, which every platform reads. */
export function hxAnimalColors(hue: number): HxAnimalColors {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  // Yellow looks dull at the saturation of the others.
  const yellow = h >= 40 && h <= 70;
  return {
    body: hexFromHsl(h, yellow ? 78 : 62, yellow ? 56 : 60),
    accent: hexFromHsl(h, 52, yellow ? 36 : 38),
    light: hexFromHsl(h, 70, 90),
    soft: hexFromHsl(h, 58, 78),
    background: hexFromHsl(h, 72, 95),
    ...FIXED,
  };
}

/** The colours of the roles for the agent's own colour, which is the body colour as it is. */
export function hxAnimalColorsFromHex(color: string): HxAnimalColors {
  const [h, s, l] = hslFromHex(color);
  const grey = s < 12;
  const saturation = grey ? s : Math.max(s, 40);
  return {
    body: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : hexFromHsl(h, saturation, l),
    accent: hexFromHsl(h, saturation * 0.85, Math.max(18, Math.min(l * 0.62, 42))),
    light: hexFromHsl(h, grey ? s : 70, 90),
    soft: hexFromHsl(h, grey ? s : 58, 78),
    background: hexFromHsl(h, grey ? s : 72, 95),
    ...FIXED,
  };
}

/**
 * The animal of an agent face. The avatar editor chooses one of ten silhouettes and one of sixteen
 * eyes; the silhouette chooses a group of animals three apart and the eyes walk from there, so the
 * silhouette options show ten animals, the eye options sixteen, and every animal can be chosen.
 */
export function hxAnimalForFace(shape: string, expression: string): HxAnimal {
  // A stored face can name a shape or eyes that this version does not have: those get the first.
  const shapes: readonly string[] = SUPPORTED_AVATAR_SILHOUETTES;
  const expressions: readonly string[] = AVATAR_EXPRESSIONS;
  const silhouette = Math.max(0, shapes.indexOf(shape));
  const eyes = Math.max(0, expressions.indexOf(expression));
  const animal = HX_ANIMALS[(silhouette * 3 + eyes) % HX_ANIMALS.length] ?? HX_ANIMALS[0];
  if (!animal) throw new Error("The HXBot animal list is empty.");
  return animal;
}

/** The animal and the colours of an agent avatar: the same face and colour that the seed chose before. */
export function hxAgentAnimal(
  seed: string,
  hue: Parameters<typeof bloubAvatarProfile>[1],
  color: Parameters<typeof bloubAvatarProfile>[2] = null,
  face: { shape?: string | undefined; expression?: string | undefined } = {},
): { animal: HxAnimal; colors: HxAnimalColors } {
  const profile: BloubAvatarProfile = bloubAvatarProfile(seed, hue, color);
  return {
    animal: hxAnimalForFace(face.shape ?? profile.shape, face.expression ?? profile.expression),
    colors: hxAnimalColorsFromHex(profile.color),
  };
}

/** How the eye of a picture looks: as drawn, wide open, closed in a smile, or left out. */
export type HxAnimalEye = "open" | "wide" | "happy" | "none";

function eyeMarkup(animal: HxAnimal, colors: HxAnimalColors, eye: HxAnimalEye): string {
  if (!animal.eye || eye === "none") return "";
  const [x, y] = animal.eye;
  if (eye === "happy") {
    return `<path fill="none" stroke="${colors.dark}" stroke-width="1.5" stroke-linecap="round" d="M${(x - 3).toFixed(2)},${(y + 0.9).toFixed(2)} Q${x.toFixed(2)},${(y - 3).toFixed(2)} ${(x + 3).toFixed(2)},${(y + 0.9).toFixed(2)}"/>`;
  }
  const r = eye === "wide" ? 3.6 : 2.6;
  const glint = eye === "wide" ? 1.25 : 0.9;
  return `<circle fill="${colors.dark}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}"/><circle fill="#ffffff" cx="${(x - glint).toFixed(2)}" cy="${(y - glint).toFixed(2)}" r="${glint}"/>`;
}

/**
 * One animal as an SVG string, on a round tinted background unless `background` is false. `size`
 * sets its width and height in pixels; without it, it fills its box. `eye` changes how its eye
 * looks, and `layer` draws only the animal without its eye, or only the eye, for a picture whose
 * eye changes while the rest stays.
 */
export function hxAnimalSvg(
  animal: HxAnimal,
  colorsOrHue: HxAnimalColors | number,
  options: { size?: number; background?: boolean; eye?: HxAnimalEye; layer?: "all" | "body" | "eye" } = {},
): string {
  const colors = typeof colorsOrHue === "number" ? hxAnimalColors(colorsOrHue) : colorsOrHue;
  const size = options.size === undefined ? "100%" : String(options.size);
  const layer = options.layer ?? "all";
  const attributes = (values: Readonly<Record<string, number | string>>) =>
    Object.entries(values)
      .map(([name, value]) => `${name}="${value}"`)
      .join(" ");
  const shapes =
    layer === "eye"
      ? ""
      : animal.parts
          .map(([tag, role, values]) => {
            const line = role.startsWith("line:");
            const name = line ? role.slice(5) : role;
            const color = colors[ROLES.find((item) => item === name) ?? "body"];
            const paint = line ? `fill="none" stroke="${color}"` : `fill="${color}"`;
            return `<${tag} ${paint} ${attributes(values)}/>`;
          })
          .join("");
  const eye = layer === "body" ? "" : eyeMarkup(animal, colors, options.eye ?? "open");
  const background =
    options.background === false || layer === "eye"
      ? ""
      : `<circle fill="${colors.background}" cx="50" cy="50" r="50"/>`;
  // The animal sits a little smaller than the circle, so its ears and tail stay inside.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${background}<g transform="translate(9 7) scale(0.82)">${shapes}${eye}</g></svg>`;
}
