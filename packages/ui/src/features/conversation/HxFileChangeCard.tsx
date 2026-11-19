// HXBot v1.7.4（ART-05、BAK-03）：对话里“改了文件”的卡片：标题、说明、文件位置、可以展开的改动列表、
// “恢复到修改前”。数据和动作都从外面传进来；这里只画。
import { Button, ChevronDown, FileText, RotateCcw } from "@hxbot/ui";
import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { useText } from "../../text";

export interface HxFileChangeCardProps {
  /** One line: what changed in which file, in the reader's language. */
  title: string;
  /** Whether it was read back and whether it can be restored, in the reader's language. */
  note: string;
  /** Where the file is. */
  file: string;
  /** One line per change, in the file's own words. */
  lines: readonly string[];
  /** The card was restored: no button any more. */
  restored: boolean;
  /** A restore runs now. */
  restoring: boolean;
  /** The outcome of the last restore on this screen, in the reader's language, or null. */
  message: string | null;
  /** The outcome is an error. */
  failed: boolean;
  /** “恢复到修改前”; absent where this screen cannot restore (another computer runs the agent). */
  onRestore?: (() => void) | undefined;
  /** The list starts open when it is short. */
  defaultOpen?: boolean;
}

/** The number of lines a card shows open from the start. */
const SHORT = 6;

export function HxFileChangeCard(props: HxFileChangeCardProps) {
  const { t } = useText();
  const panelId = createUniqueId();
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen ?? props.lines.length <= SHORT));
  return (
    <section class="hx-file-change" data-restored={props.restored ? "" : undefined}>
      <div class="hx-file-change-head">
        <span class="hx-file-change-glyph" aria-hidden="true">
          <FileText />
        </span>
        <div class="hx-file-change-text">
          <p class="hx-file-change-title">{props.title}</p>
          <Show when={props.note}>
            <p class="hx-file-change-note">{props.note}</p>
          </Show>
          <p class="hx-file-change-file" title={props.file}>
            {props.file}
          </p>
        </div>
      </div>
      <Show when={props.lines.length > 0}>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="hx-file-change-toggle"
          aria-expanded={open() ? "true" : "false"}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>
            {open()
              ? t("conversation.hx.fileChange.hide")
              : t("conversation.hx.fileChange.show", { count: props.lines.length })}
          </span>
          <ChevronDown class="hx-file-change-chevron" aria-hidden="true" />
        </Button>
        <Show when={open()}>
          <ol id={panelId} class="hx-file-change-lines">
            <For each={props.lines}>{(line) => <li class="hx-file-change-line">{line}</li>}</For>
          </ol>
        </Show>
      </Show>
      <Show when={props.message}>
        {(message) => (
          <p class="hx-file-change-outcome" data-failed={props.failed ? "" : undefined} role="status">
            {message()}
          </p>
        )}
      </Show>
      <Show when={!props.restored && props.onRestore}>
        {(restore) => (
          <div class="hx-file-change-actions">
            <Button variant="outline" size="sm" type="button" disabled={props.restoring} onClick={() => restore()()}>
              <RotateCcw aria-hidden="true" />
              <span>
                {props.restoring ? t("conversation.hx.fileChange.restoring") : t("conversation.hx.fileChange.restore")}
              </span>
            </Button>
          </div>
        )}
      </Show>
    </section>
  );
}
