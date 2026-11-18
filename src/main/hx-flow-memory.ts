// HXBot 并发（一）：桌面端的机器容量闸（v1.7.1，CONC-01）。
//
// The desktop app gets a turn budget B as a server does (ServerMemory). It never holds every turn
// (the level stays "ok"): it gives B to the turn slots, and the slots start the waiting turns in the
// HX-Flow order. The rules and the formula are in src/backend/hx-flow/budget.ts; this file reads the
// computer: the free memory (Windows os.freemem(); Linux MemAvailable; macOS vm_stat with the free,
// inactive, purgeable and speculative pages, and the kernel memory pressure level), the power and the
// temperature (powerMonitor), the delay of the main process event loop, and the resident memory of the
// processes that main started for the agents.
//
// It samples every 5 s, and only while a turn runs or waits. During sleep it does not sample; after
// sleep B starts again from the slow start. For a test, HXBOT_HX_FLOW_SAMPLE_FILE names a JSON file
// that replaces the readings (not in a packaged app).
import { readFile } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { Effect } from "effect";
import type { HostMemory } from "../backend/host-memory";
import {
  HX_FLOW_SAMPLE_MS,
  type HxFlowAgentMemory,
  HxFlowBudget,
  type HxFlowBudgetBound,
  type HxFlowPressure,
  type HxFlowSample,
  type HxFlowThermal,
} from "../backend/hx-flow/budget";
import { providerProcessIds } from "../backend/provider-processes";
import { linuxDescendantBytes, psDescendantBytes, readMacMemory, windowsAgentBytes } from "./hx-flow-readings";
import { readLinuxMemory } from "./server-memory";

/** Windows reads the processes with tasklist, which costs more: at most once in this time. */
const WINDOWS_PROCESS_MS = 15_000;

interface HxFlowPower {
  onBattery(): boolean;
  /** Called with each change; returns the unsubscribe. */
  on(event: "suspend" | "resume", listener: () => void): () => void;
  onThermal(listener: (state: HxFlowThermal) => void): () => void;
  onSpeedLimit(listener: (limit: number) => void): () => void;
}

export interface HxDesktopMemoryOptions {
  power: HxFlowPower;
  /** Whether a turn runs or waits now; only then is a sample taken. */
  active(): boolean;
  /** The executable of the Electron processes, which are not agent processes. */
  electronPath: string;
  /** The test file that replaces the readings, or null. */
  sampleFile: string | null;
  onError(message: string, error: unknown): void;
  /** Called when B changes, with the reading that changed it, for the log. */
  onBudget?(budget: number, detail: Readonly<Record<string, number | string | boolean | null>>): void;
  platform?: NodeJS.Platform;
}

interface FileSample extends Partial<Omit<HxFlowSample, "running" | "turnBytes">> {
  agentBytes?: number | null;
  agentProcesses?: number;
}

export class HxDesktopMemory implements HostMemory {
  readonly hostedPlan = false;
  readonly #options: HxDesktopMemoryOptions;
  readonly #budget = new HxFlowBudget();
  readonly #listeners = new Set<() => void>();
  readonly #loop = monitorEventLoopDelay({ resolution: 20 });
  readonly #unsubscribe: Array<() => void> = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #thermal: HxFlowThermal | null = null;
  #speedLimit: number | null = null;
  #sampling = false;
  #sleeping = false;
  #errorLogged = false;
  #windowsProcesses: { at: number; bytes: HxFlowAgentMemory | null } = { at: 0, bytes: null };
  #running = () => 0;

  constructor(options: HxDesktopMemoryOptions) {
    this.#options = options;
  }

  /** The turns that run now, for the per-turn memory. */
  setRunning(running: () => number): void {
    this.#running = running;
  }

  start(): void {
    if (this.#timer) return;
    const { power } = this.#options;
    this.#loop.enable();
    this.#unsubscribe.push(
      power.onThermal((state) => {
        this.#thermal = state;
      }),
      power.onSpeedLimit((limit) => {
        this.#speedLimit = limit;
      }),
      power.on("suspend", () => {
        this.#sleeping = true;
        this.#budget.suspend();
      }),
      power.on("resume", () => {
        this.#sleeping = false;
        this.#budget.resume();
        this.#loop.reset();
        this.#notify();
      }),
    );
    this.#timer = setInterval(() => void this.tick(), HX_FLOW_SAMPLE_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#loop.disable();
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
  }

  level() {
    return "ok" as const;
  }

  turnLimit(): number {
    return this.#budget.budget;
  }

  /** What holds B where it is, for the capacity notice. */
  bound(): HxFlowBudgetBound {
    return this.#budget.state().bound;
  }

  reserveTurn(): () => void {
    return () => {};
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** One sample; skipped while the computer sleeps, while no turn runs or waits, or while one runs. */
  async tick(): Promise<void> {
    if (this.#sampling || this.#sleeping || !this.#options.active()) return;
    this.#sampling = true;
    try {
      const file = await this.#readFile();
      const memory = file?.totalBytes && file.availableBytes !== undefined ? null : await this.#readMemory();
      const loopP99Ms = this.#loop.count > 0 ? this.#loop.percentile(99) / 1e6 : null;
      this.#loop.reset();
      const running = this.#running();
      const agents: HxFlowAgentMemory | null =
        file && "agentBytes" in file
          ? file.agentBytes === null || file.agentBytes === undefined
            ? null
            : { bytes: file.agentBytes, processes: file.agentProcesses ?? 1 }
          : await this.#agentMemory();
      const before = this.#budget.budget;
      const sample = {
        totalBytes: file?.totalBytes ?? memory?.totalBytes ?? totalmem(),
        availableBytes: file?.availableBytes ?? memory?.availableBytes ?? freemem(),
        pressure: file?.pressure ?? memory?.pressure ?? null,
        onBattery: file?.onBattery ?? this.#options.power.onBattery(),
        thermal: file?.thermal ?? this.#thermal,
        speedLimit: file?.speedLimit ?? this.#speedLimit,
        loopP99Ms: file?.loopP99Ms ?? loopP99Ms,
        running,
      };
      const after = this.#budget.sample(sample, agents);
      if (after !== before) {
        const state = this.#budget.state();
        this.#options.onBudget?.(after, {
          from: before,
          bound: state.bound,
          availableMb: Math.round(sample.availableBytes / 1024 / 1024),
          turnMb: Math.round(state.turnBytes / 1024 / 1024),
          running,
          onBattery: sample.onBattery,
          thermal: sample.thermal,
          loopP99Ms: sample.loopP99Ms === null ? null : Math.round(sample.loopP99Ms),
        });
      }
    } catch (error) {
      if (!this.#errorLogged) {
        this.#errorLogged = true;
        this.#options.onError("HX-Flow could not read the memory of this computer.", error);
      }
    } finally {
      this.#sampling = false;
    }
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#options.onError("An HX-Flow listener failed.", error);
      }
    }
  }

  async #readFile(): Promise<FileSample | null> {
    if (!this.#options.sampleFile) return null;
    return readFileSample(JSON.parse(await readFile(this.#options.sampleFile, "utf8")));
  }

  async #readMemory(): Promise<{ totalBytes: number; availableBytes: number; pressure: HxFlowPressure | null }> {
    const platform = this.#options.platform ?? process.platform;
    if (platform === "linux") {
      const { sample } = await Effect.runPromise(readLinuxMemory());
      return { totalBytes: sample.total, availableBytes: sample.available, pressure: null };
    }
    if (platform === "darwin") return readMacMemory();
    return { totalBytes: totalmem(), availableBytes: freemem(), pressure: null };
  }

  /** The resident memory of the processes below main that are not Electron, or null when unknown. */
  async #agentMemory(): Promise<HxFlowAgentMemory | null> {
    const platform = this.#options.platform ?? process.platform;
    try {
      if (platform === "linux") return await linuxDescendantBytes(this.#options.electronPath);
      if (platform === "darwin") return await psDescendantBytes(this.#options.electronPath);
      if (platform === "win32") {
        const now = Date.now();
        if (now - this.#windowsProcesses.at < WINDOWS_PROCESS_MS) return this.#windowsProcesses.bytes;
        // A reading that fails waits for the next period too: it is not tried again at each sample.
        this.#windowsProcesses = { at: now, bytes: null };
        const bytes = await windowsAgentBytes(new Set(providerProcessIds().keys()));
        this.#windowsProcesses = { at: now, bytes };
        return bytes;
      }
    } catch {
      return null;
    }
    return null;
  }
}

/** The test file: each field that it has, with the type it must have; anything else is left out. */
function readFileSample(value: unknown): FileSample {
  if (!isDynamicRecord(value)) return {};
  const number = (key: string) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
  const sample: FileSample = {};
  const total = number("totalBytes");
  const available = number("availableBytes");
  const speedLimit = number("speedLimit");
  const loop = number("loopP99Ms");
  const agentBytes = number("agentBytes");
  if (total !== undefined) sample.totalBytes = total;
  if (available !== undefined) sample.availableBytes = available;
  if (speedLimit !== undefined) sample.speedLimit = speedLimit;
  if (loop !== undefined) sample.loopP99Ms = loop;
  if (agentBytes !== undefined) sample.agentBytes = agentBytes;
  const agentProcesses = number("agentProcesses");
  if (agentProcesses !== undefined) sample.agentProcesses = agentProcesses;
  if (typeof value.onBattery === "boolean") sample.onBattery = value.onBattery;
  const thermal = value.thermal;
  if (thermal === "nominal" || thermal === "fair" || thermal === "serious" || thermal === "critical")
    sample.thermal = thermal;
  const pressure = value.pressure;
  if (pressure === "normal" || pressure === "warn" || pressure === "critical") sample.pressure = pressure;
  return sample;
}
