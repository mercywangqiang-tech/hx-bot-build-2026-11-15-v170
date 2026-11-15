import { describe, expect, it } from "vitest";
import {
  HX_CHECK_GROUPS,
  HX_CHECK_OUTCOMES,
  type HxCheckItem,
  type HxCheckOutcome,
  type HxCheckReport,
  hxCheckCounts,
  hxCheckGroup,
  hxCheckOverview,
  hxCheckSummary,
  hxCheckVerdict,
  hxDecodeCheckReport,
  hxMedian,
} from "./realcheck-report";

function item(id: string, outcome: HxCheckOutcome = "passed", detail = "fine", shot?: string): HxCheckItem {
  return { id, group: hxCheckGroup(id), outcome, detail, ms: 12, ...(shot ? { shot } : {}) };
}

function report(machine: string, platform: "mac" | "windows", more: Partial<HxCheckReport> = {}): HxCheckReport {
  return {
    format: 1,
    machine,
    platform,
    system: platform === "mac" ? "macOS 15.1" : "Windows Server 2025",
    startedAt: 1000,
    finishedAt: 95_400,
    items: [item("env.system"), item("catalog.scan"), item("setting.dark-mode.read")],
    times: { "catalog.scan": 812.4, "setting.read": 96 },
    verified: ["dark-mode"],
    untestable: [],
    ...more,
  };
}

describe("the parts of a report", () => {
  it("takes the group of a check from the part of its id before the first dot", () => {
    expect(hxCheckGroup("setting.dark-mode.read")).toBe("setting");
    expect(hxCheckGroup("page.wifi")).toBe("page");
    expect(hxCheckGroup("platform")).toBe("platform");
    // Every group of the summary is one that a check can have.
    expect(HX_CHECK_GROUPS.map(([group]) => group)).toEqual([
      "env",
      "catalog",
      "search",
      "open",
      "page",
      "setting",
      "gate",
      "tool",
      "probe",
      "final",
    ]);
  });

  it("counts the outcomes", () => {
    const counts = hxCheckCounts([item("a.1"), item("a.2", "failed"), item("a.3", "review"), item("a.4")]);
    expect(counts).toEqual({ passed: 2, failed: 1, review: 1, unavailable: 0, skipped: 0 });
    expect(Object.keys(counts)).toEqual([...HX_CHECK_OUTCOMES]);
    expect(hxCheckCounts([])).toEqual({ passed: 0, failed: 0, review: 0, unavailable: 0, skipped: 0 });
  });

  it("gives the middle of a list of times", () => {
    expect(hxMedian([])).toBe(0);
    expect(hxMedian([7])).toBe(7);
    expect(hxMedian([9, 1, 5])).toBe(5);
    // The lower of the two middle ones: a time that was measured, not one in between.
    expect(hxMedian([10, 2, 8, 4])).toBe(4);
    const times = [3, 1, 2];
    hxMedian(times);
    expect(times).toEqual([3, 1, 2]);
  });
});

describe("hxCheckSummary", () => {
  it("says that everything passed, with the counts of each group, the times and the settings", () => {
    const text = hxCheckSummary(report("macos-15", "mac"));
    expect(text).toContain("## macos-15：全部通过");
    expect(text).toContain("系统：macOS 15.1。用时 94 秒。");
    expect(text).toContain("| 环境 | 1 | 0 | 0 | 0 | 0 |");
    expect(text).toContain("| 读写设置 | 1 | 0 | 0 | 0 | 0 |");
    expect(text).toContain("| **合计** | **3** | **0** | **0** | **0** | **0** |");
    expect(text).not.toContain("| 检索 |");
    expect(text).toContain("| `catalog.scan` | 812 |");
    expect(text).toContain("`dark-mode`");
    expect(text).not.toContain("### 失败");
    expect(text).not.toContain("测不了的设置");
  });

  it("lists what failed, what a person has to look at and what the machine could not test", () => {
    const text = hxCheckSummary(
      report("windows-2022", "windows", {
        items: [
          item("page.speech", "failed", "the window\ndid not | move"),
          item("page.fonts", "review", "Typefaces"),
          item("setting.brightness.read", "unavailable", "no such screen"),
          item("probe.mouse", "unavailable", "no such key"),
          item("setting.x.change", "skipped", "not done"),
        ],
        verified: [],
        untestable: ["brightness"],
        times: {},
      }),
    );
    expect(text).toContain("## windows-2022：有失败");
    expect(text).toContain("### 失败（1 项）");
    // A line break or a bar in a detail must not break the table.
    expect(text).toContain("| `page.speech` | the window did not \\| move |");
    expect(text).toContain("### 待看（1 项）");
    expect(text).toContain("### 测不了（1 项）");
    expect(text).toContain("`setting.brightness.read`");
    // What a probe could not read is in the counts, and not in the list of what needs a real computer.
    expect(text).not.toContain("`probe.mouse`");
    expect(text).toContain("| 为新增设置做的探测 | 0 | 0 | 0 | 1 | 0 |");
    expect(text).toContain("### 这台机器测不了的设置（仍要在真机上自检）");
    expect(text).toContain("没有。");
    expect(text).not.toContain("### 用时");
  });

  it("says when nothing failed and something is left to look at, and cuts what is too long", () => {
    const many = Array.from({ length: 90 }, (_, index) => item(`page.p${index}`, "review", "x".repeat(900)));
    const text = hxCheckSummary(report("macos-26", "mac", { items: many }));
    expect(text).toContain("## macos-26：没有失败，有待看的");
    expect(text).toContain("### 待看（90 项）");
    expect(text).toContain("| … | 还有 10 项，见 report.json |");
    expect(text).toContain(`${"x".repeat(400)}…`);
    expect(text).not.toContain("x".repeat(401));
  });
});

describe("hxDecodeCheckReport", () => {
  it("reads back what was saved", () => {
    const saved = report("macos-15", "mac", { items: [item("page.wifi", "review", "Wi-Fi", "page-wifi.jpg")] });
    expect(hxDecodeCheckReport(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("reads anything that is not a report as nothing, and repairs what is damaged", () => {
    expect(hxDecodeCheckReport(null)).toBeNull();
    expect(hxDecodeCheckReport("report")).toBeNull();
    expect(hxDecodeCheckReport({ format: 2, machine: "m" })).toBeNull();
    expect(hxDecodeCheckReport({ format: 1 })).toBeNull();
    const repaired = hxDecodeCheckReport({
      format: 1,
      machine: "m".repeat(200),
      platform: "linux",
      system: 7,
      startedAt: -5,
      items: [
        { id: "page.a", outcome: "wonderful", detail: 3, ms: "soon" },
        { outcome: "passed" },
        "nothing",
        { id: "page.b", group: "wrong", outcome: "passed", detail: "ok", ms: 4, shot: "" },
      ],
      times: { good: 3, bad: "slow" },
      verified: ["a", 2],
      untestable: "all",
    });
    expect(repaired).toEqual({
      format: 1,
      machine: "m".repeat(80),
      platform: null,
      system: "",
      startedAt: 0,
      finishedAt: 0,
      // An outcome that is not one of the five counts against the run.
      items: [
        { id: "page.a", group: "page", outcome: "failed", detail: "", ms: 0 },
        { id: "page.b", group: "page", outcome: "passed", detail: "ok", ms: 4 },
      ],
      times: { good: 3 },
      verified: ["a"],
      untestable: [],
    });
  });
});

describe("hxCheckVerdict", () => {
  const mac15 = report("macos-15", "mac", {
    items: [item("setting.dark-mode.read"), item("setting.volume.read", "unavailable"), item("setting.mute.read")],
    verified: ["dark-mode", "mute"],
    untestable: ["volume"],
  });
  const mac26 = report("macos-26", "mac", {
    items: [
      item("setting.dark-mode.read"),
      item("setting.volume.read", "unavailable"),
      item("setting.mute.change", "failed"),
    ],
    verified: ["dark-mode"],
    untestable: ["volume"],
  });
  const windows = report("windows-2025", "windows", {
    items: [item("setting.transparency.read"), item("page.fonts", "review")],
    verified: ["transparency"],
  });

  it("is green and clean when every machine answered and nothing failed or is left to look at", () => {
    const verdict = hxCheckVerdict(
      [report("macos-15", "mac"), report("windows-2025", "windows")],
      ["macos-15", "windows-2025"],
    );
    expect(verdict).toEqual({
      green: true,
      clean: true,
      failed: 0,
      review: 0,
      missing: [],
      verified: { mac: ["dark-mode"], windows: ["dark-mode"] },
      untestable: { mac: [], windows: [] },
    });
  });

  it("calls a setting verified only when every machine of the system that could test it passed it", () => {
    const verdict = hxCheckVerdict([mac15, mac26, windows], ["macos-15", "macos-26", "windows-2025"]);
    expect(verdict.green).toBe(false);
    expect(verdict.failed).toBe(1);
    expect(verdict.review).toBe(1);
    // mute passed on one Mac and failed on the other; the volume could be tested on neither.
    expect(verdict.verified).toEqual({ mac: ["dark-mode"], windows: ["transparency"] });
    expect(verdict.untestable).toEqual({ mac: ["volume"], windows: [] });
  });

  it("counts a setting that one machine could test and the other could not by the one that could", () => {
    const withSound = report("macos-15", "mac", { verified: ["dark-mode", "volume"], untestable: [] });
    const without = report("macos-26", "mac", { verified: ["dark-mode"], untestable: ["volume"] });
    expect(hxCheckVerdict([withSound, without], ["macos-15", "macos-26"]).verified.mac).toEqual([
      "dark-mode",
      "volume",
    ]);
  });

  it("is not green when a machine did not answer, when there is no report at all, or when something failed", () => {
    const missing = hxCheckVerdict([report("macos-15", "mac")], ["macos-15", "windows-2025"]);
    expect(missing.green).toBe(false);
    expect(missing.missing).toEqual(["windows-2025"]);
    expect(hxCheckVerdict([], []).green).toBe(false);
    const green = hxCheckVerdict([windows], ["windows-2025"]);
    expect(green.green).toBe(true);
    expect(green.clean).toBe(false);
    expect(hxCheckVerdict([mac26], ["macos-26"]).green).toBe(false);
  });
});

describe("hxCheckOverview", () => {
  it("puts the verdict first, then one column per machine, the settings to mark, and each machine", () => {
    const text = hxCheckOverview(
      [
        report("windows-2025", "windows", {
          items: [item("env.system"), item("page.fonts", "review"), item("setting.brightness.read", "unavailable")],
          verified: ["transparency"],
          untestable: ["brightness"],
        }),
        report("macos-15", "mac"),
      ],
      ["macos-15", "windows-2025"],
    );
    expect(text.startsWith("# HXBot 电脑操控：真系统检查\n\n**结论：没有失败，有 1 项待看。**")).toBe(true);
    expect(text).toContain("| 组 | macos-15 | windows-2025 |");
    expect(text).toContain("| 环境 | 1/1 | 1/1 |");
    expect(text).toContain("| 逐页打开系统设置 | — | 0/1，待看 1 |");
    expect(text).toContain("| 读写设置 | 1/1 | 0/1，测不了 1 |");
    expect(text).toContain("- **macOS：**`dark-mode`");
    expect(text).toContain("- **Windows：**`transparency`");
    expect(text).toContain("没有一台机器测得了，仍要在真机上自检：`brightness`");
    expect(text.indexOf("## macos-15：")).toBeGreaterThan(text.indexOf("## 可以标成“已验证”的设置"));
    expect(text.indexOf("## windows-2025：")).toBeGreaterThan(text.indexOf("## macos-15："));
  });

  it("names what stands in the way: a machine that did not answer comes before a failure", () => {
    const failing = report("macos-15", "mac", { items: [item("page.wifi", "failed")], verified: [] });
    expect(hxCheckOverview([failing], ["macos-15"])).toContain("**结论：有 1 项失败。**");
    expect(hxCheckOverview([failing], ["macos-15"])).toContain("**失败 1**");
    expect(hxCheckOverview([failing], ["macos-15", "macos-26"])).toContain("**结论：有机器没有交回结果：macos-26。**");
    expect(hxCheckOverview([report("macos-15", "mac")], ["macos-15"])).toContain(
      "**结论：全部通过，没有要人看的项。**",
    );
    const empty = hxCheckOverview([], ["macos-15"]);
    expect(empty).toContain("有机器没有交回结果：macos-15");
    expect(empty).toContain("- **macOS：**没有。");
    expect(empty).not.toContain("| 组 |");
  });
});
