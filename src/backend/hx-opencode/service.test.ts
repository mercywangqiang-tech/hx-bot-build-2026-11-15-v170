import { describe, expect, it, vi } from "vitest";
import { type HxOcRequester, HxOpenCodeConnect, type HxOpenCodeHost } from "./service";

const DEEPSEEK = {
  id: "deepseek",
  name: "DeepSeek",
  methods: [{ type: "key" }],
  connections: [{ type: "credential", id: "cred_1", label: "HXBot", method: "key" }],
};
const OPENAI = {
  id: "openai",
  name: "OpenAI",
  methods: [{ type: "key" }, { id: "chatgpt-browser", type: "oauth", label: "Codex browser (legacy)" }],
  connections: [],
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function setup(options: { version?: string; url?: string; missing?: boolean } = {}) {
  const calls: Call[] = [];
  let status = "pending";
  const server: HxOcRequester = {
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === "/api/integration") return { data: [OPENAI, DEEPSEEK] };
      if (path === "/api/integration/deepseek") return { data: DEEPSEEK };
      if (path === "/api/integration/openai") return { data: OPENAI };
      if (path === "/api/integration/openai/connect/oauth")
        return {
          data: {
            attemptID: "con_1",
            url: options.url ?? "https://auth.openai.com/oauth/authorize?x=1",
            instructions: "Complete authorization in your browser.",
            mode: "auto",
            time: { created: 1, expires: Date.now() + 60_000 },
          },
        };
      if (path === "/api/integration/openai/connect/oauth/con_1") return { data: { status } };
      return { data: [] };
    },
    hold: vi.fn(),
    stop: vi.fn(),
  };
  const host: HxOpenCodeHost = {
    resolveCli: async () => {
      if (options.missing) throw new Error("missing");
      return { executable: "/x/opencode", version: options.version ?? "2.2.5" };
    },
    openLink: vi.fn(async () => undefined),
    changed: vi.fn(async () => undefined),
  };
  const connect = new HxOpenCodeConnect();
  connect.configure(host, server);
  return { connect, calls, host, server, complete: () => (status = "complete") };
}

describe("HxOpenCodeConnect", () => {
  it("says why there is no list: OpenCode missing or too old", async () => {
    expect((await setup({ missing: true }).connect.catalog()).state).toBe("missing");
    const old = await setup({ version: "1.19.3" }).connect.catalog();
    expect([old.state, old.version, old.integrations]).toEqual(["old", "1.19.3", []]);
  });

  it("lists the services of OpenCode", async () => {
    const catalog = await setup().connect.catalog();
    expect(catalog.state).toBe("ready");
    expect(catalog.integrations.map((item) => item.id)).toEqual(["deepseek", "openai"]);
  });

  it("sends a key to OpenCode's key route and restarts OpenCode", async () => {
    const { connect, calls, host } = setup();
    await connect.connectKey({ integrationId: "deepseek", key: "sk-1", answer: { stray: "x" } });
    expect(calls.find((call) => call.path === "/api/integration/deepseek/connect/key")).toEqual({
      method: "POST",
      path: "/api/integration/deepseek/connect/key",
      body: { key: "sk-1", label: "HXBot" },
    });
    expect(host.changed).toHaveBeenCalledTimes(1);
  });

  it("refuses a method the service does not offer", async () => {
    const { connect, calls } = setup();
    await expect(
      connect.startSignIn({ integrationId: "deepseek", methodId: "device", answer: null }),
    ).rejects.toThrow();
    await expect(
      connect.connectExternal({ integrationId: "openai", methodId: "aws-profile", answer: null }),
    ).rejects.toThrow();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("opens the sign-in page, keeps the server, and restarts OpenCode once when it completes", async () => {
    const { connect, host, server, complete } = setup();
    const attempt = await connect.startSignIn({ integrationId: "openai", methodId: "chatgpt-browser", answer: null });
    expect(host.openLink).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize?x=1");
    expect(server.hold).toHaveBeenCalled();
    expect((await connect.signInStatus(attempt)).status).toBe("pending");
    complete();
    expect((await connect.signInStatus(attempt)).status).toBe("complete");
    await connect.signInStatus(attempt);
    expect(host.changed).toHaveBeenCalledTimes(1);
  });

  it("opens no page that is not https", async () => {
    const { connect, host } = setup({ url: "file:///etc/passwd" });
    await connect.startSignIn({ integrationId: "openai", methodId: "chatgpt-browser", answer: null });
    expect(host.openLink).not.toHaveBeenCalled();
  });

  it("removes only a connection of the named service", async () => {
    const { connect, calls } = setup();
    await expect(connect.disconnect({ integrationId: "openai", credentialId: "cred_1" })).rejects.toThrow();
    await connect.disconnect({ integrationId: "deepseek", credentialId: "cred_1" });
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([
      "/api/credential/cred_1",
    ]);
  });
});
