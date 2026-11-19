import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HxWriteError } from "./safe-write";
import { HX_VERSION_CAP_BYTES, HxFileVersions, type HxVersionEventType, hxTaskFolder } from "./versions";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const folders: string[] = [];

async function setup(options: { disk?: { free: number; total: number } } = {}) {
  const base = await mkdtemp(join(tmpdir(), "hx-versions-"));
  folders.push(base);
  const root = join(base, "data", "file-versions");
  const work = join(base, "work");
  await mkdir(work, { recursive: true });
  const disk = options.disk;
  const versions = new HxFileVersions({
    root: () => root,
    ...(disk ? { disk: async () => disk } : {}),
  });
  return { base, root, work, versions };
}

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** The change that a tool makes: read, keep a version, write, all under the file's lock. */
async function change(versions: HxFileVersions, path: string, task: string, edit: (text: string) => string) {
  return versions.withFile(path, async () => {
    const before = await readFile(path);
    const saved = await versions.save({ path, task, agent: "A", tool: "test", expectSha256: sha(before) });
    if (saved.status !== "saved") return saved;
    await versions.write({
      path,
      task,
      content: new TextEncoder().encode(edit(before.toString("utf8"))),
      expectSha256: sha(before),
      versionId: saved.record.id,
    });
    return saved;
  });
}

describe("HxFileVersions", () => {
  it("keeps a version, writes, and restores to the same hash, with every event in order (TC-BAK-03-01)", async () => {
    const { versions, work } = await setup();
    const file = join(work, "report.txt");
    await writeFile(file, "甲 first content\n");
    const first = sha(await readFile(file));
    const saved = await change(versions, file, "thread-1", () => "乙 second content\n");
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;
    expect(saved.record.sha256).toBe(first);
    expect(sha(await readFile(file))).toBe(sha("乙 second content\n"));
    const restored = await versions.restore({ task: "thread-1", versionId: saved.record.id, agent: "user" });
    expect(restored.status).toBe("restored");
    expect(sha(await readFile(file))).toBe(first);
    if (restored.status !== "restored") return;
    // The content from before the restore is kept too, so the restore can be undone.
    expect(restored.keptVersion?.sha256).toBe(sha("乙 second content\n"));
    expect(restored.previousSha256).toBe(sha("乙 second content\n"));
    const events = await versions.events("thread-1");
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    const types: HxVersionEventType[] = [
      "version-saved",
      "write-started",
      "file-written",
      "version-saved",
      "write-started",
      "file-written",
      "restored",
    ];
    expect(events.map((event) => event.type)).toEqual(types);
    expect(events[2]?.previousSha256).toBe(first);
    expect(events[6]?.sha256).toBe(first);
    expect(new Set([events[0]?.sha256, events[3]?.sha256]).size).toBe(2);
  });

  it("answers space-full at the limit and deletes no old version", async () => {
    const { versions, work, root } = await setup();
    const file = join(work, "a.txt");
    await writeFile(file, "x".repeat(400));
    expect((await change(versions, file, "t", (text) => `${text}1`)).status).toBe("saved");
    const before = await readdir(join(root, hxTaskFolder("t")));
    await versions.setCap(100);
    const result = await change(versions, file, "t", (text) => `${text}2`);
    expect(result).toMatchObject({ status: "space-full", why: "cap", capBytes: 100 });
    // Nothing changed: not the file, not the versions.
    expect((await readFile(file, "utf8")).endsWith("1")).toBe(true);
    expect((await readdir(join(root, hxTaskFolder("t")))).filter((name) => !name.startsWith("events"))).toEqual(
      before.filter((name) => !name.startsWith("events")),
    );
    expect((await versions.list("t")).every((record) => record.state === "saved")).toBe(true);
  });

  it("answers space-full when the disk itself is nearly full", async () => {
    const { versions, work } = await setup({ disk: { free: 10 * 1024 * 1024, total: 1e12 } });
    const file = join(work, "a.txt");
    await writeFile(file, "content");
    expect(await versions.save({ path: file, task: "t", agent: "A", tool: "x" })).toMatchObject({
      status: "space-full",
      why: "disk",
    });
  });

  it("answers space-full when the disk fills during the copy, and leaves no partial file", async () => {
    const base = await mkdtemp(join(tmpdir(), "hx-versions-"));
    folders.push(base);
    const root = join(base, "v");
    let chunks = 0;
    const versions = new HxFileVersions({
      root: () => root,
      faults: {
        onChunk: () => {
          chunks += 1;
          if (chunks === 2) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        },
      },
    });
    const file = join(base, "big.bin");
    await writeFile(file, Buffer.alloc(3 * 1024 * 1024, 7));
    expect(await versions.save({ path: file, task: "t", agent: "A", tool: "x" })).toMatchObject({
      status: "space-full",
      why: "disk",
    });
    const names = await readdir(join(root, hxTaskFolder("t")));
    expect(names.some((name) => name.startsWith(".tmp-") || name.endsWith(".blob"))).toBe(false);
    expect((await versions.list("t")).map((record) => record.state)).toEqual(["failed"]);
  });

  it("uses the smaller of 2 GiB and 5% of the disk, and a limit set in Settings", async () => {
    const small = await setup({ disk: { free: 1e12, total: 10 * 1024 * 1024 * 1024 } });
    expect((await small.versions.settings()).capBytes).toBe(Math.floor(10 * 1024 * 1024 * 1024 * 0.05));
    const large = await setup({ disk: { free: 1e13, total: 1e13 } });
    expect((await large.versions.settings()).capBytes).toBe(HX_VERSION_CAP_BYTES);
    expect(await large.versions.setCap(5_000_000)).toMatchObject({ capBytes: 5_000_000, custom: true });
    expect(await large.versions.setCap(null)).toMatchObject({ capBytes: HX_VERSION_CAP_BYTES, custom: false });
    await expect(large.versions.setCap(-1)).rejects.toThrow();
  });

  it("stops when the file changed after it was read", async () => {
    const { versions, work } = await setup();
    const file = join(work, "a.txt");
    await writeFile(file, "one");
    expect(await versions.save({ path: file, task: "t", agent: "A", tool: "x", expectSha256: sha("other") })).toEqual({
      status: "changed",
    });
    const write = versions.write({
      path: file,
      task: "t",
      content: new Uint8Array([1]),
      expectSha256: sha("other"),
      versionId: null,
    });
    await expect(write).rejects.toMatchObject({ code: "changed" });
    expect(await readFile(file, "utf8")).toBe("one");
  });

  it("keeps one copy of the same content", async () => {
    const { versions, work, root } = await setup();
    const file = join(work, "a.txt");
    await writeFile(file, "same");
    await versions.save({ path: file, task: "t", agent: "A", tool: "x" });
    await versions.save({ path: file, task: "t", agent: "A", tool: "x" });
    const names = await readdir(join(root, hxTaskFolder("t")));
    expect(names.filter((name) => name.endsWith(".blob"))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith(".json"))).toHaveLength(2);
  });

  it("restores a file that was deleted, refuses a damaged copy, and asks when the space is full", async () => {
    const { versions, work, root } = await setup();
    const file = join(work, "a.txt");
    await writeFile(file, "original");
    const saved = await change(versions, file, "t", () => "changed");
    if (saved.status !== "saved") throw new Error("setup");
    await rm(file);
    expect((await versions.restore({ task: "t", versionId: saved.record.id, agent: "u" })).status).toBe("restored");
    expect(await readFile(file, "utf8")).toBe("original");
    // Same content again: nothing to do.
    expect((await versions.restore({ task: "t", versionId: saved.record.id, agent: "u" })).status).toBe("unchanged");
    await writeFile(file, "later");
    await versions.setCap(1);
    expect((await versions.restore({ task: "t", versionId: saved.record.id, agent: "u" })).status).toBe("space-full");
    expect(await readFile(file, "utf8")).toBe("later");
    expect(
      (await versions.restore({ task: "t", versionId: saved.record.id, agent: "u", keepCurrent: false })).status,
    ).toBe("restored");
    expect(await readFile(file, "utf8")).toBe("original");
    await writeFile(join(root, hxTaskFolder("t"), `${saved.record.sha256}.blob`), "tampered");
    expect((await versions.restore({ task: "t", versionId: saved.record.id, agent: "u" })).status).toBe("damaged");
    expect((await versions.restore({ task: "t", versionId: "v0000000000", agent: "u" })).status).toBe("missing");
    expect((await versions.restore({ task: "t", versionId: "../../x", agent: "u" })).status).toBe("missing");
  });

  it("serializes many changes of one file: none is lost, each kept its own version", async () => {
    const { versions, work } = await setup();
    const file = join(work, "count.txt");
    await writeFile(file, "0");
    const results = await Promise.all(
      Array.from({ length: 25 }, () => change(versions, file, "t", (text) => String(Number(text) + 1))),
    );
    expect(results.every((result) => result.status === "saved")).toBe(true);
    expect(await readFile(file, "utf8")).toBe("25");
    const kept = (await versions.list("t")).map((record) => record.sha256);
    expect(new Set(kept).size).toBe(25);
  });

  it("writes a file with hard links in place, and a symbolic link through to its target", async () => {
    const { versions, work } = await setup();
    const file = join(work, "a.txt");
    const other = join(work, "b.txt");
    await writeFile(file, "one");
    await chmod(file, 0o640);
    await link(file, other);
    const result = await versions.write({
      path: file,
      task: "t",
      content: new TextEncoder().encode("two"),
      expectSha256: sha("one"),
      versionId: null,
    });
    expect(result.how).toBe("in-place");
    expect(await readFile(other, "utf8")).toBe("two");
    const target = join(work, "target.txt");
    const pointer = join(work, "pointer.txt");
    await writeFile(target, "x");
    await chmod(target, 0o600);
    await symlink(target, pointer);
    await versions.write({
      path: pointer,
      task: "t",
      content: new TextEncoder().encode("y"),
      expectSha256: sha("x"),
      versionId: null,
    });
    expect(await readFile(target, "utf8")).toBe("y");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    const { lstat } = await import("node:fs/promises");
    expect((await lstat(pointer)).isSymbolicLink()).toBe(true);
  });

  it("refuses a folder and a missing file as plain answers", async () => {
    const { versions, work } = await setup();
    expect((await versions.save({ path: work, task: "t", agent: "A", tool: "x" })).status).toBe("failed");
    expect((await versions.save({ path: join(work, "none"), task: "t", agent: "A", tool: "x" })).status).toBe("failed");
    await expect(
      versions.write({
        path: join(work, "none"),
        task: "t",
        content: new Uint8Array(1),
        expectSha256: "x",
        versionId: null,
      }),
    ).rejects.toBeInstanceOf(HxWriteError);
  });

  it("deletes only what the user asks to delete, and lists tasks with their sizes", async () => {
    const { versions, work } = await setup();
    const file = join(work, "a.txt");
    await writeFile(file, "a");
    await change(versions, file, "keep", () => "b");
    await change(versions, file, "drop", () => "c");
    expect((await versions.tasks()).map((task) => task.task).sort()).toEqual(["drop", "keep"]);
    await versions.setCap(0);
    expect((await versions.list("keep")).length).toBe(1);
    await versions.deleteTask("drop");
    expect((await versions.tasks()).map((task) => task.task)).toEqual(["keep"]);
  });

  it("reads past a record or an event line that a crash damaged", async () => {
    const { versions, work, root } = await setup();
    const file = join(work, "a.txt");
    await writeFile(file, "a");
    await change(versions, file, "t", () => "b");
    const folder = join(root, hxTaskFolder("t"));
    await writeFile(join(folder, "vbroken00000.json"), '{"version":1,"id":');
    await writeFile(
      join(folder, "events.jsonl"),
      `${await readFile(join(folder, "events.jsonl"), "utf8")}{"seq":99,"ty`,
    );
    expect((await versions.list("t")).length).toBe(1);
    const next = await versions.event("t", { type: "no-version", path: file });
    expect(next.seq).toBe(4);
  });

  it("gives tasks with any id a safe folder name", () => {
    expect(hxTaskFolder("thread_123-abc")).toBe("thread_123-abc");
    expect(hxTaskFolder("../../etc")).toMatch(/^etc-[0-9a-f]{12}$/);
    expect(hxTaskFolder("中文")).toMatch(/^task-[0-9a-f]{12}$/);
    expect(hxTaskFolder("a".repeat(100))).toMatch(/^a{60}-[0-9a-f]{12}$/);
  });
});

const ROOT = process.cwd();

/** A child process that changes `file` under the given fault, and says when it reached it. */
function child(script: string): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function waitFor(process: ChildProcess, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let seen = "";
    process.stdout?.on("data", (chunk: Buffer) => {
      seen += chunk.toString();
      if (seen.includes(text)) resolve();
    });
    process.on("exit", () => (seen.includes(text) ? resolve() : reject(new Error(`exited before ${text}: ${seen}`))));
  });
}

function exited(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) resolve();
    else process.on("exit", () => resolve());
  });
}

const MODULE = JSON.stringify(join(ROOT, "src/backend/hx-files/versions.ts"));

describe("HxFileVersions across processes", () => {
  // The file is 9 MiB: the copy into the versions takes chunks 1 to 9 (1 MiB each), the new file 10 to 12 (4 MiB).
  it.each(["afterRecord", "copy:2", "beforeSaved", "temp:11", "beforeReplace", "afterReplace"])(
    "keeps the file whole and recovers after kill -9 at %s",
    async (point) => {
      const { root, work, versions } = await setup();
      const file = join(work, "doc.bin");
      const before = Buffer.alloc(9 * 1024 * 1024, 1);
      const after = Buffer.alloc(9 * 1024 * 1024 + 7, 2);
      await writeFile(file, before);
      const chunk = point.includes(":") ? Number(point.split(":")[1]) : 0;
      const fault = chunk
        ? `onChunk: () => { chunks += 1; if (chunks === ${chunk}) { process.stdout.write("AT"); return new Promise(() => {}); } }`
        : `${point}: () => { process.stdout.write("AT"); return new Promise(() => {}); }`;
      const script = `
        import { createHash } from "node:crypto";
        import { readFile } from "node:fs/promises";
        const { HxFileVersions } = await import(${MODULE});
        let chunks = 0;
        const versions = new HxFileVersions({ root: () => ${JSON.stringify(root)}, faults: { ${fault} } });
        const file = ${JSON.stringify(file)};
        const bytes = await readFile(file);
        const hash = createHash("sha256").update(bytes).digest("hex");
        const saved = await versions.save({ path: file, task: "t", agent: "A", tool: "x", expectSha256: hash });
        await versions.write({ path: file, task: "t", content: Buffer.alloc(${after.length}, 2), expectSha256: hash, versionId: saved.record.id });
        process.stdout.write("DONE");
      `;
      const process_ = child(script);
      await waitFor(process_, "AT");
      process_.kill("SIGKILL");
      await exited(process_);
      const now = sha(await readFile(file));
      expect([sha(before), sha(after)]).toContain(now);
      await versions.recover();
      expect((await readdir(work)).filter((name) => name.includes(".hx-"))).toEqual([]);
      const records = await versions.list("t");
      expect(records.every((record) => record.state !== "saving")).toBe(true);
      const names = await readdir(join(root, hxTaskFolder("t")));
      expect(names.some((name) => name.startsWith(".tmp-"))).toBe(false);
      for (const record of records.filter((item) => item.state === "saved")) {
        expect(sha(await readFile(join(root, hxTaskFolder("t"), `${record.sha256}.blob`)))).toBe(record.sha256);
      }
      const events = await versions.events("t");
      if (point === "afterReplace") {
        expect(now).toBe(sha(after));
        expect(events.at(-1)).toMatchObject({ type: "file-written", detail: "recovered" });
        const saved = records.find((record) => record.state === "saved");
        if (!saved) throw new Error("no saved version");
        expect((await versions.restore({ task: "t", versionId: saved.id, agent: "u" })).status).toBe("restored");
        expect(sha(await readFile(file))).toBe(sha(before));
      } else {
        expect(now).toBe(sha(before));
      }
    },
    30_000,
  );

  it("lets two processes change one file one after the other", async () => {
    const { root, work } = await setup();
    const file = join(work, "count.txt");
    await writeFile(file, "0");
    const script = `
      import { createHash } from "node:crypto";
      import { readFile } from "node:fs/promises";
      const { HxFileVersions } = await import(${MODULE});
      const versions = new HxFileVersions({ root: () => ${JSON.stringify(root)} });
      const file = ${JSON.stringify(file)};
      for (let index = 0; index < 15; index += 1) {
        await versions.withFile(file, async () => {
          const bytes = await readFile(file);
          const hash = createHash("sha256").update(bytes).digest("hex");
          const saved = await versions.save({ path: file, task: "t" + process.pid, agent: "A", tool: "x", expectSha256: hash });
          await versions.write({ path: file, task: "t" + process.pid, content: Buffer.from(String(Number(bytes.toString()) + 1)), expectSha256: hash, versionId: saved.record.id });
        });
      }
      process.stdout.write("DONE");
    `;
    const first = child(script);
    const second = child(script);
    await Promise.all([waitFor(first, "DONE"), waitFor(second, "DONE")]);
    expect(await readFile(file, "utf8")).toBe("30");
  }, 60_000);
});
