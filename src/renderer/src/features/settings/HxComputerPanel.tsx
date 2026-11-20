import type { HxComputerStatus, HxSelfTestReport } from "@hxbot/contracts/hx-computer";
import { HX_FILE_VERSION_CAPS, type HxFileVersionsView, hxByteSize } from "@hxbot/contracts/hx-file-change";
import type { HxLearnedView } from "@hxbot/contracts/hx-learned";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
  Text,
} from "@hxbot/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { accountPort } from "../account/account-port";
import { HX_WORK_LABEL, isHxWorkType } from "../agents/hx-work-labels";

/** A failed check shows this much of its detail; the saved report has all of it. */
const PROBLEM_DETAIL_LIMIT = 300;

/** What the panel asks of the main process. A test or a story gives its own. */
export interface HxComputerCalls {
  status(): Promise<HxComputerStatus>;
  rebuild(): Promise<HxComputerStatus>;
  selfTest(): Promise<HxSelfTestReport>;
  /** HXBot (v1.7.3): “停放后自动续做”. */
  setAutoResume(on: boolean): Promise<HxComputerStatus>;
  /** HXBot (v1.7.4): the space for the versions kept before changes, and what they take. */
  versions(): Promise<HxFileVersionsView>;
  /** HXBot (v1.7.4): sets that space; null goes back to the default. */
  setVersionsCap(bytes: number | null): Promise<HxFileVersionsView>;
  /** HXBot (v1.7.5, CONC-13): the times learned from your choices, and the defaults back. */
  learned?(): Promise<HxLearnedView>;
  resetLearned?(): Promise<HxLearnedView>;
}

function portCalls(): HxComputerCalls {
  const auth = accountPort().auth;
  return {
    status: () => auth.hxComputerStatus(),
    rebuild: () => auth.hxComputerRebuild(),
    selfTest: () => auth.hxComputerSelfTest(),
    setAutoResume: (on) => auth.hxComputerSetAutoResume(on),
    versions: () => auth.hxFileVersionsView(),
    setVersionsCap: (bytes) => auth.hxFileVersionsSetCap(bytes),
    learned: () => auth.hxLearnedView(),
    resetLearned: () => auth.hxLearnedReset(),
  };
}

/** The spaces to choose from: the default of this computer, then the fixed ones, smallest first. */
export function hxVersionCapOptions(view: HxFileVersionsView): number[] {
  return [...new Set([view.defaultCapBytes, ...HX_FILE_VERSION_CAPS, view.capBytes])].sort((a, b) => a - b);
}

/**
 * HXBot：设置 → Computer Use 里的“这台电脑上的应用和设置”。显示目录里有多少应用、设置页和设置项，
 * 可以重新建立目录，可以运行自检（在这台电脑上实际读一遍、原样写回，不改变任何设置的值）并把报告存成文件。
 * 还有几项设置没有在这台电脑上核对过时说明一句：自检通过之后，助手才直接修改它们。
 * v1.7.3：开关“停放后自动续做”（默认开）：你在用电脑时助手停放的步骤，你停手后自动接着做。
 */
export function HxComputerPanel(props: {
  visible: boolean;
  calls?: HxComputerCalls;
  /** Where the list of a select opens: the settings dialog. */
  selectMount?: HTMLElement | undefined;
}) {
  const i18n = useI18n();
  const t = i18n.t;
  const calls = () => props.calls ?? portCalls();
  const [status, setStatus] = createSignal<HxComputerStatus | null>(null);
  const [report, setReport] = createSignal<HxSelfTestReport | null>(null);
  const [busy, setBusy] = createSignal<"rebuild" | "self-test" | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [versions, setVersions] = createSignal<HxFileVersionsView | null>(null);
  const [learned, setLearned] = createSignal<HxLearnedView | null>(null);
  const [learnedFailed, setLearnedFailed] = createSignal(false);

  async function load() {
    try {
      setStatus(await calls().status());
      setFailed(false);
    } catch {
      setFailed(true);
    }
    try {
      setVersions(await calls().versions());
    } catch {
      setVersions(null);
    }
    await loadLearned();
  }

  /** v1.7.5 (CONC-13). */
  async function loadLearned() {
    const read = calls().learned;
    if (!read) return;
    try {
      setLearned(await read());
      setLearnedFailed(false);
    } catch {
      setLearnedFailed(true);
    }
  }

  async function resetLearned() {
    const reset = calls().resetLearned;
    if (!reset) return;
    try {
      setLearned(await reset());
      setLearnedFailed(false);
    } catch {
      setLearnedFailed(true);
    }
  }

  const learnedList = (view: HxLearnedView) =>
    Object.entries(view.progressByWork)
      .map(([work, ms]) =>
        t("settings.hxLearned.work", {
          work: isHxWorkType(work) ? t(HX_WORK_LABEL[work]) : work,
          minutes: Math.round(ms / 60_000),
        }),
      )
      .join(", ");

  /** v1.7.4: a smaller space deletes nothing; the next change asks when it is full. */
  async function setVersionsCap(bytes: number) {
    const current = versions();
    if (!current || bytes === current.capBytes) return;
    try {
      setVersions(await calls().setVersionsCap(bytes === current.defaultCapBytes ? null : bytes));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  const capLabel = (bytes: number | undefined) => {
    const view = versions();
    if (bytes === undefined || !view) return "";
    const size = hxByteSize(bytes);
    return bytes === view.defaultCapBytes ? t("settings.hxComputer.versions.default", { size }) : size;
  };

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

  async function setAutoResume(on: boolean) {
    const current = status();
    if (current) setStatus({ ...current, autoResume: on });
    try {
      setStatus(await calls().setAutoResume(on));
      setFailed(false);
    } catch {
      if (current) setStatus(current);
      setFailed(true);
    }
  }

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
        <SwitchField
          data-settings-row="settings.hxComputer.autoResume.title"
          checked={status()?.autoResume !== false}
          disabled={status() === null || !supported()}
          onChange={(checked) => void setAutoResume(checked)}
          label={t("settings.hxComputer.autoResume.title")}
          description={t("settings.hxComputer.autoResume.description")}
        />
        <Show when={calls().learned}>
          <Item data-settings-row="settings.hxLearned.title">
            <ItemContent>
              <ItemTitle>{t("settings.hxLearned.title")}</ItemTitle>
              <Show when={learned()}>
                {(view) => (
                  <>
                    <ItemDescription>
                      {t("settings.hxLearned.description", {
                        minutes: Math.round(view().progressDefaultMs / 60_000),
                        seconds: Math.round(view().yieldMs / 1000),
                      })}
                    </ItemDescription>
                    <ItemDescription data-hx-learned="changed">
                      {Object.keys(view().progressByWork).length > 0
                        ? t("settings.hxLearned.changed", { list: learnedList(view()) })
                        : t("settings.hxLearned.none")}
                    </ItemDescription>
                  </>
                )}
              </Show>
              <Show when={learnedFailed()}>
                <Text variant="caption" tone="danger">
                  {t("settings.hxLearned.failed")}
                </Text>
              </Show>
            </ItemContent>
            <ItemActions>
              <Button type="button" variant="outline" size="sm" onClick={() => void resetLearned()}>
                {t("settings.hxLearned.reset")}
              </Button>
            </ItemActions>
          </Item>
        </Show>
        <Item data-settings-row="settings.hxComputer.versions.title">
          <ItemContent>
            <ItemTitle>{t("settings.hxComputer.versions.title")}</ItemTitle>
            <ItemDescription>{t("settings.hxComputer.versions.description")}</ItemDescription>
            <Show when={versions()}>
              {(view) => (
                <ItemDescription data-hx-computer="versions">
                  {t("settings.hxComputer.versions.usage", {
                    used: hxByteSize(view().usedBytes),
                    count: view().versions,
                  })}
                </ItemDescription>
              )}
            </Show>
            <ItemDescription>{t("settings.hxComputer.versions.git")}</ItemDescription>
          </ItemContent>
          <Show when={versions()}>
            {(view) => (
              <ItemActions>
                <Select<number>
                  class="settings-modal-select"
                  options={hxVersionCapOptions(view())}
                  value={view().capBytes}
                  onChange={(value) => value !== null && void setVersionsCap(value)}
                  placement="bottom-end"
                  itemComponent={(selectProps) => (
                    <SelectItem item={selectProps.item}>{capLabel(selectProps.item.rawValue)}</SelectItem>
                  )}
                >
                  <SelectTrigger size="sm" aria-label={t("settings.hxComputer.versions.cap")}>
                    <SelectValue<number>>{(state) => capLabel(state.selectedOption())}</SelectValue>
                  </SelectTrigger>
                  <SelectContent mount={props.selectMount} />
                </Select>
              </ItemActions>
            )}
          </Show>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}
