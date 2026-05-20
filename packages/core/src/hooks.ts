/**
 * Async hook bus. Hooks are async by definition — `emit` awaits each handler
 * in deterministic order (ascending priority, then registration order). This is
 * the in-process extension point for core/engine; plugin code never registers
 * here directly (it goes through the capability-gated RPC boundary in Phase 8).
 */
export type Hook<C = unknown> = (ctx: C) => void | Promise<void>;

type AnyHook = (ctx: unknown) => void | Promise<void>;

interface Registration {
  readonly fn: AnyHook;
  readonly priority: number;
  readonly seq: number;
}

export class HookBus {
  #hooks = new Map<string, Registration[]>();
  #seq = 0;

  on<C = unknown>(name: string, fn: Hook<C>, opts?: { priority?: number }): () => void {
    const list = this.#hooks.get(name) ?? [];
    const reg: Registration = {
      fn: fn as unknown as AnyHook,
      priority: opts?.priority ?? 0,
      seq: this.#seq++,
    };
    list.push(reg);
    list.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    this.#hooks.set(name, list);
    return () => {
      const current = this.#hooks.get(name);
      if (!current) return;
      const idx = current.indexOf(reg);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  async emit<C = unknown>(name: string, ctx: C): Promise<void> {
    const list = this.#hooks.get(name);
    if (!list) return;
    for (const reg of [...list]) {
      await reg.fn(ctx);
    }
  }
}
