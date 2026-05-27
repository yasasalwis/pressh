import {randomUUID} from "node:crypto";
import type {AuditLog, Logger, Page, Result, StorageAdapter, StoredDoc} from "@pressh/core";

/**
 * Plugin CVE feed (ADR-011, baseline #11). A pluggable feed source provides
 * known-vulnerable plugin entries; the sync job persists them, and the
 * PluginHost refuses to load any flagged plugin. If a sync fails, the service
 * degrades gracefully — it keeps the last-known data and reports `stale`.
 *
 * v1 has no central registry, so the default source is empty/operator-supplied.
 */
export interface CveEntry {
  name: string;
  /** Exact version, or "*" for all versions of the plugin. */
  version: string;
  advisory: string;
}

export interface CveFeedSource {
  fetch(): Promise<CveEntry[]>;
}

export interface CveChecker {
  isFlagged(name: string, version: string): Promise<boolean>;
}

export interface CveService extends CveChecker {
  sync(): Promise<{ synced: number; stale: boolean }>;
  list(): Promise<CveEntry[]>;
}

export interface CveServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  source: CveFeedSource;
  logger?: Logger;
}

const CVE = "plugin_cve";

/** Canonical form for name/version matching so case/whitespace can't evade a flag. */
function normalize(value: string): string {
    return value.trim().toLowerCase();
}

interface CveRecord extends StoredDoc {
  name: string;
  version: string;
  advisory: string;
}

function must<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export function createCveService(opts: CveServiceOptions): CveService {
  async function records(filter?: Record<string, string>): Promise<CveRecord[]> {
    const collected: CveRecord[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<CveRecord> = must(
        await opts.storage.query<CveRecord>(CVE, filter ? { where: filter } : {}, { limit: 500, after: cursor }),
      );
      collected.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return collected;
  }

  return {
    async sync() {
      try {
        const entries = await opts.source.fetch();
        for (const existing of await records()) {
          must(await opts.storage.delete(CVE, existing.id));
        }
        for (const entry of entries) {
          must(
            await opts.storage.put(CVE, {
              id: randomUUID(),
              name: entry.name,
              version: entry.version,
              advisory: entry.advisory,
            }),
          );
        }
        await opts.audit.append({ action: "cve.sync", actorId: null, detail: { synced: entries.length } });
        return { synced: entries.length, stale: false };
      } catch (e) {
        opts.logger?.warn("CVE feed sync failed; using last-known data", {
          error: e instanceof Error ? e.message : String(e),
        });
        await opts.audit.append({ action: "cve.sync.failed", actorId: null, detail: {} });
        return { synced: 0, stale: true };
      }
    },

    async isFlagged(name, version) {
        // Compare on the normalized form (not a server-side exact-name filter) so a
        // plugin republished as "Foo "/"FOO" with a flagged name can't slip the net.
        const targetName = normalize(name);
        const targetVersion = normalize(version);
        const found = (await records()).filter((entry) => normalize(entry.name) === targetName);
        return found.some(
            (entry) => entry.version.trim() === "*" || normalize(entry.version) === targetVersion,
        );
    },

    async list() {
      return (await records()).map((r) => ({ name: r.name, version: r.version, advisory: r.advisory }));
    },
  };
}
