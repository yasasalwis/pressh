#!/usr/bin/env node
// Dev/build signer: signs every first-party plugin under builtins/ by writing a
// pressh.signature.json (a keyed HMAC over every file in the plugin directory).
// The PluginHost refuses unsigned/tampered plugins in production.
//
// The signing key is derived from PRESSH_MASTER_KEY (or PRESSH_PLUGIN_SIGNING_KEY)
// — the same per-deployment secret the host verifies against. Without a key it
// falls back to a clearly-marked DEV key so `npm run build` still produces
// loadable (dev-only) signatures; the deploy entrypoint re-signs with the real
// key (via the bundled .pressh/sign-builtins.mjs) once it is provisioned.

import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {signBuiltinsDir} from "./sign-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_FALLBACK = "pressh-dev-only-unsigned-key";

// Honor a project-root .env so `npm run build` signs with the same key the
// runtime verifies against. loadEnvFile never overrides an already-set var, and
// a missing file is a no-op.
try {
    process.loadEnvFile();
} catch { /* no .env — rely on the real environment */
}

function resolveSecret() {
    const secret = process.env["PRESSH_MASTER_KEY"] || process.env["PRESSH_PLUGIN_SIGNING_KEY"];
    if (secret) return secret;
    console.warn(
        "sign-builtins: no PRESSH_MASTER_KEY set — signing with a DEV key. These\n" +
        "  signatures are NOT valid in production; the deploy entrypoint re-signs\n" +
        "  with the real key once it is provisioned.",
    );
    return DEV_FALLBACK;
}

signBuiltinsDir(join(ROOT, "builtins"), resolveSecret()).catch((e) => {
    console.error(e);
    process.exit(1);
});
