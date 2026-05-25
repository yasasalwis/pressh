// Forms & Submissions — captures public form posts as entries in the
// `form_submissions` collection, which the engine's GDPR service already scopes
// for data-subject export/erasure (subjectRef). Abuse defence: a hidden honeypot
// field (`_hp`) here, plus a per-IP rate limit applied host-side at the Site's
// plugin dispatch. Field values are length-capped and type-restricted on save.

import { randomUUID } from "node:crypto";

const COLLECTION = "form_submissions";
const MAX_FIELDS = 50;
const MAX_VALUE_LEN = 5000;
const MAX_KEY_LEN = 100;

/** Keeps only scalar values, capped in count and length; drops the honeypot. */
function sanitizeFields(fields) {
  const out = {};
  if (!fields || typeof fields !== "object") return out;
  let n = 0;
  for (const [rawKey, value] of Object.entries(fields)) {
    if (rawKey === "_hp") continue;
    if (n++ >= MAX_FIELDS) break;
    const key = String(rawKey).slice(0, MAX_KEY_LEN);
    if (typeof value === "string") out[key] = value.slice(0, MAX_VALUE_LEN);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * Public submit handler. A filled honeypot is silently accepted (no store, no
 * error) so bots get no signal. Real submissions are persisted with a subjectRef
 * (for GDPR linkage) and a consent flag.
 * @param {Record<string, unknown>} args @param {import('@pressh/sdk').HostApi} host
 */
export async function submit(args, host) {
  if (typeof args?._hp === "string" && args._hp.trim() !== "") return { ok: true };
  const data = sanitizeFields(args?.fields);
  const subjectRef = String(args?.subjectRef ?? data.email ?? "").slice(0, 320);
  const doc = {
    id: randomUUID(),
    formId: String(args?.formId ?? "default").slice(0, MAX_KEY_LEN),
    data,
    subjectRef,
    consent: args?.consent === true,
    at: new Date().toISOString(),
  };
  await host.storage.put(COLLECTION, doc);
  return { ok: true, id: doc.id };
}

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function list(_args, host) {
  const page = await host.storage.query(COLLECTION, undefined, { limit: 200 });
  const items = page.items.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { items };
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function remove(args, host) {
  const id = String(args?.id ?? "");
  if (!id) throw new Error("A submission id is required");
  await host.storage.delete(COLLECTION, id);
  return { ok: true };
}
