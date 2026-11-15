// HXBot：手机端长颈鹿堆的布局。
import { describe, expect, it } from "vitest";
import { giraffePileLayout, PILE_BODY, PILE_COLORS } from "./hx-giraffe-pile-layout";

/** The share of the block that the round bodies of the giraffes cover, measured on a grid of points. */
function coverage(width: number, height: number) {
  const layout = giraffePileLayout(width, height);
  const torsos = layout.rows.flatMap((row) =>
    row.giraffes.map((giraffe) => ({
      x: giraffe.x + giraffe.size * 0.5,
      y: row.top + giraffe.y + giraffe.size * PILE_BODY.centre,
      r: giraffe.size * PILE_BODY.radius,
    })),
  );
  let covered = 0;
  let total = 0;
  for (let y = 2; y < height; y += 4) {
    for (let x = 2; x < width; x += 4) {
      total += 1;
      if (torsos.some((torso) => (torso.x - x) ** 2 + (torso.y - y) ** 2 <= (torso.r * 1.35) ** 2)) covered += 1;
    }
  }
  return covered / total;
}

describe("the giraffe pile on the phone", () => {
  it("fills a phone screen from the floor to the top", () => {
    const layout = giraffePileLayout(390, 884);
    expect(layout.rows.length).toBeGreaterThan(8);
    // The bottom row stands on the floor, and the top row reaches the top of the block.
    const bottom = layout.rows[0];
    const top = layout.rows.at(-1);
    expect(bottom && bottom.top + bottom.height).toBeGreaterThanOrEqual(884 - 40);
    expect(top?.top).toBeLessThanOrEqual(0);
    expect(coverage(390, 884)).toBeGreaterThan(0.9);
  });

  it("fills a tablet and a short header the same way", () => {
    expect(coverage(1024, 1406)).toBeGreaterThan(0.9);
    expect(coverage(1366, 1024)).toBeGreaterThan(0.9);
    expect(coverage(390, 260)).toBeGreaterThan(0.85);
  });

  it("keeps a large screen light to draw", () => {
    const layout = giraffePileLayout(2732, 2088);
    const count = layout.rows.reduce((sum, row) => sum + row.giraffes.length, 0);
    expect(count).toBeLessThanOrEqual(120);
    expect(layout.size).toBeLessThanOrEqual(320);
  });

  it("makes the same pile for the same size", () => {
    expect(giraffePileLayout(390, 884)).toEqual(giraffePileLayout(390, 884));
  });

  it("has no giraffes for a block without area", () => {
    expect(giraffePileLayout(0, 884).rows).toEqual([]);
    expect(giraffePileLayout(390, Number.NaN).rows).toEqual([]);
  });

  it("stands the giraffes side by side, not through each other", () => {
    // The round bodies of a row touch at most: no body reaches the centre of its neighbour.
    for (const row of giraffePileLayout(390, 884).rows) {
      const centres = row.giraffes.map((giraffe) => ({
        x: giraffe.x + giraffe.size / 2,
        r: giraffe.size * PILE_BODY.radius,
      }));
      for (let index = 1; index < centres.length; index += 1) {
        const left = centres[index - 1];
        const right = centres[index];
        if (!left || !right) continue;
        expect(right.x - left.x).toBeGreaterThan((left.r + right.r) * 0.85);
      }
    }
  });

  it("gives the giraffes all six colours", () => {
    const colors = new Set(
      giraffePileLayout(390, 884).rows.flatMap((row) => row.giraffes.map((giraffe) => giraffe.color)),
    );
    expect([...colors].sort()).toEqual(Array.from({ length: PILE_COLORS }, (_, index) => index));
  });

  it("gives each row room for its tilted giraffes", () => {
    for (const row of giraffePileLayout(390, 884).rows) {
      for (const giraffe of row.giraffes) {
        expect(giraffe.y).toBeGreaterThan(0);
        expect(giraffe.y + giraffe.size).toBeLessThan(row.height);
        expect(Math.abs(giraffe.tilt)).toBeLessThanOrEqual(11);
      }
    }
  });
});
