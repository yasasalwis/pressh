import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAuditLog, createFileSystemStorage, createScheduler } from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-sched-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  clock = 1_000_000;
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Scheduler", () => {
  it("runs a due job and does not re-run a completed one", async () => {
    let ran = 0;
    const s = createScheduler({ storage, audit, now: () => clock });
    s.register("ping", async () => {
      ran += 1;
    });
    await s.schedule({ type: "ping" });
    expect((await s.tick()).ran).toBe(1);
    expect((await s.tick()).ran).toBe(0); // already done — not re-run
    expect(ran).toBe(1);
  });

  it("does not run a job before its runAt", async () => {
    let ran = 0;
    const s = createScheduler({ storage, audit, now: () => clock });
    s.register("later", async () => {
      ran += 1;
    });
    await s.schedule({ type: "later", runAt: clock + 1000 });
    expect((await s.tick()).ran).toBe(0);
    expect(ran).toBe(0);
  });

  it("survives a restart and catches up (persistence)", async () => {
    let ran = 0;
    const s1 = createScheduler({ storage, audit, now: () => clock });
    s1.register("p", async () => {
      ran += 1;
    });
    await s1.schedule({ type: "p", runAt: clock + 1000 });
    expect((await s1.tick()).ran).toBe(0);

    clock += 2000;
    // Simulate a fresh process over the same storage.
    const s2 = createScheduler({ storage, audit, now: () => clock });
    s2.register("p", async () => {
      ran += 1;
    });
    expect((await s2.tick()).ran).toBe(1);
    expect(ran).toBe(1);
  });

  it("retries up to maxAttempts then fails", async () => {
    let calls = 0;
    const s = createScheduler({ storage, audit, now: () => clock, maxAttempts: 2 });
    s.register("boom", async () => {
      calls += 1;
      throw new Error("nope");
    });
    await s.schedule({ type: "boom" });
    await s.tick(); // attempt 1 → back to pending
    const second = await s.tick(); // attempt 2 → failed
    expect(calls).toBe(2);
    expect(second.failed).toBe(1);
    expect(await s.pending()).toHaveLength(0);
  });

  it("fails a job with no registered handler", async () => {
    const s = createScheduler({ storage, audit, now: () => clock });
    await s.schedule({ type: "unknown" });
    expect((await s.tick()).failed).toBe(1);
  });
});
