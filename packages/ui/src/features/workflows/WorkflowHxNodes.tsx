// HXBot v1.7.5（RTN-11、RTN-08）：工作流画布上的三种新步骤：应用操作、应用技能、团队任务。它们存成带
// hxStep 字段的“智能体”节点（发布过的数据库表把节点类型列死了），所以在智能体节点上选“步骤类型”就能换。
// 智能体步骤还可以选“自动”模型。没有执行器的节点（图片、素材、文件输出、消息触发、以后版本的步骤）
// 标“暂不支持”，保存、调用和运行都会被主机拒绝。每种能运行的节点写明它需要什么、能不能安全重做、怎么核对。
import {
  HX_NODE_DECLARATIONS,
  HX_WORKFLOW_STEP_FIELD,
  type HxNodeDeclaration,
  type HxWorkflowStepKind,
} from "@hxbot/contracts/hx-workflows";
import type { AppTextKey } from "@hxbot/i18n";
import { Button, Input, NativeSelect, Play, Textarea } from "@hxbot/ui";
import { For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { AgentNode, AgentPill } from "./WorkflowAgentNode";
import { useBoard } from "./workflow-board";
import { hxStepOf } from "./workflow-hx-badge";
import { HX_STEP_ICON, HX_STEP_LABEL, HxStepKindPill } from "./workflow-hx-pills";
import {
  asString,
  Field,
  NodeShell,
  NodeToolbar,
  ResultField,
  useField,
  useLocked,
  useStepRun,
  useTextField,
} from "./workflow-node-parts";

const STEP_HINT = {
  "app-action": "workflow.hx.node.appActionHint",
  "app-skill": "workflow.hx.node.appSkillHint",
  team: "workflow.hx.node.teamHint",
} as const satisfies Record<HxWorkflowStepKind, AppTextKey>;

const PERMISSION = {
  none: "workflow.hx.permission.none",
  person: "workflow.hx.permission.person",
  agent: "workflow.hx.permission.agent",
  "computer-use": "workflow.hx.permission.computer-use",
  connection: "workflow.hx.permission.connection",
} as const satisfies Record<HxNodeDeclaration["permission"], AppTextKey>;

const IDEMPOTENT = {
  yes: "workflow.hx.idempotent.yes",
  key: "workflow.hx.idempotent.key",
  no: "workflow.hx.idempotent.no",
} as const satisfies Record<HxNodeDeclaration["idempotent"], AppTextKey>;

const READBACK = {
  value: "workflow.hx.readback.value",
  answer: "workflow.hx.readback.answer",
  file: "workflow.hx.readback.file",
  delivery: "workflow.hx.readback.delivery",
  post: "workflow.hx.readback.post",
  team: "workflow.hx.readback.team",
  person: "workflow.hx.readback.person",
} as const satisfies Record<HxNodeDeclaration["readback"], AppTextKey>;

/** The shape of each JSON setting, as code: it reads the same in every language. */
const ACTIONS_EXAMPLE = JSON.stringify([{ tool: "computer_open", arguments: { query: "Numbers" } }]);
const ARGS_EXAMPLE = JSON.stringify({ files: ["report.xlsx"] });
const TEAM_EXAMPLE = JSON.stringify({ goal: "…", roles: [], steps: [] });

/** The six built-in app skills (CU-07), in the order of their declarations. */
const SKILLS = ["sheet", "document", "slides", "pdf", "files", "settings"] as const;

const stepOf = hxStepOf;

/** What a kind of node declares (RTN-08): what it needs, whether it repeats safely, and how it checks. */
function HxDeclarationLine(props: { declaration: HxNodeDeclaration | undefined }) {
  const { t } = useText();
  return (
    <Show when={props.declaration}>
      {(declaration) => (
        <p class="wfn-hx-declares">
          {t("workflow.hx.declares", {
            permission: t(PERMISSION[declaration().permission]),
            idempotent: t(IDEMPOTENT[declaration().idempotent]),
            readback: t(READBACK[declaration().readback]),
          })}
        </p>
      )}
    </Show>
  );
}

/** An agent node: the agent's task, or one of HXBot's steps when the node has its type. */
export function HxAgentOrStepNode(props: { id: string }) {
  const board = useBoard();
  return (
    <Show when={stepOf(board.field(props.id, HX_WORKFLOW_STEP_FIELD))} keyed fallback={<AgentNode id={props.id} />}>
      {(step) => <HxStepNode id={props.id} step={step} />}
    </Show>
  );
}

/** One of HXBot's steps, with its agent, its settings and its run. */
function HxStepNode(props: { id: string; step: HxWorkflowStepKind }) {
  const board = useBoard();
  const { t } = useText();
  const [agentId] = useField(
    () => props.id,
    "agentId",
    untrack(() => board.catalogs().agents[0]?.id ?? ""),
    asString,
  );
  const agent = () => board.catalogs().agents.find((candidate) => candidate.id === agentId());
  const [actions, setActions] = useTextField(() => props.id, "actions", "");
  const [skill, setSkill] = useTextField(() => props.id, "skill", "sheet");
  const [action, setAction] = useTextField(() => props.id, "action", "");
  const [args, setArgs] = useTextField(() => props.id, "args", "");
  const [team, setTeam] = useTextField(() => props.id, "team", "");
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const ready = () => {
    if (!agent()) return false;
    if (props.step === "app-action") return actions().trim().length > 0;
    if (props.step === "app-skill") return skill().trim().length > 0 && action().trim().length > 0;
    return team().trim().length > 0;
  };
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={!ready() || locked()}
          onClick={run.start}
        >
          {t("workflow.agent.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t(HX_STEP_LABEL[props.step])}
      icon={HX_STEP_ICON[props.step]()}
      kind="agent"
      inputs={["text", "image", "file"]}
      output="text"
      toolbar={<NodeToolbar id={props.id} name={t(HX_STEP_LABEL[props.step])} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-field-task wfn-hx-step">
        <p class="wfn-hx-hint">{t(STEP_HINT[props.step])}</p>
        <Show when={props.step === "app-action"}>
          <Textarea
            class="wfn-input wfn-hx-json"
            aria-label={t("workflow.hx.field.actions")}
            placeholder={ACTIONS_EXAMPLE}
            readonly={locked()}
            value={actions()}
            onValueChange={setActions}
          />
        </Show>
        <Show when={props.step === "app-skill"}>
          <div class="wfn-hx-row">
            <label class="wfn-hx-label">
              <span>{t("workflow.hx.field.skill")}</span>
              <NativeSelect
                class="wfn-hx-select"
                size="sm"
                disabled={locked()}
                value={skill()}
                onChange={(event) => setSkill(event.currentTarget.value)}
              >
                <For each={SKILLS}>{(name) => <option value={name}>{name}</option>}</For>
              </NativeSelect>
            </label>
            <label class="wfn-hx-label">
              <span>{t("workflow.hx.field.action")}</span>
              <Input
                class="wfn-input"
                aria-label={t("workflow.hx.field.action")}
                readonly={locked()}
                value={action()}
                onValueChange={setAction}
              />
            </label>
          </div>
          <Textarea
            class="wfn-input wfn-hx-json"
            aria-label={t("workflow.hx.field.args")}
            placeholder={ARGS_EXAMPLE}
            readonly={locked()}
            value={args()}
            onValueChange={setArgs}
          />
        </Show>
        <Show when={props.step === "team"}>
          <Textarea
            class="wfn-input wfn-hx-json"
            aria-label={t("workflow.hx.field.team")}
            placeholder={TEAM_EXAMPLE}
            readonly={locked()}
            value={team()}
            onValueChange={setTeam}
          />
        </Show>
        <p class="wfn-hx-hint">{t("workflow.hx.field.inputHint", { token: "{{input}}" })}</p>
        <HxDeclarationLine declaration={HX_NODE_DECLARATIONS[props.step]} />
        <div class="wfn-field-foot">
          <HxStepKindPill id={props.id} disabled={locked()} />
          <AgentPill
            agent={agent()}
            removed={agentId() !== "" && !agent()}
            disabled={locked()}
            onChange={(choice) => board.setFields(props.id, { agentId: choice.id })}
          />
        </div>
      </Field>
      <ResultField id={props.id} running={run.running()} />
    </NodeShell>
  );
}
