import {isBuiltin} from "node:module";

/**
 * ESM resolve hook registered inside every plugin worker (see worker-entry).
 *
 * The OS-level Node permission model (`--permission`, configured by the host in
 * PluginHost.#spawn) already denies the filesystem, child_process, native
 * addons and sub-worker capabilities. The one thing it does NOT cover in Node
 * <23 is the network, so a plugin could otherwise `import("node:net")` /
 * `node:http` / `node:dns` and exfiltrate data, bypassing the host-mediated
 * `network` capability entirely.
 *
 * Rather than enumerate every dangerous builtin (and risk missing one), this is
 * an ALLOWLIST: a plugin may import only pure-computation core modules. Anything
 * I/O-capable (fs, net, http, dns, child_process, worker_threads, module, vm,
 * os, process, inspector, …) is denied. All real I/O must go through the
 * capability-gated host RPC (`HostApi`), never a direct builtin.
 *
 * File specifiers (the plugin's own `index.mjs` and its bundled siblings) are
 * permitted here and confined to the plugin directory by the permission model's
 * `--allow-fs-read`. Bare npm specifiers are denied — plugins bundle their deps.
 */
const SAFE_BUILTINS = new Set<string>([
    "assert",
    "buffer",
    "crypto",
    "events",
    "path",
    "punycode",
    "querystring",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "timers",
    "timers/promises",
    "url",
    "util",
    "zlib",
]);

interface ResolveContext {
    conditions: string[];
    importAttributes: Record<string, string>;
    parentURL?: string;
}

type NextResolve = (specifier: string, context?: ResolveContext) => Promise<unknown>;

function denied(specifier: string): never {
    const err = new Error(`PRESSH_SANDBOX: import of "${specifier}" is not permitted in a plugin worker`);
    (err as Error & { code?: string }).code = "ERR_PRESSH_SANDBOX_DENIED";
    throw err;
}

export async function resolve(
    specifier: string,
    context: ResolveContext,
    nextResolve: NextResolve,
): Promise<unknown> {
    if (isBuiltin(specifier)) {
        const bare = specifier.replace(/^node:/, "");
        if (!SAFE_BUILTINS.has(bare)) denied(specifier);
        return nextResolve(specifier, context);
    }
    // Relative / absolute / file URL: the plugin's own bundle. The permission
    // model confines these reads to the plugin's directory.
    if (
        specifier.startsWith("./") ||
        specifier.startsWith("../") ||
        specifier.startsWith("/") ||
        specifier.startsWith("file:")
    ) {
        return nextResolve(specifier, context);
    }
    // Anything else is a bare npm specifier — denied.
    denied(specifier);
}
