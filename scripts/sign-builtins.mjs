#!/usr/bin/env node
// Signs every first-party plugin under builtins/ by writing a
// pressh.signature.json — a keyed HMAC over EVERY file in the plugin directory
// (see packages/runtime/src/plugin-signature.ts). The PluginHost refuses
// unsigned/tampered plugins in production (allowUnsigned=false).
//
// The signing key is derived from PRESSH_MASTER_KEY (or PRESSH_PLUGIN_SIGNING_KEY)
// — the same per-deployment secret the host verifies against. Run this at DEPLOY
// time (the container entrypoint does) once that key is provisioned. Without a
// key it falls back to a clearly-marked DEV key so `npm run build` still
// produces loadable (dev-only) signatures; those MUST be re-signed at deploy.

import {readdir, writeFile, rename} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes} from "node:crypto";
import {buildSignature, derivePluginSigningKey, SIGNATURE_FILE} from "../packages/runtime/dist/plugin-signature.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILTINS = join(ROOT, "builtins");
const MANIFEST_FILE = "pressh.plugin.json";
const DEV_FALLBACK = "pressh-dev-only-unsigned-key";

function resolveSecret() {
    const secret = process.env["PRESSH_MASTER_KEY"] || process.env["PRESSH_PLUGIN_SIGNING_KEY"];
    if (secret) return {secret, dev: false};
    console.warn(
        "sign-builtins: no PRESSH_MASTER_KEY set — signing with a DEV key. These\n" +
        "  signatures are NOT valid in production; the deploy entrypoint re-signs\n" +
        "  with the real key once it is provisioned.",
    );
    return {secret: DEV_FALLBACK, dev: true};
}

async function sign() {
    const {secret} = resolveSecret();
    const key = derivePluginSigningKey(secret);

  let dirs;
  try {
    dirs = await readdir(BUILTINS, { withFileTypes: true });
  } catch {
    console.log("No builtins/ directory — nothing to sign.");
    return;
  }

  let count = 0;
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const dir = join(BUILTINS, entry.name);

    let manifest;
    try {
        manifest = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(join(dir, MANIFEST_FILE), "utf8")));
    } catch {
      console.warn(`skip ${entry.name}: no readable ${MANIFEST_FILE}`);
      continue;
    }

      const signature = await buildSignature(dir, key);
      // Atomic publish so concurrent signers (site + studio both run the deploy
      // entrypoint) never observe a half-written signature.
      const target = join(dir, SIGNATURE_FILE);
      const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(signature, null, 2) + "\n", "utf8");
      await rename(tmp, target);
    count++;
      console.log(`signed ${manifest.name ?? entry.name}@${manifest.version ?? "?"} (${Object.keys(signature.files).length} files)`);
  }
  console.log(`Signed ${count} built-in plugin(s).`);
}

sign().catch((e) => {
  console.error(e);
  process.exit(1);
});
