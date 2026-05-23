import type { ComponentDef } from "../types.js";
import { e } from "./utils.js";

export const recentPostsComponent: ComponentDef = {
  id: "recent-posts",
  name: "Recent Posts",
  category: "data",
  description: "Server component: fetches and displays latest published pages",
  icon: "📰",
  props: {
    heading:  { type: "text",   label: "Section heading", default: "Latest posts" },
    limit:    { type: "number", label: "Number of posts", default: 6, min: 1, max: 20 },
    columns:  { type: "select", label: "Columns",         default: "3", options: ["1", "2", "3"] },
    bgColor:  { type: "color",  label: "Background",      default: "#f6f7fb" },
    showDate: { type: "boolean",label: "Show date",       default: true },
  },
  defaultProps: { heading: "Latest posts", limit: 6, columns: "3", bgColor: "#f6f7fb", showDate: true },

  async serverData(props, ctx) {
    const limit = Math.min(Number(props["limit"] ?? 6), 20);
    const posts = await ctx.listPublished(limit);
    return { posts };
  },

  render(props, serverData) {
    const posts = (serverData["posts"] as Array<Record<string, unknown>>) ?? [];
    const cols  = Number(props["columns"] ?? 3);
    const showDate = props["showDate"] !== false;

    const cards = posts.length
      ? posts.map(p => {
          const title  = e(p["title"] ?? p["slug"] ?? "Untitled");
          const slug   = e(p["slug"] ?? "");
          const date   = showDate && p["publishedAt"]
            ? `<time class="ps-rp-date">${new Date(String(p["publishedAt"])).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}</time>`
            : "";
          return `<a href="/${slug}" class="ps-rp-card">
  <div class="ps-rp-card-body">
    ${date}
    <h3>${title}</h3>
  </div>
</a>`;
        }).join("\n")
      : '<p class="ps-rp-empty">No posts published yet.</p>';

    return `<section class="ps-rp" style="background:${e(props["bgColor"])}">
  <div class="ps-rp-inner">
    ${props["heading"] ? `<h2 class="ps-rp-heading">${e(props["heading"])}</h2>` : ""}
    <div class="ps-rp-grid" style="grid-template-columns:repeat(${cols},1fr)">${cards}</div>
  </div>
</section>`;
  },
  styles: `
.ps-rp{padding:4rem 1.5rem}
.ps-rp-inner{max-width:1100px;margin:0 auto}
.ps-rp-heading{font-size:clamp(1.4rem,3vw,2rem);font-weight:800;margin:0 0 2rem;letter-spacing:-.02em}
.ps-rp-grid{display:grid;gap:1.25rem}
@media(max-width:640px){.ps-rp-grid{grid-template-columns:1fr!important}}
.ps-rp-card{display:block;background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:16px;text-decoration:none;color:inherit;transition:transform .2s,box-shadow .2s;overflow:hidden}
.ps-rp-card:hover{transform:translateY(-4px);box-shadow:0 16px 40px -12px rgba(15,23,42,.14)}
.ps-rp-card-body{padding:1.5rem}
.ps-rp-date{font-size:.75rem;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.ps-rp-card h3{margin:.4rem 0 0;font-size:1.05rem;font-weight:700;line-height:1.35}
.ps-rp-empty{color:#94a3b8;font-size:.9rem}`,
};
