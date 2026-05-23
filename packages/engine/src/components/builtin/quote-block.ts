import type { ComponentDef } from "../types.js";
import { e } from "./utils.js";

export const quoteBlockComponent: ComponentDef = {
  id: "quote-block",
  name: "Pull Quote",
  category: "content",
  description: "Large typographic pull quote with attribution",
  icon: "💬",
  props: {
    quote:      { type: "richtext",label: "Quote text",      default: "The best CMS is one that gets out of your way — and stays out of the attacker's way too." },
    author:     { type: "text",   label: "Author",           default: "Jane Smith" },
    role:       { type: "text",   label: "Role / company",  default: "CTO, Acme Corp" },
    size:       { type: "select", label: "Quote size",       default: "lg", options: ["sm","md","lg","xl"] },
    variant:    { type: "select", label: "Variant",          default: "default", options: ["default","bordered","card","dark"] },
    accentColor:{ type: "color",  label: "Accent color",     default: "#6d28d9" },
    bgColor:    { type: "color",  label: "Background",       default: "#f6f7fb" },
    align:      { type: "select", label: "Alignment",        default: "center", options: ["left","center"] },
  },
  defaultProps: {
    quote: "The best CMS is one that gets out of your way — and stays out of the attacker's way too.",
    author: "Jane Smith", role: "CTO, Acme Corp",
    size: "lg", variant: "default", accentColor: "#6d28d9", bgColor: "#f6f7fb", align: "center",
  },
  render(props) {
    const acc = e(props["accentColor"]);
    const sizeMap: Record<string,string> = { sm:".95rem", md:"1.1rem", lg:"1.35rem", xl:"1.65rem" };
    const qSize = sizeMap[String(props["size"] ?? "lg")] ?? "1.35rem";
    const variant = String(props["variant"] ?? "default");
    const align = e(props["align"] ?? "center");
    let extraStyle = `text-align:${align};background:${e(props["bgColor"])};`;
    let extraClass = "";
    if (variant === "bordered") { extraStyle += `border-left:5px solid ${acc};`; extraClass = " ps-qb-bordered"; }
    if (variant === "card")     { extraClass = " ps-qb-card"; }
    if (variant === "dark")     { extraStyle = `background:#0f172a;color:#e2e8f0;text-align:${align};`; }
    return `<section class="ps-qb${extraClass}" style="${extraStyle}">
  <div class="ps-qb-inner">
    <div class="ps-qb-mark" style="color:${acc}">&ldquo;</div>
    <blockquote class="ps-qb-text" style="font-size:${qSize}">${props["quote"] ?? ""}</blockquote>
    <div class="ps-qb-attr">
      ${props["author"] ? `<strong style="color:${variant==="dark"?"#e2e8f0":"#0f172a"}">${e(props["author"])}</strong>` : ""}
      ${props["role"] ? `<span>${e(props["role"])}</span>` : ""}
    </div>
  </div>
</section>`;
  },
  styles: `
.ps-qb{padding:clamp(3rem,7vw,5.5rem) 1.25rem}
.ps-qb-inner{max-width:820px;margin:0 auto}
.ps-qb-bordered{padding-left:2.5rem}
.ps-qb-card .ps-qb-inner{background:#fff;border-radius:20px;padding:2.5rem;box-shadow:0 8px 32px -8px rgba(15,23,42,.1)}
.ps-qb-mark{font-size:clamp(4rem,10vw,7rem);line-height:.8;font-weight:900;opacity:.25;margin-bottom:-.5rem}
.ps-qb-text{font-size:clamp(1rem,2.5vw,1.35rem);font-weight:600;line-height:1.55;margin:0 0 1.5rem;font-style:italic;color:inherit}
.ps-qb-attr{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;font-size:.88rem}
.ps-qb-attr strong{font-size:.9rem}
.ps-qb-attr span{color:#64748b}
.ps-qb-attr strong::after{content:"·";margin-left:.75rem;color:#94a3b8}`,
};
