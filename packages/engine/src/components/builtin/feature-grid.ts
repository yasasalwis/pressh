import type { ComponentDef } from "../types.js";
import { cssColor, e } from "./utils.js";

function featureCard(
  icon: unknown, title: unknown, body: unknown,
  style: string, acc: string, iconBg: string
): string {
  if (!title && !body) return "";
  const cardStyle = style === "flat"
    ? "border:1px solid rgba(15,23,42,.08)"
    : style === "bordered"
    ? `border:2px solid ${acc}25;box-shadow:none`
    : "box-shadow:0 4px 24px -8px rgba(15,23,42,.1)";
  return `<div class="ps-fg-card" style="${cardStyle}">
    <div class="ps-fg-icon" style="background:${iconBg}">${e(icon)}</div>
    <h3>${e(title)}</h3>
    <p>${e(body)}</p>
  </div>`;
}

export const featureGridComponent: ComponentDef = {
  id: "feature-grid",
  name: "Feature Grid",
  category: "content",
  description: "Responsive grid of icon, title and description cards",
  icon: "✨",
  props: {
    heading:    { type: "text",    label: "Section heading",   default: "Why choose us" },
    subheading: { type: "text",    label: "Section subheading",default: "", placeholder: "Supporting text below heading" },
    columns:    { type: "select",  label: "Columns",           default: "3", options: ["2","3","4"] },
    cardStyle:  { type: "select",  label: "Card style",        default: "shadow", options: ["shadow","flat","bordered"] },
    accentColor:{ type: "color",   label: "Accent color",      default: "#6d28d9" },
    iconBg:     { type: "color",   label: "Icon background",   default: "#ede9fe" },
    bgColor:    { type: "color",   label: "Background",        default: "#f6f7fb" },
    icon1:      { type: "text",    label: "Icon 1",            default: "🔒", placeholder: "Emoji or SVG" },
    title1:     { type: "text",    label: "Title 1",           default: "Secure by default" },
    body1:      { type: "text",    label: "Body 1",            default: "Plugins run in isolated sandboxes — no third-party code touches your data." },
    icon2:      { type: "text",    label: "Icon 2",            default: "⚡" },
    title2:     { type: "text",    label: "Title 2",           default: "Blazing fast" },
    body2:      { type: "text",    label: "Body 2",            default: "Static-first rendering with intelligent cache invalidation delivers sub-100ms pages." },
    icon3:      { type: "text",    label: "Icon 3",            default: "🎨" },
    title3:     { type: "text",    label: "Title 3",           default: "No-code design" },
    body3:      { type: "text",    label: "Body 3",            default: "Drag and drop components to build beautiful pages without writing a line of code." },
    icon4:      { type: "text",    label: "Icon 4",            default: "📊", placeholder: "Leave title blank to hide" },
    title4:     { type: "text",    label: "Title 4",           default: "Built-in analytics" },
    body4:      { type: "text",    label: "Body 4",            default: "Audit trail and analytics with zero third-party tracking." },
    icon5:      { type: "text",    label: "Icon 5",            default: "🌍", placeholder: "Leave title blank to hide" },
    title5:     { type: "text",    label: "Title 5",           default: "" },
    body5:      { type: "text",    label: "Body 5",            default: "" },
    icon6:      { type: "text",    label: "Icon 6",            default: "🤝", placeholder: "Leave title blank to hide" },
    title6:     { type: "text",    label: "Title 6",           default: "" },
    body6:      { type: "text",    label: "Body 6",            default: "" },
  },
  defaultProps: {
    heading: "Why choose us", subheading: "", columns: "3",
    cardStyle: "shadow", accentColor: "#6d28d9", iconBg: "#ede9fe", bgColor: "#f6f7fb",
    icon1: "🔒", title1: "Secure by default", body1: "Plugins run in isolated sandboxes — no third-party code touches your data.",
    icon2: "⚡",  title2: "Blazing fast",       body2: "Static-first rendering with intelligent cache invalidation delivers sub-100ms pages.",
    icon3: "🎨", title3: "No-code design",     body3: "Drag and drop components to build beautiful pages without writing a line of code.",
    icon4: "📊", title4: "Built-in analytics", body4: "Audit trail and analytics with zero third-party tracking.",
    icon5: "🌍", title5: "", body5: "",
    icon6: "🤝", title6: "", body6: "",
  },
  render(props) {
    const cols    = Number(props["columns"] ?? 3);
    const style   = String(props["cardStyle"] ?? "shadow");
    const acc     = cssColor(props["accentColor"], "#6d28d9");
    const iconBg  = cssColor(props["iconBg"], "#ede9fe");
    const cards   = [1,2,3,4,5,6].map(i =>
      featureCard(props[`icon${i}`], props[`title${i}`], props[`body${i}`], style, acc, iconBg)
    ).join("");
    return `<section class="ps-fg" style="background:${cssColor(props["bgColor"])}">
  <div class="ps-fg-inner">
    ${props["heading"] ? `<h2 class="ps-fg-heading">${e(props["heading"])}</h2>` : ""}
    ${props["subheading"] ? `<p class="ps-fg-sub">${e(props["subheading"])}</p>` : ""}
    <div class="ps-fg-grid" style="grid-template-columns:repeat(${cols},1fr)">${cards}</div>
  </div>
</section>`;
  },
  styles: `
.ps-fg{padding:clamp(3rem,7vw,5.5rem) 1.25rem}
.ps-fg-inner{max-width:1200px;margin:0 auto}
.ps-fg-heading{text-align:center;font-size:clamp(1.5rem,3vw,2.4rem);font-weight:800;margin:0 0 .6rem;letter-spacing:-.03em}
.ps-fg-sub{text-align:center;color:#64748b;font-size:.98rem;margin:0 0 2.8rem;line-height:1.6}
.ps-fg-grid{display:grid;gap:1.25rem}
@media(max-width:768px){.ps-fg-grid{grid-template-columns:repeat(2,1fr)!important}}
@media(max-width:480px){.ps-fg-grid{grid-template-columns:1fr!important}}
.ps-fg-card{background:#fff;border-radius:18px;padding:2rem 1.5rem;transition:transform .2s,box-shadow .2s}
.ps-fg-card:hover{transform:translateY(-4px);box-shadow:0 16px 40px -12px rgba(15,23,42,.16)!important}
.ps-fg-icon{font-size:1.5rem;width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:1rem;flex-shrink:0}
.ps-fg-card h3{font-size:1rem;font-weight:700;margin:0 0 .5rem;color:#0f172a}
.ps-fg-card p{color:#64748b;margin:0;line-height:1.65;font-size:.88rem}`,
};
