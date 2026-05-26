#!/usr/bin/env node
// Deploy-time re-signer. esbuild bundles this (with sign-core + the runtime's
// signature helpers inlined) into `.pressh/sign-builtins.mjs`; the Docker
// entrypoint runs it at boot, once PRESSH_MASTER_KEY is provisioned, to re-sign
// the shipped first-party plugins with THIS deployment's key.
//
// Resolves `builtins/` as a sibling so it works wherever `.pressh/` is mounted.
// Unlike the dev signer it FAILS CLOSED when no key is set — it only ever runs at
// deploy, where signing with a dev key would ship invalid (rejected) signatures.

import {fileURLToPath} from "node:url";
import {signBuiltinsDir} from "./sign-core.mjs";

// Honor a .env in cwd if present. loadEnvFile never overrides an already-set
// var, so provisioned deploy env still wins; a missing file is a no-op.
try {
    process.loadEnvFile();
} catch { /* no .env — rely on the real environment */
}

const secret = process.env["PRESSH_MASTER_KEY"] || process.env["PRESSH_PLUGIN_SIGNING_KEY"];
if (!secret) {
    console.error(
        "sign-builtins: PRESSH_MASTER_KEY (or PRESSH_PLUGIN_SIGNING_KEY) is required " +
        "to re-sign the first-party plugins at deploy time.",
    );
    process.exit(1);
}

const builtinsDir = fileURLToPath(new URL("builtins", import.meta.url));
signBuiltinsDir(builtinsDir, secret).catch((e) => {
    console.error(e);
    process.exit(1);
});
