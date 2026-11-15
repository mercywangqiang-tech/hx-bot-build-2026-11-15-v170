// HXBot：手机端启动、登录、加载时那块色块里堆满的长颈鹿（代替上游色块上的一双眼睛）。
//
// The layout of the pile, without React: rows of giraffes from the floor up, until the block is full.
// It is the pile of the desktop loading screen at rest: each giraffe stands on the bottom of a round
// body, the bodies of a row touch, and each row rests in the gaps of the row under it. The neck and
// the head reach a little above the body. Each giraffe has one of six colours. One seed always makes
// the same pile, so a block that renders again does not reshuffle its giraffes.

/** The giraffe stands in a square box of this many units (see hx-giraffe-pile.tsx). */
export const GIRAFFE_BOX = 1000;

interface PileGiraffe {
  /** The top left corner of its box, in points from the top left corner of its row. */
  x: number;
  y: number;
  /** The side of its square box, in points. */
  size: number;
  /** Which of the six colours it has, from 0 to 5. */
  color: number;
  /** Degrees, around the centre of its round body. */
  tilt: number;
}

export interface PileRow {
  /** The top of the row in the block, in points. */
  top: number;
  height: number;
  /** Drawn from the left; the rows are drawn from the floor up, so a higher row covers a lower one. */
  giraffes: PileGiraffe[];
}

export interface PileLayout {
  /** The side of an average giraffe box, in points. */
  size: number;
  /** From the floor up. */
  rows: PileRow[];
}

/** An average giraffe box is this share of the square root of the block area, between the limits. */
const SIZE = { share: 0.2, min: 84, max: 320 } as const;
/**
 * The round body that rests on the others, as shares of the box: its radius, and its centre from the
 * top. The giraffe is 0.92 of the box tall with its feet at 0.96, and the body is as wide as on the
 * desktop, where the giraffe is 0.72 and the body 0.62 of a crew box: 0.92 × 0.62 / 0.72 / 2.
 */
export const PILE_BODY = { radius: 0.396, centre: 0.564 } as const;
const TORSO_RADIUS = PILE_BODY.radius;
const TORSO_CENTRE = PILE_BODY.centre;
/** The space between two giraffes of a row, and between two rows, in body radii: they touch. */
const SPACING = { column: 2.04, row: 1.76 } as const;
/** How many colours the giraffes have. */
export const PILE_COLORS = 6;
/** The floor is this far above the bottom of the block, in points. */
const FLOOR_INSET = 4;
/** Room around a row's giraffes, as a share of the box, so a tilted head is not cut by the row's view. */
const ROW_PADDING = 0.12;
/** A pile never has more giraffes than this, so a large tablet stays light to draw. */
const MAX_GIRAFFES = 120;

/** A small seeded generator (mulberry32), so one seed always makes the same pile. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/**
 * The pile for a block of `width` by `height` points. Empty for a block without area. The giraffes
 * cover the whole block: the top row reaches above it, where the block clips it.
 */
export function giraffePileLayout(width: number, height: number, seed = 1): PileLayout {
  if (!(width > 0) || !(height > 0)) return { size: 0, rows: [] };
  const size = Math.round(Math.min(Math.max(Math.sqrt(width * height) * SIZE.share, SIZE.min), SIZE.max));
  const radius = size * TORSO_RADIUS;
  const columnStep = radius * SPACING.column;
  const rowStep = radius * SPACING.row;
  const random = createRandom(seed);
  const rows: PileRow[] = [];
  let count = 0;
  // The centre of the torsos of the bottom row rests one torso radius above the floor.
  for (let index = 0; ; index += 1) {
    const centreY = height - FLOOR_INSET - radius - index * rowStep;
    // A row whose giraffes would end above the block adds nothing: its feet are above the top.
    if (centreY + radius < 0) break;
    const offset = index % 2 === 0 ? 0 : columnStep / 2;
    const giraffes: PileGiraffe[] = [];
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    // Columns start half a step beyond each side, so a giraffe that leans in covers the edge.
    for (let centreX = offset - columnStep / 2; centreX < width + columnStep / 2; centreX += columnStep) {
      if (count >= MAX_GIRAFFES) break;
      const boxSize = Math.round(size * between(random, 0.9, 1.08));
      const x = centreX + between(random, -0.04, 0.04) * size - boxSize / 2;
      const y = centreY + between(random, -0.03, 0.03) * size - boxSize * TORSO_CENTRE;
      giraffes.push({
        x,
        y,
        size: boxSize,
        color: Math.floor(random() * PILE_COLORS) % PILE_COLORS,
        tilt: Math.round(between(random, -11, 11) * 10) / 10,
      });
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + boxSize);
      count += 1;
    }
    if (giraffes.length === 0) break;
    const padding = Math.ceil(size * ROW_PADDING);
    const rowTop = Math.floor(top) - padding;
    rows.push({
      top: rowTop,
      height: Math.ceil(bottom) + padding - rowTop,
      giraffes: giraffes.map((giraffe) => ({ ...giraffe, y: giraffe.y - rowTop })),
    });
    if (count >= MAX_GIRAFFES) break;
  }
  return { size, rows };
}
