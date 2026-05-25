import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {StorageAdapter} from "@pressh/core";
import {createFileAuditLog, createFileSystemStorage} from "@pressh/core";
import type {QueryResolver} from "@pressh/engine";
import {createContentService, createQueryResolver} from "@pressh/engine";
import type {SitePluginHost} from "./app";
import {createSiteApp} from "./app";
import {createRenderCache} from "./cache";

const stubHost: SitePluginHost = {
    has: () => false,
    endpoints: () => [],
    invoke: async () => ({}),
};

let dir: string;
let storage: StorageAdapter;

async function makeContent(): Promise<ReturnType<typeof createContentService>> {
    const audit = await createFileAuditLog({path: join(dir, "audit.log")});
    return createContentService({storage, audit});
}

function makeApp(resolver: QueryResolver): ReturnType<typeof createSiteApp> {
    return createSiteApp({
        resolver,
        pluginHost: stubHost,
        cache: createRenderCache(),
        storage,
    });
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-syspages-"));
    storage = createFileSystemStorage({root: join(dir, "content")});
});
afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

describe("system error pages", () => {
    it("renders the seeded 404 system page for an unresolved route", async () => {
        const content = await makeContent();
        await content.ensureSystemPages("owner-1");
        const app = makeApp(createQueryResolver({content}));

        const res = await app.request("/this-route-does-not-exist");
        expect(res.status).toBe(404);
        expect(await res.text()).toContain("does not exist"); // 404 page starter copy
    });

    it("falls back to the default not-found page when no 404 page is seeded", async () => {
        const content = await makeContent();
        const app = makeApp(createQueryResolver({content}));

        const res = await app.request("/missing");
        expect(res.status).toBe(404);
        const body = await res.text();
        expect(body).toContain("404 — Not found"); // renderNotFound() default
        expect(body).not.toContain("does not exist");
    });

    it("renders the seeded 500 system page on an unexpected error", async () => {
        const content = await makeContent();
        await content.ensureSystemPages("owner-1");
        const real = createQueryResolver({content});
        // A resolver whose path lookup blows up with a non-not_found error, while
        // direct slug resolution (used to fetch the 500 page) still works.
        const failingResolver: QueryResolver = {
            resolve: real.resolve,
            resolvePath: async () => {
                throw new Error("storage exploded");
            },
        };
        const app = makeApp(failingResolver);

        const res = await app.request("/boom");
        expect(res.status).toBe(500);
        expect((await res.text()).toLowerCase()).toContain("unexpected error"); // 500 starter copy
    });
});
