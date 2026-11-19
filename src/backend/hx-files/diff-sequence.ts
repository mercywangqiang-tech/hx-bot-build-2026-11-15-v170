// HXBot v1.7.4（ART-05）：两串东西（文本的行、文档的段落、演示的页）之间的差异。
// 用 histogram 算法（git 默认的那种）：先在两边找出现次数最少的共同行作锚点，从锚点向两边扩成最长的一段相同，
// 再对两头递归；找不到锚点的那一段交给 Myers 算法。这样出来的差异贴近人眼：改了一行就是那一行，
// 不会把一段花括号或空行错配成“移动”。很长的输入有工作量上限，超了就整段算作替换，不会卡住。

export interface HxEdit {
  kind: "equal" | "delete" | "insert";
  /** Lines [aStart, aEnd) of the old sequence and [bStart, bEnd) of the new one. */
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/** Above this many occurrences in the old part, a line is too common to be an anchor. */
const MAX_CHAIN = 64;
/** Myers explores at most this many differences in one region before it calls the region replaced. */
const MAX_MYERS_D = 4000;
/** Regions up to this many lines on both sides together go to Myers directly. */
const SMALL_REGION = 400;

export function hxDiffSequences(a: readonly string[], b: readonly string[]): HxEdit[] {
  const raw: HxEdit[] = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  if (start > 0) raw.push({ kind: "equal", aStart: 0, aEnd: start, bStart: 0, bEnd: start });
  const budget = { work: 50_000_000 };
  histogram(a, start, endA, b, start, endB, raw, budget, 0);
  if (endA < a.length) raw.push({ kind: "equal", aStart: endA, aEnd: a.length, bStart: endB, bEnd: b.length });
  return merge(raw);
}

function histogram(
  a: readonly string[],
  a0: number,
  a1: number,
  b: readonly string[],
  b0: number,
  b1: number,
  out: HxEdit[],
  budget: { work: number },
  depth: number,
): void {
  if (a0 === a1 && b0 === b1) return;
  if (a0 === a1) {
    out.push({ kind: "insert", aStart: a0, aEnd: a0, bStart: b0, bEnd: b1 });
    return;
  }
  if (b0 === b1) {
    out.push({ kind: "delete", aStart: a0, aEnd: a1, bStart: b0, bEnd: b0 });
    return;
  }
  budget.work -= a1 - a0 + (b1 - b0);
  if (budget.work < 0 || depth > 2000) {
    replace(a0, a1, b0, b1, out);
    return;
  }
  // A small region gets the shortest edit script outright; anchors pay off on long ones.
  if (a1 - a0 + (b1 - b0) <= SMALL_REGION) {
    myers(a, a0, a1, b, b0, b1, out, budget);
    return;
  }
  const positions = new Map<string, number[]>();
  for (let i = a0; i < a1; i += 1) {
    const line = a[i] ?? "";
    const list = positions.get(line);
    if (list) list.push(i);
    else positions.set(line, [i]);
  }
  let best: { as: number; ae: number; bs: number; be: number; count: number } | null = null;
  for (let j = b0; j < b1; ) {
    const list = positions.get(b[j] ?? "");
    if (!list || list.length > MAX_CHAIN) {
      j += 1;
      continue;
    }
    let nextJ = j + 1;
    for (const i of list) {
      let as = i;
      let bs = j;
      while (as > a0 && bs > b0 && a[as - 1] === b[bs - 1]) {
        as -= 1;
        bs -= 1;
      }
      let ae = i + 1;
      let be = j + 1;
      let count = list.length;
      while (ae < a1 && be < b1 && a[ae] === b[be]) {
        count = Math.min(count, positions.get(a[ae] ?? "")?.length ?? MAX_CHAIN);
        ae += 1;
        be += 1;
      }
      budget.work -= ae - as;
      if (!best || count < best.count || (count === best.count && ae - as > best.ae - best.as)) {
        best = { as, ae, bs, be, count };
      }
      if (be > nextJ) nextJ = be;
    }
    j = nextJ;
  }
  if (!best) {
    myers(a, a0, a1, b, b0, b1, out, budget);
    return;
  }
  histogram(a, a0, best.as, b, b0, best.bs, out, budget, depth + 1);
  out.push({ kind: "equal", aStart: best.as, aEnd: best.ae, bStart: best.bs, bEnd: best.be });
  histogram(a, best.ae, a1, b, best.be, b1, out, budget, depth + 1);
}

function replace(a0: number, a1: number, b0: number, b1: number, out: HxEdit[]): void {
  if (a1 > a0) out.push({ kind: "delete", aStart: a0, aEnd: a1, bStart: b0, bEnd: b0 });
  if (b1 > b0) out.push({ kind: "insert", aStart: a1, aEnd: a1, bStart: b0, bEnd: b1 });
}

/** The greedy O(ND) algorithm of Myers (1986), with its trace kept to walk the path back. */
function myers(
  a: readonly string[],
  a0: number,
  a1: number,
  b: readonly string[],
  b0: number,
  b1: number,
  out: HxEdit[],
  budget: { work: number },
): void {
  const n = a1 - a0;
  const m = b1 - b0;
  const max = Math.min(n + m, MAX_MYERS_D);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) x = v[offset + k + 1] ?? 0;
      else x = (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x += 1;
        y += 1;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
    budget.work -= 2 * d + 1;
    if (found >= 0) {
      trace.push(v);
      break;
    }
    if (budget.work < 0) break;
  }
  if (found < 0) {
    replace(a0, a1, b0, b1, out);
    return;
  }
  // Walk back from the end to the start, collecting the edits in reverse.
  const edits: HxEdit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const before = trace[d] ?? new Int32Array(0);
    const k = x - y;
    const down = k === -d || (k !== d && (before[offset + k - 1] ?? 0) < (before[offset + k + 1] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = before[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    const startX = down ? prevX : prevX + 1;
    const startY = down ? prevY + 1 : prevY;
    if (x > startX) edits.push({ kind: "equal", aStart: a0 + startX, aEnd: a0 + x, bStart: b0 + startY, bEnd: b0 + y });
    if (down)
      edits.push({ kind: "insert", aStart: a0 + prevX, aEnd: a0 + prevX, bStart: b0 + prevY, bEnd: b0 + prevY + 1 });
    else edits.push({ kind: "delete", aStart: a0 + prevX, aEnd: a0 + prevX + 1, bStart: b0 + prevY, bEnd: b0 + prevY });
    x = prevX;
    y = prevY;
  }
  if (x > 0) edits.push({ kind: "equal", aStart: a0, aEnd: a0 + x, bStart: b0, bEnd: b0 + y });
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index];
    if (edit) out.push(edit);
  }
}

/** Joins neighbouring edits of one kind, and orders a delete before the insert next to it. */
function merge(edits: readonly HxEdit[]): HxEdit[] {
  const out: HxEdit[] = [];
  for (const edit of edits) {
    if (edit.aStart === edit.aEnd && edit.bStart === edit.bEnd) continue;
    const last = out[out.length - 1];
    if (last && last.kind === edit.kind && last.aEnd === edit.aStart && last.bEnd === edit.bStart) {
      out[out.length - 1] = { ...last, aEnd: edit.aEnd, bEnd: edit.bEnd };
      continue;
    }
    out.push({ ...edit });
  }
  // A run of deletes and inserts between two equal parts becomes one delete and one insert.
  const tidy: HxEdit[] = [];
  let index = 0;
  while (index < out.length) {
    const edit = out[index];
    if (!edit) break;
    if (edit.kind === "equal") {
      tidy.push(edit);
      index += 1;
      continue;
    }
    let end = index;
    while (end < out.length && out[end]?.kind !== "equal") end += 1;
    const run = out.slice(index, end);
    const aStart = Math.min(...run.map((item) => item.aStart));
    const aEnd = Math.max(...run.map((item) => item.aEnd));
    const bStart = Math.min(...run.map((item) => item.bStart));
    const bEnd = Math.max(...run.map((item) => item.bEnd));
    if (aEnd > aStart) tidy.push({ kind: "delete", aStart, aEnd, bStart, bEnd: bStart });
    if (bEnd > bStart) tidy.push({ kind: "insert", aStart: aEnd, aEnd, bStart, bEnd });
    index = end;
  }
  return tidy;
}

export interface HxLineHunk {
  /** 1-based line numbers, as unified diffs show them. */
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: { kind: " " | "-" | "+"; text: string }[];
}

/** Unified-diff hunks with `context` equal lines around each change. */
export function hxLineHunks(a: readonly string[], b: readonly string[], context = 3): HxLineHunk[] {
  const edits = hxDiffSequences(a, b);
  const hunks: HxLineHunk[] = [];
  let current: HxLineHunk | null = null;
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (!edit) continue;
    if (edit.kind === "equal") {
      const length = edit.aEnd - edit.aStart;
      if (current) {
        const isLast = !edits.slice(index + 1).some((item) => item.kind !== "equal");
        const keep = isLast || length > context * 2 ? Math.min(context, length) : length;
        for (let k = 0; k < keep; k += 1) current.lines.push({ kind: " ", text: a[edit.aStart + k] ?? "" });
        current.oldLines += keep;
        current.newLines += keep;
        if (keep < length) {
          hunks.push(current);
          current = null;
        }
      }
      continue;
    }
    if (!current) {
      const previous = edits[index - 1];
      const lead = previous?.kind === "equal" ? Math.min(context, previous.aEnd - previous.aStart) : 0;
      current = {
        oldStart: edit.aStart - lead + 1,
        oldLines: lead,
        newStart: edit.bStart - lead + 1,
        newLines: lead,
        lines: [],
      };
      for (let k = lead; k > 0; k -= 1) current.lines.push({ kind: " ", text: a[edit.aStart - k] ?? "" });
    }
    if (edit.kind === "delete") {
      for (let k = edit.aStart; k < edit.aEnd; k += 1) current.lines.push({ kind: "-", text: a[k] ?? "" });
      current.oldLines += edit.aEnd - edit.aStart;
    } else {
      for (let k = edit.bStart; k < edit.bEnd; k += 1) current.lines.push({ kind: "+", text: b[k] ?? "" });
      current.newLines += edit.bEnd - edit.bStart;
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

/** Applies edits to the old sequence: the result must be the new one (for tests and self-checks). */
export function hxApplyEdits<T>(a: readonly T[], b: readonly T[], edits: readonly HxEdit[]): T[] {
  const out: T[] = [];
  for (const edit of edits) {
    const [from, start, end] =
      edit.kind === "equal"
        ? [a, edit.aStart, edit.aEnd]
        : edit.kind === "insert"
          ? [b, edit.bStart, edit.bEnd]
          : [a, 0, 0];
    for (let index = start; index < end; index += 1) {
      const item = from[index];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}
