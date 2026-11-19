import { describe, expect, it } from "vitest";
import { hxApplyEdits, hxDiffSequences, hxLineHunks } from "./diff-sequence";

function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** The length of the longest common subsequence, by dynamic programming. */
function lcs(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const up = row[j] ?? 0;
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(up, row[j - 1] ?? 0);
      diagonal = up;
    }
  }
  return row[b.length] ?? 0;
}

describe("hxDiffSequences", () => {
  it("turns the old sequence into the new one for random inputs, and covers both completely", () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
      const next = random(seed);
      const alphabet = ["a", "b", "c", "d", "", "}", "x"].slice(0, 2 + Math.floor(next() * 5));
      const make = () =>
        Array.from({ length: Math.floor(next() * 30) }, () => alphabet[Math.floor(next() * alphabet.length)] ?? "");
      const a = make();
      const b = next() < 0.5 ? make() : a.map((line) => (next() < 0.2 ? `${line}!` : line)).filter(() => next() > 0.1);
      const edits = hxDiffSequences(a, b);
      expect(hxApplyEdits(a, b, edits), `seed ${seed}`).toEqual(b);
      let aAt = 0;
      let bAt = 0;
      for (const edit of edits) {
        expect(edit.aStart, `seed ${seed}`).toBe(aAt);
        expect(edit.bStart, `seed ${seed}`).toBe(bAt);
        aAt = edit.aEnd;
        bAt = edit.bEnd;
        if (edit.kind === "equal") expect(a.slice(edit.aStart, edit.aEnd)).toEqual(b.slice(edit.bStart, edit.bEnd));
      }
      expect([aAt, bAt], `seed ${seed}`).toEqual([a.length, b.length]);
      // Close to the best: histogram may give up a few matches for readability, never many.
      const kept = edits
        .filter((edit) => edit.kind === "equal")
        .reduce((sum, edit) => sum + edit.aEnd - edit.aStart, 0);
      expect(kept, `seed ${seed}`).toBeGreaterThanOrEqual(Math.floor(lcs(a, b) * 0.7));
    }
  });

  it("reports one changed line as one delete and one insert", () => {
    const a = ["{", "  one", "}", "{", "  two", "}"];
    const b = ["{", "  one", "}", "{", "  TWO", "}"];
    expect(hxDiffSequences(a, b)).toEqual([
      { kind: "equal", aStart: 0, aEnd: 4, bStart: 0, bEnd: 4 },
      { kind: "delete", aStart: 4, aEnd: 5, bStart: 4, bEnd: 4 },
      { kind: "insert", aStart: 5, aEnd: 5, bStart: 4, bEnd: 5 },
      { kind: "equal", aStart: 5, aEnd: 6, bStart: 5, bEnd: 6 },
    ]);
  });

  it("handles large inputs in time, and gives up on the hopeless ones without hanging", () => {
    const a = Array.from({ length: 200_000 }, (_, index) => `line ${index}`);
    const b = [...a];
    b[1000] = "changed";
    b.splice(150_000, 0, "added");
    const started = performance.now();
    const edits = hxDiffSequences(a, b);
    expect(hxApplyEdits(a, b, edits)).toEqual(b);
    const noisyA = Array.from({ length: 30_000 }, (_, index) => String(index % 7));
    const noisyB = Array.from({ length: 30_000 }, (_, index) => String((index * 3) % 7));
    expect(hxApplyEdits(noisyA, noisyB, hxDiffSequences(noisyA, noisyB))).toEqual(noisyB);
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it("writes unified hunks with context, and empty input sides", () => {
    const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const b = ["1", "2", "3", "4", "five", "6", "7", "8", "9", "10", "11"];
    const hunks = hxLineHunks(a, b, 2);
    expect(hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines])).toEqual([
      [3, 5, 3, 5],
      [9, 2, 9, 3],
    ]);
    expect(hunks[0]?.lines.map((line) => line.kind + line.text)).toEqual([" 3", " 4", "-5", "+five", " 6", " 7"]);
    expect(hxLineHunks([], ["x"])).toEqual([
      { oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: "+", text: "x" }] },
    ]);
    expect(hxLineHunks(["x"], [])[0]?.lines).toEqual([{ kind: "-", text: "x" }]);
    expect(hxLineHunks(["same"], ["same"])).toEqual([]);
  });
});
