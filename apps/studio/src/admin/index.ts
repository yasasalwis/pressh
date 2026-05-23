import { STYLES } from "./styles.js";
import { DESIGNER_STYLES, DESIGNER_JS } from "./designer.js";
import { MARKUP } from "./markup.js";
import { CORE_JS } from "./client-core.js";
import { SECTIONS_JS } from "./client-sections.js";

/** Wiring that runs once everything is parsed: button labels, listeners, boot. */
const STARTUP_JS = `
el("su-btn").dataset.label="Create account & sign in";
el("login-btn").dataset.label="Sign in";
el("ac-btn").dataset.label="Activate & sign in";
window.addEventListener("hashchange", function(){ applyRoute(); });
window.addEventListener("beforeunload", function(e){ if(authed && D.editingId && D.dirty){ e.preventDefault(); e.returnValue=""; } });
boot();
`;

/**
 * Pressh Studio admin client — self-contained, no build step. Assembled from:
 * styles + designer styles, body markup (auth · sidebar shell · designer overlay),
 * and the client JS (core routing · section renderers · designer · startup).
 */
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pressh Studio</title>
<style>${STYLES}${DESIGNER_STYLES}</style>
</head>
<body>
${MARKUP}
<script>
${CORE_JS}
${SECTIONS_JS}
${DESIGNER_JS}
${STARTUP_JS}
</script>
</body>
</html>`;
