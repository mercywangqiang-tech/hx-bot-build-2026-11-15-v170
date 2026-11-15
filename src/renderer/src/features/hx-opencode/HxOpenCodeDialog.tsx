/**
 * HXBot: every model service that OpenCode can reach, connected from here (hx-opencode).
 *
 * The list is OpenCode's own: main asks OpenCode's local server for it each time the dialog opens.
 * A service connects with a key, a sign-in in the browser, or a credential that is already on this
 * computer, as OpenCode offers for it. OpenCode keeps the credential; the key never comes back to
 * this screen. After a change, OpenCode restarts when idle and its model list, which the agents and
 * auto model read, has the service's models.
 */

import type {
  HxOcAnswer,
  HxOcAttempt,
  HxOcCatalog,
  HxOcConnection,
  HxOcField,
  HxOcIntegration,
  HxOcMethod,
} from "@hxbot/contracts/hx-opencode";
import type { AppTextKey } from "@hxbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  ChevronRight,
  Dialog,
  ExternalLink,
  Field,
  Gift,
  Heading,
  IconButton,
  Input,
  LoaderCircle,
  Plug,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  X,
} from "@hxbot/ui";
import { useText } from "@hxbot/ui/text";
import { createEffect, createMemo, createStore, For, Show } from "solid-js";
import { type HxOpenCodePort, hxOpenCodePort } from "./hx-opencode-port";

const POLL_MS = 2000;

interface Chosen {
  integrationId: string;
  method: HxOcMethod;
}

interface DialogState {
  loading: boolean;
  catalog: HxOcCatalog | null;
  query: string;
  open: string | null;
  chosen: Chosen | null;
  key: string;
  answer: Record<string, string | boolean>;
  busy: boolean;
  attempt: HxOcAttempt | null;
  code: string;
  error: string;
  note: string;
}

const EMPTY: DialogState = {
  loading: false,
  catalog: null,
  query: "",
  open: null,
  chosen: null,
  key: "",
  answer: {},
  busy: false,
  attempt: null,
  code: "",
  error: "",
  note: "",
};

const WAY_KEY: Record<HxOcMethod["kind"], AppTextKey> = {
  oauth: "settings.hxOpenCode.way.oauth",
  key: "settings.hxOpenCode.way.key",
  external: "settings.hxOpenCode.way.external",
  env: "settings.hxOpenCode.way.env",
};

function initialOf(field: HxOcField): string | boolean {
  return field.initial ?? (field.kind === "boolean" ? false : "");
}

/** A question shows while each of its conditions holds for the answers given so far. */
function visible(field: HxOcField, fields: readonly HxOcField[], answer: HxOcAnswer): boolean {
  return field.when.every((when) => {
    const other = fields.find((item) => item.key === when.key);
    const value = answer[when.key] ?? (other ? initialOf(other) : "");
    return (String(value) === when.value) === when.equal;
  });
}

export interface HxOpenCodeDialogProps {
  open: boolean;
  onClose: () => void;
  port?: HxOpenCodePort;
}

export function HxOpenCodeDialog(props: HxOpenCodeDialogProps) {
  const i18n = useText();
  const t = i18n.t;
  const port = () => props.port ?? hxOpenCodePort();
  const [state, setState] = createStore<DialogState>({ ...EMPTY });

  const describe = (error: unknown) => i18n.errorMessage(error, t("settings.hxOpenCode.unknown"));

  async function load(): Promise<void> {
    setState((draft) => {
      draft.loading = true;
      draft.error = "";
    });
    try {
      const catalog = await port().hxOpenCodeCatalog();
      setState((draft) => {
        draft.catalog = catalog;
      });
    } catch (error) {
      setState((draft) => {
        draft.error = t("settings.hxOpenCode.error", { detail: describe(error) });
      });
    } finally {
      setState((draft) => {
        draft.loading = false;
      });
    }
  }

  function stopAttempt(): void {
    const attempt = state.attempt;
    if (attempt)
      void port().hxOpenCodeCancelSignIn({ integrationId: attempt.integrationId, attemptId: attempt.attemptId });
    setState((draft) => {
      draft.attempt = null;
      draft.code = "";
    });
  }

  createEffect(
    () => props.open,
    (open) => {
      if (open) {
        setState(() => ({ ...EMPTY }));
        void load();
      } else if (state.attempt) {
        stopAttempt();
      }
    },
  );

  // A sign-in in the browser ends on OpenCode's side; the dialog asks for its state until then.
  createEffect(
    () => state.attempt,
    (attempt) => {
      if (!attempt) return;
      let asking = false;
      const timer = setInterval(() => {
        if (asking) return;
        asking = true;
        void port()
          .hxOpenCodeSignInStatus({ integrationId: attempt.integrationId, attemptId: attempt.attemptId })
          .then((status) => ended(attempt, status.status, status.message))
          .catch((error: unknown) => ended(attempt, "failed", describe(error)))
          .finally(() => {
            asking = false;
          });
      }, POLL_MS);
      return () => clearInterval(timer);
    },
  );

  function nameOf(integrationId: string): string {
    return state.catalog?.integrations.find((item) => item.id === integrationId)?.name ?? integrationId;
  }

  async function ended(attempt: HxOcAttempt, status: string, message: string | null): Promise<void> {
    if (state.attempt?.attemptId !== attempt.attemptId || status === "pending") return;
    setState((draft) => {
      draft.attempt = null;
      draft.code = "";
      if (status === "complete") {
        draft.chosen = null;
        draft.note = t("settings.hxOpenCode.done", { name: nameOf(attempt.integrationId) });
      } else if (status === "expired") {
        draft.error = t("settings.hxOpenCode.expired");
      } else {
        draft.error = t("settings.hxOpenCode.signInFailed", { detail: message ?? "" });
      }
    });
    if (status === "complete") await load();
  }

  const matches = createMemo(() => {
    const list = state.catalog?.integrations ?? [];
    const query = state.query.trim().toLowerCase();
    return query ? list.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(query)) : list;
  });

  function toggle(integrationId: string): void {
    if (state.attempt || state.busy) return;
    setState((draft) => {
      draft.open = draft.open === integrationId ? null : integrationId;
      draft.chosen = null;
      draft.error = "";
      draft.note = "";
    });
  }

  function choose(integrationId: string, method: HxOcMethod): void {
    setState((draft) => {
      draft.chosen = { integrationId, method };
      draft.key = "";
      draft.answer = Object.fromEntries(method.fields.map((field) => [field.key, initialOf(field)]));
      draft.error = "";
      draft.note = "";
    });
    // A sign-in with no questions starts at once: there is nothing to fill in first. The store write above
    // lands at the next flush, so the choice is passed on, not read back.
    if (method.kind === "oauth" && method.fields.every((field) => field.kind === "link"))
      void submit({ integrationId, method });
  }

  /** The first required question that is still empty, or null. */
  function missing(method: HxOcMethod): HxOcField | null {
    return (
      method.fields.find(
        (field) =>
          field.required &&
          field.kind !== "link" &&
          visible(field, method.fields, state.answer) &&
          String(state.answer[field.key] ?? "").trim() === "",
      ) ?? null
    );
  }

  async function submit(target: Chosen | null = state.chosen): Promise<void> {
    const chosen = target;
    if (!chosen || state.busy) return;
    const empty = missing(chosen.method);
    if (empty) {
      setState((draft) => {
        draft.error = t("settings.hxOpenCode.requiredMissing", { field: empty.title });
      });
      return;
    }
    const answer: Record<string, string | boolean> = {};
    for (const field of chosen.method.fields) {
      if (field.kind === "link" || !visible(field, chosen.method.fields, state.answer)) continue;
      const value = state.answer[field.key];
      if (value !== undefined && value !== "") answer[field.key] = value;
    }
    const given = Object.keys(answer).length > 0 ? answer : null;
    const { integrationId, method } = chosen;
    setState((draft) => {
      draft.busy = true;
      draft.error = "";
    });
    try {
      if (method.kind === "key") {
        const catalog = await port().hxOpenCodeConnectKey({ integrationId, key: state.key, answer: given });
        setState((draft) => {
          draft.catalog = catalog;
          draft.chosen = null;
          draft.key = "";
          draft.note = t("settings.hxOpenCode.done", { name: nameOf(integrationId) });
        });
      } else if (method.kind === "external" && method.id) {
        const catalog = await port().hxOpenCodeConnectExternal({ integrationId, methodId: method.id, answer: given });
        setState((draft) => {
          draft.catalog = catalog;
          draft.chosen = null;
          draft.note = t("settings.hxOpenCode.done", { name: nameOf(integrationId) });
        });
      } else if (method.kind === "oauth" && method.id) {
        const attempt = await port().hxOpenCodeStartSignIn({ integrationId, methodId: method.id, answer: given });
        setState((draft) => {
          draft.attempt = attempt;
        });
      }
    } catch (error) {
      setState((draft) => {
        draft.key = "";
        draft.error = t("settings.hxOpenCode.error", { detail: describe(error) });
      });
    } finally {
      setState((draft) => {
        draft.busy = false;
      });
    }
  }

  async function sendCode(): Promise<void> {
    const attempt = state.attempt;
    if (!attempt || state.busy || !state.code.trim()) return;
    setState((draft) => {
      draft.busy = true;
    });
    try {
      const status = await port().hxOpenCodeCompleteSignIn({
        integrationId: attempt.integrationId,
        attemptId: attempt.attemptId,
        code: state.code,
      });
      await ended(attempt, status.status, status.message);
    } catch (error) {
      await ended(attempt, "failed", describe(error));
    } finally {
      setState((draft) => {
        draft.busy = false;
      });
    }
  }

  async function disconnect(integration: HxOcIntegration, connection: HxOcConnection): Promise<void> {
    if (state.busy) return;
    setState((draft) => {
      draft.busy = true;
      draft.error = "";
      draft.note = "";
    });
    try {
      const catalog = await port().hxOpenCodeDisconnect({ integrationId: integration.id, credentialId: connection.id });
      setState((draft) => {
        draft.catalog = catalog;
        draft.note = t("settings.hxOpenCode.removed", { name: integration.name });
      });
    } catch (error) {
      setState((draft) => {
        draft.error = t("settings.hxOpenCode.error", { detail: describe(error) });
      });
    } finally {
      setState((draft) => {
        draft.busy = false;
      });
    }
  }

  const close = () => {
    if (state.attempt) stopAttempt();
    props.onClose();
  };

  /** What a row says under the name: connected and how many models, or the ways in. */
  function summary(integration: HxOcIntegration): string {
    if (integration.connections.length > 0) {
      const count = state.catalog?.models[integration.id];
      return count
        ? `${t("settings.hxOpenCode.connected")} · ${t("settings.hxOpenCode.models", { count })}`
        : t("settings.hxOpenCode.connected");
    }
    const kinds = [...new Set(integration.methods.map((method) => method.kind))];
    return kinds.map((kind) => t(WAY_KEY[kind])).join(" · ");
  }

  function methodLabel(method: HxOcMethod): string {
    if (method.kind === "oauth") return t("settings.hxOpenCode.signInWith", { label: method.label ?? "" });
    if (method.kind === "external") return t("settings.hxOpenCode.useExternal", { label: method.label ?? "" });
    return t("settings.hxOpenCode.useKey");
  }

  function connectionText(connection: HxOcConnection): string {
    if (connection.kind === "env") return t("settings.hxOpenCode.connection.env", { name: connection.label });
    const label = connection.label;
    if (connection.method === "key") return t("settings.hxOpenCode.connection.key", { label });
    if (connection.method === "oauth") return t("settings.hxOpenCode.connection.oauth", { label });
    if (connection.method === "external") return t("settings.hxOpenCode.connection.external", { label });
    return label;
  }

  function setAnswer(key: string, value: string | boolean): void {
    setState((draft) => {
      draft.answer[key] = value;
    });
  }

  function FieldControl(field: HxOcField, fields: readonly HxOcField[]) {
    return (
      <Show when={visible(field, fields, state.answer)}>
        <Show
          when={field.kind === "link"}
          fallback={
            <Field label={field.title} description={field.description ?? undefined} required={field.required}>
              <Show
                when={field.kind === "choice"}
                fallback={
                  <Show
                    when={field.kind === "boolean"}
                    fallback={
                      <Input
                        autocomplete="off"
                        spellcheck={false}
                        placeholder={field.placeholder ?? undefined}
                        value={String(state.answer[field.key] ?? "")}
                        disabled={state.busy}
                        onValueChange={(value) => setAnswer(field.key, value)}
                      />
                    }
                  >
                    <Checkbox
                      checked={state.answer[field.key] === true}
                      aria-label={field.title}
                      disabled={state.busy}
                      onChange={(event) => setAnswer(field.key, event.currentTarget.checked)}
                    />
                  </Show>
                }
              >
                <Select<string>
                  options={field.options.map((option) => option.value)}
                  value={String(state.answer[field.key] ?? "")}
                  onChange={(value) => value !== null && setAnswer(field.key, value)}
                  itemComponent={(item) => (
                    <SelectItem item={item.item}>
                      {field.options.find((option) => option.value === item.item.rawValue)?.label ?? item.item.rawValue}
                    </SelectItem>
                  )}
                >
                  <SelectTrigger aria-label={field.title}>
                    <SelectValue<string>>
                      {(selected) =>
                        field.options.find((option) => option.value === selected.selectedOption())?.label ?? ""
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </Show>
            </Field>
          }
        >
          <div class="hx-opencode-link">
            <Text tone="muted" variant="caption">
              {field.description ?? field.title}
            </Text>
            <Button type="button" variant="ghost" size="xs" onClick={() => field.url && void port().openUrl(field.url)}>
              <ExternalLink />
              {t("settings.hxOpenCode.openPage")}
            </Button>
          </div>
        </Show>
      </Show>
    );
  }

  function Panel(integration: HxOcIntegration) {
    const runnable = () => integration.methods.filter((method) => method.kind !== "env");
    const envNames = () => integration.methods.flatMap((method) => (method.kind === "env" ? method.envNames : []));
    return (
      <div class="hx-opencode-panel">
        <For each={integration.connections}>
          {(connection) => (
            <div class="hx-opencode-connection">
              <Text variant="caption">{connectionText(connection)}</Text>
              <Show when={connection.kind === "credential"}>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={state.busy}
                  onClick={() => void disconnect(integration, connection)}
                >
                  {t("settings.hxOpenCode.disconnect")}
                </Button>
              </Show>
            </div>
          )}
        </For>
        <Show
          when={state.chosen?.integrationId === integration.id ? state.chosen : null}
          fallback={
            <div class="hx-opencode-ways">
              <For each={runnable()}>
                {(method) => (
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    disabled={state.busy}
                    onClick={() => choose(integration.id, method)}
                  >
                    {methodLabel(method)}
                  </Button>
                )}
              </For>
              <Show when={runnable().length === 0}>
                <Text tone="muted" variant="caption">
                  {t("settings.hxOpenCode.noWay")}
                </Text>
              </Show>
            </div>
          }
        >
          {(chosen) => (
            <Show
              when={state.attempt?.integrationId === integration.id ? state.attempt : null}
              fallback={
                <form
                  class="hx-opencode-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <Show when={chosen().method.kind === "key"}>
                    <Field label={chosen().method.label ?? t("settings.hxOpenCode.keyLabel")}>
                      <Input
                        type="password"
                        autocomplete="off"
                        spellcheck={false}
                        placeholder={t("settings.hxOpenCode.keyPlaceholder")}
                        value={state.key}
                        disabled={state.busy}
                        onValueChange={(value) =>
                          setState((draft) => {
                            draft.key = value;
                          })
                        }
                      />
                    </Field>
                  </Show>
                  <For each={chosen().method.fields}>{(field) => FieldControl(field, chosen().method.fields)}</For>
                  <div class="hx-opencode-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={state.busy}
                      onClick={() =>
                        setState((draft) => {
                          draft.chosen = null;
                        })
                      }
                    >
                      {t("settings.hxOpenCode.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={state.busy || (chosen().method.kind === "key" && !state.key.trim())}
                    >
                      <Show when={state.busy}>
                        <LoaderCircle class="hx-opencode-spin" />
                      </Show>
                      {t("settings.hxOpenCode.connect")}
                    </Button>
                  </div>
                </form>
              }
            >
              {(attempt) => (
                <div class="hx-opencode-form" role="status">
                  <Text variant="caption">{t("settings.hxOpenCode.waiting")}</Text>
                  <Show when={attempt().instructions}>
                    <Text tone="muted" variant="caption">
                      {attempt().instructions}
                    </Text>
                  </Show>
                  <Show when={attempt().mode === "code"}>
                    <Field label={t("settings.hxOpenCode.codeLabel")}>
                      <Input
                        type="password"
                        autocomplete="off"
                        spellcheck={false}
                        value={state.code}
                        disabled={state.busy}
                        onValueChange={(value) =>
                          setState((draft) => {
                            draft.code = value;
                          })
                        }
                      />
                    </Field>
                  </Show>
                  <div class="hx-opencode-actions">
                    <Button type="button" variant="ghost" size="sm" onClick={stopAttempt}>
                      {t("settings.hxOpenCode.cancel")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void port().openUrl(attempt().url)}>
                      <ExternalLink />
                      {t("settings.hxOpenCode.reopen")}
                    </Button>
                    <Show when={attempt().mode === "code"}>
                      <Button
                        type="button"
                        size="sm"
                        disabled={state.busy || !state.code.trim()}
                        onClick={() => void sendCode()}
                      >
                        {t("settings.hxOpenCode.submitCode")}
                      </Button>
                    </Show>
                  </div>
                </div>
              )}
            </Show>
          )}
        </Show>
        <Show when={envNames().length > 0}>
          <Text tone="muted" variant="caption">
            {t("settings.hxOpenCode.envHint", { names: envNames().join(", ") })}
          </Text>
        </Show>
      </div>
    );
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog hx-opencode-dialog">
            <Dialog.Title class="sr-only">{t("settings.hxOpenCode.title")}</Dialog.Title>
            <Dialog.Description class="sr-only">{t("settings.hxOpenCode.subtitle")}</Dialog.Description>
            <header class="custom-provider-header">
              <span class="custom-provider-mark" aria-hidden="true">
                <Plug />
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  {t("settings.hxOpenCode.title")}
                </Heading>
                <Text tone="muted" variant="caption">
                  {t("settings.hxOpenCode.subtitle")}
                </Text>
              </div>
              <IconButton class="custom-provider-close" label={t("common.close")} variant="ghost" onClick={close}>
                <X />
              </IconButton>
            </header>

            <div class="custom-provider-list hx-opencode-body">
              <Show when={state.loading && !state.catalog}>
                <Text tone="muted" variant="caption" role="status">
                  {t("settings.hxOpenCode.loading")}
                </Text>
              </Show>
              <Show when={state.catalog}>
                {(catalog) => (
                  <Show
                    when={catalog().state === "ready"}
                    fallback={
                      <div class="hx-opencode-state" role="status">
                        <Text variant="caption">
                          {catalog().state === "missing"
                            ? t("settings.hxOpenCode.missing")
                            : catalog().state === "old"
                              ? t("settings.hxOpenCode.old", { version: catalog().version ?? "" })
                              : t("settings.hxOpenCode.failed", { detail: catalog().message ?? "" })}
                        </Text>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={state.loading}
                          onClick={() => void load()}
                        >
                          {t("settings.hxOpenCode.retry")}
                        </Button>
                      </div>
                    }
                  >
                    <Input
                      type="search"
                      placeholder={t("settings.hxOpenCode.search")}
                      aria-label={t("settings.hxOpenCode.search")}
                      autocomplete="off"
                      value={state.query}
                      onValueChange={(value) =>
                        setState((draft) => {
                          draft.query = value;
                        })
                      }
                    />
                    <div class="hx-opencode-free">
                      <span class="custom-provider-preset-icon" aria-hidden="true">
                        <Gift />
                      </span>
                      <span class="custom-provider-preset-copy">
                        <span class="custom-provider-preset-title">{t("settings.hxOpenCode.freeTitle")}</span>
                        <span class="custom-provider-preset-description">
                          {t("settings.hxOpenCode.freeDetail", { count: catalog().freeModels })}
                        </span>
                      </span>
                      <Badge variant="success-light">{t("settings.hxOpenCode.ready")}</Badge>
                    </div>
                    <ul class="custom-provider-presets hx-opencode-list">
                      <For each={matches()}>
                        {(integration) => (
                          <li>
                            <Button
                              type="button"
                              variant="ghost"
                              class="custom-provider-preset"
                              aria-expanded={state.open === integration.id ? "true" : "false"}
                              onClick={() => toggle(integration.id)}
                            >
                              <span class="custom-provider-preset-copy">
                                <span class="custom-provider-preset-title">{integration.name}</span>
                                <span class="custom-provider-preset-description">{summary(integration)}</span>
                              </span>
                              <Show when={integration.connections.length > 0}>
                                <Badge variant="success-light">{t("settings.hxOpenCode.connected")}</Badge>
                              </Show>
                              <ChevronRight class="custom-provider-preset-chevron" aria-hidden="true" />
                            </Button>
                            <Show when={state.open === integration.id}>{Panel(integration)}</Show>
                          </li>
                        )}
                      </For>
                    </ul>
                    <Show when={state.query.trim() && matches().length === 0}>
                      <Text tone="muted" variant="caption">
                        {t("settings.hxOpenCode.empty", { query: state.query.trim() })}
                      </Text>
                    </Show>
                  </Show>
                )}
              </Show>
              <Show when={state.error}>
                <Alert tone="danger" role="alert" report={false}>
                  <AlertContent>
                    <AlertDescription>{state.error}</AlertDescription>
                  </AlertContent>
                </Alert>
              </Show>
              <Show when={state.note}>
                <Text variant="caption" role="status">
                  {state.note}
                </Text>
              </Show>
              <Text tone="muted" variant="caption">
                {t("settings.hxOpenCode.note")}
              </Text>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
