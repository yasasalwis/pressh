#!/usr/bin/env node
// Signs every first-party plugin under builtins/ by writing a
// pressh.signature.json (sha256 of the manifest's `main` file). The PluginHost
// refuses unsigned/tampered plugins in production (allowUnsigned=false), so this
// runs as part of `npm run build` to keep shipped built-ins loadable in prod.

import {readdir, readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILTINS = join(ROOT, "builtins");
const SIGNATURE_FILE = "pressh.signature.json";
const MANIFEST_FILE = "pressh.plugin.json";

async function sign() {
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
      manifest = JSON.parse(await readFile(join(dir, MANIFEST_FILE), "utf8"));
    } catch {
      console.warn(`skip ${entry.name}: no readable ${MANIFEST_FILE}`);
      continue;
    }
    if (!manifest.main) {
      console.warn(`skip ${entry.name}: manifest has no "main"`);
      continue;
    }

    const content = await readFile(join(dir, manifest.main));
    const hash = createHash("sha256").update(content).digest("hex");
      const signature = {algorithm: "sha256", hash};

      // Also sign manifest-referenced auxiliary files (e.g. contributed designer
      // presets) so the host can reject a tampered file at load (must match the
      // `files` map PluginHost#verifySignature checks).
      const auxFiles = [manifest.designerPresets].filter(Boolean);
      if (auxFiles.length) {
          signature.files = {};
          for (const rel of auxFiles) {
              const aux = await readFile(join(dir, rel));
              signature.files[rel] = createHash("sha256").update(aux).digest("hex");
          }
      }

    await writeFile(
      join(dir, SIGNATURE_FILE),
        JSON.stringify(signature, null, 2) + "\n",
      "utf8",
    );
    count++;
    console.log(`signed ${manifest.name}@${manifest.version}`);
  }
  console.log(`Signed ${count} built-in plugin(s).`);
}

sign().catch((e) => {
  console.error(e);
  process.exit(1);
});
