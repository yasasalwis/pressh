import {randomUUID} from "node:crypto";
import type {SecretsBackend} from "@pressh/core";
import {PressError} from "@pressh/core";
import type {EncRef} from "./gdpr.js";
import type {FieldDef} from "./types.js";

/**
 * Baseline #6 — sensitive content-field protection.
 *
 * A field marked `sensitive` (PII/secret) is sealed in the secrets vault on
 * write and replaced in the revision by an opaque `{$enc}` reference, so the
 * plaintext never lands in storage, backups, or query results. Only an admin
 * holding `content.reveal` (with a configured vault) can decrypt it; every
 * other read path — the public site, bound list data, unauthorized admins —
 * sees the mask. The `{$enc}` reference IS the boundary: anyone who only redacts
 * (never reveals) is structurally safe and needs no key.
 */

/** Shown in place of a sealed value on any read path that must not reveal it. */
export const SENSITIVE_MASK = "••••••";

/** Capability required to decrypt sealed sensitive content-field values. */
export const REVEAL_CAPABILITY = "content.reveal";

const SECRET_PREFIX = "field:";

export function isEncRef(value: unknown): value is EncRef {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as EncRef).$enc === "string"
    );
}

/**
 * Encrypt-on-write for fields marked `sensitive`. Each plaintext value is sealed
 * in the vault and replaced by an `{$enc}` reference.
 *
 * - Fail-closed: a type with a sensitive field but no vault throws — the value
 *   is NEVER stored in the clear.
 * - Mask carry-forward: an incoming value equal to `SENSITIVE_MASK` (an editor
 *   who couldn't reveal the field, or didn't touch it) keeps the prior revision's
 *   ciphertext rather than sealing the mask string.
 * - Already-sealed (`{$enc}`) and empty/nullish values pass through untouched.
 */
export async function protectSensitive(
    fields: Record<string, unknown>,
    fieldDefs: readonly FieldDef[],
    secrets: SecretsBackend | undefined,
    prior?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const sensitiveNames = fieldDefs.filter((f) => f.sensitive).map((f) => f.name);
    if (sensitiveNames.length === 0) return fields;
    if (!secrets) {
        throw new PressError(
            "validation",
            "This content type has sensitive fields but no secrets vault is configured. Set PRESSH_MASTER_KEY to store encrypted values.",
        );
    }

    const out: Record<string, unknown> = {...fields};
    for (const name of sensitiveNames) {
        const value = out[name];
        if (isEncRef(value)) continue; // already sealed
        if (value === SENSITIVE_MASK) {
            // Carry forward the prior ciphertext — never seal the mask placeholder.
            const priorVal = prior?.[name];
            out[name] = isEncRef(priorVal) ? priorVal : null;
            continue;
        }
        if (value === undefined || value === null || value === "") continue;
        const plaintext = typeof value === "string" ? value : JSON.stringify(value);
        const secretName = `${SECRET_PREFIX}${randomUUID()}`;
        await secrets.setSecret(secretName, plaintext);
        out[name] = {$enc: secretName};
    }
    return out;
}

/**
 * Deep-reveal: decrypt every `{$enc}` reference to its plaintext. A missing key
 * or absent vault yields the mask rather than throwing, so a crypto-shredded or
 * unreadable secret degrades gracefully.
 */
export async function revealEncRefs(
    value: unknown,
    secrets: SecretsBackend | undefined,
): Promise<unknown> {
    if (isEncRef(value)) {
        if (!secrets) return SENSITIVE_MASK;
        try {
            return await secrets.getSecret(value.$enc);
        } catch {
            return SENSITIVE_MASK;
        }
    }
    if (Array.isArray(value)) {
        return Promise.all(value.map((v) => revealEncRefs(v, secrets)));
    }
    if (typeof value === "object" && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = await revealEncRefs(v, secrets);
        return out;
    }
    return value;
}

/**
 * Deep-redact: replace every `{$enc}` reference with the mask. Pure/synchronous
 * and key-free — the default for every non-authorized read path.
 */
export function redactEncRefs(value: unknown): unknown {
    if (isEncRef(value)) return SENSITIVE_MASK;
    if (Array.isArray(value)) return value.map(redactEncRefs);
    if (typeof value === "object" && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = redactEncRefs(v);
        return out;
    }
    return value;
}
