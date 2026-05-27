// Forms & Submissions — captures public form posts as entries in the
// `form_submissions` collection, which the engine's GDPR service already scopes
// for data-subject export/erasure (subjectRef). Abuse defence: a hidden honeypot
// field (`_hp`) here, plus a per-IP rate limit applied host-side at the Site's
// plugin dispatch. Field values are length-capped and type-restricted on save.
//
// PII protection (baseline #6): fields the operator's form marks sensitive (via
// the `sensitiveFields` array in the payload) are sealed in the vault through the
// gated `host.pii.protect` RPC, so the plaintext never lands in storage/backups —
// it is recoverable only via a host-side GDPR export and crypto-shredded on erase.
// The subjectRef/email stays plaintext: it is the GDPR lookup key and the
// operator's contact handle. On opt-in, a GDPR consent record is written.

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
    const formId = String(args?.formId ?? "default").slice(0, MAX_KEY_LEN);

    // Seal operator-declared sensitive fields. A self-submitter who strips the list
    // only weakens confidentiality of their OWN data; the threat we defend against
    // is bulk exfiltration of PII honest submitters entrusted to the operator.
    const sensitive = Array.isArray(args?.sensitiveFields)
        ? args.sensitiveFields.filter((k) => typeof k === "string")
        : [];
    for (const key of sensitive) {
        const value = data[key];
        if (typeof value === "string" && value !== "") {
            data[key] = await host.pii.protect(subjectRef, value);
        }
    }

    const consent = args?.consent === true;
  const doc = {
    id: randomUUID(),
      formId,
    data,
    subjectRef,
      consent,
    at: new Date().toISOString(),
  };
  await host.storage.put(COLLECTION, doc);

    // Verifiable proof of consent (GDPR Art. 7), linked to the subject for export/erase.
    if (consent && subjectRef) {
        await host.pii.recordConsent(subjectRef, `form:${formId}`, true);
    }
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
