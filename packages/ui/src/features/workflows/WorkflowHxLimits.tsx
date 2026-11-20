/**
 * HXBot (v1.7.5, RTN-07): the run limits of one workflow. A loop runs at most 10 times, a run at most
 * 100 steps, and its loops at most 600 seconds; here they can be made larger, never endless (the host
 * refuses a value above `HX_WORKFLOW_MAX_LIMITS`).
 */

import {
  HX_WORKFLOW_DEFAULT_LIMITS,
  HX_WORKFLOW_MAX_LIMITS,
  type HxWorkflowLimits,
} from "@hxbot/contracts/hx-workflows";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { Button } from "../../button";
import { ConfirmDialog } from "../../confirm-dialog";
import { Field, Input } from "../../form";
import { Gauge } from "../../icons";
import { useText } from "../../text";

/** What the canvas reads and writes of the limits, on the host. */
export interface HxWorkflowLimitsPort {
  load: (workflowId: string) => Promise<HxWorkflowLimits>;
  /** Null goes back to the defaults. Answers the limits as the host keeps them. */
  save: (workflowId: string, limits: HxWorkflowLimits | null) => Promise<HxWorkflowLimits>;
}

const NAMES = ["loops", "steps", "seconds"] as const;
type LimitName = (typeof NAMES)[number];

const LABEL = {
  loops: "workflow.hx.limits.loops",
  steps: "workflow.hx.limits.steps",
  seconds: "workflow.hx.limits.seconds",
} as const;

/** A whole number from 1 to the most this limit can be, or null. */
export function hxLimitValue(name: LimitName, text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= HX_WORKFLOW_MAX_LIMITS[name] ? value : null;
}

export function WorkflowHxLimitsDialog(props: {
  open: boolean;
  workflowId: string;
  port: HxWorkflowLimitsPort;
  onClose: () => void;
}) {
  const { t, format, errorMessage } = useText();
  const [text, setText] = createSignal<Record<LimitName, string>>({ loops: "", steps: "", seconds: "" });
  const [shown, setShown] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  const fill = (limits: HxWorkflowLimits) =>
    setText({ loops: String(limits.loops), steps: String(limits.steps), seconds: String(limits.seconds) });

  // Reads the limits each time the dialog opens, so a change on another device shows.
  createEffect(
    () => (props.open ? props.workflowId : null),
    (workflowId) => {
      if (!workflowId) return;
      setShown(false);
      setError(null);
      setLoading(true);
      untrack(() => props.port.load(workflowId))
        .then((limits) => {
          fill(limits);
          setShown(true);
        })
        .catch((failure: unknown) => setError(errorMessage(failure, t("workflow.hx.limits.loadFailed"))))
        .finally(() => setLoading(false));
    },
  );

  const values = (): HxWorkflowLimits | null => {
    const loops = hxLimitValue("loops", text().loops);
    const steps = hxLimitValue("steps", text().steps);
    const seconds = hxLimitValue("seconds", text().seconds);
    return loops !== null && steps !== null && seconds !== null ? { loops, steps, seconds } : null;
  };

  const close = () => props.onClose();

  const save = async (limits: HxWorkflowLimits | null) => {
    setError(null);
    try {
      fill(await props.port.save(props.workflowId, limits));
      close();
    } catch (failure) {
      setError(errorMessage(failure, t("workflow.hx.limits.loadFailed")));
    }
  };

  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      icon={<Gauge />}
      initialFocus="field"
      title={t("workflow.hx.limits.title")}
      description={
        <>
          {t("workflow.hx.limits.hint")}{" "}
          {t("workflow.hx.limits.defaults", {
            loops: format.number(HX_WORKFLOW_DEFAULT_LIMITS.loops),
            steps: format.number(HX_WORKFLOW_DEFAULT_LIMITS.steps),
            seconds: format.number(HX_WORKFLOW_DEFAULT_LIMITS.seconds),
          })}
        </>
      }
      confirmLabel={t("workflow.hx.limits.save")}
      pending={loading()}
      error={error() ?? undefined}
      onCancel={close}
      onConfirm={() => {
        const next = values();
        if (!shown() || !next) return;
        return save(next);
      }}
    >
      <Show when={shown()}>
        <div class="wfn-hx-limits">
          <For each={NAMES}>
            {(name) => (
              <Field
                label={t(LABEL[name])}
                error={
                  hxLimitValue(name, text()[name]) === null
                    ? t("workflow.hx.limits.range", { max: format.number(HX_WORKFLOW_MAX_LIMITS[name]) })
                    : undefined
                }
              >
                <Input
                  type="number"
                  inputmode="numeric"
                  min={1}
                  max={HX_WORKFLOW_MAX_LIMITS[name]}
                  step={1}
                  value={text()[name]}
                  onValueChange={(value) => setText((current) => ({ ...current, [name]: value }))}
                />
              </Field>
            )}
          </For>
          <Button type="button" variant="ghost" size="sm" class="wfn-hx-limits-reset" onClick={() => save(null)}>
            {t("workflow.hx.limits.reset")}
          </Button>
        </div>
      </Show>
    </ConfirmDialog>
  );
}
