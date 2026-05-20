import { describe, it, expect } from "vitest";
import { HookBus } from "@pressh/core";

describe("HookBus", () => {
  it("runs handlers in registration order", async () => {
    const bus = new HookBus();
    const order: number[] = [];
    bus.on("e", () => void order.push(1));
    bus.on("e", () => void order.push(2));
    await bus.emit("e", {});
    expect(order).toEqual([1, 2]);
  });

  it("orders by priority then registration", async () => {
    const bus = new HookBus();
    const order: string[] = [];
    bus.on("e", () => void order.push("default"));
    bus.on("e", () => void order.push("early"), { priority: -10 });
    bus.on("e", () => void order.push("late"), { priority: 10 });
    await bus.emit("e", {});
    expect(order).toEqual(["early", "default", "late"]);
  });

  it("awaits async handlers sequentially", async () => {
    const bus = new HookBus();
    const order: string[] = [];
    bus.on("e", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("slow");
    });
    bus.on("e", () => void order.push("fast"));
    await bus.emit("e", {});
    expect(order).toEqual(["slow", "fast"]);
  });

  it("passes the context to handlers", async () => {
    const bus = new HookBus();
    let seen: unknown;
    bus.on<{ id: string }>("e", (ctx) => {
      seen = ctx.id;
    });
    await bus.emit("e", { id: "abc" });
    expect(seen).toBe("abc");
  });

  it("unsubscribe removes the handler", async () => {
    const bus = new HookBus();
    const order: number[] = [];
    const off = bus.on("e", () => void order.push(1));
    off();
    await bus.emit("e", {});
    expect(order).toEqual([]);
  });

  it("emitting an unknown hook is a no-op", async () => {
    const bus = new HookBus();
    await expect(bus.emit("nope", {})).resolves.toBeUndefined();
  });
});
