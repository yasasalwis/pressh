import {describe, expect, it} from "vitest";
import {createRenderCache} from "./cache.js";

const page = (size: number): string => "x".repeat(size);

describe("createRenderCache byte budget", () => {
    it("evicts least-recently-used pages once the byte budget is exceeded", () => {
        // Budget fits ~2 pages of 1000 bytes (key/tag overhead is tiny here).
        const cache = createRenderCache({maxBytes: 2200});
        cache.set("/a", page(1000), "1", []);
        cache.set("/b", page(1000), "1", []);
        expect(cache.get("/a")).toBeDefined();
        expect(cache.get("/b")).toBeDefined();

        // Adding a third 1000-byte page pushes total over budget; the LRU (/a, since
        // /b was just read) is evicted.
        cache.set("/c", page(1000), "1", []);
        expect(cache.get("/a")).toBeUndefined();
        expect(cache.get("/b")).toBeDefined();
        expect(cache.get("/c")).toBeDefined();
    });

    it("reading a page makes it most-recently-used so a flood can't evict it", () => {
        const cache = createRenderCache({maxBytes: 2200});
        cache.set("/hot", page(1000), "1", []);
        cache.set("/cold", page(1000), "1", []);
        cache.get("/hot"); // touch /hot so /cold becomes the LRU
        cache.set("/new", page(1000), "1", []);
        expect(cache.get("/hot")).toBeDefined();
        expect(cache.get("/cold")).toBeUndefined();
    });

    it("never caches a single page larger than the whole budget", () => {
        const cache = createRenderCache({maxBytes: 500});
        cache.set("/huge", page(1000), "1", []);
        expect(cache.get("/huge")).toBeUndefined();
    });

    it("frees the byte budget when an entry is replaced or tag-invalidated", () => {
        const cache = createRenderCache({maxBytes: 2200});
        cache.set("/p", page(1000), "1", ["post:1"]);
        cache.set("/q", page(1000), "1", ["post:2"]);

        // Tag-invalidating /p frees its bytes, so two fresh 1000-byte pages now fit
        // alongside /q without evicting it.
        cache.invalidateTag("post:1");
        expect(cache.get("/p")).toBeUndefined();
        cache.set("/r", page(1000), "1", []);
        expect(cache.get("/q")).toBeDefined();
        expect(cache.get("/r")).toBeDefined();
    });

    it("enforces the secondary entry-count cap even when pages are tiny", () => {
        const cache = createRenderCache({maxBytes: 10 * 1024 * 1024, maxEntries: 2});
        cache.set("/a", page(10), "1", []);
        cache.set("/b", page(10), "1", []);
        cache.set("/c", page(10), "1", []);
        expect(cache.get("/a")).toBeUndefined(); // evicted by the count cap
        expect(cache.get("/b")).toBeDefined();
        expect(cache.get("/c")).toBeDefined();
    });
});
