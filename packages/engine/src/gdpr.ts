import { createHash, randomUUID } from "node:crypto";
import { CapabilityGate, PressError } from "@pressh/core";
import type { AuditLog, Page, Result, SecretsBackend, StorageAdapter, StoredDoc } from "@pressh/core";

/**
 * GDPR data-subject features (FR-040..043). Personal data lives in a set of
 * subject-linked collections; this service can export it (Art. 15/20), erase it
 * with crypto-shred + audited tombstone (Art. 17), record consent (Art. 6/7),
 * and purge per retention policy (Art. 5(1e)).
 *
 * PII minimization: the erasure tombstone and audit entry store only a HASH of
 * the subject reference, never the raw email/identifier.
 */
export interface SubjectScope {
  collection: string;
  subjectField: string;
  /** Field holding an ISO timestamp, used for retention. */
  timestampField?: string;
  /** Records older than this are purged by applyRetention. */
  retentionMs?: number;
}

export interface GdprServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  secrets?: SecretsBackend;
  scopes: SubjectScope[];
  now?: () => number;
}

export interface GdprExport {
  subjectRef: string;
  exportedAt: string;
  records: Record<string, unknown[]>;
}

export interface EncRef {
  $enc: string;
}

export interface GdprService {
  export(capabilities: string[], subjectRef: string): Promise<GdprExport>;
  erase(capabilities: string[], subjectRef: string): Promise<{ tombstoneId: string; erasedCount: number }>;
  recordConsent(subjectRef: string, scope: string, granted: boolean): Promise<void>;
  getConsent(subjectRef: string, scope: string): Promise<boolean | null>;
  applyRetention(): Promise<{ purged: number }>;
  protect(subjectRef: string, value: string): Promise<EncRef>;
  reveal(ref: EncRef): Promise<string>;
}

const CONSENT_COLLECTION = "consent_records";
const TOMBSTONE_COLLECTION = "gdpr_tombstones";

function must<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function subjectHash(subjectRef: string): string {
  return createHash("sha256").update(subjectRef).digest("hex");
}

function isEncRef(value: unknown): value is EncRef {
  return typeof value === "object" && value !== null && typeof (value as EncRef).$enc === "string";
}

export function createGdprService(opts: GdprServiceOptions): GdprService {
  const gate = new CapabilityGate();
  const now = opts.now ?? (() => Date.now());
  const allScopes: SubjectScope[] = [
    ...opts.scopes,
    { collection: CONSENT_COLLECTION, subjectField: "subjectRef" },
  ];

  async function reveal(ref: EncRef): Promise<string> {
    if (!opts.secrets) throw new PressError("internal", "Secrets backend not configured");
    return opts.secrets.getSecret(ref.$enc);
  }

  async function revealDeep(value: unknown): Promise<unknown> {
    if (isEncRef(value)) {
      if (!opts.secrets) return value; // cannot decrypt; leave the reference
      return reveal(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map((v) => revealDeep(v)));
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = await revealDeep(v);
      return out;
    }
    return value;
  }

  async function recordsForSubject(scope: SubjectScope, subjectRef: string): Promise<StoredDoc[]> {
    const collected: StoredDoc[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<StoredDoc> = must(
        await opts.storage.query<StoredDoc>(
          scope.collection,
          { where: { [scope.subjectField]: subjectRef } },
          { limit: 500, after: cursor },
        ),
      );
      collected.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return collected;
  }

  return {
    async export(capabilities, subjectRef) {
      gate.assert(capabilities, "gdpr.manage");
      const records: Record<string, unknown[]> = {};
      for (const scope of allScopes) {
        const found = await recordsForSubject(scope, subjectRef);
        records[scope.collection] = (await revealDeep(found)) as unknown[];
      }
      return { subjectRef, exportedAt: new Date(now()).toISOString(), records };
    },

    async erase(capabilities, subjectRef) {
      gate.assert(capabilities, "gdpr.manage");
      let erasedCount = 0;
      for (const scope of allScopes) {
        for (const record of await recordsForSubject(scope, subjectRef)) {
          must(await opts.storage.delete(scope.collection, record.id));
          erasedCount += 1;
        }
      }

      // Crypto-shred: delete every secret in the subject's namespace.
      if (opts.secrets) {
        const prefix = `gdpr:${subjectHash(subjectRef)}:`;
        for (const name of await opts.secrets.listNames()) {
          if (name.startsWith(prefix)) await opts.secrets.deleteSecret(name);
        }
      }

      const tombstoneId = randomUUID();
      must(
        await opts.storage.put(TOMBSTONE_COLLECTION, {
          id: tombstoneId,
          subject: subjectHash(subjectRef), // hash only — no raw PII retained
          erasedCount,
          erasedAt: new Date(now()).toISOString(),
        }),
      );
      await opts.audit.append({
        action: "gdpr.erase",
        actorId: null,
        detail: { subject: subjectHash(subjectRef), erasedCount },
      });
      return { tombstoneId, erasedCount };
    },

    async recordConsent(subjectRef, scope, granted) {
      must(
        await opts.storage.put(CONSENT_COLLECTION, {
          id: randomUUID(),
          subjectRef,
          scope,
          granted,
          at: new Date(now()).toISOString(),
        }),
      );
      await opts.audit.append({
        action: "gdpr.consent",
        actorId: null,
        detail: { subject: subjectHash(subjectRef), scope, granted },
      });
    },

    async getConsent(subjectRef, scope) {
      const all = (await recordsForSubject(
        { collection: CONSENT_COLLECTION, subjectField: "subjectRef" },
        subjectRef,
      )) as unknown as { scope: string; granted: boolean; at: string }[];
      const matching = all.filter((r) => r.scope === scope).sort((a, b) => b.at.localeCompare(a.at));
      return matching[0]?.granted ?? null;
    },

    async applyRetention() {
      let purged = 0;
      const t = now();
      for (const scope of allScopes) {
        if (scope.retentionMs === undefined || scope.timestampField === undefined) continue;
        const tsField = scope.timestampField;
        let cursor: string | null = null;
        do {
          const page: Page<StoredDoc> = must(
            await opts.storage.query<StoredDoc>(scope.collection, {}, { limit: 500, after: cursor }),
          );
          for (const record of page.items) {
            const raw = record[tsField];
            const at = typeof raw === "string" ? Date.parse(raw) : NaN;
            if (!Number.isNaN(at) && t - at > scope.retentionMs) {
              must(await opts.storage.delete(scope.collection, record.id));
              purged += 1;
            }
          }
          cursor = page.nextCursor;
        } while (cursor !== null);
      }
      if (purged > 0) {
        await opts.audit.append({ action: "gdpr.retention", actorId: null, detail: { purged } });
      }
      return { purged };
    },

    async protect(subjectRef, value) {
      if (!opts.secrets) throw new PressError("internal", "Secrets backend not configured");
      const name = `gdpr:${subjectHash(subjectRef)}:${randomUUID()}`;
      await opts.secrets.setSecret(name, value);
      return { $enc: name };
    },

    reveal,
  };
}
