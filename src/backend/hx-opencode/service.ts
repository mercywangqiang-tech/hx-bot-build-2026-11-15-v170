// HXBot: connecting OpenCode's model services from HXBot (hx-opencode).
//
// Owns the private OpenCode server and the sign-ins that wait on it. Every request goes to
// OpenCode's own connection routes, so OpenCode decides what a key or a sign-in needs and keeps the
// credential itself; HXBot keeps no copy. After a connection changes, `changed` restarts HXBot's
// OpenCode process so that the agents' model list reads the new credentials.

import type {
  HxOcAttempt,
  HxOcAttemptRef,
  HxOcAttemptStatus,
  HxOcCatalog,
  HxOcCompleteInput,
  HxOcDisconnectInput,
  HxOcKeyInput,
  HxOcMethodInput,
} from "@hxbot/contracts/hx-opencode";
import { registerSecretValue } from "@hxbot/logging";
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
import { hxOpenCodeNames } from "./names";
import { type HxOcCli, HxOcServer } from "./server";

/** OpenCode 2 is the first with the connection routes. */
const FIRST_MAJOR = 2;
/** A sign-in that OpenCode gives no end time keeps the server this long. */
const SIGN_IN_MS = 10 * 60_000;
const LABEL = "HXBot";
/** OpenCode 2.2.5's web search services, in case its list of them comes back empty. */
const SEARCH_IDS = ["exa", "firecrawl", "parallel", "tavily", "tinyfish"];

export interface HxOpenCodeHost {
  /** The OpenCode program that HXBot's agents run. Rejects when there is none. */
  resolveCli(): Promise<HxOcCli>;
  /** Opens a page in the browser that the user chose. */
  openLink(url: string): Promise<void>;
  /** Restarts HXBot's OpenCode process once it is idle. */
  changed(): Promise<void>;
}

function majorOf(version: string): number {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 0;
}

function path(integrationId: string, rest = ""): string {
  return `/api/integration/${encodeURIComponent(integrationId)}${rest}`;
}

function failure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

const EMPTY = { integrations: [], freeModels: 0, models: {} } as const;

/** The private server, or a stand-in in a test. */
export type HxOcRequester = Pick<HxOcServer, "request" | "hold" | "stop">;

export class HxOpenCodeConnect {
  #host: HxOpenCodeHost | null = null;
  #server: HxOcRequester | null = null;
  #cli: HxOcCli | null = null;
  /** The sign-ins that have not reached an end, by attempt id. */
  readonly #attempts = new Map<string, HxOcAttempt>();

  configure(host: HxOpenCodeHost, server?: HxOcRequester): void {
    this.#server?.stop();
    this.#host = host;
    this.#server =
      server ??
      new HxOcServer(async () => {
        const cli = await host.resolveCli();
        this.#cli = cli;
        return cli;
      });
  }

  stop(): void {
    this.#server?.stop();
    this.#attempts.clear();
  }

  #need(): { host: HxOpenCodeHost; server: HxOcRequester } {
    if (!this.#host || !this.#server) throw new Error("OpenCode connections are not available here.");
    return { host: this.#host, server: this.#server };
  }

  /** Every service OpenCode can connect, with the state of each. Never throws: the state says why. */
  async catalog(): Promise<HxOcCatalog> {
    const { host, server } = this.#need();
    let cli: HxOcCli;
    try {
      cli = this.#cli ?? (await host.resolveCli());
      this.#cli = cli;
    } catch {
      return { state: "missing", version: null, message: null, ...EMPTY };
    }
    if (majorOf(cli.version) < FIRST_MAJOR) return { state: "old", version: cli.version, message: null, ...EMPTY };
    try {
      // OpenCode 2.2.5 fills its web search list while it reads the integrations: asked first, the list is
      // empty. So the integrations come first.
      const integrations = await server.request("GET", "/api/integration");
      const [search, models] = await Promise.all([
        server.request("GET", "/api/websearch/provider").catch(() => null),
        server.request("GET", "/api/model").catch(() => null),
      ]);
      const list = hxOcIntegrations(integrations, new Set([...SEARCH_IDS, ...hxOcSearchIds(search)]));
      hxOpenCodeNames.remember(hxOcConnectedNames(list));
      return { state: "ready", version: cli.version, message: null, integrations: list, ...hxOcModelCounts(models) };
    } catch (error) {
      return { state: "failed", version: cli.version, message: failure(error), ...EMPTY };
    }
  }

  async connectKey(input: HxOcKeyInput): Promise<HxOcCatalog> {
    const { server } = this.#need();
    registerSecretValue(input.key);
    const integration = await server.request("GET", path(input.integrationId));
    if (!hxOcHasMethod(integration, "key", null)) throw new Error("This service does not take a key.");
    const answer = hxOcAnswer(hxOcMethodForm(integration, "key", null), input.answer);
    await server.request("POST", path(input.integrationId, "/connect/key"), {
      key: input.key,
      label: LABEL,
      ...(answer ? { answer } : {}),
    });
    await this.#changed();
    return this.catalog();
  }

  /** A credential that is already on this computer, such as an AWS profile or a gcloud sign-in. */
  async connectExternal(input: HxOcMethodInput): Promise<HxOcCatalog> {
    const { server } = this.#need();
    const integration = await server.request("GET", path(input.integrationId));
    if (!hxOcHasMethod(integration, "external", input.methodId)) throw new Error("Unknown connection method.");
    const answer = hxOcAnswer(hxOcMethodForm(integration, "external", input.methodId), input.answer);
    await server.request("POST", path(input.integrationId, "/connect/external"), {
      methodID: input.methodId,
      label: LABEL,
      ...(answer ? { answer } : {}),
    });
    await this.#changed();
    return this.catalog();
  }

  /** Starts a sign-in in the browser and opens its page. */
  async startSignIn(input: HxOcMethodInput): Promise<HxOcAttempt> {
    const { host, server } = this.#need();
    const integration = await server.request("GET", path(input.integrationId));
    if (!hxOcHasMethod(integration, "oauth", input.methodId)) throw new Error("Unknown sign-in method.");
    const answer = hxOcAnswer(hxOcMethodForm(integration, "oauth", input.methodId), input.answer);
    const attempt = hxOcAttempt(
      input.integrationId,
      await server.request("POST", path(input.integrationId, "/connect/oauth"), {
        methodID: input.methodId,
        label: LABEL,
        ...(answer ? { answer } : {}),
      }),
    );
    if (!attempt) throw new Error("OpenCode did not start the sign-in.");
    server.hold(attempt.expiresAt > Date.now() ? attempt.expiresAt : Date.now() + SIGN_IN_MS);
    this.#attempts.set(attempt.attemptId, attempt);
    const page = URL.parse(attempt.url);
    // A sign-in page is a web page of the service; nothing else is opened from OpenCode's answer.
    if (page?.protocol === "https:") await host.openLink(page.toString());
    return attempt;
  }

  async signInStatus(ref: HxOcAttemptRef): Promise<HxOcAttemptStatus> {
    const { server } = this.#need();
    const status = hxOcAttemptStatus(
      await server.request("GET", path(ref.integrationId, `/connect/oauth/${encodeURIComponent(ref.attemptId)}`)),
    );
    await this.#ended(ref, status);
    return status;
  }

  /** Sends the code that the sign-in page showed, for a sign-in that asks for one. */
  async completeSignIn(input: HxOcCompleteInput): Promise<HxOcAttemptStatus> {
    const { server } = this.#need();
    if (input.code) registerSecretValue(input.code);
    await server.request(
      "POST",
      path(input.integrationId, `/connect/oauth/${encodeURIComponent(input.attemptId)}/complete`),
      { code: input.code },
    );
    return this.signInStatus(input);
  }

  async cancelSignIn(ref: HxOcAttemptRef): Promise<void> {
    const { server } = this.#need();
    this.#attempts.delete(ref.attemptId);
    await server
      .request("DELETE", path(ref.integrationId, `/connect/oauth/${encodeURIComponent(ref.attemptId)}`))
      .catch(() => undefined);
  }

  async disconnect(input: HxOcDisconnectInput): Promise<HxOcCatalog> {
    const { server } = this.#need();
    const integration = await server.request("GET", path(input.integrationId));
    const known = hxOcIntegration(integration)?.connections.some(
      (connection) => connection.kind === "credential" && connection.id === input.credentialId,
    );
    if (!known) throw new Error("This connection is not of this service.");
    await server.request("DELETE", `/api/credential/${encodeURIComponent(input.credentialId)}`);
    await this.#changed();
    return this.catalog();
  }

  async #ended(ref: HxOcAttemptRef, status: HxOcAttemptStatus): Promise<void> {
    if (status.status === "pending" || !this.#attempts.has(ref.attemptId)) return;
    this.#attempts.delete(ref.attemptId);
    if (status.status === "complete") await this.#changed();
  }

  async #changed(): Promise<void> {
    try {
      await this.#need().host.changed();
    } catch {
      // OpenCode off or not running: its next start reads the credential anyway.
    }
  }
}

export const hxOpenCode = new HxOpenCodeConnect();
