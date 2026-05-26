import {afterEach, describe, expect, it, vi} from "vitest";
import {request} from "./index";

afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
});

describe("request", () => {
    it("rejects when the host bridge is absent", async () => {
        await expect(request("ping")).rejects.toThrow("Panel host bridge is unavailable");
    });

    it("rejects when window.presshPanel.request is not a function", async () => {
        (globalThis as { window?: unknown }).window = {presshPanel: {} as never};
        await expect(request("ping")).rejects.toThrow("Panel host bridge is unavailable");
    });

    it("delegates the action and payload to the bridge and returns its result", async () => {
        const bridge = vi.fn().mockResolvedValue({ok: true});
        (globalThis as { window?: unknown }).window = {presshPanel: {request: bridge}};

        const result = await request<{ ok: boolean }>("save", {id: 1});

        expect(bridge).toHaveBeenCalledWith("save", {id: 1});
        expect(result).toEqual({ok: true});
    });

    it("propagates a rejection from the bridge", async () => {
        const bridge = vi.fn().mockRejectedValue(new Error("denied"));
        (globalThis as { window?: unknown }).window = {presshPanel: {request: bridge}};

        await expect(request("danger")).rejects.toThrow("denied");
    });
});
