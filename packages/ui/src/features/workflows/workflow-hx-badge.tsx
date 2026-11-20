// HXBot v1.7.5（RTN-08）：画布上没有执行器的节点标“暂不支持”。放在单独的文件里，节点外壳和 HXBot 的步骤都用它。
import { HX_WORKFLOW_STEP_FIELD, HX_WORKFLOW_STEP_KINDS, type HxWorkflowStepKind } from "@hxbot/contracts/hx-workflows";
import { Show } from "solid-js";
import { useText } from "../../text";
import { useBoard, type WfnFieldValue } from "./workflow-board";

/** The HXBot step that a field names, or null. */
export function hxStepOf(value: WfnFieldValue | undefined): HxWorkflowStepKind | null {
  return HX_WORKFLOW_STEP_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * Whether this version has no runner for a node on the canvas, as the host decides it
 * (`hxNodeUnsupported`): an image or asset step, a message trigger, a file output, a step of a later HXBot.
 */
function hxCanvasUnsupported(kind: string, field: (key: string) => WfnFieldValue | undefined): boolean {
  if (kind === "image" || kind === "asset") return true;
  if (kind === "trigger") return field("trigger") === "message";
  if (kind === "output") return field("target") === "file";
  const step = field(HX_WORKFLOW_STEP_FIELD);
  return step !== undefined && step !== "" && (kind !== "agent" || hxStepOf(step) === null);
}

/** The "Not supported yet" badge of a node that this version cannot run. */
export function HxUnsupportedBadge(props: { id: string; kind: string }) {
  const board = useBoard();
  const { t } = useText();
  return (
    <Show when={hxCanvasUnsupported(props.kind, (key) => board.field(props.id, key))}>
      <span class="wfn-hx-unsupported" title={t("workflow.hx.unsupportedHint")}>
        {t("workflow.hx.unsupported")}
      </span>
    </Show>
  );
}
