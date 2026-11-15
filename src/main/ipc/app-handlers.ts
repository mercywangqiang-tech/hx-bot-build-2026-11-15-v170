import { Effect } from "effect";
// App identity, first-run setup, the analytics preference, external links and the data and
// diagnostics exports.

import { HOSTED_SERVER_CONTACT_URL } from "@hxbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@hxbot/contracts/input-limits";
import {
  type AnalyticsPreference,
  type AppInfo,
  type AppSetupState,
  type AppVariant,
  type ChatWindowTarget,
  type ExternalDestination,
  type ExternalLinkBrowser,
  externalLinkAppName,
  GROK_BOT_EXPORT_URL,
} from "@hxbot/contracts/ipc";
import type { AppTranslate } from "@hxbot/i18n";
import { analyticsOnByDefault } from "@hxbot/telemetry";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from "electron";
import { version as developmentVersion } from "../../../package.json";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import type { AgentDefaultsPreferenceStore } from "../agent-defaults-preference-store";
import type { AgentMemoryLimitSetting } from "../agent-memory-limit-preference-store";
import type { AnalyticsPreferenceService } from "../analytics-preference-service";
import type { AppBehaviorService } from "../app-behavior-service";
import type { AppearanceService } from "../appearance-service";
import type { ApprovalAutomation } from "../approval-automation-store";
import type { BusyMessageModePreferenceStore } from "../busy-message-mode-preference-store";
import type { ExternalLinkOpener, ExternalLinkPreferenceStore } from "../external-link-opener";
import type { InterfaceSizeService } from "../interface-size-service";
import type { LanguageService } from "../language-service";
import type { LogoColorService } from "../logo-color-service";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { exportDiagnostics, exportHxBotData } from "../maintenance-service";
import { isTailscaleConnected } from "../private-network-detection";
import type { RemoteNetworkRoutePreferenceStore } from "../remote-network-route-preference-store";
import type { RemoteSessionCache } from "../remote-session-cache";
import type { RemoteSessionReusePreferenceStore } from "../remote-session-reuse-preference-store";
import { readSetupState, writeSetupState } from "../setup-store";
import { systemHourCycle } from "../system-hour-cycle";
import type { UpdateService } from "../update-service";
import {
  parseAgentDefaults,
  parseAnalyticsPreference,
  parseAppAppearancePreference,
  parseAppBehaviorPreferenceChange,
  parseAppInterfaceSizePreference,
  parseAppLanguagePreference,
  parseAppLogoColorPreference,
  parseBusyMessageModePreference,
  parseChatWindowTarget,
  parseExternalDestination,
  parseExternalLinkPreference,
  parseRemoteNetworkRoutePreference,
  parseRemoteSessionReusePreference,
  parseRendererTimingReport,
  parseSetup,
} from "./app-inputs";
import { stringPayload } from "./validation";

// HXBot: every destination below opens the HXBot server (the portal on bot.hxallai.com) or writes to
// 弘犀智能. The Help menu opens the guide, the server page and the downloads there; the community and
// social links of HXBot open the portal. No destination leads to HXBot.
const HXBOT_SITE = "https://bot.hxallai.com/";
const HX_FEEDBACK_URL = "mailto:bot@hxallai.com?subject=HXBot%20%E5%8F%8D%E9%A6%88%20/%20Feedback";
const HX_GUIDE_URL = "https://bot.hxallai.com/guide/";
const HX_SERVER_URL = "https://bot.hxallai.com/guide/#server";
const HX_DOWNLOADS_URL = "https://bot.hxallai.com/#downloads";
const HX_FAQ_URL = "https://bot.hxallai.com/guide/#faq";

/**
 * Every destination `openExternal` may reach, as a closed table.
 *
 * Exported because the addresses are a product contract the checker cannot judge: a wrong one sends
 * a user who asked for an OpenCode Go key to some other site, and the type only says "a string".
 *
 * `mac-screen-recording` is not a web page. macOS opens a settings pane from a URL, and the table is
 * what keeps that address out of the renderer. It is the same pane the Computer Use panel opens, so
 * it is read from `mac-permission-urls.ts` rather than written twice. `hosted-server-contact` is a
 * `mailto:` address, which `openUrl` refuses; the web client opens the same constant.
 */
const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string | ((translate: AppTranslate) => string)> = {
  "agent-setup": HX_FAQ_URL,
  "opencode-install": "https://opencode.ai/docs/",
  "opencode-auth": "https://opencode.ai/auth",
  "claude-install": "https://code.claude.com/docs",
  "hermes-install": "https://hermes-agent.nousresearch.com/docs/getting-started/installation",
  feedback: HX_FEEDBACK_URL,
  message: HX_FEEDBACK_URL,
  changelog: HX_DOWNLOADS_URL,
  guides: HX_GUIDE_URL,
  discord: HX_SERVER_URL,
  github: HXBOT_SITE,
  x: HXBOT_SITE,
  threads: HXBOT_SITE,
  instagram: HXBOT_SITE,
  tiktok: HXBOT_SITE,
  facebook: HXBOT_SITE,
  linkedin: HXBOT_SITE,
  reddit: HXBOT_SITE,
  "x-post": HXBOT_SITE,
  "threads-post": HXBOT_SITE,
  "linkedin-post": HXBOT_SITE,
  "reddit-post": HXBOT_SITE,
  "facebook-post": HXBOT_SITE,
  "instagram-post": HXBOT_SITE,
  "tiktok-post": HXBOT_SITE,
  "grok-bot-export": GROK_BOT_EXPORT_URL,
  "hosted-server-contact": HOSTED_SERVER_CONTACT_URL,
  "mac-screen-recording": MAC_PERMISSION_URLS["screen-recording"],
};

import { runCauseEffect } from "../../backend/effect-boundary";
import { openHttpLink } from "../message-link-relay";
import type { ResourceMonitor } from "../resource-monitor";
import type { StartupTiming } from "../startup-timing";
import type { TraceFile } from "../trace-file";
import { eventPayloadHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AppIpcDependencies {
  service: AgentService;
  mailbox: MailboxStore;
  browser: BrowserHost;
  updater: UpdateService;
  setupFile: string;
  analyticsPreferences: AnalyticsPreferenceService;
  approvalAutomation: ApprovalAutomation;
  busyMessageMode: BusyMessageModePreferenceStore;
  agentDefaults: AgentDefaultsPreferenceStore;
  agentMemoryLimit: AgentMemoryLimitSetting;
  remoteSessionReuse: RemoteSessionReusePreferenceStore;
  remoteNetworkRoute: RemoteNetworkRoutePreferenceStore;
  /** Applies a changed network route to the devices that are connected to this computer now. */
  applyRemoteNetworkRoute: () => Promise<void>;
  remoteSessionCache: RemoteSessionCache;
  externalLinkPreference: ExternalLinkPreferenceStore;
  externalLinks: ExternalLinkOpener;
  /** Opens a web page in the program that the user chose in Settings. */
  openLink: (url: string) => Promise<void>;
  appBehavior: AppBehaviorService;
  language: LanguageService;
  logoColor: LogoColorService;
  appearance: AppearanceService;
  interfaceSize: InterfaceSizeService;
  initializeAgent: () => Promise<void>;
  appVariant: AppVariant;
  analyticsCaptureUrl: string | null;
  analyticsInstallId: string | null;
  getMainWindow: () => BrowserWindow | null;
  /** True for the main window's own `webContents`, not a chat window's. */
  isMainWindow: (sender: WebContents) => boolean;
  openChatWindow: (target: ChatWindowTarget) => void;
  chatWindowTargets: () => ChatWindowTarget[];
  trace: TraceFile;
  resources: ResourceMonitor;
  /** Null for a local server child, which reports no start. */
  startup: StartupTiming | null;
}

export function appIpcHandlers({
  service,
  mailbox,
  browser,
  updater,
  setupFile,
  analyticsPreferences,
  approvalAutomation,
  busyMessageMode,
  agentDefaults,
  agentMemoryLimit,
  remoteSessionReuse,
  remoteNetworkRoute,
  applyRemoteNetworkRoute,
  remoteSessionCache,
  externalLinkPreference,
  externalLinks,
  openLink,
  appBehavior,
  language,
  logoColor,
  appearance,
  interfaceSize,
  initializeAgent,
  appVariant,
  analyticsCaptureUrl,
  analyticsInstallId,
  getMainWindow,
  isMainWindow,
  openChatWindow,
  chatWindowTargets,
  trace,
  resources,
  startup,
}: AppIpcDependencies): Pick<IpcGroupHandlers, "app" | "maintenance"> {
  return {
    app: {
      getAppInfo: handler((): AppInfo => {
        const platform = process.platform;
        if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
          throw new Error(`Unsupported desktop platform: ${platform}`);
        }
        // electron-vite starts a script, so Electron reports its own version in development.
        const version = app.isPackaged ? app.getVersion() : developmentVersion;
        // Each state other than `enabled*` (such as `disabled_software` or `unavailable_software`)
        // composites on the CPU. This covers the GPU switch of `linux-gpu-mode.ts` and a GPU that
        // Chromium blocks, such as the llvmpipe driver of a server or a remote desktop.
        const softwareRendering = !app.getGPUFeatureStatus().gpu_compositing.startsWith("enabled");
        const hourCycle = systemHourCycle();
        return {
          name: app.getName(),
          version,
          platform,
          variant: appVariant,
          ...(analyticsCaptureUrl ? { analyticsCaptureUrl } : {}),
          ...(analyticsInstallId ? { analyticsInstallId } : {}),
          ...(softwareRendering ? { softwareRendering } : {}),
          ...(hourCycle ? { hourCycle } : {}),
        };
      }),
      getSetupState: handler(() => runCauseEffect(readSetupState(setupFile))),
      getAnalyticsPreference: handler(() =>
        runCauseEffect(
          readSetupState(setupFile).pipe(Effect.flatMap((setup) => analyticsPreferences.read(setup.completed))),
        ),
      ),
      // An answer the user gave on another device comes before the regional default.
      getAnalyticsDefault: handler(
        (): AnalyticsPreference => ({
          enabled:
            analyticsPreferences.accountAnswer() ??
            analyticsOnByDefault(app.getLocaleCountryCode(), Intl.DateTimeFormat().resolvedOptions().timeZone),
        }),
      ),
      setAnalyticsPreference: payloadHandler(parseAnalyticsPreference, (parsed) =>
        runCauseEffect(analyticsPreferences.set(parsed.enabled, parsed.chosen === true)),
      ),
      // Any window can send its bounded counts. Only the main window's workspace load times the start,
      // and main times it on its own clock.
      reportRendererTiming: eventPayloadHandler(parseRendererTimingReport, (event, report) => {
        if (report.workspaceReady && isMainWindow(event.sender)) startup?.workspaceReady();
        resources.observeRendererTiming(report);
      }),
      getApprovalAutomation: handler(() => approvalAutomation.current()),
      getBusyMessageModePreference: handler(() => busyMessageMode.get()),
      setBusyMessageModePreference: payloadHandler(parseBusyMessageModePreference, (parsed) =>
        runCauseEffect(busyMessageMode.set(parsed)),
      ),
      getAgentDefaults: handler(() => agentDefaults.get()),
      // The agents that follow a changed default get it at once: see `AgentService.agentDefaultsChanged`.
      setAgentDefaults: payloadHandler(parseAgentDefaults, async (parsed) => {
        const previous = agentDefaults.get();
        const saved = await runCauseEffect(agentDefaults.set(parsed));
        service.agentDefaultsChanged(previous);
        return saved;
      }),
      getAgentMemoryLimitPreference: handler(() => agentMemoryLimit.get()),
      getRemoteSessionReusePreference: handler(() => remoteSessionReuse.get()),
      // Off removes the kept sessions at once. The sessions of this run then end when the app quits.
      setRemoteSessionReusePreference: payloadHandler(parseRemoteSessionReusePreference, async (parsed) => {
        const saved = await runCauseEffect(remoteSessionReuse.set(parsed));
        await Effect.runPromise(remoteSessionCache.setEnabled(saved.keepBetweenRuns));
        return saved;
      }),
      getRemoteNetworkRoute: handler(() => ({
        ...remoteNetworkRoute.get(),
        tailscaleConnected: isTailscaleConnected(),
      })),
      // The private route drops the connected devices, so each connects again without the relay.
      setRemoteNetworkRoute: payloadHandler(parseRemoteNetworkRoutePreference, async (parsed) => {
        const previous = remoteNetworkRoute.get();
        const saved = await runCauseEffect(remoteNetworkRoute.set(parsed));
        // A route that the host did not apply must not stay saved: the next connection would read it.
        await applyRemoteNetworkRoute().catch(async (error: unknown) => {
          await runCauseEffect(remoteNetworkRoute.set(previous));
          throw error;
        });
        return { ...saved, tailscaleConnected: isTailscaleConnected() };
      }),
      getAppBehaviorPreference: handler(() => runCauseEffect(appBehavior.get())),
      setAppBehaviorPreference: payloadHandler(parseAppBehaviorPreferenceChange, (parsed) =>
        runCauseEffect(appBehavior.set(parsed)),
      ),
      getAppLanguagePreference: handler(() => language.preference),
      setAppLanguagePreference: payloadHandler(parseAppLanguagePreference, (parsed) =>
        runCauseEffect(language.set(parsed)),
      ),
      getAppLogoColorPreference: handler(() => logoColor.preference),
      setAppLogoColorPreference: payloadHandler(parseAppLogoColorPreference, (parsed) =>
        runCauseEffect(logoColor.set(parsed)),
      ),
      getAppAppearancePreference: handler(() => appearance.preference),
      setAppAppearancePreference: payloadHandler(parseAppAppearancePreference, (parsed) =>
        runCauseEffect(appearance.set(parsed)),
      ),
      getAppInterfaceSizePreference: handler(() => interfaceSize.preference),
      setAppInterfaceSizePreference: payloadHandler(parseAppInterfaceSizePreference, (parsed) =>
        runCauseEffect(interfaceSize.set(parsed)),
      ),
      saveSetup: payloadHandler(parseSetup, async (input): Promise<AppSetupState> => {
        // Before the setup file: once setup is complete, a missing choice reads as an older user's "on".
        const before = await runCauseEffect(readSetupState(setupFile));
        await runCauseEffect(analyticsPreferences.saveDefault(before.completed));
        const state = await runCauseEffect(writeSetupState(setupFile, input));
        await runCauseEffect(service.setPreferredProvider(input.preferredProvider, input.preferredModel));
        await initializeAgent();
        return state;
      }),
      openExternal: payloadHandler(parseExternalDestination, (parsed) => {
        const target = EXTERNAL_DESTINATIONS[parsed];
        return openLink(typeof target === "string" ? target : target(language.translate));
      }),
      getSentMessageStats: handler(() => service.readSentMessageStats()),
      openUrl: payloadHandler(stringPayload("URL", INPUT_LIMITS.browserUrl), (url) => openHttpLink(url, openLink)),
      getExternalLinkPreference: handler(() => externalLinkPreference.get()),
      setExternalLinkPreference: payloadHandler(parseExternalLinkPreference, (parsed) =>
        runCauseEffect(externalLinkPreference.set(parsed)),
      ),
      listExternalLinkBrowsers: handler(() => runCauseEffect(externalLinks.listBrowsers())),
      chooseExternalLinkApp: handler(async (): Promise<ExternalLinkBrowser | null> => {
        const mainWindow = getMainWindow();
        // macOS shows an application bundle as one file, so the dialog can offer only applications.
        const options: OpenDialogOptions = {
          title: language.translate("dialog.chooseExternalLinkApp"),
          properties: ["openFile"],
          ...(process.platform === "darwin"
            ? {
                defaultPath: "/Applications",
                filters: [{ name: language.translate("dialog.filter.applications"), extensions: ["app"] }],
              }
            : {}),
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        const path = result.canceled ? undefined : result.filePaths[0];
        return path ? { name: externalLinkAppName(path), path } : null;
      }),
      openChatWindow: payloadHandler(parseChatWindowTarget, openChatWindow),
      getChatWindows: handler(chatWindowTargets),
    },
    maintenance: {
      exportData: handler(() =>
        runCauseEffect(
          exportHxBotData({ service, mailbox, parentWindow: getMainWindow(), translate: language.translate }),
        ),
      ),
      exportDiagnostics: handler(() =>
        runCauseEffect(
          exportDiagnostics({
            service,
            browser,
            updater,
            trace,
            resources,
            parentWindow: getMainWindow(),
            translate: language.translate,
          }),
        ),
      ),
    },
  };
}
