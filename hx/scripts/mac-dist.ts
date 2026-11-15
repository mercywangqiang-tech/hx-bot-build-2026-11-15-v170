// HXBot (v1.6.8): the last step of `bun run dist:mac`. It runs electron-builder for the Mac.
//
// macOS keeps the Screen Recording, Accessibility, Automation and App Management grants for the
// signing identity of an app. Before v1.6.8 the build was not signed (`--config.mac.identity=null`),
// so every version was a new app to macOS, and every update lost the grants. Now:
//
//   HXBOT_MAC_IDENTITY set    sign with that identity (the fixed certificate of HXBot, or later a
//                             Developer ID), with the hardened runtime and hx-entitlements.mac.plist
//   HXBOT_MAC_IDENTITY empty  build without a signature, as before, and say so. The GitHub build
//                             refuses such a build for release (hx/scripts/mac-signing-check.sh).
//
// HXBOT_MAC_DEVELOPER_ID=1 marks a Developer ID identity: it keeps Apple's timestamp, which
// notarization needs. A certificate of HXBot's own gets no timestamp: Apple's server is for Apple
// certificates.
//
// HX_MAC_DIST_DRY=1 prints the arguments and does not build (hx/tests/test_mac_signing.py).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function hxMacBuilderArgs(env: NodeJS.ProcessEnv): string[] {
  const identity = env.HXBOT_MAC_IDENTITY?.trim() ?? "";
  const args = ["--mac", "--config.mac.notarize=false"];
  if (identity === "") return [...args, "--config.mac.identity=null"];
  return [
    ...args,
    `--config.mac.identity=${identity}`,
    "--config.mac.hardenedRuntime=true",
    "--config.mac.entitlements=build/hx-entitlements.mac.plist",
    "--config.mac.entitlementsInherit=build/hx-entitlements.mac.inherit.plist",
    ...(env.HXBOT_MAC_DEVELOPER_ID === "1" ? [] : ["--config.mac.timestamp=none"]),
  ];
}

if (import.meta.main) {
  const args = hxMacBuilderArgs(process.env);
  if (args.includes("--config.mac.identity=null")) {
    console.warn(
      "HXBot: this Mac build has no fixed signature (HXBOT_MAC_IDENTITY is empty). macOS will treat it as a new app, and the grants of an earlier version will not work for it.",
    );
  }
  if (process.env.HX_MAC_DIST_DRY === "1") {
    console.log(JSON.stringify(args));
  } else {
    const bin = join(process.cwd(), "node_modules", ".bin", "electron-builder");
    const run = spawnSync(bin, args, { stdio: "inherit" });
    process.exit(run.status ?? 1);
  }
}
