import type { HxComputerStatus, HxSelfTestReport } from "@hxbot/contracts/hx-computer";
import {
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

/** A failed check shows this much of its detail; the saved report has all of it. */
const PROBLEM_DETAIL_LIMIT = 300;

/** What the panel asks of the main process. A test or a story gives its own. */
export interface HxComputerCalls {
  status(): Promise<HxComputerStatus>;
  rebuild(): Promise<HxComputerStatus>;
  selfTest(): Promise<HxSelfTestReport>;
}

function portCalls(): HxComputerCalls {
  const auth = accountPort().auth;
  return {
    status: () => auth.hxComputerStatus(),
    rebuild: () => auth.hxComputerRebuild(),
    selfTest: () => auth.hxComputerSelfTest(),
  };
}

/**
 * HXBot：设置 → Computer Use 里的“这台电脑上的应用和设置”。显示目录里有多少应用、设置页和设置项，
 * 可以重新建立目录，可以运行自检（在这台电脑上实际读一遍、原样写回，不改变任何设置的值）并把报告存成文件。
 * 还有几项设置没有在这台电脑上核对过时说明一句：自检通过之后，助手才直接修改它们。
 */
export function HxComputerPanel(props: { visible: boolean; calls?: HxComputerCalls }) {
  const i18n = useI18n();
  const t = i18n.t;
  const calls = () => props.calls ?? portCalls();
  const [status, setStatus] = createSignal<HxComputerStatus | null>(null);
  const [report, setReport] = createSignal<HxSelfTestReport | null>(null);
  const [busy, setBusy] = createSignal<"rebuild" | "self-test" | null>(null);
  const [failed, setFailed] = createSignal(false);

  async function load() {
    try {
      setStatus(await calls().status());
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

  async function rebuild() {
    if (busy() !== null) return;
    setBusy("rebuild");
    setFailed(false);
    try {
      const before = status()?.builtAt ?? null;
      const next = await calls().rebuild();
      setStatus(next);
      // The time of the catalog moves with every scan that found the apps. When it did not move, the
      // scan found nothing: the earlier list stays, and the user is told to try again.
      if (next.platform !== null && next.builtAt === before) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  async function selfTest() {
    if (busy() !== null) return;
    setBusy("self-test");
    setFailed(false);
    try {
      setReport(await calls().selfTest());
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const supported = () => status()?.platform !== null;
  const summary = () => {
    const current = status();
    if (!current) return "";
    if (current.platform === null) return t("settings.hxComputer.unsupported");
    if (current.builtAt === null) return t("settings.hxComputer.notBuilt");
    return t("settings.hxComputer.counts", {
      apps: current.apps,
      pages: current.pages,
      settings: current.settings,
      direct: current.directSettings,
    });
  };
  const problems = () => report()?.items.filter((item) => item.outcome === "failed") ?? [];

  return (
    <SettingsSection
      title={t("settings.hxComputer.title")}
      description={t("settings.hxComputer.description")}
      data-settings-row="settings.hxComputer.title"
    >
      <Show when={failed()}>
        <Text as="p" variant="caption" tone="danger" role="alert">
          {t("settings.hxComputer.failed")}
        </Text>
      </Show>
      <ItemGroup class="settings-modal-card">
        <Item>
          <ItemContent>
            <ItemTitle data-hx-computer="summary">{summary()}</ItemTitle>
            <Show when={(status()?.unchecked ?? 0) > 0}>
              <ItemDescription data-hx-computer="unchecked">
                {t("settings.hxComputer.unchecked", { count: status()?.unchecked ?? 0 })}
              </ItemDescription>
            </Show>
            <Show when={(status()?.disabled.length ?? 0) > 0}>
              <ItemDescription>
                {t("settings.hxComputer.disabled", { count: status()?.disabled.length ?? 0 })}
              </ItemDescription>
            </Show>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void rebuild()}
              disabled={busy() !== null || !supported()}
            >
              {busy() === "rebuild" ? t("settings.hxComputer.working") : t("settings.hxComputer.rebuild")}
            </Button>
          </ItemActions>
        </Item>
        <Item data-settings-row="settings.hxComputer.selfTest.title">
          <ItemContent>
            <ItemTitle>{t("settings.hxComputer.selfTest.title")}</ItemTitle>
            <ItemDescription>{t("settings.hxComputer.selfTest.description")}</ItemDescription>
            <Show when={report()}>
              {(current) => (
                <>
                  <ItemDescription data-hx-computer="result">
                    {t("settings.hxComputer.selfTest.result", {
                      passed: current().passed,
                      failed: current().failed,
                      skipped: current().skipped,
                    })}
                  </ItemDescription>
                  <Show when={current().file !== ""}>
                    <ItemDescription>
                      {t("settings.hxComputer.selfTest.saved", { file: current().file })}
                    </ItemDescription>
                  </Show>
                  <For each={problems()}>
                    {(item) => (
                      <ItemDescription data-hx-computer="problem">
                        {item.id}: {item.detail.slice(0, PROBLEM_DETAIL_LIMIT)}
                      </ItemDescription>
                    )}
                  </For>
                </>
              )}
            </Show>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void selfTest()}
              disabled={busy() !== null || !supported()}
            >
              {busy() === "self-test" ? t("settings.hxComputer.working") : t("settings.hxComputer.selfTest.run")}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}
