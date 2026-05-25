import {createHmac, timingSafeEqual} from "node:crypto";
import {readdir, readFile} from "node:fs/promises";
import {join, relative, sep} from "node:path";

/**
 * Plugin signatures (SECURITY baseline #4, ADR-011).
 *
 * The original scheme stored a bare SHA-256 of the plugin's `main` file. That
 * is only an integrity *checksum*: anyone who can write the plugin directory can
 * edit the code AND recompute the matching hash, so it stops nothing. It also
 * covered only `main`, so a sibling file imported by the plugin was unsigned.
 *
 * This scheme fixes both:
 *  - It is a keyed **HMAC-SHA256**. Forging a valid signature requires the
 *    signing key, which is derived from `PRESSH_MASTER_KEY` and lives in the
 *    host's environment / secrets volume — never in the plugin directory. An
 *    attacker who can only write `plugins/<x>/` cannot forge it.
 *  - It covers **every file** in the plugin directory (manifest, code, panel,
 *    presets, …). Adding, modifying, or removing any file is detected.
 */

export const SIGNATURE_FILE = "pressh.signature.json";
export const SIGNATURE_ALGORITHM = "hmac-sha256";
const KEY_DERIVATION_LABEL = "pressh/plugin-signing/v1";

export interface PluginSignature {
    algorithm: string;
    /** relPath (POSIX) → hex HMAC of that file's bytes. */
    files: Record<string, string>;
}

/**
 * Derives the per-deployment plugin-signing key from the master secret. Using a
 * labelled HMAC (rather than the raw master key) keeps the signing key distinct
 * from the vault-encryption use of the same secret.
 */
export function derivePluginSigningKey(secret: string): Buffer {
    return createHmac("sha256", secret).update(KEY_DERIVATION_LABEL).digest();
}

export function computeFileHmac(key: Buffer, content: Buffer): string {
    return createHmac("sha256", key).update(content).digest("hex");
}

/**
 * Lists every file in a plugin directory as POSIX-relative paths, excluding the
 * signature file itself. Recurses so bundled sibling modules are covered.
 */
export async function listPluginFiles(dir: string): Promise<string[]> {
    const out: string[] = [];

    async function walk(current: string): Promise<void> {
        const entries = await readdir(current, {withFileTypes: true});
        for (const entry of entries) {
            const abs = join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(abs);
            } else if (entry.isFile()) {
                const rel = relative(dir, abs).split(sep).join("/");
                if (rel !== SIGNATURE_FILE) out.push(rel);
            }
        }
    }

    await walk(dir);
    return out.sort();
}

function hmacEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Builds a signature over every file in `dir` using `key`. */
export async function buildSignature(dir: string, key: Buffer): Promise<PluginSignature> {
    const files: Record<string, string> = {};
    for (const rel of await listPluginFiles(dir)) {
        files[rel] = computeFileHmac(key, await readFile(join(dir, rel)));
    }
    return {algorithm: SIGNATURE_ALGORITHM, files};
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verifies that the on-disk file set EXACTLY matches the signature and that
 * every file's HMAC matches — detecting modified, added, and removed files.
 */
export async function verifyPluginSignature(
    dir: string,
    signature: PluginSignature,
    key: Buffer,
): Promise<VerifyResult> {
    if (signature.algorithm !== SIGNATURE_ALGORITHM || !signature.files || typeof signature.files !== "object") {
        return {ok: false, reason: "unrecognized signature format"};
    }
    const onDisk = await listPluginFiles(dir);
    const signed = Object.keys(signature.files).sort();

    if (onDisk.length !== signed.length || onDisk.some((f, i) => f !== signed[i])) {
        return {ok: false, reason: "file set does not match signature (a file was added or removed)"};
    }
    for (const rel of onDisk) {
        const actual = computeFileHmac(key, await readFile(join(dir, rel)));
        const expected = signature.files[rel];
        if (typeof expected !== "string" || !hmacEqual(actual, expected)) {
            return {ok: false, reason: `file "${rel}" failed signature verification`};
        }
    }
    return {ok: true};
}
