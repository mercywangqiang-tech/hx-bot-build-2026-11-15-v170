import type { HxAccessLogView, HxAccessRuleView } from "@hxbot/contracts/hx-access-settings";
import type { AppTextKey } from "@hxbot/i18n";
import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
} from "@hxbot/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { accountPort } from "../account/account-port";

/** The kinds of a target and of a record line, with their labels. Anything else shows as it is. */
const TARGET_KEYS: Readonly<Record<string, AppTextKey>> = {
  folder: "settings.hxAccess.target.folder",
  file: "settings.hxAccess.target.file",
  website: "settings.hxAccess.target.website",
  command: "settings.hxAccess.target.command",
  password: "settings.hxAccess.target.password",
  payment: "settings.hxAccess.target.payment",
  vault: "settings.hxAccess.target.vault",
};
const ACTION_KEYS: Readonly<Record<string, AppTextKey>> = {
  read: "settings.hxAccess.action.read",
  write: "settings.hxAccess.action.write",
  delete: "settings.hxAccess.action.delete",
};
const KIND_KEYS: Readonly<Record<string, AppTextKey>> = {
  read: "settings.hxAccess.kind.read",
  write: "settings.hxAccess.kind.write",
  delete: "settings.hxAccess.kind.delete",
  command: "settings.hxAccess.kind.command",
  screen: "settings.hxAccess.kind.screen",
  search: "settings.hxAccess.kind.search",
  password: "settings.hxAccess.kind.password",
  payment: "settings.hxAccess.kind.payment",
  vault: "settings.hxAccess.kind.vault",
  request: "settings.hxAccess.kind.request",
};
const OUTCOME_KEYS: Readonly<Record<string, AppTextKey>> = {
  auto: "settings.hxAccess.outcome.auto",
  once: "settings.hxAccess.outcome.once",
  always: "settings.hxAccess.outcome.always",
  held: "settings.hxAccess.outcome.held",
  "allowed-once": "settings.hxAccess.outcome.allowedOnce",
  "allowed-always": "settings.hxAccess.outcome.allowedAlways",
  refused: "settings.hxAccess.outcome.refused",
};

/**
 * HXBot：设置 → 授权与记录。上面是“始终允许”的规则（对所有助手有效，可以删除，删除后同样的事会重新问）；
 * 下面是操作记录：工作区以外的读写、删除、命令、截图、搜索、登录、付款和每次确认，只保存在这台电脑上。
 */
export function HxAccessSettingsTab(props: { visible: boolean }) {
  const i18n = useI18n();
  const t = i18n.t;
  const [rules, setRules] = createSignal<HxAccessRuleView[]>([]);
  const [log, setLog] = createSignal<HxAccessLogView[]>([]);
  const [failed, setFailed] = createSignal(false);

  async function load() {
    try {
      const auth = accountPort().auth;
      const [nextRules, nextLog] = await Promise.all([auth.hxAccessRules(), auth.hxAccessLog()]);
      setRules(nextRules);
      setLog(nextLog);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  createEffect(
    () => props.visible,
    (visible) => {
      if (visible) void load();
    },
  );

  async function remove(id: string) {
    try {
      await accountPort().auth.hxAccessRemoveRule(id);
    } finally {
      await load();
    }
  }

  async function clearLog() {
    try {
      await accountPort().auth.hxAccessClearLog();
    } finally {
      await load();
    }
  }

  const label = (keys: Readonly<Record<string, AppTextKey>>, value: string) => {
    const key = keys[value];
    return key ? t(key) : value;
  };
  const when = (at: number) =>
    at > 0
      ? new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(at))
      : "";
  const targetText = (rule: HxAccessRuleView) =>
    rule.targets
      .map((target) =>
        `${label(TARGET_KEYS, target.type)} ${target.value === "*" ? t("settings.hxAccess.target.any") : target.value}`.trim(),
      )
      .join(" · ");

  return (
    <>
      <Show when={failed()}>
        <Text as="p" variant="caption" tone="danger" role="alert">
          {t("settings.hxAccess.loadFailed")}
        </Text>
      </Show>
      <SettingsSection
        title={t("settings.hxAccess.rules.title")}
        description={t("settings.hxAccess.rules.description")}
        data-settings-row="settings.hxAccess.rules.title"
      >
        <ItemGroup class="settings-modal-card">
          <Show
            when={rules().length > 0}
            fallback={
              <Item>
                <ItemContent>
                  <ItemDescription>{t("settings.hxAccess.rules.empty")}</ItemDescription>
                </ItemContent>
              </Item>
            }
          >
            <For each={rules()}>
              {(rule) => (
                <Item>
                  <ItemContent>
                    <ItemTitle>{targetText(rule)}</ItemTitle>
                    <Show
                      when={
                        rule.actions.length > 0 &&
                        rule.targets.some((target) => target.type === "folder" || target.type === "file")
                      }
                    >
                      <ItemDescription>
                        {rule.actions.map((action) => label(ACTION_KEYS, action)).join(" · ")}
                      </ItemDescription>
                    </Show>
                    <ItemDescription>
                      {t("settings.hxAccess.rules.from", {
                        agent: rule.agentName || "HXBot",
                        date: when(rule.createdAt),
                      })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button type="button" variant="outline" size="sm" onClick={() => void remove(rule.id)}>
                      {t("settings.hxAccess.rules.remove")}
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </For>
          </Show>
        </ItemGroup>
      </SettingsSection>
      <SettingsSection
        title={t("settings.hxAccess.log.title")}
        description={t("settings.hxAccess.log.description")}
        data-settings-row="settings.hxAccess.log.title"
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t("settings.hxAccess.log.refresh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void clearLog()}
              disabled={log().length === 0}
            >
              {t("settings.hxAccess.log.clear")}
            </Button>
          </>
        }
      >
        <ItemGroup class="settings-modal-card">
          <Show
            when={log().length > 0}
            fallback={
              <Item>
                <ItemContent>
                  <ItemDescription>{t("settings.hxAccess.log.empty")}</ItemDescription>
                </ItemContent>
              </Item>
            }
          >
            <For each={log()}>
              {(entry) => (
                <Item>
                  <ItemContent>
                    <ItemTitle>
                      {label(KIND_KEYS, entry.kind)}
                      {entry.detail ? ` ${entry.detail}` : ""}
                    </ItemTitle>
                    <ItemDescription>
                      {when(entry.at)} · {entry.agent || "HXBot"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge>{label(OUTCOME_KEYS, entry.outcome)}</Badge>
                  </ItemActions>
                </Item>
              )}
            </For>
          </Show>
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
