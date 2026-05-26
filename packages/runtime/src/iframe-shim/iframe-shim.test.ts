import {describe, expect, it} from "vitest";
import {createPanelBridge, panelFrameTag, wrapPanelHtml} from "@pressh/runtime";

describe("panelFrameTag", () => {
  it("sandboxes without allow-same-origin", () => {
    const tag = panelFrameTag("/admin/plugins/hello/panel");
    expect(tag).toContain('sandbox="allow-scripts allow-forms"');
    expect(tag).not.toContain("allow-same-origin");
  });
  it("escapes the src", () => {
    expect(panelFrameTag('"></iframe><script>')).not.toContain("<script>");
  });
});

describe("wrapPanelHtml", () => {
    it("builds the iframe document: mount root, shim, inlined panel script, escaped title", () => {
        const html = wrapPanelHtml({title: "<x>", script: "window.__panel=1"});
        expect(html).toContain("window.presshPanel"); // host bridge shim
        expect(html).toContain('<div id="pressh-root"></div>'); // React mount target
        expect(html).toContain("window.__panel=1"); // inlined plugin bundle
        expect(html).toContain("&lt;x&gt;"); // title escaped
  });
});

describe("createPanelBridge", () => {
  function source() {
    const posted: unknown[] = [];
    return { posted, postMessage: (m: unknown) => posted.push(m) };
  }

  it("forwards an allowed action and posts a correlated response", async () => {
    const calls: [string, unknown][] = [];
    const bridge = createPanelBridge({
      allowedActions: ["ping"],
      onRequest: async (action, payload) => {
        calls.push([action, payload]);
        return { pong: payload };
      },
    });
    const s = source();
    await bridge.handleMessage({ data: { pressh: true, id: 1, action: "ping", payload: 42 }, source: s });
    expect(calls).toEqual([["ping", 42]]);
    expect(s.posted[0]).toEqual({ pressh: true, id: 1, ok: true, result: { pong: 42 } });
  });

  it("rejects a disallowed action", async () => {
    const bridge = createPanelBridge({ allowedActions: ["ping"], onRequest: async () => null });
    const s = source();
    await bridge.handleMessage({ data: { pressh: true, id: 2, action: "evil" }, source: s });
    expect(s.posted[0]).toMatchObject({ pressh: true, id: 2, ok: false });
  });

  it("ignores foreign/malformed messages", async () => {
    let called = false;
    const bridge = createPanelBridge({
      allowedActions: ["ping"],
      onRequest: async () => {
        called = true;
        return null;
      },
    });
    const s = source();
    await bridge.handleMessage({ data: { not: "ours" }, source: s });
    await bridge.handleMessage({ data: 42, source: s });
    expect(called).toBe(false);
    expect(s.posted).toHaveLength(0);
  });

  it("reports handler errors back to the panel", async () => {
    const bridge = createPanelBridge({
      allowedActions: ["x"],
      onRequest: async () => {
        throw new Error("boom");
      },
    });
    const s = source();
    await bridge.handleMessage({ data: { pressh: true, id: 3, action: "x" }, source: s });
    expect(s.posted[0]).toMatchObject({ ok: false, error: { message: "boom" } });
  });

  it("respects an isTrusted gate", async () => {
    let called = false;
    const bridge = createPanelBridge({
      allowedActions: ["x"],
      isTrusted: () => false,
      onRequest: async () => {
        called = true;
        return null;
      },
    });
    const s = source();
    await bridge.handleMessage({ data: { pressh: true, id: 4, action: "x" }, source: s });
    expect(called).toBe(false);
    expect(s.posted).toHaveLength(0);
  });
});
