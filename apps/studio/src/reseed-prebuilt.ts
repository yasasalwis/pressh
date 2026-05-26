import {join} from "node:path";
import {createFileAuditLog} from "@pressh/core";
import {createContentService, getPrebuiltPage, prebuiltLayoutBlocks} from "@pressh/engine";
import {openConfiguredStorage} from "./bootstrap.js";

/**
 * `npm run reseed:pages` — re-applies the shipped, fully designed layouts to the
 * prebuilt public pages (home/header/footer, the 404/500/maintenance system
 * pages, and the about/blog/contact demo pages).
 *
 * `ensureSystemPages`/`seedDemoContent` only create these pages when they are
 * missing — they never overwrite an existing page — so an install that was
 * seeded before the designed layouts existed keeps its old, bare content. This
 * CLI rewrites each page's current revision with the designed primitive tree,
 * giving an existing site the same out-of-the-box design a fresh install gets.
 * It writes through the normal content service (new audited revision), into the
 * SAME backend the server uses (see openConfiguredStorage).
 */
const PREBUILT_SLUGS = [
    "header",
    "footer",
    "home",
    "404",
    "500",
    "maintenance",
    "about",
    "blog",
    "contact",
];

async function main(): Promise<void> {
    // Honor a project-root .env (dev). Real env vars take precedence; missing file is fine.
    try {
        process.loadEnvFile();
    } catch { /* no .env — rely on the real environment */
    }
    const contentRoot = process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content";
    const masterSecret = process.env["PRESSH_MASTER_KEY"]?.trim() || undefined;
    const {storage} = await openConfiguredStorage({
        contentRoot,
        ...(masterSecret ? {masterSecret} : {}),
    });
    const audit = await createFileAuditLog({
        path: join(contentRoot, "..", "audit.log"),
        ...(process.env["PRESSH_MASTER_KEY"] ? {sealSecret: process.env["PRESSH_MASTER_KEY"]} : {}),
    });
    const content = createContentService({storage, audit});

    // Author the revisions as the first owner if one exists (keeps the audit trail
    // attributable); fall back to a stable system actor on a not-yet-seeded store.
    const usersPage = await storage.query<{ id: string }>("users");
    const editorId =
        usersPage.ok && usersPage.value.items.length > 0
            ? (usersPage.value.items[0]?.id ?? "system-reseed")
            : "system-reseed";

    // Create any system page that is missing (with its designed layout) before the
    // rewrite pass, so a partially-seeded install ends up complete.
    await content.ensureSystemPages(editorId);

    let updated = 0;
    for (const slug of PREBUILT_SLUGS) {
        const page = getPrebuiltPage(slug);
        const blocks = prebuiltLayoutBlocks(slug);
        if (!page || !blocks) continue;
        const entry = await content.resolveBySlug(slug);
        if (!entry) continue; // demo pages (about/blog/contact) only exist if previously seeded
        await content.saveEntry(["*"], entry.id, {fields: {title: page.title}, blocks, editorId});
        if (entry.status !== "published") {
            await content.transition(["*"], entry.id, "published");
        }
        updated += 1;
        process.stdout.write(`refreshed /${slug === "home" ? "" : slug}\n`);
    }

    storage.close();
    process.stdout.write(`Done. Refreshed ${updated} prebuilt page(s).\n`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
