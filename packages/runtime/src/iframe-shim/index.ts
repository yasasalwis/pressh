/**
 * Iframe plugin admin UI (ADR-005). Plugin panels render in an iframe that is
 * sandboxed WITHOUT `allow-same-origin`, so the panel runs as a null origin and
 * cannot read the Studio's cookies, session, or DOM. The only channel is
 * `postMessage`, brokered by the host bridge below, which validates every
 * message and only forwards explicitly-allowed actions.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Client-side bridge injected into the (sandboxed) panel document. */
export const PANEL_SHIM_JS = `(function(){
  var pending = {}, seq = 1;
  window.addEventListener("message", function(e){
    var m = e.data;
    if (!m || m.pressh !== true || typeof m.id !== "number" || !("ok" in m)) return;
    var p = pending[m.id]; if (!p) return; delete pending[m.id];
    if (m.ok) p.resolve(m.result); else p.reject(new Error((m.error && m.error.message) || "Request failed"));
  });
  window.presshPanel = {
    request: function(action, payload){
      var id = seq++;
      return new Promise(function(res, rej){
        pending[id] = { resolve: res, reject: rej };
        parent.postMessage({ pressh: true, id: id, action: action, payload: payload }, "*");
      });
    }
  };
})();`;

/**
 * Builds the iframe element the Studio embeds. No `allow-same-origin`. The panel
 * opens in its own dedicated tab, so the frame fills the viewport (the panel's
 * own document scrolls for overflow) rather than clipping at a fixed height.
 */
export function panelFrameTag(src: string): string {
    return `<iframe class="pressh-panel" sandbox="allow-scripts allow-forms" src="${escapeHtml(src)}" title="Plugin panel" style="display:block;width:100%;height:100vh;border:0;min-height:480px"></iframe>`;
}

/** Wraps a plugin's panel body into a full document with the shim injected. */
export function wrapPanelHtml(panel: { title: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(panel.title)}</title>
<script>${PANEL_SHIM_JS}</script>
</head>
<body>${panel.body}</body>
</html>`;
}

export interface PanelRequest {
  pressh: true;
  id: number;
  action: string;
  payload?: unknown;
}

export interface PanelEventSource {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface PanelMessageEvent {
  data: unknown;
  source?: PanelEventSource | null;
  origin?: string;
}

export interface PanelBridgeOptions {
  allowedActions: readonly string[];
  onRequest: (action: string, payload: unknown) => Promise<unknown>;
  /** Optional extra trust check (e.g. expected source frame). */
  isTrusted?: (event: PanelMessageEvent) => boolean;
}

export interface PanelBridge {
  handleMessage(event: PanelMessageEvent): Promise<void>;
}

function isPanelRequest(data: unknown): data is PanelRequest {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  return m["pressh"] === true && typeof m["id"] === "number" && typeof m["action"] === "string";
}

/**
 * Host-side (Studio parent window) bridge. Validates each incoming message,
 * forwards only allow-listed actions to `onRequest`, and posts a correlated
 * response back. Foreign/malformed messages are ignored.
 */
export function createPanelBridge(opts: PanelBridgeOptions): PanelBridge {
  return {
    async handleMessage(event) {
      const data = event.data;
      if (!isPanelRequest(data)) return;
      if (opts.isTrusted && !opts.isTrusted(event)) return;

      const respond = (body: { ok: true; result: unknown } | { ok: false; error: { message: string } }): void => {
        event.source?.postMessage({ pressh: true, id: data.id, ...body }, "*");
      };

      if (!opts.allowedActions.includes(data.action)) {
        respond({ ok: false, error: { message: `Action not allowed: ${data.action}` } });
        return;
      }
      try {
        respond({ ok: true, result: await opts.onRequest(data.action, data.payload) });
      } catch (e) {
        respond({ ok: false, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    },
  };
}

export { escapeHtml as escapePanelHtml };
