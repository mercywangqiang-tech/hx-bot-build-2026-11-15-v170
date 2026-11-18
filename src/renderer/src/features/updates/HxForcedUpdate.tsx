import { hxReleaseNoteLines, hxUpdateIsRequired } from "@hxbot/contracts/hx-update-policy";
import type { UpdateStatus } from "@hxbot/contracts/ipc";
import { Button, ConfirmDialog, Download, Progress, Text } from "@hxbot/ui";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { appPort } from "../../app-port";
import { useI18n } from "../../i18n-context";
import { useUpdates } from "./updates-context";

/** Seconds after which an update that is not downloading by itself is started once. */
const START_DOWNLOAD_AFTER_MS = 15_000;

/** True while a newer version is known and not installed yet. */
export function hxUpdatePending(status: UpdateStatus): boolean {
  if (status.managedByHost) return false;
  if (status.phase === "available" || status.phase === "downloading" || status.phase === "ready") return true;
  if (status.phase === "installing") return true;
  return status.phase === "error" && Boolean(status.availableVersion);
}

/** What the button does now: install, download first, or try again. Nothing while it installs. */
export function hxUpdateButton(status: UpdateStatus): "install" | "download" | "retry" | "wait" {
  switch (status.phase) {
    case "ready":
      return "install";
    case "available":
    case "downloading":
      return "download";
    case "error":
      return "retry";
    default:
      return "wait";
  }
}

/**
 * HXBot：桌面端的“更新 HXBot”窗口（规则见 @hxbot/contracts/hx-update-policy）。
 *
 * - v1.7.1 起大版本不再强制：打开 HXBot 时找到的新版本由主进程自动下载、装好，在空闲时重启进入新版
 *   （RequestedUpdate，提示见 scheduled-update-toast.ts），这个窗口不弹出。
 * - 只有账号服务拒绝了这个版本（426）时窗口挡住，不能关，只有“立即更新”；没人点时，下载好 10 分钟后
 *   HXBot 在空闲时自动重启安装。“立即更新”：已经下载好时马上重启安装；还在下载时，下载完自动重启安装。
 * 下载或安装失败时可以重试，或者去下载页手动下载。
 */
/** What the window reads and does; the app passes nothing and uses the updates of this window. */
interface HxUpdateCalls {
  status: () => UpdateStatus;
  runAction: () => Promise<void>;
}

export function HxForcedUpdate(props: { updates?: HxUpdateCalls }) {
  const i18n = useI18n();
  const t = i18n.t;
  const updates = props.updates ?? useUpdates();
  // The user chose Update now while the new version was still downloading: install it when it is ready.
  const [installWhenReady, setInstallWhenReady] = createSignal(false);
  const [started, setStarted] = createSignal<string | null>(null);

  const status = () => updates.status();
  const version = () => status().availableVersion ?? "";
  const required = () => hxUpdateIsRequired(status());
  const notes = () => hxReleaseNoteLines(status().hxReleaseNotes, i18n.language());

  // Only an update that the account service requires opens the window; any other installs by itself (v1.7.1).
  const open = () => hxUpdatePending(status()) && required();

  let startTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(startTimer));

  createEffect(
    () => {
      const current = status();
      return { phase: current.phase, target: current.availableVersion ?? null };
    },
    ({ phase, target }) => {
      // Updates download by themselves; one that has not started 15 seconds later is started once.
      if (phase === "available" && target && started() !== target) {
        setStarted(target);
        clearTimeout(startTimer);
        startTimer = setTimeout(() => {
          if (status().phase === "available" && status().availableVersion === target) void updates.runAction();
        }, START_DOWNLOAD_AFTER_MS);
      }
      if (phase === "ready" && installWhenReady()) {
        setInstallWhenReady(false);
        void updates.runAction();
      }
      if (phase === "error") setInstallWhenReady(false);
    },
  );

  const update = () => {
    const current = status();
    const action = hxUpdateButton(current);
    if (action === "install" || action === "retry") {
      void updates.runAction();
      return;
    }
    if (action !== "download") return;
    setInstallWhenReady(true);
    clearTimeout(startTimer);
    if (current.phase === "available") void updates.runAction();
  };

  const later = () => {
    if (required()) return;
    setInstallWhenReady(false);
  };

  const message = () => {
    const current = status();
    switch (current.phase) {
      case "downloading": {
        const downloading =
          current.progress === null
            ? t("update.hxForced.downloading")
            : t("update.hxForced.downloadingProgress", { progress: String(Math.round(current.progress)) });
        return installWhenReady() ? `${downloading} ${t("update.hxForced.afterDownload")}` : downloading;
      }
      case "ready":
        return required() ? t("update.hxForced.ready") : t("update.hxOptional.ready");
      case "installing":
        return t("update.hxForced.installing");
      case "error":
        return t("update.hxForced.failed");
      default:
        return installWhenReady() ? t("update.hxForced.afterDownload") : t("update.hxForced.starting");
    }
  };

  // A required update: Escape and a click beside the dialog do nothing, HXBot is not usable until it is installed.
  const confirmLabel = () =>
    status().phase === "error" ? t("update.hxForced.retry") : t("update.hxForced.installNow");
  return (
    <ConfirmDialog
      open={open()}
      onCancel={later}
      hideCancel={required()}
      dismissWhilePending={!required()}
      cancelLabel={t("update.hxOptional.later")}
      tone="default"
      icon={<Download />}
      title={required() ? t("update.hxForced.title") : t("update.hxOptional.title", { version: version() })}
      description={required() ? t("update.hxForced.body", { version: version() }) : t("update.hxOptional.body")}
      confirmLabel={confirmLabel()}
      pending={status().phase === "installing" || (installWhenReady() && status().phase !== "error")}
      onConfirm={update}
    >
      <Show when={notes().length > 0}>
        <div class="hx-update-notes">
          <Text as="p" variant="label">
            {t("update.hxOptional.whatsNew")}
          </Text>
          <ul>
            <For each={notes()}>{(line) => <li>{line}</li>}</For>
          </ul>
        </div>
      </Show>
      <Show when={status().phase === "downloading" && status().progress !== null}>
        <Progress value={Math.round(status().progress ?? 0)} aria-label={t("update.hxForced.downloading")} />
      </Show>
      <Text as="p" variant="caption" tone="muted" role="status">
        {message()}
      </Text>
      <Button type="button" size="sm" variant="ghost" onClick={() => void appPort().openExternal("changelog")}>
        {t("update.hxForced.manual")}
      </Button>
    </ConfirmDialog>
  );
}
