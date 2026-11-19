import { describe, expect, it } from "vitest";
import { hxOrphanedLocalServers, hxParsePs, hxParseWindowsRows } from "./hx-local-servers";

const MAC_EXE = "/Applications/HXBot.app/Contents/MacOS/HXBot";
const MAC_ROOT = "/Users/ana/Library/Application Support/HXBot/local-servers";

describe("hxOrphanedLocalServers (macOS)", () => {
  const rows = hxParsePs(
    [
      `  500     1 ${MAC_EXE}`,
      `  501   500 ${MAC_EXE} --user-data-dir=${MAC_ROOT}/a1`,
      `  502     1 ${MAC_EXE} --user-data-dir=${MAC_ROOT}/b2`,
      `  503   999 ${MAC_EXE} --user-data-dir=${MAC_ROOT}/c3`,
      `  504     1 /Applications/HXBot.app/Contents/Frameworks/HXBot Helper.app/Contents/MacOS/HXBot Helper --type=gpu`,
      `  505     1 ${MAC_EXE} --user-data-dir=/Users/ben/Library/Application Support/HXBot/local-servers/d4`,
      `  506     1 /Users/ana/Downloads/HXBot.app/Contents/MacOS/HXBot --user-data-dir=${MAC_ROOT}/e5`,
      `  507     1 /usr/bin/python3 ${MAC_EXE} --user-data-dir=${MAC_ROOT}/f6`,
    ].join("\n"),
  );
  const query = {
    executable: MAC_EXE,
    localServersRoot: MAC_ROOT,
    ownPid: 500,
    platform: "darwin" as const,
    alive: (pid: number) => pid === 500,
  };

  it("reads ps output", () => {
    expect(rows).toHaveLength(8);
    expect(rows[1]).toEqual({ pid: 501, ppid: 500, command: `${MAC_EXE} --user-data-dir=${MAC_ROOT}/a1` });
  });

  it("finds only the servers of this HXBot and this user whose desktop app is gone", () => {
    // 501 has a running parent (this app); 504 is a helper; 505 is another user's; 506 is another copy
    // of HXBot; 507 only names the executable in its arguments.
    expect(hxOrphanedLocalServers(rows, query)).toEqual([502, 503]);
  });

  it("never names this process", () => {
    expect(hxOrphanedLocalServers(rows, { ...query, ownPid: 502 })).toEqual([503]);
  });
});

describe("hxOrphanedLocalServers (Windows)", () => {
  const exe = "C:\\Users\\Ana Li\\AppData\\Local\\Programs\\HXBot\\HXBot.exe";
  const root = "C:\\Users\\Ana Li\\AppData\\Roaming\\HXBot\\local-servers";
  const rows = hxParseWindowsRows(
    [
      `7000\t6000\t"${exe}" `,
      `7001\t7000\t"${exe}" "--user-data-dir=${root}\\a1"`,
      `7002\t4321\t"${exe}" "--user-data-dir=${root}\\b2"`,
      `7003\t4321\t"${exe.toLowerCase()}" --user-data-dir=${root.toLowerCase()}\\c3`,
      `7004\t4321\t"${exe}" --type=renderer --user-data-dir=C:\\Users\\Ana Li\\AppData\\Roaming\\HXBot`,
      "not a row",
    ].join("\r\n"),
  );

  it("reads the PowerShell rows", () => {
    expect(rows.map((row) => row.pid)).toEqual([7000, 7001, 7002, 7003, 7004]);
  });

  it("compares paths without case and finds the servers whose parent is gone", () => {
    expect(
      hxOrphanedLocalServers(rows, {
        executable: exe,
        localServersRoot: root,
        ownPid: 7000,
        platform: "win32",
        alive: (pid) => pid === 7000 || pid === 6000,
      }),
    ).toEqual([7002, 7003]);
  });
});
