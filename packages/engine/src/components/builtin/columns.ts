import type { ComponentDef } from "../types.js";
import { e } from "./utils.js";

export const columnsComponent: ComponentDef = {
  id: "columns",
  name: "Columns",
  category: "layout",
  description: "2-column layout with icon, heading and text per column",
  icon: "⬜⬜",
  props: {
    cols:    { type: "select",   label: "Columns",           default: "2", options: ["2", "3"] },
    gap:     { type: "select",   label: "Gap",               default: "normal", options: ["compact", "normal", "wide"] },
    bgColor: { type: "color",    label: "Background",        default: "#ffffff" },
    icon1:   { type: "text",     label: "Col 1 icon",        default: "🚀" },
    head1:   { type: "text",     label: "Col 1 heading",     default: "Move fast" },
    body1:   { type: "richtext", label: "Col 1 body",        default: "Deploy content changes instantly without touching infrastructure." },
    icon2:   { type: "text",     label: "Col 2 icon",        default: "🛡️" },
    head2:   { type: "text",     label: "Col 2 heading",     default: "Stay secure" },
    body2:   { type: "richtext", label: "Col 2 body",        default: "Every plugin runs in its own sandbox. Your data stays yours." },
    icon3:   { type: "text",     label: "Col 3 icon",        default: "📦" },
    head3:   { type: "text",     label: "Col 3 heading",     default: "Extend freely" },
    body3:   { type: "richtext", label: "Col 3 body",        default: "The plugin system lets you add any capability without forking the core." },
  },
  defaultProps: {
    cols: "2", gap: "normal", bgColor: "#ffffff",
    icon1: "🚀", head1: "Move fast",    body1: "Deploy content changes instantly without touching infrastructure.",
    icon2: "🛡️",  head2: "Stay secure",  body2: "Every plugin runs in its own sandbox. Your data stays yours.",
    icon3: "📦", head3: "Extend freely",body3: "The plugin system lets you add any capability without forking the core.",
  },
  render(props) {
    const n = Number(props["cols"] ?? 2);
    const gapMap: Record<string, string> = { compact: "1rem", normal: "2.5rem", wide: "4rem" };
    const gap = gapMap[String(props["gap"] ?? "normal")] ?? "2.5rem";
    function col(i: number): string {
      return `<div class="ps-col-item"><div class="ps-col-icon">${e(props[`icon${i}`])}</div><h3>${e(props[`head${i}`])}</h3><div>${props[`body${i}`] ?? ""}</div></div>`;
    }
    let cols = col(1) + col(2);
    if (n >= 3) cols += col(3);
    return `<section class="ps-cols" style="background:${e(props["bgColor"])}">
  <div class="ps-cols-inner" style="grid-template-columns:repeat(${n},1fr);gap:${gap}">
    ${cols}
  </div>
</section>`;
  },
  styles: `
.ps-cols{padding:4rem 1.5rem}
.ps-cols-inner{max-width:1100px;margin:0 auto;display:grid}
@media(max-width:640px){.ps-cols-inner{grid-template-columns:1fr!important}}
.ps-col-item{display:flex;flex-direction:column;gap:.5rem}
.ps-col-icon{font-size:2rem}
.ps-col-item h3{font-size:1.1rem;font-weight:700;margin:0;letter-spacing:-.01em}
.ps-col-item div{color:#475569;line-height:1.65;font-size:.95rem}`,
};
