import type { BlockNode } from "@pressh/engine";

/** HTML-escape for text/attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clampLevel(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(6, Math.max(1, Math.floor(n))) : 2;
}

/**
 * Renders a single block to HTML. Inputs were already sanitized at write time
 * (Phase 6); this layer additionally escapes anything inserted into text or
 * attribute contexts so rendering can never reintroduce XSS.
 */
export function renderBlock(block: BlockNode): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${block.content ?? ""}</p>`;
    case "quote":
      return `<blockquote>${block.content ?? ""}</blockquote>`;
    case "heading": {
      const level = clampLevel(block.props?.["level"]);
      return `<h${level}>${block.content ?? ""}</h${level}>`;
    }
    case "image": {
      const src = typeof block.props?.["src"] === "string" ? block.props["src"] : "";
      const alt = typeof block.props?.["alt"] === "string" ? block.props["alt"] : "";
      return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">` : "";
    }
    case "code":
      return `<pre><code>${escapeHtml(block.content ?? "")}</code></pre>`;
    case "html":
      // Already passed the rich sanitizer (script/handlers stripped) at write time.
      return block.content ?? "";
    default:
      return "<!-- unsupported block -->";
  }
}

export function renderBlocks(blocks: BlockNode[]): string {
  return blocks
    .map((block) => renderBlock(block) + (block.children?.length ? renderBlocks(block.children) : ""))
    .join("\n");
}

export function renderPage(opts: { title: string; body: string; locale?: string; extraStyles?: string }): string {
  const styles = opts.extraStyles ? `<style>${opts.extraStyles}</style>` : "";
  return `<!DOCTYPE html>
<html lang="${escapeHtml(opts.locale ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}</style>
${styles}</head>
<body>${opts.body}</body>
</html>`;
}

export function renderNotFound(): string {
  return renderPage({ title: "Not found", body: "<h1>404 — Not found</h1>" });
}
