import type { ComponentDef } from "../types.js";
import { e, safeUrl, cssColor } from "./utils.js";

export const bannerStripComponent: ComponentDef = {
  id: "banner-strip",
  name: "Announcement Banner",
  category: "layout",
  description: "Slim top-of-page announcement or promotional strip",
  icon: "📢",
  props: {
    message:    { type: "text",    label: "Message",           default: "🎉 We just launched v2.0 — check out what's new!" },
    ctaLabel:   { type: "text",    label: "CTA label",         default: "Learn more", placeholder: "Leave blank to hide" },
    ctaUrl:     { type: "text",    label: "CTA URL",           default: "#" },
    dismissible:{ type: "boolean", label: "Dismissible",       default: true },
    bgColor:    { type: "color",   label: "Background",        default: "#6d28d9" },
    textColor:  { type: "color",   label: "Text color",        default: "#ffffff" },
    align:      { type: "select",  label: "Alignment",         default: "center", options: ["left","center"] },
    size:       { type: "select",  label: "Size",              default: "md", options: ["sm","md","lg"] },
    sticky:     { type: "boolean", label: "Sticky (fixed top)",default: false },
    icon:       { type: "text",    label: "Leading icon",      default: "", placeholder: "Emoji, e.g. 🚀" },
  },
  defaultProps: {
    message: "🎉 We just launched v2.0 — check out what's new!",
    ctaLabel: "Learn more", ctaUrl: "#", dismissible: true,
    bgColor: "#6d28d9", textColor: "#ffffff", align: "center",
    size: "md", sticky: false, icon: "",
  },
  render(props) {
    const sizeMap: Record<string,string> = { sm:".78rem .8rem", md:".65rem 1rem", lg:".9rem 1.25rem" };
    const padding = sizeMap[String(props["size"] ?? "md")] ?? ".65rem 1rem";
    const fontMap: Record<string,string> = { sm:".78rem", md:".875rem", lg:"1rem" };
    const fontSize = fontMap[String(props["size"] ?? "md")] ?? ".875rem";
    const align = String(props["align"] ?? "center");
    const sticky = props["sticky"] ? "position:sticky;top:0;z-index:999;" : "";
    const icon = props["icon"] ? `<span class="ps-bs-icon">${e(props["icon"])}</span>` : "";
    const tc = cssColor(props["textColor"], "#ffffff");
    const cta = props["ctaLabel"]
      ? `<a href="${e(safeUrl(props["ctaUrl"]))}" class="ps-bs-cta" style="color:${tc};border-color:${tc}">${e(props["ctaLabel"])} &#8594;</a>`
      : "";
    const dismiss = props["dismissible"]
      ? `<button class="ps-bs-close" onclick="this.closest('.ps-bs').style.display='none'" aria-label="Dismiss" style="color:${tc}">&#10005;</button>`
      : "";
    return `<div class="ps-bs" role="banner" style="background:${cssColor(props["bgColor"], "#6d28d9")};color:${tc};padding:${padding};font-size:${fontSize};text-align:${align};${sticky}">
  <div class="ps-bs-inner">
    <span class="ps-bs-msg">${icon}${e(props["message"])}</span>
    ${cta}
    ${dismiss}
  </div>
</div>`;
  },
  styles: `
.ps-bs{width:100%;box-sizing:border-box;line-height:1.4}
.ps-bs-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:.65rem;flex-wrap:wrap;position:relative;padding:0 2rem}
.ps-bs-icon{margin-right:.2rem}
.ps-bs-msg{font-weight:500}
.ps-bs-cta{font-weight:700;text-decoration:none;border:1px solid;border-radius:999px;padding:.2em .65em;font-size:.88em;white-space:nowrap;opacity:.95;transition:opacity .15s}
.ps-bs-cta:hover{opacity:1}
.ps-bs-close{position:absolute;right:0;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1rem;padding:.25rem .35rem;border-radius:4px;opacity:.7;transition:opacity .15s;line-height:1}
.ps-bs-close:hover{opacity:1}
@media(max-width:480px){.ps-bs-inner{gap:.4rem}.ps-bs-close{position:static;transform:none;margin-left:.25rem}}`,
};
