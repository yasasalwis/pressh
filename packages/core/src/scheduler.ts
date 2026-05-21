import { randomUUID } from "node:crypto";
import type { AuditLog } from "./audit.js";
import type { Result } from "./result.js";
import type { Page, StorageAdapter, StoredDoc } from "./storage/types.js";

/**
 * Persisted background-job scheduler (FR-052). Jobs live in storage, so they
 * survive restarts: a fresh process picks up any pending, now-due jobs on its
 * next `tick` (catch-up). A completed job is never re-run. Handlers must be
 * idempotent so a retry (or a duplicate due to a crash mid-run) is safe.
 */
export type JobStatus = "pending" | "running" | "done" | "failed";

export interface JobRecord extends StoredDoc {
  type: string;
  runAt: number;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  createdAt: string;
  lastError: string | null;
}

export type JobHandler = (payload: unknown) => Promise<void>;

export interface ScheduleInput {
  type: string;
  runAt?: number;
  payload?: unknown;
}

export interface Scheduler {
  register(type: string, handler: JobHandler): void;
  schedule(input: ScheduleInput): Promise<JobRecord>;
  tick(): Promise<{ ran: number; failed: number }>;
  start(intervalMs?: number): void;
  stop(): void;
  pending(): Promise<JobRecord[]>;
}

export interface SchedulerOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  now?: () => number;
  maxAttempts?: number;
}

const JOBS = "jobs";

function must<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const handlers = new Map<string, JobHandler>();
  const now = opts.now ?? (() => Date.now());
  const maxAttempts = opts.maxAttempts ?? 3;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function loadPending(): Promise<JobRecord[]> {
    const collected: JobRecord[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<JobRecord> = must(
        await opts.storage.query<JobRecord>(JOBS, { where: { status: "pending" } }, { limit: 500, after: cursor }),
      );
      collected.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return collected;
  }

  async function schedule(input: ScheduleInput): Promise<JobRecord> {
    const job: JobRecord = {
      id: randomUUID(),
      type: input.type,
      runAt: input.runAt ?? now(),
      payload: input.payload ?? null,
      status: "pending",
      attempts: 0,
      createdAt: new Date(now()).toISOString(),
      lastError: null,
    };
    must(await opts.storage.put(JOBS, job));
    await opts.audit.append({
      action: "job.schedule",
      actorId: null,
      detail: { jobId: job.id, type: job.type, runAt: job.runAt },
    });
    return job;
  }

  async function tick(): Promise<{ ran: number; failed: number }> {
    const t = now();
    const due = (await loadPending()).filter((j) => j.runAt <= t).sort((a, b) => a.runAt - b.runAt);
    let ran = 0;
    let failed = 0;

    for (const job of due) {
      const handler = handlers.get(job.type);
      job.status = "running";
      must(await opts.storage.put(JOBS, job));

      if (!handler) {
        job.status = "failed";
        job.lastError = `No handler for job type: ${job.type}`;
        must(await opts.storage.put(JOBS, job));
        failed += 1;
        continue;
      }

      try {
        await handler(job.payload);
        job.status = "done";
        job.lastError = null;
        must(await opts.storage.put(JOBS, job));
        ran += 1;
        await opts.audit.append({ action: "job.done", actorId: null, detail: { jobId: job.id, type: job.type } });
      } catch (e) {
        job.attempts += 1;
        job.lastError = e instanceof Error ? e.message : String(e);
        job.status = job.attempts >= maxAttempts ? "failed" : "pending";
        if (job.status === "failed") failed += 1;
        must(await opts.storage.put(JOBS, job));
        await opts.audit.append({
          action: "job.failed",
          actorId: null,
          detail: { jobId: job.id, type: job.type, attempts: job.attempts },
        });
      }
    }
    return { ran, failed };
  }

  return {
    register: (type, handler) => {
      handlers.set(type, handler);
    },
    schedule,
    tick,
    pending: loadPending,
    start: (intervalMs = 5000) => {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof timer.unref === "function") timer.unref();
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
