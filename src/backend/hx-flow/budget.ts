// HXBot 并发（一）：桌面端机器容量闸（v1.7.1，CONC-01）。
//
// The budget B is how many agent turns may run at the same time on this computer. It comes from the
// free memory, the power state, the temperature and the delay of the main process. The number of
// members of a team is not limited: only the turns that run at the same time are.
//
//   B = clamp(floor((available − max(2 GiB, total × 15 %)) / per-turn) × factor, 2, 16)
//   factor: on battery × 0.75; thermal "serious" × 0.5; CPU speed limit below 70 % × 0.75
//   thermal "critical": B = 1. Main event loop p99 above 200 ms: B − 1.
//   macOS memory pressure "warn": B does not go up; "critical": B goes below the running turns.
//
// A sample comes every 5 s while a turn runs or waits. B goes down at once and goes up only after 3
// samples in a row that allow more. A lower B never stops a turn that runs. After sleep, B starts
// again from the slow start (2). This file has no Electron import: the main process gives the samples.

export const HX_FLOW_SAMPLE_MS = 5_000;
const HX_FLOW_MIN_BUDGET = 2;
const HX_FLOW_MAX_BUDGET = 16;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
/** The memory of one turn before a reading of the provider processes. */
const HX_FLOW_TURN_BYTES = 2 * GIB;
const TURN_BYTES_MIN = 256 * MIB;
const TURN_BYTES_MAX = 4 * GIB;
/** How much of each new reading goes into the rolling memory of one turn. */
const TURN_BYTES_WEIGHT = 0.3;
const HX_FLOW_RAISE_SAMPLES = 3;
const HX_FLOW_LOOP_P99_MS = 200;
const HX_FLOW_SPEED_LIMIT = 70;

export type HxFlowThermal = "nominal" | "fair" | "serious" | "critical";
export type HxFlowPressure = "normal" | "warn" | "critical";

export interface HxFlowSample {
  totalBytes: number;
  availableBytes: number;
  /** The memory of one turn now (rolling). */
  turnBytes: number;
  onBattery: boolean;
  thermal: HxFlowThermal | null;
  /** The CPU speed limit in percent, or null when the system does not tell it. */
  speedLimit: number | null;
  /** The p99 delay of the main process event loop in the last sample period, in ms. */
  loopP99Ms: number | null;
  /** macOS only; null on the other systems. */
  pressure: HxFlowPressure | null;
  /** The turns that run now. */
  running: number;
}

/** The factor of the power state and the temperature. */
function hxFlowFactor(sample: Pick<HxFlowSample, "onBattery" | "thermal" | "speedLimit">): number {
  let factor = 1;
  if (sample.onBattery) factor *= 0.75;
  if (sample.thermal === "serious") factor *= 0.5;
  if (sample.speedLimit !== null && sample.speedLimit < HX_FLOW_SPEED_LIMIT) factor *= 0.75;
  return factor;
}

/** B for one sample, before the rules of going up and down. Never below 1 or above 16. */
export function hxFlowTarget(sample: HxFlowSample): number {
  if (sample.thermal === "critical") return 1;
  const reserve = Math.max(2 * GIB, sample.totalBytes * 0.15);
  const turnBytes = Math.max(TURN_BYTES_MIN, sample.turnBytes);
  const turns = Math.floor(Math.max(0, sample.availableBytes - reserve) / turnBytes);
  let budget = Math.floor(turns * hxFlowFactor(sample));
  budget = Math.min(HX_FLOW_MAX_BUDGET, Math.max(HX_FLOW_MIN_BUDGET, budget));
  if (sample.loopP99Ms !== null && sample.loopP99Ms > HX_FLOW_LOOP_P99_MS) budget -= 1;
  if (sample.pressure === "critical") budget = Math.min(budget, sample.running - 1);
  return Math.min(HX_FLOW_MAX_BUDGET, Math.max(1, budget));
}

/**
 * The rolling memory of one turn: the resident memory of one provider process. A turn runs in one
 * process, and an idle process keeps its memory too, so the memory of all of them over the turns that
 * run would count the idle ones as the turn's (the stress run of v1.7.1 found B held at 2 that way).
 * The free memory already counts the processes that are there; this is what one more turn costs.
 */
function hxFlowTurnBytes(previous: number, agents: HxFlowAgentMemory | null, running: number): number {
  if (agents === null || running <= 0 || agents.processes <= 0) return previous;
  const reading = Math.min(TURN_BYTES_MAX, Math.max(TURN_BYTES_MIN, agents.bytes / agents.processes));
  return previous + (reading - previous) * TURN_BYTES_WEIGHT;
}

/** The provider processes of the agents: their resident memory and how many there are. */
export interface HxFlowAgentMemory {
  bytes: number;
  processes: number;
}

export type HxFlowBudgetBound = "memory" | "power" | "heat" | "delay" | "pressure" | "ceiling" | "floor";

export interface HxFlowBudgetState {
  budget: number;
  target: number;
  /** What holds B where it is, for the capacity notice. */
  bound: HxFlowBudgetBound;
  turnBytes: number;
  sleeping: boolean;
}

/**
 * The rules of going up and down: down at once, up after 3 samples in a row that allow more (to the
 * smallest of them), no going up at memory pressure "warn", and the slow start after sleep.
 */
export class HxFlowBudget {
  #budget: number | null = null;
  #target = HX_FLOW_MIN_BUDGET;
  #raises: number[] = [];
  #turnBytes = HX_FLOW_TURN_BYTES;
  #bound: HxFlowBudgetBound = "memory";
  #sleeping = false;

  /** B now; the slow start before the first sample. */
  get budget(): number {
    return this.#budget ?? HX_FLOW_MIN_BUDGET;
  }

  state(): HxFlowBudgetState {
    return {
      budget: this.budget,
      target: this.#target,
      bound: this.#bound,
      turnBytes: this.#turnBytes,
      sleeping: this.#sleeping,
    };
  }

  /** `agents` is the memory of the provider processes, or null when unknown. */
  sample(input: Omit<HxFlowSample, "turnBytes">, agents: HxFlowAgentMemory | null): number {
    if (this.#sleeping) return this.budget;
    this.#turnBytes = hxFlowTurnBytes(this.#turnBytes, agents, input.running);
    const sample = { ...input, turnBytes: this.#turnBytes };
    const target = hxFlowTarget(sample);
    this.#target = target;
    this.#bound = boundOf(sample, target);
    const current = this.#budget;
    if (current === null) {
      this.#budget = target;
      return target;
    }
    if (target < current) {
      this.#budget = target;
      this.#raises = [];
    } else if (target > current && input.pressure !== "warn") {
      this.#raises.push(target);
      if (this.#raises.length >= HX_FLOW_RAISE_SAMPLES) {
        this.#budget = Math.min(...this.#raises.slice(-HX_FLOW_RAISE_SAMPLES));
        this.#raises = [];
      }
    } else {
      this.#raises = [];
    }
    return this.budget;
  }

  /** The computer sleeps: every timer stops, and nothing goes up. */
  suspend(): void {
    this.#sleeping = true;
    this.#raises = [];
  }

  /** The computer woke: B starts again from the slow start. */
  resume(): void {
    this.#sleeping = false;
    this.#raises = [];
    this.#budget = Math.min(this.budget, HX_FLOW_MIN_BUDGET);
  }
}

function boundOf(sample: HxFlowSample, target: number): HxFlowBudgetBound {
  if (sample.thermal === "critical" || sample.thermal === "serious") return "heat";
  if (sample.pressure === "critical") return "pressure";
  if (sample.loopP99Ms !== null && sample.loopP99Ms > HX_FLOW_LOOP_P99_MS) return "delay";
  if (sample.onBattery || (sample.speedLimit !== null && sample.speedLimit < HX_FLOW_SPEED_LIMIT)) return "power";
  if (target >= HX_FLOW_MAX_BUDGET) return "ceiling";
  if (target <= HX_FLOW_MIN_BUDGET) return "floor";
  return "memory";
}
