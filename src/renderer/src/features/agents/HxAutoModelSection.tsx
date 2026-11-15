import type {
  HxAutoJudge,
  HxAutoModelEntry,
  HxAutoModelSettings,
  HxAutoModelView,
  HxAutoPreference,
  HxModelRef,
  HxProposalMode,
  HxWorkType,
} from "@hxbot/contracts/hx-auto-model";
import {
  HX_TEAM_MEMBER_LIMITS,
  HX_TEAM_MINUTES,
  HX_TEAM_ROUNDS,
  HX_TEAM_TEMPORARY,
  HX_WORK_TYPES,
  type HxTeamTemporary,
} from "@hxbot/contracts/hx-auto-model";
import type { AppTextKey } from "@hxbot/i18n";
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Text } from "@hxbot/ui";
import { SettingsLinkGroup } from "@hxbot/ui/components/SettingsPanel";
import { createEffect, createSignal, For, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { accountPort } from "../account/account-port";

/** What the section asks of the main process. A test or a story gives its own. */
export interface HxAutoModelCalls {
  view(agentId: string): Promise<HxAutoModelView>;
  update(agentId: string, settings: HxAutoModelSettings): Promise<HxAutoModelView>;
}

function portCalls(): HxAutoModelCalls {
  const auth = accountPort().auth;
  return {
    view: (agentId) => auth.hxAutoModelView(agentId),
    update: (agentId, settings) => auth.hxAutoModelUpdate({ agentId, settings }),
  };
}

const PREFERENCES: readonly HxAutoPreference[] = ["free", "balanced", "quality"];
const JUDGES: readonly HxAutoJudge[] = ["rules+model", "rules"];
const PROPOSALS: readonly HxProposalMode[] = ["auto", "always", "off"];

const PREFERENCE_LABEL: Record<HxAutoPreference, AppTextKey> = {
  free: "settings.hxAutoModel.preference.free",
  balanced: "settings.hxAutoModel.preference.balanced",
  quality: "settings.hxAutoModel.preference.quality",
};
const JUDGE_LABEL: Record<HxAutoJudge, AppTextKey> = {
  "rules+model": "settings.hxAutoModel.judge.rulesModel",
  rules: "settings.hxAutoModel.judge.rules",
};
const PROPOSAL_LABEL: Record<HxProposalMode, AppTextKey> = {
  auto: "settings.hxAutoModel.proposal.auto",
  always: "settings.hxAutoModel.proposal.always",
  off: "settings.hxAutoModel.proposal.off",
};
const TEMPORARY_LABEL: Record<HxTeamTemporary, AppTextKey> = {
  collapse: "settings.hxAutoModel.team.temporary.collapse",
  keep: "settings.hxAutoModel.team.temporary.keep",
};
type TeamMembers = HxAutoModelSettings["teamMembers"];
type TeamMinutes = HxAutoModelSettings["teamMinutes"];
type TeamRounds = HxAutoModelSettings["teamRounds"];
const WORK_LABEL: Record<HxWorkType, AppTextKey> = {
  chat: "settings.hxAutoModel.work.chat",
  writing: "settings.hxAutoModel.work.writing",
  "code-small": "settings.hxAutoModel.work.codeSmall",
  "code-large": "settings.hxAutoModel.work.codeLarge",
  data: "settings.hxAutoModel.work.data",
  vision: "settings.hxAutoModel.work.vision",
  "long-context": "settings.hxAutoModel.work.longContext",
  reasoning: "settings.hxAutoModel.work.reasoning",
  computer: "settings.hxAutoModel.work.computer",
};
const COST_LABEL: Record<HxAutoModelEntry["cost"], AppTextKey> = {
  free: "settings.hxAutoModel.cost.free",
  subscription: "settings.hxAutoModel.cost.subscription",
  paid: "settings.hxAutoModel.cost.paid",
};

function sameRef(left: HxModelRef, right: HxModelRef): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.providerAccountId ?? "default") === (right.providerAccountId ?? "default")
  );
}

/**
 * HXBot：智能体设置里的“自动选择模型”和“建议卡”。打开后，这个智能体每件新工作先判断是什么、有多难，
 * 再从候选模型里选一个（hx-auto-model）；对话里有一行小字写明用了哪个模型。下面可以看到现在每种工作会用
 * 哪个模型、候选模型（可以取消勾选）和最近的选择。只在这台电脑上的智能体有这一节。
 */
export function HxAutoModelSection(props: { agentId: string; calls?: HxAutoModelCalls }) {
  const i18n = useI18n();
  const t = i18n.t;
  const calls = () => props.calls ?? portCalls();
  const [view, setView] = createSignal<HxAutoModelView | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [more, setMore] = createSignal(false);
  // v1.6.7: the team limits are one line; the four choices show only when the user opens them.
  const [teamOpen, setTeamOpen] = createSignal(false);

  createEffect(
    () => props.agentId,
    (agentId) => {
      setView(null);
      void calls()
        .view(agentId)
        .then((next) => {
          if (next.agentId === props.agentId) setView(next);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    },
  );

  async function save(patch: Partial<HxAutoModelSettings>) {
    const current = view();
    if (!current) return;
    try {
      setView(await calls().update(current.agentId, { ...current.settings, ...patch }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  function toggleExcluded(ref: HxModelRef, use: boolean) {
    const current = view();
    if (!current) return;
    const excluded = current.settings.excluded.filter((item) => !sameRef(item, ref));
    void save({ excluded: use ? excluded : [...excluded, ref] });
  }

  const time = (at: number) =>
    new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(at));

  return (
    <Show when={view()}>
      {(current) => (
        <SettingsLinkGroup inset title={t("settings.hxAutoModel.title")} class="agent-settings-runtime-rows">
          <div class="agent-settings-notifications">
            <div>
              <strong>{t("settings.hxAutoModel.enabled")}</strong>
              <span>{t("settings.hxAutoModel.description")}</span>
            </div>
            <Switch
              size="sm"
              aria-label={t("settings.hxAutoModel.enabled")}
              checked={current().settings.enabled}
              onChange={(enabled) => void save({ enabled })}
            />
          </div>
          <Show when={current().settings.enabled}>
            <Select<HxAutoPreference>
              class="agent-settings-runtime-select"
              options={[...PREFERENCES]}
              value={current().settings.preference}
              onChange={(preference) => preference && void save({ preference })}
              itemComponent={(item) => (
                <SelectItem item={item.item}>{t(PREFERENCE_LABEL[item.item.rawValue])}</SelectItem>
              )}
            >
              <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.hxAutoModel.preference")}>
                <span class="agent-settings-runtime-label">{t("settings.hxAutoModel.preference")}</span>
                <SelectValue<HxAutoPreference>>
                  {(state) => t(PREFERENCE_LABEL[state.selectedOption() ?? current().settings.preference])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
            <Select<HxAutoJudge>
              class="agent-settings-runtime-select"
              options={[...JUDGES]}
              value={current().settings.judge}
              onChange={(judge) => judge && void save({ judge })}
              itemComponent={(item) => <SelectItem item={item.item}>{t(JUDGE_LABEL[item.item.rawValue])}</SelectItem>}
            >
              <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.hxAutoModel.judge")}>
                <span class="agent-settings-runtime-label">{t("settings.hxAutoModel.judge")}</span>
                <SelectValue<HxAutoJudge>>
                  {(state) => t(JUDGE_LABEL[state.selectedOption() ?? current().settings.judge])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
            <div class="agent-settings-notifications">
              <div>
                <strong>{t("settings.hxAutoModel.crossProvider.title")}</strong>
                <span>{t("settings.hxAutoModel.crossProvider.description")}</span>
              </div>
              <Switch
                size="sm"
                aria-label={t("settings.hxAutoModel.crossProvider.title")}
                checked={current().settings.crossProvider}
                onChange={(crossProvider) => void save({ crossProvider })}
              />
            </div>
            <div class="agent-settings-notifications">
              <div>
                <strong>{t("settings.hxAutoModel.suggestStronger.title")}</strong>
                <span>{t("settings.hxAutoModel.suggestStronger.description")}</span>
              </div>
              <Switch
                size="sm"
                aria-label={t("settings.hxAutoModel.suggestStronger.title")}
                checked={current().settings.suggestStronger}
                onChange={(suggestStronger) => void save({ suggestStronger })}
              />
            </div>
          </Show>
          <Select<HxProposalMode>
            class="agent-settings-runtime-select"
            options={[...PROPOSALS]}
            value={current().settings.proposal}
            onChange={(proposal) => proposal && void save({ proposal })}
            itemComponent={(item) => <SelectItem item={item.item}>{t(PROPOSAL_LABEL[item.item.rawValue])}</SelectItem>}
          >
            <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.hxAutoModel.proposal")}>
              <span class="agent-settings-runtime-label">{t("settings.hxAutoModel.proposal")}</span>
              <SelectValue<HxProposalMode>>
                {(state) => t(PROPOSAL_LABEL[state.selectedOption() ?? current().settings.proposal])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
          <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
            {t("settings.hxAutoModel.proposal.description")}
          </Text>
          {/* v1.6.6: the limits of a team that this agent starts from a card (hx-team). v1.6.7: one line
              with the limits, at their strongest by default; the choices show when the user opens them. */}
          <Show when={current().settings.proposal !== "off"}>
            <div class="agent-settings-notifications">
              <div>
                <strong>
                  {t("settings.hxAutoModel.team.summary", {
                    members: current().settings.teamMembers,
                    minutes: current().settings.teamMinutes,
                    rounds: current().settings.teamRounds,
                  })}
                </strong>
                <span>{t("settings.hxAutoModel.team.summaryDescription")}</span>
              </div>
              <Switch
                size="sm"
                aria-label={t("settings.hxAutoModel.team.change")}
                checked={teamOpen()}
                onChange={(next) => setTeamOpen(next)}
              />
            </div>
          </Show>
          <Show when={current().settings.proposal !== "off" && teamOpen()}>
            <Select<TeamMembers>
              class="agent-settings-runtime-select"
              options={[...HX_TEAM_MEMBER_LIMITS]}
              value={current().settings.teamMembers}
              onChange={(teamMembers) => teamMembers && void save({ teamMembers })}
              itemComponent={(item) => <SelectItem item={item.item}>{String(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.hxAutoModel.team.members")}>
                <span class="agent-settings-runtime-label">{t("settings.hxAutoModel.team.members")}</span>
                <SelectValue<TeamMembers>>
                  {(state) => String(state.selectedOption() ?? current().settings.teamMembers)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
            <Select<TeamMinutes>
              class="agent-settings-runtime-select"
              options={[...HX_TEAM_MINUTES]}
              value={current().settings.teamMinutes}
              onChange={(teamMinutes) => teamMinutes && void save({ teamMinutes })}
              itemComponent={(item) => (
                <SelectItem item={item.item}>
                  {t("settings.hxAutoModel.team.minuteValue", { count: item.item.rawValue })}
                </SelectItem>
              )}
            >
              <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.hxAutoModel.team.minutes")}>
                <span class="agent-settings-runtime-label">{t("settings.hxAutoModel.team.minutes")}</span>
                <SelectValue<TeamMinutes>>
                  {(state) =>
                    t("settings.hxAutoModel.team.minuteValue", {
                      count: state.selectedOption() ?? current().settings.teamMinutes,
                    })
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
            <Select<TeamRounds>
              class="agent-settings-runtime-select"
              options={[...HX_TEAM_ROUNDS]}
              value={current().settings.teamRounds}
              onChange={(teamRounds) => teamRounds && void save({ teamRounds })}
              itemComponent={(item) => <SelectItem item={item.item}>{String(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.hxAutoModel.team.rounds")}>
                <span class="agent-settings-runtime-label">{t("settings.hxAutoModel.team.rounds")}</span>
                <SelectValue<TeamRounds>>
                  {(state) => String(state.selectedOption() ?? current().settings.teamRounds)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
            <Select<HxTeamTemporary>
              class="agent-settings-runtime-select"
              options={[...HX_TEAM_TEMPORARY]}
              value={current().settings.teamTemporary}
              onChange={(teamTemporary) => teamTemporary && void save({ teamTemporary })}
              itemComponent={(item) => (
                <SelectItem item={item.item}>{t(TEMPORARY_LABEL[item.item.rawValue])}</SelectItem>
              )}
            >
              <SelectTrigger class="agent-settings-runtime-row" aria-label={t("settings.hxAutoModel.team.temporary")}>
                <span class="agent-settings-runtime-label">{t("settings.hxAutoModel.team.temporary")}</span>
                <SelectValue<HxTeamTemporary>>
                  {(state) => t(TEMPORARY_LABEL[state.selectedOption() ?? current().settings.teamTemporary])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
            <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
              {t("settings.hxAutoModel.team.description")}
            </Text>
          </Show>
          <Show when={current().settings.enabled}>
            <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
              <strong>{t("settings.hxAutoModel.preview")}</strong>{" "}
              <For each={HX_WORK_TYPES.filter((work) => current().preview[work])}>
                {(work, index) => (
                  <span>
                    {index() > 0 ? " · " : ""}
                    {t(WORK_LABEL[work])} → {current().preview[work]?.name}
                  </span>
                )}
              </For>
            </Text>
            <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
              <Show
                when={current().freeQuota.blockedUntil}
                fallback={t("settings.hxAutoModel.freeUsed", { count: current().freeQuota.usedToday })}
              >
                {(until) => t("settings.hxAutoModel.freeBlocked", { time: time(until()) })}
              </Show>
            </Text>
            <div class="agent-settings-notifications">
              <div>
                <strong>{t("settings.hxAutoModel.more")}</strong>
                <span>{t("settings.hxAutoModel.models.description")}</span>
              </div>
              <Switch
                size="sm"
                aria-label={t("settings.hxAutoModel.more")}
                checked={more()}
                onChange={(next) => setMore(next)}
              />
            </div>
            <Show when={more()}>
              <For each={current().models}>
                {(model) => (
                  <div class="agent-settings-notifications">
                    <div>
                      <strong>{model.name}</strong>
                      <span>
                        {t(COST_LABEL[model.cost])} · {model.tier}
                        {model.vision ? ` · ${t("settings.hxAutoModel.vision")}` : ""}
                        {model.ready ? "" : ` · ${t("settings.hxAutoModel.notReady")}`}
                      </span>
                    </div>
                    <Checkbox
                      checked={!model.excluded}
                      aria-label={model.name}
                      onChange={(event) => toggleExcluded(model.ref, event.currentTarget.checked)}
                    />
                  </div>
                )}
              </For>
              <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                <strong>{t("settings.hxAutoModel.recent")}</strong>
              </Text>
              <Show
                when={current().decisions.length > 0}
                fallback={
                  <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                    {t("settings.hxAutoModel.recent.empty")}
                  </Text>
                }
              >
                <For each={current().decisions.slice(0, 10)}>
                  {(decision) => (
                    <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                      {time(decision.at)} · {t(WORK_LABEL[decision.work])} ·{" "}
                      {t(decision.kept ? "settings.hxAutoModel.recent.kept" : "settings.hxAutoModel.recent.switched", {
                        model: decision.chosen.name,
                      })}
                    </Text>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
          <Show when={failed()}>
            <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
              {t("settings.hxAutoModel.failed")}
            </Text>
          </Show>
        </SettingsLinkGroup>
      )}
    </Show>
  );
}
