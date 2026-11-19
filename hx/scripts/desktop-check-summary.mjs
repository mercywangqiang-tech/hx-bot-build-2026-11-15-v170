#!/usr/bin/env node
// HXBot v1.7.2：把 scripts/hx-desktop-check.mjs 写出的 earlier.json、new.json 合成一张表（写进 GitHub 运行页面的摘要）。
//   node hx/scripts/desktop-check-summary.mjs <文件夹>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const folder = process.argv[2] ?? "out";
const rows = [];
for (const name of ["earlier", "new"]) {
  const path = join(folder, `${name}.json`);
  if (!existsSync(path)) continue;
  const report = JSON.parse(readFileSync(path, "utf8"));
  const place = report.platform === "darwin" ? "Dock" : "taskbar";
  const servers = report.servers ? `${report.servers.max} of ${report.servers.servers.length}` : "no result";
  const ready = report.servers
    ? report.servers.servers
        .map((server) => (server.readyMs === null ? "-" : `${Math.round(server.readyMs / 100) / 10}s`))
        .join(", ")
    : "-";
  const desktop = report.desktop ? String(report.desktop.max) : "no result";
  const consoles = report.platform === "win32" && report.desktop ? String(report.desktop.maxNewConsoles) : "-";
  const without = report.dialogs?.without?.medianMs ?? "-";
  const withApp = report.dialogs?.with?.medianMs ?? "-";
  rows.push(
    `| ${name} | ${servers} | ${ready} | ${desktop} | ${consoles} | ${without} | ${withApp} | ${report.error ? "error" : ""} |`,
  );
  rows.unshift(`<!-- ${place} -->`);
}
console.log("### HXBot desktop check (v1.7.2)\n");
if (rows.length === 0) {
  console.log("The check wrote no report.");
} else {
  console.log(
    "| Build | Local servers in the Dock/taskbar (max) | Server ready after | HXBot icons of the desktop (max) | New console windows (Windows) | Save dialog without HXBot (ms) | Save dialog with HXBot (ms) | |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) if (row.startsWith("|")) console.log(row);
}
