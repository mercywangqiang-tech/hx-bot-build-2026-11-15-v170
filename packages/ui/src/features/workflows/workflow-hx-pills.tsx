// HXBot v1.7.5（RTN-11）：智能体节点上的“步骤类型”和“自动”模型。单独一个文件，智能体节点和 HXBot 的步骤都用它。
import {
  HX_WORKFLOW_AUTO_MODEL,
  HX_WORKFLOW_STEP_FIELD,
  HX_WORKFLOW_STEP_KINDS,
  type HxWorkflowStepKind,
} from "@hxbot/contracts/hx-workflows";
import type { AppTextKey } from "@hxbot/i18n";
import { Bot, Button, buttonVariants, ChevronDown, Cpu, DropdownMenu, Monitor, Sparkles, UsersRound } from "@hxbot/ui";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { useText } from "../../text";
import { useBoard } from "./workflow-board";
import { hxStepOf } from "./workflow-hx-badge";

export const HX_STEP_LABEL = {
  "app-action": "workflow.hx.node.appAction",
  "app-skill": "workflow.hx.node.appSkill",
  team: "workflow.hx.node.team",
} as const satisfies Record<HxWorkflowStepKind, AppTextKey>;

export const HX_STEP_ICON: Record<HxWorkflowStepKind, () => JSX.Element> = {
  "app-action": () => <Monitor aria-hidden="true" />,
  "app-skill": () => <Cpu aria-hidden="true" />,
  team: () => <UsersRound aria-hidden="true" />,
};

/** The step type of an agent node: an agent's task, or one of HXBot's three steps. */
export function HxStepKindPill(props: { id: string; disabled?: boolean }) {
  const board = useBoard();
  const { t } = useText();
  const current = () => hxStepOf(board.field(props.id, HX_WORKFLOW_STEP_FIELD));
  const label = () => {
    const step = current();
    return step ? t(HX_STEP_LABEL[step]) : t("workflow.agent.title");
  };
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-hx-kind-pill`}
        aria-label={label()}
        disabled={props.disabled}
      >
        <span>{label()}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="wfn-menu">
          <DropdownMenu.Item
            class="wfn-menu-item"
            onSelect={() => board.setField(props.id, HX_WORKFLOW_STEP_FIELD, "")}
          >
            <Bot aria-hidden="true" />
            <span>{t("workflow.agent.title")}</span>
          </DropdownMenu.Item>
          <For each={HX_WORKFLOW_STEP_KINDS}>
            {(step) => (
              <DropdownMenu.Item
                class="wfn-menu-item"
                onSelect={() => board.setField(props.id, HX_WORKFLOW_STEP_FIELD, step)}
              >
                {HX_STEP_ICON[step]()}
                <span>{t(HX_STEP_LABEL[step])}</span>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** An agent step's model: the agent's own, or "auto", which HXBot picks for the work of the turn. */
export function HxAutoModelPill(props: { id: string; disabled?: boolean }) {
  const board = useBoard();
  const { t } = useText();
  const auto = () => board.field(props.id, "model") === HX_WORKFLOW_AUTO_MODEL;
  return (
    <Button
      type="button"
      variant={auto() ? "secondary" : "ghost"}
      size="xs"
      class="wfn-pill wfn-hx-auto-pill"
      aria-pressed={auto() ? "true" : "false"}
      disabled={props.disabled}
      onClick={() => {
        if (auto()) {
          const agent = board.catalogs().agents.find((candidate) => candidate.id === board.field(props.id, "agentId"));
          board.setFields(props.id, { model: agent?.model ?? "" });
        } else board.setField(props.id, "model", HX_WORKFLOW_AUTO_MODEL);
      }}
    >
      <Sparkles aria-hidden="true" />
      <span>{auto() ? t("workflow.hx.modelAuto") : t("workflow.hx.modelAgent")}</span>
    </Button>
  );
}
