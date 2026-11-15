// HXBot: the OpenCode services dialog (HxOpenCodeDialog.tsx).
import type { HxOcAttemptStatus, HxOcCatalog, HxOcIntegration } from "@hxbot/contracts/hx-opencode";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HxOpenCodeDialog } from "./HxOpenCodeDialog";
import type { HxOpenCodePort } from "./hx-opencode-port";

const NO_FIELDS = { fields: [], envNames: [] } as const;
const SERVICES: HxOcIntegration[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    methods: [{ kind: "key", id: null, label: null, ...NO_FIELDS }],
    connections: [{ kind: "credential", id: "cred_1", label: "HXBot", method: "key" }],
  },
  {
    id: "openai",
    name: "OpenAI",
    methods: [
      { kind: "key", id: null, label: null, ...NO_FIELDS },
      { kind: "oauth", id: "chatgpt-browser", label: "Codex browser (legacy)", ...NO_FIELDS },
      { kind: "env", id: null, label: null, fields: [], envNames: ["OPENAI_API_KEY"] },
    ],
    connections: [],
  },
];

function catalog(integrations: HxOcIntegration[] = SERVICES): HxOcCatalog {
  return { state: "ready", version: "2.2.5", message: null, integrations, freeModels: 8, models: { deepseek: 2 } };
}

function port() {
  let status: HxOcAttemptStatus = { status: "pending", message: null };
  const calls = {
    hxOpenCodeCatalog: vi.fn(async () => catalog()),
    hxOpenCodeConnectKey: vi.fn(async () => catalog()),
    hxOpenCodeConnectExternal: vi.fn(async () => catalog()),
    hxOpenCodeStartSignIn: vi.fn(async () => ({
      integrationId: "openai",
      attemptId: "con_1",
      url: "https://auth.openai.com/x",
      instructions: "Complete authorization in your browser.",
      mode: "auto" as const,
      expiresAt: Date.now() + 600_000,
    })),
    hxOpenCodeSignInStatus: vi.fn(async () => status),
    hxOpenCodeCompleteSignIn: vi.fn(async () => status),
    hxOpenCodeCancelSignIn: vi.fn(async () => undefined),
    hxOpenCodeDisconnect: vi.fn(async () =>
      catalog(SERVICES.map((service) => (service.id === "deepseek" ? { ...service, connections: [] } : service))),
    ),
    openUrl: vi.fn(async () => undefined),
  } satisfies HxOpenCodePort;
  return {
    calls,
    complete: () => {
      status = { status: "complete", message: null };
    },
  };
}

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  flush();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HxOpenCodeDialog", () => {
  it("lists OpenCode's services, the free models first, and filters them", async () => {
    const { calls } = port();
    render(() => <HxOpenCodeDialog open={true} onClose={() => undefined} port={calls} />);
    await settle();
    expect(calls.hxOpenCodeCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Free models: 8. No sign-in. Ready to use.")).toBeTruthy();
    expect(screen.getByText("Connected · Models: 2")).toBeTruthy();
    expect(screen.getByText("API key · Browser sign-in · Environment variable")).toBeTruthy();
    fireEvent.input(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "deep" } });
    await settle();
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.getByText("DeepSeek")).toBeTruthy();
  });

  it("connects a service with a key, which goes to main and is cleared", async () => {
    const { calls } = port();
    render(() => <HxOpenCodeDialog open={true} onClose={() => undefined} port={calls} />);
    await settle();
    fireEvent.click(screen.getByText("OpenAI"));
    await settle();
    expect(screen.getByText("OpenCode also reads OPENAI_API_KEY.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paste an API key" }));
    await settle();
    fireEvent.input(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await settle();
    expect(calls.hxOpenCodeConnectKey).toHaveBeenCalledWith({ integrationId: "openai", key: "sk-test", answer: null });
    expect(screen.getByText(/OpenAI is connected\./u)).toBeTruthy();
    expect(screen.queryByDisplayValue("sk-test")).toBeNull();
  });

  it("waits for a browser sign-in and reports it when OpenCode completes it", async () => {
    vi.useFakeTimers();
    const { calls, complete } = port();
    render(() => <HxOpenCodeDialog open={true} onClose={() => undefined} port={calls} />);
    await settle();
    fireEvent.click(screen.getByText("OpenAI"));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Sign in: Codex browser (legacy)" }));
    await settle();
    expect(calls.hxOpenCodeStartSignIn).toHaveBeenCalledWith({
      integrationId: "openai",
      methodId: "chatgpt-browser",
      answer: null,
    });
    expect(screen.getByText(/The sign-in page is open in your browser/u)).toBeTruthy();
    vi.advanceTimersByTime(2000);
    await settle();
    expect(calls.hxOpenCodeSignInStatus).toHaveBeenCalledTimes(1);
    complete();
    vi.advanceTimersByTime(2000);
    await settle();
    await settle();
    expect(screen.getByText(/OpenAI is connected\./u)).toBeTruthy();
    expect(calls.hxOpenCodeCatalog).toHaveBeenCalledTimes(2);
  });

  it("disconnects a connected service", async () => {
    const { calls } = port();
    render(() => <HxOpenCodeDialog open={true} onClose={() => undefined} port={calls} />);
    await settle();
    fireEvent.click(screen.getByText("DeepSeek"));
    await settle();
    expect(screen.getByText("HXBot · API key")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await settle();
    expect(calls.hxOpenCodeDisconnect).toHaveBeenCalledWith({ integrationId: "deepseek", credentialId: "cred_1" });
    expect(screen.getByText("DeepSeek is disconnected.")).toBeTruthy();
  });
});
