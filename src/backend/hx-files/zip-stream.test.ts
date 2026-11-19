import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HxWriteError } from "./safe-write";
import { HxZipError } from "./zip";
import { encoder, rawZip } from "./zip-fixtures";
import {
  HX_ZIP_STREAM_LIMITS,
  hxCheckEntries,
  hxEntriesSize,
  hxUnzipTo,
  hxZipEntries,
  hxZipSources,
  hxZipVerify,
  hxZipWrite,
} from "./zip-stream";

let base = "";
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "hx-zip-stream-"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const text = (value: string) => encoder.encode(value);

async function errorCode(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof HxZipError || error instanceof HxWriteError) return error.code;
    if (error instanceof Error && error.name === "AbortError") return "aborted";
    return `other: ${String(error)}`;
  }
  return "none";
}

/** Every file and folder under `folder`, relative, "/" between parts. */
async function tree(folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string, prefix: string) => {
    for (const child of await readdir(current, { withFileTypes: true })) {
      const name = `${prefix}${child.name}`;
      found.push(child.isDirectory() ? `${name}/` : name);
      if (child.isDirectory()) await walk(join(current, child.name), `${name}/`);
    }
  };
  await walk(folder, "");
  return found.sort();
}

function python(script: string, ...args: string[]): string {
  return execFileSync("python3", ["-I", "-c", script, ...args], { encoding: "utf8" });
}

async function makeProject(): Promise<{ project: string; single: string; files: Record<string, Buffer> }> {
  const project = join(base, "项目");
  await mkdir(join(project, "子目录"), { recursive: true });
  await mkdir(join(project, "空文件夹"));
  const files: Record<string, Buffer> = {
    "项目/a.txt": Buffer.from("hello world\n".repeat(5000)),
    "项目/子目录/空.txt": Buffer.alloc(0),
    "项目/pic.png": randomBytes(10_000),
    "项目/rand.bin": randomBytes(2 * 1024 * 1024),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(base, name), content);
  await symlink("/etc/passwd", join(project, "link-to-passwd"));
  const single = join(base, "单个.txt");
  await writeFile(single, "single file");
  files["单个.txt"] = Buffer.from("single file");
  const old = new Date("2021-03-04T05:06:08Z");
  await utimes(join(project, "a.txt"), old, old);
  return { project, single, files };
}

function noTemp(names: readonly string[]): boolean {
  return names.every((name) => !name.includes(".hx-"));
}

describe("hxZipWrite", () => {
  it("packs folders and files that other tools read back byte for byte", async () => {
    const { project, single, files } = await makeProject();
    const { sources, skipped } = await hxZipSources([project, single]);
    expect(skipped).toEqual([join(project, "link-to-passwd")]);
    expect(sources.map((source) => source.name)).toEqual([
      "项目/",
      "项目/a.txt",
      "项目/pic.png",
      "项目/rand.bin",
      "项目/子目录/",
      "项目/子目录/空.txt",
      "项目/空文件夹/",
      "单个.txt",
    ]);
    const output = join(base, "out.zip");
    const result = await hxZipWrite(sources, output);
    expect(result.entries).toBe(8);
    expect((await stat(output)).size).toBe(result.bytes);
    expect(noTemp(await readdir(base))).toBe(true);
    expect(await hxZipVerify(output)).toMatchObject({ entries: 8, bad: [] });
    // Python's zipfile: CRCs, names, contents, methods.
    const report = JSON.parse(
      python(
        `import zipfile,sys,json,hashlib
z=zipfile.ZipFile(sys.argv[1])
print(json.dumps({"bad":z.testzip(),"items":[[i.filename,i.compress_type,hashlib.sha256(z.read(i)).hexdigest(),i.date_time] for i in z.infolist()]}))`,
        output,
      ),
    );
    expect(report.bad).toBeNull();
    const byName = new Map<string, [string, number, string, number[]]>(
      report.items.map((item: [string, number, string, number[]]) => [item[0], item]),
    );
    for (const [name, content] of Object.entries(files)) {
      expect(byName.get(name)?.[2]).toBe(execFileSync("sha256sum", { input: content, encoding: "utf8" }).split(" ")[0]);
    }
    expect(byName.get("项目/pic.png")?.[1]).toBe(0);
    expect(byName.get("项目/a.txt")?.[1]).toBe(8);
    expect(byName.get("项目/子目录/空.txt")?.[1]).toBe(0);
    if (spawnSync("unzip", ["-v"]).status === 0) {
      expect(spawnSync("unzip", ["-tq", output]).status).toBe(0);
    }
    // And HXBot's own unpacking gives the same tree, contents and times.
    const into = join(base, "into");
    await mkdir(into);
    const unpacked = await hxUnzipTo(output, into);
    expect(unpacked.folders).toBe(3);
    expect(await tree(into)).toEqual([
      "单个.txt",
      "项目/",
      "项目/a.txt",
      "项目/pic.png",
      "项目/rand.bin",
      "项目/子目录/",
      "项目/子目录/空.txt",
      "项目/空文件夹/",
    ]);
    for (const [name, content] of Object.entries(files)) expect(await readFile(join(into, name))).toEqual(content);
    expect((await stat(join(into, "项目/a.txt"))).mtime.toISOString()).toBe("2021-03-04T05:06:08.000Z");
  });

  it("stores names in NFC, the form Windows and Linux expect from a Mac", async () => {
    const decomposed = "Cafe\u0301.txt";
    await writeFile(join(base, decomposed), "x");
    const { sources } = await hxZipSources([join(base, decomposed)]);
    expect(sources[0]?.name).toBe("Café.txt");
  });

  it("never replaces an existing archive and leaves no temporary file", async () => {
    await writeFile(join(base, "a.txt"), "a");
    await writeFile(join(base, "out.zip"), "keep me");
    const { sources } = await hxZipSources([join(base, "a.txt")]);
    expect(await errorCode(hxZipWrite(sources, join(base, "out.zip")))).toBe("changed");
    expect(await readFile(join(base, "out.zip"), "utf8")).toBe("keep me");
    expect(noTemp(await readdir(base))).toBe(true);
  });

  it("refuses names that Windows cannot hold, and duplicate names", async () => {
    for (const name of ["a:b.txt", "trailing.", "con.txt", "what?.txt"]) {
      await writeFile(join(base, name), "x");
      expect(await errorCode(hxZipSources([join(base, name)]))).toBe("unsupported");
    }
    await mkdir(join(base, "one"));
    await mkdir(join(base, "two"));
    await writeFile(join(base, "one", "report.txt"), "1");
    await writeFile(join(base, "two", "report.txt"), "2");
    expect(await errorCode(hxZipSources([join(base, "one", "report.txt"), join(base, "two", "report.txt")]))).toBe(
      "duplicate-name",
    );
  });

  it("stops on cancel, also in the middle of a file, and removes its temporary file", async () => {
    await writeFile(join(base, "a.txt"), "a");
    const { sources } = await hxZipSources([join(base, "a.txt")]);
    const before = new AbortController();
    before.abort();
    expect(await errorCode(hxZipWrite(sources, join(base, "x.zip"), { signal: before.signal }))).toBe("aborted");
    expect(await readdir(base)).toEqual(["a.txt"]);
    // A pipe that never ends: the write waits on it until the cancel.
    const fifo = join(base, "pipe");
    if (spawnSync("mkfifo", [fifo]).status !== 0) return;
    const middle = new AbortController();
    const work = hxZipWrite(
      [{ path: fifo, name: "pipe.txt", directory: false, size: 1, mtime: new Date(), mode: 0o644 }],
      join(base, "y.zip"),
      { signal: middle.signal },
    );
    const writer = await open(fifo, "w");
    await writer.write(Buffer.alloc(1024 * 1024, 65));
    middle.abort();
    expect(await errorCode(work)).toBe("aborted");
    await writer.close();
    expect((await readdir(base)).sort()).toEqual(["a.txt", "pipe"]);
  });

  it("fails cleanly when a file disappears before it is packed", async () => {
    await writeFile(join(base, "a.txt"), "a");
    await writeFile(join(base, "b.txt"), "b");
    const { sources } = await hxZipSources([join(base, "a.txt"), join(base, "b.txt")]);
    await unlink(join(base, "b.txt"));
    expect(await errorCode(hxZipWrite(sources, join(base, "x.zip")))).toBe("missing");
    expect(await readdir(base)).toEqual(["a.txt"]);
  });

  it("writes ZIP64 end records past 65535 entries", async () => {
    await writeFile(join(base, "empty"), "");
    const count = 70_000;
    const sources = Array.from({ length: count }, (_, index) => ({
      path: join(base, "empty"),
      name: `f/${index}.txt`,
      directory: false,
      size: 0,
      mtime: new Date(),
      mode: 0o644,
    }));
    const output = join(base, "many.zip");
    await hxZipWrite(sources, output);
    expect(
      python("import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(len(z.namelist()), z.testzip())", output).trim(),
    ).toBe(`${count} None`);
    const handle = await open(output, "r");
    const directory = await hxZipEntries(handle);
    await handle.close();
    expect(directory.entries.length).toBe(count);
    expect(directory.entries.at(-1)?.name).toBe(`f/${count - 1}.txt`);
  }, 120_000);

  it.runIf(process.env.HX_ZIP_SLOW === "1")(
    "packs a file larger than 4 GiB with ZIP64 sizes",
    async () => {
      const big = join(base, "big.bin");
      await writeFile(big, "");
      await truncate(big, 4.5 * 1024 * 1024 * 1024);
      const output = join(base, "big.zip");
      const { sources } = await hxZipSources([big]);
      await hxZipWrite(sources, output, { level: 1 });
      const report = python(
        "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);i=z.infolist()[0];print(i.file_size, i.CRC)",
        output,
      ).trim();
      expect(report.split(" ")[0]).toBe(String(4.5 * 1024 * 1024 * 1024));
      expect((await hxZipVerify(output)).bad).toEqual([]);
    },
    600_000,
  );
});

async function archive(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(base, name);
  await writeFile(path, bytes);
  return path;
}

async function emptyRoot(): Promise<string> {
  const root = join(base, "root");
  await mkdir(root, { recursive: true });
  return root;
}

describe("hxUnzipTo", () => {
  it("refuses unsafe paths, encryption, unknown methods and wrong sizes before writing anything", async () => {
    const cases: [string, Parameters<typeof rawZip>[0], string][] = [
      [
        "parent",
        [
          { name: "ok.txt", content: text("1") },
          { name: "../evil.txt", content: text("x") },
        ],
        "unsupported",
      ],
      ["absolute", [{ name: "/etc/evil", content: text("x") }], "unsupported"],
      ["drive", [{ name: "C:/evil.txt", content: text("x") }], "unsupported"],
      ["backslash", [{ name: "a\\..\\..\\evil.txt", content: text("x") }], "unsupported"],
      ["reserved", [{ name: "docs/con.txt", content: text("x") }], "unsupported"],
      ["control", [{ name: "a\u0001b.txt", content: text("x") }], "unsupported"],
      ["encrypted", [{ name: "s.txt", content: text("x"), flags: 1, method: 0 }], "encrypted"],
      ["strong", [{ name: "s.txt", content: text("x"), flags: 0x40, method: 0 }], "encrypted"],
      ["bzip2", [{ name: "s.txt", content: text("x"), method: 12 }], "unsupported"],
      ["stored-size", [{ name: "s.txt", content: text("abc"), method: 0, statedSize: 5 }], "corrupt"],
      [
        "twice",
        [
          { name: "a.txt", content: text("1") },
          { name: "a.txt", content: text("2") },
        ],
        "duplicate-name",
      ],
      [
        "file-and-folder",
        [
          { name: "a", content: text("1") },
          { name: "a/b.txt", content: text("2") },
        ],
        "corrupt",
      ],
      ["bomb", [{ name: "bomb.bin", content: text("x"), statedSize: 200 * 1024 * 1024 }], "too-large"],
    ];
    for (const [label, entries, expected] of cases) {
      const root = await emptyRoot();
      const path = await archive(`${label}.zip`, rawZip(entries));
      expect(`${label}: ${await errorCode(hxUnzipTo(path, root))}`).toBe(`${label}: ${expected}`);
      expect(await readdir(root)).toEqual([]);
    }
  });

  it("refuses entries that share their data (a bomb that does not nest)", async () => {
    const root = await emptyRoot();
    const entries = Array.from({ length: 5 }, (_, index) => ({ name: `f${index}`, content: new Uint8Array(10_000) }));
    const path = await archive("overlap.zip", rawZip(entries, { overlap: true }));
    expect(await errorCode(hxUnzipTo(path, root))).toBe("corrupt");
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses archives over the entry and size limits", async () => {
    const saved = { ...HX_ZIP_STREAM_LIMITS };
    try {
      HX_ZIP_STREAM_LIMITS.maxEntries = 5;
      const many = await archive(
        "many.zip",
        rawZip(Array.from({ length: 6 }, (_, index) => ({ name: `f${index}`, content: text("x") }))),
      );
      expect(await errorCode(hxUnzipTo(many, await emptyRoot()))).toBe("too-large");
      HX_ZIP_STREAM_LIMITS.maxEntries = saved.maxEntries;
      HX_ZIP_STREAM_LIMITS.maxTotalBytes = 100;
      const big = await archive(
        "big.zip",
        rawZip([
          { name: "a", content: new Uint8Array(60) },
          { name: "b", content: new Uint8Array(60) },
        ]),
      );
      expect(await errorCode(hxUnzipTo(big, await emptyRoot()))).toBe("too-large");
    } finally {
      Object.assign(HX_ZIP_STREAM_LIMITS, saved);
    }
  });

  it("refuses files that are not single zip archives", async () => {
    const root = await emptyRoot();
    expect(await errorCode(hxUnzipTo(await archive("empty.zip", new Uint8Array(0)), root))).toBe("not-zip");
    expect(await errorCode(hxUnzipTo(await archive("noise.zip", randomBytes(5000)), root))).toBe("not-zip");
    const good = rawZip([{ name: "a.txt", content: text("hello") }]);
    expect(await errorCode(hxUnzipTo(await archive("cut.zip", good.subarray(0, good.length - 10)), root))).toBe(
      "not-zip",
    );
    const split = Buffer.from(good);
    split.writeUInt16LE(1, split.length - 22 + 4);
    expect(await errorCode(hxUnzipTo(await archive("split.zip", split), root))).toBe("unsupported");
    expect(await readdir(root)).toEqual([]);
  });

  it("finds the real end record when the comment contains its signature", async () => {
    const root = await emptyRoot();
    const path = await archive(
      "comment.zip",
      rawZip([{ name: "a.txt", content: text("hello") }], { comment: "PK\u0005\u0006 not an end record" }),
    );
    await hxUnzipTo(path, root);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("hello");
  });

  it("never overwrites and never unpacks through a link or a file in the way", async () => {
    const root = await emptyRoot();
    await writeFile(join(root, "a.txt"), "mine");
    const path = await archive(
      "x.zip",
      rawZip([
        { name: "b.txt", content: text("b") },
        { name: "a.txt", content: text("theirs") },
      ]),
    );
    expect(await errorCode(hxUnzipTo(path, root))).toBe("duplicate-name");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("mine");
    expect(await readdir(root)).toEqual(["a.txt"]);
    const outside = join(base, "outside");
    await mkdir(outside);
    await symlink(outside, join(root, "sub"));
    const through = await archive("through.zip", rawZip([{ name: "sub/x.txt", content: text("x") }]));
    expect(await errorCode(hxUnzipTo(through, root))).toBe("duplicate-name");
    expect(await readdir(outside)).toEqual([]);
    await writeFile(join(root, "file"), "f");
    const fileWay = await archive("fileway.zip", rawZip([{ name: "file/x.txt", content: text("x") }]));
    expect(await errorCode(hxUnzipTo(fileWay, root))).toBe("duplicate-name");
  });

  it("skips link entries instead of creating them", async () => {
    const root = await emptyRoot();
    const path = await archive(
      "link.zip",
      rawZip([
        {
          name: "evil",
          content: text("/etc/passwd"),
          method: 0,
          versionMadeBy: (3 << 8) | 20,
          externalAttrs: (0o120777 << 16) >>> 0,
        },
        { name: "ok.txt", content: text("ok") },
      ]),
    );
    const result = await hxUnzipTo(path, root);
    expect(result.skippedLinks).toBe(1);
    expect(await readdir(root)).toEqual(["ok.txt"]);
  });

  it("stops at a damaged entry or one that unpacks larger than stated, leaving no temporary file", async () => {
    const good = Buffer.from(
      rawZip([
        { name: "a.txt", content: text("first") },
        { name: "b.txt", content: text("second entry"), method: 0 },
      ]),
    );
    const at = good.indexOf("second entry");
    good[at] = good[at] === 0x73 ? 0x53 : 0x73;
    const root = await emptyRoot();
    await mkdir(join(root, "kept"));
    await writeFile(join(root, "kept", "mine.txt"), "mine");
    const damaged = Buffer.concat([
      Buffer.from(
        rawZip([
          { name: "new/a.txt", content: text("first") },
          { name: "kept/b.txt", content: text("second entry"), method: 0 },
        ]),
      ),
    ]);
    const second = damaged.indexOf("second entry");
    damaged[second] = 0x53;
    // What the call made goes again; what was there stays.
    expect(await errorCode(hxUnzipTo(await archive("crc.zip", damaged), root))).toBe("corrupt");
    expect(await tree(root)).toEqual(["kept/", "kept/mine.txt"]);
    expect(await errorCode(hxUnzipTo(await archive("crc2.zip", good), root))).toBe("corrupt");
    expect(await tree(root)).toEqual(["kept/", "kept/mine.txt"]);
    const lie = await archive("lie.zip", rawZip([{ name: "lie.txt", content: new Uint8Array(1000), statedSize: 10 }]));
    const other = join(base, "other");
    await mkdir(other);
    expect(await errorCode(hxUnzipTo(lie, other))).toBe("too-large");
    expect(await readdir(other)).toEqual([]);
  });

  it("reads ZIP64 records, data descriptors and Windows separators", async () => {
    const root = await emptyRoot();
    const path = await archive(
      "mixed.zip",
      rawZip([
        { name: "z64.txt", content: text("zip64 entry"), zip64: true },
        { name: "desc.txt", content: text("described"), descriptor: true },
        { name: "dir\\win.txt", content: text("windows") },
      ]),
    );
    await hxUnzipTo(path, root);
    expect(await readFile(join(root, "z64.txt"), "utf8")).toBe("zip64 entry");
    expect(await readFile(join(root, "desc.txt"), "utf8")).toBe("described");
    expect(await readFile(join(root, "dir", "win.txt"), "utf8")).toBe("windows");
    expect((await lstat(join(root, "dir"))).isDirectory()).toBe(true);
  });

  it("stops on cancel before it writes", async () => {
    const root = await emptyRoot();
    const path = await archive("a.zip", rawZip([{ name: "a.txt", content: text("a") }]));
    const controller = new AbortController();
    controller.abort();
    expect(await errorCode(hxUnzipTo(path, root, { signal: controller.signal }))).toBe("aborted");
    expect(await readdir(root)).toEqual([]);
  });

  it("states the unpacked size for the free-space check", async () => {
    const path = await archive(
      "s.zip",
      rawZip([
        { name: "a", content: new Uint8Array(300) },
        { name: "d/", content: new Uint8Array(0) },
        { name: "d/b", content: new Uint8Array(200) },
      ]),
    );
    const handle = await open(path, "r");
    const directory = await hxZipEntries(handle);
    await handle.close();
    hxCheckEntries(directory);
    expect(hxEntriesSize(directory)).toBe(500);
  });
});
