// HXBot: the OpenCode services dialog's main-process half, against a real OpenCode (hx-opencode).
//
// Usage: bun scripts/hx-opencode-e2e.ts <opencode program> [report.json]
//
// Runs OpenCode in a new empty home folder, so the user's own OpenCode data is not touched. It
// lists the services, connects DeepSeek with a made-up key, checks that a second OpenCode process
// lists DeepSeek's models (as the agents' `opencode acp` does), starts and cancels a ChatGPT sign-in
// in the browser (no browser opens: the page is only recorded), disconnects DeepSeek, and writes a
// JSON report.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseOpencodeVersion } from "../src/backend/cli";
import { HxOcServer } from "../src/backend/hx-opencode/server";
import { HxOpenCodeConnect } from "../src/backend/hx-opencode/service";

const program = process.argv[2];
const reportPath = process.argv[3] ?? ".hxbot-build/hx-opencode-e2e.json";
if (!program) throw new Error("Usage: bun scripts/hx-opencode-e2e.ts <opencode program> [report.json]");

const home = mkdtempSync(join(tmpdir(), "hx-opencode-e2e-"));
for (const name of ["GITHUB_TOKEN", "GH_TOKEN", "OPENCODE_API_KEY", "DEEPSEEK_API_KEY"]) delete process.env[name];
Object.assign(process.env, {
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local/state"),
});

// The app reads the version with `parseOpencodeVersion`, which this does too.
const version = parseOpencodeVersion(execFileSync(program, ["--version"], { encoding: "utf8" }));
const opened: string[] = [];
let restarts = 0;
const host = {
  resolveCli: async () => ({ executable: program, version }),
  openLink: async (url: string) => {
    opened.push(url);
  },
  changed: async () => {
    restarts += 1;
  },
};
const server = new HxOcServer(host.resolveCli);
const connect = new HxOpenCodeConnect();
connect.configure(host, server);

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "passed" : "FAILED"}  ${name}  ${detail}\n`);
}

try {
  const first = await connect.catalog();
  const ids = first.integrations.map((item) => item.id);
  check(
    "catalog",
    first.state === "ready" && ids.length > 200,
    `${first.state}, ${ids.length} services, OpenCode ${version}`,
  );
  check("search services left out", !ids.includes("exa") && !ids.includes("tavily"), "exa, tavily");
  check("well-known first", ids.indexOf("openai") < ids.indexOf("302ai"), `openai at ${ids.indexOf("openai")}`);
  check("free models", first.freeModels > 0, `${first.freeModels} free models`);
  const openai = first.integrations.find((item) => item.id === "openai");
  check(
    "browser sign-in offered",
    Boolean(openai?.methods.some((method) => method.kind === "oauth" && method.id === "chatgpt-browser")),
    (openai?.methods ?? []).map((method) => `${method.kind}:${method.id ?? ""}`).join(" "),
  );

  const afterKey = await connect.connectKey({ integrationId: "deepseek", key: "sk-hx-e2e-not-real", answer: null });
  const deepseek = afterKey.integrations.find((item) => item.id === "deepseek");
  check(
    "key connected",
    deepseek?.connections.length === 1 && (afterKey.models.deepseek ?? 0) > 0 && restarts === 1,
    `connections ${deepseek?.connections.length}, models ${afterKey.models.deepseek ?? 0}, restarts ${restarts}`,
  );
  const listed = execFileSync(program, ["models", "--standalone"], { encoding: "utf8", timeout: 120_000 })
    .split("\n")
    .filter((line) => line.startsWith("deepseek/"));
  check("another OpenCode process lists the models", listed.length > 0, listed.join(" "));

  const attempt = await connect.startSignIn({ integrationId: "openai", methodId: "chatgpt-browser", answer: null });
  check(
    "browser sign-in starts",
    opened.length === 1 && opened[0]?.startsWith("https://auth.openai.com/") === true && attempt.mode === "auto",
    `${attempt.mode}, ${opened[0]?.slice(0, 50) ?? "no page"}`,
  );
  const pending = await connect.signInStatus(attempt);
  check("sign-in waits", pending.status === "pending", pending.status);
  await connect.cancelSignIn(attempt);

  const credential = deepseek?.connections[0]?.id ?? "";
  let refused = false;
  try {
    await connect.disconnect({ integrationId: "openai", credentialId: credential });
  } catch {
    refused = true;
  }
  check("disconnect of another service refused", refused, credential);
  const afterRemove = await connect.disconnect({ integrationId: "deepseek", credentialId: credential });
  check(
    "disconnected",
    afterRemove.integrations.find((item) => item.id === "deepseek")?.connections.length === 0 && restarts === 2,
    `restarts ${restarts}`,
  );
} catch (error) {
  check("no error", false, error instanceof Error ? error.message : String(error));
} finally {
  connect.stop();
  rmSync(home, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.ok).length;
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify({ version, at: new Date().toISOString(), failed, checks }, null, 2)}\n`);
process.stdout.write(`${checks.length - failed}/${checks.length} passed; report ${reportPath}\n`);
process.exit(failed === 0 ? 0 : 1);
