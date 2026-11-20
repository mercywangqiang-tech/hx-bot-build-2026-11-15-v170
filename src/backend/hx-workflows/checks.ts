/**
 * HXBot (v1.7.5, RTN-08, RTN-11, RTN-07): the checks of the workflow runner that are HXBot's own.
 *
 * - RTN-08: a node without a runner (an image or asset step, a message trigger, a file output, a step of
 *   a later HXBot that this one does not know) is refused when a graph is saved, when a step is called and
 *   when it runs, never answered with a success. Every node that runs has a declaration
 *   (`HX_NODE_DECLARATIONS`).
 * - RTN-11: before a step starts or continues, what it needs is read now: the settings and the agent of
 *   an HXBot step and its agent's Computer Use; for a continue, the messaging connection of an output.
 */

import { HX_WORKFLOW_STEP_FIELD, hxNodeDeclaration, hxWorkflowStepOf } from "@hxbot/contracts/hx-workflows";
import { isWorkflowStepKind, type WorkflowGraph, type WorkflowNode } from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n/source";
import { unsupportedNode } from "../workflows/workflow-walk";
import type { HxLimitHit } from "./limits";
import { hxWorkflowSteps } from "./steps";

/** Whether this version has no runner for the node. */
function hxNodeUnsupported(node: WorkflowNode): boolean {
  if (!isWorkflowStepKind(node.kind)) return false;
  if (unsupportedNode(node)) return true;
  // An `hxStep` that this version does not know is a step of a later one.
  const step = node.fields[HX_WORKFLOW_STEP_FIELD];
  if (step !== undefined && step !== "" && hxWorkflowStepOf(node) === null) return true;
  return hxNodeDeclaration(node) === null;
}

/** Why the graph cannot be saved, or null: the first node without a runner. */
export function hxGraphProblem(graph: WorkflowGraph): string | null {
  return graph.nodes.some(hxNodeUnsupported) ? sourceText("error.workflow.nodeUnsupported") : null;
}

/**
 * Why the node cannot start or continue now, or null. `connectionOn` is given for a continue: an output
 * to a messaging place whose connection is off is refused before the step runs again.
 */
export function hxRecheckNode(
  node: WorkflowNode,
  connectionOn: ((connectionId: string) => boolean) | null,
): string | null {
  if (hxNodeUnsupported(node)) return sourceText("error.workflow.nodeUnsupported");
  if (hxWorkflowStepOf(node)) return hxWorkflowSteps.recheck(node);
  if (connectionOn && node.kind === "output" && node.fields.target === "channel") {
    const connectionId = node.fields.connectionId;
    if (typeof connectionId === "string" && connectionId && !connectionOn(connectionId))
      return sourceText("error.workflow.hxConnectionOff");
  }
  return null;
}

/** "Over the limit", with the limit it reached. */
export function hxLimitText(hit: HxLimitHit): string {
  switch (hit.what) {
    case "loops":
      return sourceText("error.workflow.hxLimitLoops", { count: hit.limit });
    case "steps":
      return sourceText("error.workflow.hxLimitSteps", { count: hit.limit });
    default:
      return sourceText("error.workflow.hxLimitSeconds", { count: hit.limit });
  }
}
