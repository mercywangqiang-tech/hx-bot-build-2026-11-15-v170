import { describe, expect, it } from "vitest";
import {
  hxOcAnswer,
  hxOcAttempt,
  hxOcAttemptStatus,
  hxOcConnectedNames,
  hxOcHasMethod,
  hxOcIntegration,
  hxOcIntegrations,
  hxOcMethodForm,
  hxOcModelCounts,
  hxOcSearchIds,
} from "./catalog";

// Shapes copied from OpenCode 2.2.5's `GET /api/integration`.
const COPILOT = {
  id: "github-copilot",
  name: "GitHub Copilot",
  methods: [
    { type: "env", names: ["GITHUB_TOKEN"] },
    {
      id: "device",
      type: "oauth",
      label: "Login with GitHub Copilot",
      form: [
        {
          key: "deploymentType",
          title: "Select GitHub deployment type",
          required: true,
          type: "string",
          options: [
            { value: "github.com", label: "GitHub.com", description: "Public" },
            { value: "enterprise", label: "GitHub Enterprise" },
          ],
        },
        {
          key: "enterpriseUrl",
          title: "Enter your GitHub Enterprise URL or domain",
          required: true,
          when: [{ key: "deploymentType", op: "eq", value: "enterprise" }],
          type: "string",
          placeholder: "company.ghe.com",
        },
      ],
    },
  ],
  connections: [],
};
const CONSOLE = {
  id: "opencode",
  name: "OpenCode Console",
  methods: [
    { type: "key", label: "API key (service account)" },
    { type: "env", names: ["OPENCODE_API_KEY"] },
    {
      id: "device",
      type: "oauth",
      label: "OpenCode Console account",
      form: [{ key: "server", hidden: true, type: "string", format: "uri", default: "https://opencode.ai/console" }],
    },
  ],
  connections: [],
};
const DEEPSEEK = {
  id: "deepseek",
  name: "DeepSeek",
  methods: [{ type: "key" }, { type: "env", names: ["DEEPSEEK_API_KEY"] }],
  connections: [{ type: "credential", id: "cred_1", label: "HXBot", method: "key" }],
};
const EXA = { id: "exa", name: "Exa", methods: [{ type: "key" }], connections: [] };
const ZED = {
  id: "zed-cloud",
  name: "Zed",
  methods: [{ type: "command", id: "x", label: "x", command: ["x"] }],
  connections: [],
};

const LIST = { location: { directory: "/tmp" }, data: [ZED, EXA, COPILOT, DEEPSEEK, CONSOLE, { nonsense: true }] };

describe("hxOcIntegrations", () => {
  const list = hxOcIntegrations(LIST, hxOcSearchIds({ data: [{ id: "exa", name: "Exa" }] }));

  it("leaves out the web search services and entries with no id", () => {
    expect(list.map((item) => item.id)).toEqual(["deepseek", "opencode", "github-copilot", "zed-cloud"]);
  });

  it("lists a connected service first, then OpenCode's own, then the rest by name", () => {
    expect(list[0]?.connections).toEqual([{ kind: "credential", id: "cred_1", label: "HXBot", method: "key" }]);
  });

  it("drops a hidden question and keeps the conditions of the others", () => {
    const consoleSignIn = list
      .find((item) => item.id === "opencode")
      ?.methods.find((method) => method.kind === "oauth");
    expect(consoleSignIn?.fields).toEqual([]);
    const copilot = list
      .find((item) => item.id === "github-copilot")
      ?.methods.find((method) => method.kind === "oauth");
    expect(copilot?.fields.map((field) => [field.key, field.kind, field.when])).toEqual([
      ["deploymentType", "choice", []],
      ["enterpriseUrl", "text", [{ key: "deploymentType", equal: true, value: "enterprise" }]],
    ]);
  });

  it("does not list a command connection, which is done in a terminal", () => {
    expect(list.find((item) => item.id === "zed-cloud")?.methods).toEqual([]);
  });

  it("reads one integration and the names of the connected ones", () => {
    expect(hxOcIntegration({ data: DEEPSEEK })?.connections).toHaveLength(1);
    expect(hxOcIntegration({ data: "x" })).toBeNull();
    expect(hxOcConnectedNames(list)).toEqual({ deepseek: "DeepSeek" });
  });
});

describe("hxOcAnswer", () => {
  it("sends the default of a hidden question", () => {
    expect(hxOcAnswer(hxOcMethodForm({ data: CONSOLE }, "oauth", "device"), null)).toEqual({
      server: "https://opencode.ai/console",
    });
  });

  it("keeps only the questions of the form", () => {
    const form = hxOcMethodForm({ data: COPILOT }, "oauth", "device");
    expect(hxOcAnswer(form, { deploymentType: "enterprise", enterpriseUrl: " a.ghe.com ", extra: "x" })).toEqual({
      deploymentType: "enterprise",
      enterpriseUrl: "a.ghe.com",
    });
    expect(hxOcAnswer(form, null)).toBeNull();
  });

  it("knows which methods a service offers", () => {
    expect(hxOcHasMethod({ data: DEEPSEEK }, "key", null)).toBe(true);
    expect(hxOcHasMethod({ data: DEEPSEEK }, "oauth", "device")).toBe(false);
    expect(hxOcHasMethod({ data: COPILOT }, "oauth", "device")).toBe(true);
    expect(hxOcHasMethod({ data: COPILOT }, "oauth", "browser")).toBe(false);
  });
});

describe("hxOcModelCounts", () => {
  it("counts the models of each service and OpenCode's free ones", () => {
    const counts = hxOcModelCounts({
      data: [
        { providerID: "opencode", cost: [{ input: 0, output: 0 }] },
        { providerID: "opencode", cost: [{ input: 1, output: 5 }] },
        { providerID: "opencode", cost: [] },
        { providerID: "deepseek", cost: [{ input: 0.3, output: 1 }] },
        { providerID: "deepseek", enabled: false },
      ],
    });
    expect(counts).toEqual({ models: { opencode: 3, deepseek: 1 }, freeModels: 1 });
  });
});

describe("sign-in answers", () => {
  it("reads an attempt and its states", () => {
    expect(
      hxOcAttempt("openai", {
        data: {
          attemptID: "con_1",
          url: "https://auth.openai.com/x",
          instructions: "Complete authorization",
          mode: "auto",
          time: { created: 1, expires: 2 },
        },
      }),
    ).toEqual({
      integrationId: "openai",
      attemptId: "con_1",
      url: "https://auth.openai.com/x",
      instructions: "Complete authorization",
      mode: "auto",
      expiresAt: 2,
    });
    expect(hxOcAttempt("openai", { data: {} })).toBeNull();
    expect(hxOcAttemptStatus({ data: { status: "complete" } })).toEqual({ status: "complete", message: null });
    expect(hxOcAttemptStatus({ data: { status: "failed", message: "denied" } })).toEqual({
      status: "failed",
      message: "denied",
    });
    expect(hxOcAttemptStatus({ data: { status: "weird" } }).status).toBe("failed");
  });
});
