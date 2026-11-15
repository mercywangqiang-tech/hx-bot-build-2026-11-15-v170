// HXBot 不打扰其他应用（v1.7.0，F8）：更新下载不占满网络。
// 用户 2026-11-14 选了“经常断网”：更新包以全速下载时整条线路被占满，用户自己的通话和网页就断了。
// Mac 的下载（hx-updates.ts）和 Windows、Linux 的 electron-updater 都按同一个速度走。
// electron-updater 的请求经 Electron 的 net 模块：会话的网络模拟（enableNetworkEmulation）管不到它
// （2026-11-15 在 Electron 44 里实测：限 256 KB/s 时 1 MB 4 毫秒就下完），所以在它收数据的地方按速度放行。
import { Transform, type TransformCallback } from "node:stream";

/**
 * The most an update download takes of the network: 2 MB/s, 16 Mbit/s. A 200 MB update then takes
 * under two minutes, and a line of 20 Mbit/s or more keeps room for the user.
 */
export const HX_UPDATE_BYTES_PER_SECOND = 2 * 1024 * 1024;

/** A short burst that may go at once, so a small file is not slowed. */
const BURST_MS = 250;

/**
 * One budget for every download that shares it: parallel range requests of a differential update
 * together keep to the rate.
 */
export class HxPacer {
  #free = Number.NEGATIVE_INFINITY;
  readonly #bytesPerSecond: number;
  readonly #now: () => number;

  constructor(bytesPerSecond: number = HX_UPDATE_BYTES_PER_SECOND, now: () => number = Date.now) {
    this.#bytesPerSecond = bytesPerSecond;
    this.#now = now;
  }

  /** How long to wait before `bytes` more may go on. */
  delay(bytes: number): number {
    const now = this.#now();
    this.#free = Math.max(this.#free, now - BURST_MS) + (bytes * 1000) / this.#bytesPerSecond;
    return Math.max(0, this.#free - now);
  }
}

/** A stream that lets data through at the pacer's rate. */
export class HxPacedStream extends Transform {
  readonly #pacer: HxPacer;

  constructor(pacer: HxPacer) {
    super();
    this.#pacer = pacer;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    const ms = this.#pacer.delay(chunk.length);
    if (ms <= 0) done(null, chunk);
    else setTimeout(() => done(null, chunk), ms);
  }
}
