// HXBot（基于 HXBot 的研究版，PolyForm Noncommercial 1.0.0）
//
// The packaged HXBot uses the self-hosted account service and Signal of 弘犀智能 by default, through
// the self-hosting variables that HXBot already reads (docs/self-hosting.md). This module must be the
// first import of `src/main/index.ts`: ES modules run in import order, so every other module of the
// main process reads these values. A person can still name another service with the same variables.
import { app } from "electron";

const HX_ACCOUNT_API_URL = "https://api.bot.hxallai.com";
const HX_SIGNAL_URL = "wss://signal.bot.hxallai.com/v1/signal";

// macOS: Chromium keeps the key of its cookie store in the login Keychain item "HXBot Safe Storage".
// HXBot has no Apple Developer ID signature, so macOS takes each start or update for another app and
// asks for the Keychain password. The mock keychain keeps that key out of the Keychain. HXBot's own
// secrets use the key file in userData on macOS (src/main/secret-storage-cipher.ts, hx/rebrand.py).
// The switch must be set before `ready`, before the network service starts: this module runs first.
if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");

if (app.isPackaged && !process.env.HXBOT_AUTH_API_URL && !process.env.HXBOT_REMOTE_SIGNAL_URL) {
  process.env.HXBOT_AUTH_API_URL = HX_ACCOUNT_API_URL;
  process.env.HXBOT_REMOTE_SIGNAL_URL = HX_SIGNAL_URL;
}
