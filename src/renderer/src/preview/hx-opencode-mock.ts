// HXBot: the OpenCode services of the preview and the stories (hx-opencode). A short list in the shape
// of OpenCode 2.2.5's answer: one service of each way in, and one connected.

import type {
  HxOcAttempt,
  HxOcAttemptStatus,
  HxOcCatalog,
  HxOcDisconnectInput,
  HxOcIntegration,
  HxOcKeyInput,
  HxOcMethodInput,
} from "@hxbot/contracts/hx-opencode";

const NO_FIELDS = { fields: [], envNames: [] } as const;

let integrations: HxOcIntegration[] = [
  {
    id: "opencode",
    name: "OpenCode Console",
    methods: [
      { kind: "key", id: null, label: "API key (service account)", ...NO_FIELDS },
      { kind: "oauth", id: "device", label: "OpenCode Console account", ...NO_FIELDS },
    ],
    connections: [],
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
  {
    id: "deepseek",
    name: "DeepSeek",
    methods: [{ kind: "key", id: null, label: null, ...NO_FIELDS }],
    connections: [{ kind: "credential", id: "cred_preview_deepseek", label: "HXBot", method: "key" }],
  },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    methods: [
      { kind: "key", id: null, label: "Bedrock API key", ...NO_FIELDS },
      {
        kind: "external",
        id: "aws-profile",
        label: "AWS profile (SSO or named profile)",
        fields: [
          {
            key: "profile",
            kind: "text",
            title: "AWS profile",
            description: null,
            required: true,
            placeholder: "default",
            initial: null,
            options: [],
            url: null,
            when: [],
          },
        ],
        envNames: [],
      },
    ],
    connections: [],
  },
];

function catalog(): HxOcCatalog {
  return {
    state: "ready",
    version: "2.2.5",
    message: null,
    integrations: structuredClone(integrations),
    freeModels: 8,
    models: { deepseek: 2 },
  };
}

function connect(integrationId: string, method: "key" | "oauth" | "external"): void {
  integrations = integrations.map((item) =>
    item.id === integrationId
      ? {
          ...item,
          connections: [
            ...item.connections,
            { kind: "credential", id: `cred_preview_${item.id}_${item.connections.length}`, label: "HXBot", method },
          ],
        }
      : item,
  );
}

export const hxOpenCodePreview = {
  hxOpenCodeCatalog: async (): Promise<HxOcCatalog> => catalog(),
  hxOpenCodeConnectKey: async (input: HxOcKeyInput): Promise<HxOcCatalog> => {
    connect(input.integrationId, "key");
    return catalog();
  },
  hxOpenCodeConnectExternal: async (input: HxOcMethodInput): Promise<HxOcCatalog> => {
    connect(input.integrationId, "external");
    return catalog();
  },
  hxOpenCodeStartSignIn: async (input: HxOcMethodInput): Promise<HxOcAttempt> => {
    connect(input.integrationId, "oauth");
    return {
      integrationId: input.integrationId,
      attemptId: "con_preview",
      url: "https://example.com/sign-in",
      instructions: "Complete authorization in your browser.",
      mode: "auto",
      expiresAt: Date.now() + 600_000,
    };
  },
  hxOpenCodeSignInStatus: async (): Promise<HxOcAttemptStatus> => ({ status: "complete", message: null }),
  hxOpenCodeCompleteSignIn: async (): Promise<HxOcAttemptStatus> => ({ status: "complete", message: null }),
  hxOpenCodeCancelSignIn: async (): Promise<void> => undefined,
  hxOpenCodeDisconnect: async (input: HxOcDisconnectInput): Promise<HxOcCatalog> => {
    integrations = integrations.map((item) =>
      item.id === input.integrationId
        ? { ...item, connections: item.connections.filter((connection) => connection.id !== input.credentialId) }
        : item,
    );
    return catalog();
  },
};
