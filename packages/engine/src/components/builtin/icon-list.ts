import type { ComponentDef } from "../types.js";
import { e } from "./utils.js";

function item(icon: unknown, title: unknown, body: unknown, acc: string): string {
  if (!title) return "";
  return `<div class="ps-il-item">
    <div class="ps-il-icon" style="background:${acc}18;color:${acc}">${e(icon)}</div>
    <div><strong class="ps-il-title">${e(title)}</strong>${body ? `<p class="ps-il-body">${e(body)}</p>` : ""}</div>
  </div>`;
}

export const iconListComponent: ComponentDef = {
  id: "icon-list",
  name: "Icon List",
  category: "content",
  description: "Feature list with emoji/icon, title and description per row",
  icon: "✅",
  props: {
    heading:  { type: "text",   label: "Section heading", default: "Why Pressh?" },
    columns:  { type: "select", label: "Columns",         default: "2", options: ["1","2","3"] },
    bgColor:  { type: "color",  label: "Background",      default: "#ffffff" },
    accent:   { type: "color",  label: "Icon accent",     default: "#6d28d9" },
    icon1:    { type: "text",   label: "Icon 1",          default: "🔒" },
    title1:   { type: "text",   label: "Title 1",         default: "Sandboxed plugins" },
    body1:    { type: "text",   label: "Body 1",          default: "Every plugin runs in an isolated worker — no direct database access." },
    icon2:    { type: "text",   label: "Icon 2",          default: "📝" },
    title2:   { type: "text",   label: "Title 2",         default: "No-code modelling" },
    body2:    { type: "text",   label: "Body 2",          default: "Define custom content types and fields visually — no schema migrations." },
    icon3:    { type: "text",   label: "Icon 3",          default: "🌍" },
    title3:   { type: "text",   label: "Title 3",         default: "Built-in i18n" },
    body3:    { type: "text",   label: "Body 3",          default: "Manage content in multiple locales from day one." },
    icon4:    { type: "text",   label: "Icon 4",          default: "♻️" },
    title4:   { type: "text",   label: "Title 4",         default: "Immutable revisions" },
    body4:    { type: "text",   label: "Body 4",          default: "Every save creates a new revision — restore to any point with one click." },
    icon5:    { type: "text",   label: "Icon 5",          default: "⚡" },
    title5:   { type: "text",   label: "Title 5",         default: "Edge-cacheable" },
    body5:    { type: "text",   label: "Body 5",          default: "Static-first rendering with smart cache invalidation. Sub-100ms worldwide." },
    icon6:    { type: "text",   label: "Icon 6",          default: "🛠" },
    title6:   { type: "text",   label: "Title 6",         default: "Open source" },
    body6:    { type: "text",   label: "Body 6",          default: "Every line is auditable. Contribute, fork, or self-host with full control." },
  },
  defaultProps: {
    heading: "Why Pressh?", columns: "2", bgColor: "#ffffff", accent: "#6d28d9",
    icon1:"🔒",title1:"Sandboxed plugins",body1:"Every plugin runs in an isolated worker — no direct database access.",
    icon2:"📝",title2:"No-code modelling",body2:"Define custom content types and fields visually — no schema migrations.",
    icon3:"🌍",title3:"Built-in i18n",    body3:"Manage content in multiple locales from day one.",
    icon4:"♻️",title4:"Immutable revisions",body4:"Every save creates a new revision — restore to any point with one click.",
    icon5:"⚡",title5:"Edge-cacheable",   body5:"Static-first rendering with smart cache invalidation. Sub-100ms worldwide.",
    icon6:"🛠",title6:"Open source",      body6:"Every line is auditable. Contribute, fork, or self-host with full control.",
  },
  render(props) {
    const acc = e(props["accent"] as string ?? "#6d28d9");
    const cols = Number(props["columns"] ?? 2);
    const items = [1,2,3,4,5,6].map(i => item(props[`icon${i}`],props[`title${i}`],props[`body${i}`],acc)).join("");
    return `<section class="ps-il" style="background:${e(props["bgColor"])}">
  <div class="ps-il-inner">
    ${props["heading"] ? `<h2 class="ps-il-heading">${e(props["heading"])}</h2>` : ""}
    <div class="ps-il-grid" style="--il-cols:${cols}">${items}</div>
  </div>
</section>`;
  },
  styles: `
.ps-il{padding:clamp(3rem,7vw,5rem) 1.25rem}
.ps-il-inner{max-width:1050px;margin:0 auto}
.ps-il-heading{font-size:clamp(1.4rem,3vw,2rem);font-weight:800;letter-spacing:-.03em;margin:0 0 2rem;text-align:center}
.ps-il-grid{display:grid;grid-template-columns:repeat(var(--il-cols,2),1fr);gap:1.5rem 2.5rem}
.ps-il-item{display:flex;align-items:flex-start;gap:1rem}
.ps-il-icon{font-size:1.2rem;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ps-il-title{font-size:.95rem;font-weight:700;display:block;margin-bottom:.25rem;color:#0f172a}
.ps-il-body{font-size:.85rem;color:#64748b;margin:0;line-height:1.6}
@media(max-width:640px){.ps-il-grid{grid-template-columns:1fr!important}}`,
};
