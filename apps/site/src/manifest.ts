import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type ViteManifest = Record<string, { file: string; css?: string[] }>;

const clientDir = fileURLToPath(new URL("client", import.meta.url));
const MANIFEST_PATH = join(clientDir, ".vite", "manifest.json");

export interface ClientAssets {
  readonly script: string;
  readonly styles: readonly string[];
}

const EMPTY: ClientAssets = { script: "", styles: [] };
let cached: ClientAssets | null = null;

/** Reads the Vite manifest once and returns hashed asset URLs. Returns empty strings when the client bundle has not been built yet. */
export function getClientAssets(): ClientAssets {
  if (cached) return cached;
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ViteManifest;
    const entry = manifest["src/client/main.tsx"];
    if (!entry) return EMPTY;
    cached = {
      script: `/${entry.file}`,
      styles: (entry.css ?? []).map((f) => `/${f}`),
    };
    return cached;
  } catch {
    return EMPTY;
  }
}
