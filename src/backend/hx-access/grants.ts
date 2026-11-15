// HXBot：授权记录。“允许一次”的授权只在内存里，属于一个智能体的一个任务，每个对象用一次即失效，
// 任务结束时收回。“始终允许”的规则在 rules.ts，对所有智能体有效，存在数据文件夹里。
import { randomUUID } from "node:crypto";
import type { AccessGrant, AccessUse } from "./policy";

export type NewAccessGrant = Omit<AccessGrant, "id" | "grantedAt">;

/**
 * The grants that users gave in access cards. A grant belongs to the turn it was given in: the turn's
 * end, the agent's release_access, the user's revoke, a new access level or a restart ends it.
 * Nothing is written to disk, so a grant cannot outlive the app.
 */
export class HxAccessGrants {
  readonly #grants = new Map<string, AccessGrant>();
  readonly #listeners = new Set<(agentId: string) => void>();

  add(input: NewAccessGrant): AccessGrant {
    const grant: AccessGrant = { ...input, id: `grant-${randomUUID()}`, grantedAt: Date.now() };
    this.#grants.set(grant.id, grant);
    this.#changed(grant.agentId);
    return grant;
  }

  /** The grants of an agent's thread: those of the running turn of that thread. */
  forThread(agentId: string, threadId: string): AccessGrant[] {
    return [...this.#grants.values()].filter((grant) => grant.agentId === agentId && grant.threadId === threadId);
  }

  forAgent(agentId: string): AccessGrant[] {
    return [...this.#grants.values()].filter((grant) => grant.agentId === agentId);
  }

  /**
   * A confirmation was used: each target of a once grant covers one use. The uses come from the
   * decision just made, so their target numbers are those of the grants as they are now.
   */
  consume(uses: readonly AccessUse[]): void {
    const byGrant = new Map<string, Set<number>>();
    for (const use of uses) {
      const grant = this.#grants.get(use.grantId);
      if (!grant?.once) continue;
      const targets = byGrant.get(use.grantId) ?? new Set<number>();
      targets.add(use.target);
      byGrant.set(use.grantId, targets);
    }
    for (const [id, used] of byGrant) {
      const grant = this.#grants.get(id);
      if (!grant) continue;
      const left = grant.targets.filter((_target, index) => !used.has(index));
      if (left.length === 0) this.#grants.delete(id);
      else this.#grants.set(id, { ...grant, targets: left });
      this.#changed(grant.agentId);
    }
  }

  /** Ends one grant. False when it was not there. */
  release(id: string): boolean {
    const grant = this.#grants.get(id);
    if (!grant) return false;
    this.#grants.delete(id);
    this.#changed(grant.agentId);
    return true;
  }

  /** Ends the grants of a turn: the task is over. */
  releaseTurn(threadId: string, turnId: string): number {
    return this.#releaseWhere((grant) => grant.threadId === threadId && grant.turnId === turnId);
  }

  /** Ends the grants of a thread's earlier turns: a new task starts with none. */
  releaseOtherTurns(agentId: string, threadId: string, turnId: string): number {
    return this.#releaseWhere(
      (grant) => grant.agentId === agentId && grant.threadId === threadId && grant.turnId !== turnId,
    );
  }

  /** Ends the grants of a thread, such as when the agent releases all it asked for. */
  releaseThread(agentId: string, threadId: string): number {
    return this.#releaseWhere((grant) => grant.agentId === agentId && grant.threadId === threadId);
  }

  /** Ends every grant of an agent: the user revoked them, or changed the agent's access. */
  releaseAgent(agentId: string): number {
    return this.#releaseWhere((grant) => grant.agentId === agentId);
  }

  onChange(listener: (agentId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #releaseWhere(test: (grant: AccessGrant) => boolean): number {
    const agents = new Set<string>();
    let released = 0;
    for (const [id, grant] of this.#grants) {
      if (!test(grant)) continue;
      this.#grants.delete(id);
      agents.add(grant.agentId);
      released += 1;
    }
    for (const agentId of agents) this.#changed(agentId);
    return released;
  }

  #changed(agentId: string): void {
    for (const listener of this.#listeners) {
      try {
        listener(agentId);
      } catch {
        // A listener that fails must not keep a grant alive or stop the others.
      }
    }
  }
}

/** The grants of this HXBot process. */
export const hxAccessGrants = new HxAccessGrants();
