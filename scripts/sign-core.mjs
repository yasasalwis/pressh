// Shared first-party-plugin signing logic. A plugin signature is a keyed HMAC
// over EVERY file in the plugin directory (see packages/runtime/plugin-signature.ts);
// the PluginHost refuses unsigned/tampered plugins in production.
//
// Imported by:
//  - scripts/sign-builtins.mjs    — dev/build signer (signs ./builtins, dev-key fallback)
//  - scripts/sign-standalone.mjs  — bundled into .pressh/sign-builtins.mjs; the Docker
//                                   entrypoint runs it at deploy to re-sign with the
//                                   provisioned master key.

import {readdir, rename, writeFile} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {buildSignature, derivePluginSigningKey, SIGNATURE_FILE} from "../packages/runtime/dist/plugin-signature.js";

const MANIFEST_FILE = "pressh.plugin.json";

/**
 * Signs every plugin directory under `builtinsDir` with the key derived from
 * `secret`. Each signature is published atomically (write-temp + rename) so the
 * site and studio processes both running this at boot never observe a partial
 * file. Returns the number of plugins signed.
 */
export async function signBuiltinsDir(builtinsDir, secret) {
    const key = derivePluginSigningKey(secret);

    let dirs;
    try {
        dirs = await readdir(builtinsDir, {withFileTypes: true});
    } catch {
        console.log("No builtins directory — nothing to sign.");
        return 0;
    }

    let count = 0;
    for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        const dir = join(builtinsDir, entry.name);

        let manifest;
        try {
            manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8"));
        } catch {
            console.warn(`skip ${entry.name}: no readable ${MANIFEST_FILE}`);
            continue;
        }

        const signature = await buildSignature(dir, key);
        const target = join(dir, SIGNATURE_FILE);
        const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(tmp, JSON.stringify(signature, null, 2) + "\n", "utf8");
        await rename(tmp, target);
        count++;
        console.log(
            `signed ${manifest.name ?? entry.name}@${manifest.version ?? "?"} ` +
            `(${Object.keys(signature.files).length} files)`,
        );
    }
    console.log(`Signed ${count} built-in plugin(s).`);
    return count;
}
