// HXBot v1.7.3（压力测试：用了很久的资料夹）：排队检查一遍只读每条线路一次。
//
// 一个轮次结束、内存采样时，排队调度把所有在等位置的线路一条条再问一遍能不能开始（retrySlotWaiters）；
// 每问一条，turn-slots.ts 都要把所有线路的“在不在跑”“在不在等”“排在最前面的消息”“排第几”重新算一遍。
// 每一项都要读对话、任务和信箱，线路一多（每个智能体的对话加上它没做完的任务），一遍就是 等着的 × 全部，
// 一个用了很久的资料夹（GitHub 之外的压力测试：250 MB 的数据库）启动时主进程卡住 15 秒。
// 一遍检查是同步做完的：这期间这些读数不会变（开始一个轮次要等到下一个微任务），所以一遍里每条线路只读一次。
// 不在一遍检查里时照旧每次都读。
import type { QueueDelivery } from "@hxbot/contracts/ipc";
import type { HxFlowCandidate } from "./ledger";

/** What the turn slots read of each lane (turn-slots.ts). */
export interface HxSlotReads {
  lanes(): readonly string[];
  isRunning(lane: string): boolean;
  isWaiting(lane: string): boolean;
  head(lane: string): QueueDelivery | null;
  rank?(lane: string, head: QueueDelivery): HxFlowCandidate;
}

interface Held<T> {
  value: T;
}

/** The reads of one pass of the turn slots. */
export class HxSlotPass {
  #depth = 0;
  #lanes: Held<readonly string[]> | null = null;
  readonly #running = new Map<string, boolean>();
  readonly #waiting = new Map<string, boolean>();
  readonly #heads = new Map<string, Held<QueueDelivery | null>>();
  readonly #ranks = new Map<string, HxFlowCandidate>();
  /** The reads kept by `memo`, forgotten with the others at the end of a pass. */
  readonly #memos: Array<{ clear(): void }> = [];

  /** Runs one pass: inside it, each lane is read once. */
  run<T>(body: () => T): T {
    this.#depth += 1;
    try {
      return body();
    } finally {
      this.#depth -= 1;
      if (this.#depth === 0) this.#forget();
    }
  }

  /** The same reads, kept for the length of a pass. */
  wrap<O extends HxSlotReads>(options: O): O {
    const rank = options.rank;
    return {
      ...options,
      lanes: () => {
        if (this.#depth === 0) return options.lanes();
        this.#lanes ??= { value: options.lanes() };
        return this.#lanes.value;
      },
      isRunning: (lane: string) => this.#flag(this.#running, lane, () => options.isRunning(lane)),
      isWaiting: (lane: string) => this.#flag(this.#waiting, lane, () => options.isWaiting(lane)),
      head: (lane: string) => {
        if (this.#depth === 0) return options.head(lane);
        let held = this.#heads.get(lane);
        if (!held) {
          held = { value: options.head(lane) };
          this.#heads.set(lane, held);
        }
        return held.value;
      },
      ...(rank
        ? {
            rank: (lane: string, head: QueueDelivery) => {
              if (this.#depth === 0) return rank(lane, head);
              const key = `${lane}\n${head.id}`;
              let found = this.#ranks.get(key);
              if (!found) {
                found = rank(lane, head);
                this.#ranks.set(key, found);
              }
              return found;
            },
          }
        : {}),
    };
  }

  /**
   * A read of the scheduler kept for the length of a pass, under a key (an agent's lanes, the list of
   * agents). Outside a pass it reads each time.
   */
  memo<V>(): (key: string, read: () => V) => V {
    const held = new Map<string, Held<V>>();
    this.#memos.push(held);
    return (key, read) => {
      if (this.#depth === 0) return read();
      const found = held.get(key);
      if (found) return found.value;
      const value = read();
      held.set(key, { value });
      return value;
    };
  }

  #flag(map: Map<string, boolean>, lane: string, read: () => boolean): boolean {
    if (this.#depth === 0) return read();
    const known = map.get(lane);
    if (known !== undefined) return known;
    const value = read();
    map.set(lane, value);
    return value;
  }

  #forget(): void {
    this.#lanes = null;
    this.#running.clear();
    this.#waiting.clear();
    this.#heads.clear();
    this.#ranks.clear();
    for (const memo of this.#memos) memo.clear();
  }
}
