import type { ComponentDef } from "../types.js";
import { e, safeUrl, cssColor, cssUrl } from "./utils.js";

export const ctaBannerComponent: ComponentDef = {
  id: "cta-banner",
  name: "CTA Banner",
  category: "content",
  description: "Call-to-action strip with title, subtitle and buttons",
  icon: "📣",
  props: {
    heading:    { type: "text",      label: "Heading",               default: "Ready to get started?" },
    sub:        { type: "text",      label: "Subtext",               default: "Join thousands of teams building with Pressh." },
    btnLabel:   { type: "text",      label: "Primary button label",  default: "Start for free" },
    btnUrl:     { type: "text",      label: "Primary button URL",    default: "#" },
    btn2Label:  { type: "text",      label: "Ghost button label",    default: "View demo", placeholder: "Leave blank to hide" },
    btn2Url:    { type: "text",      label: "Ghost button URL",      default: "#" },
    bgColor:    { type: "color",     label: "Background",            default: "#0f172a" },
    bgImage:    { type: "image-url", label: "Background image URL",  default: "", placeholder: "Optional (overlays on bg color)" },
    textColor:  { type: "color",     label: "Text color",            default: "#ffffff" },
    btnColor:   { type: "color",     label: "Primary button color",  default: "#6d28d9" },
    align:      { type: "select",    label: "Layout",                default: "split", options: ["split","centered"] },
    rounded:    { type: "boolean",   label: "Rounded corners",       default: false },
  },
  defaultProps: {
    heading: "Ready to get started?",
    sub: "Join thousands of teams building with Pressh.",
    btnLabel: "Start for free", btnUrl: "#",
    btn2Label: "View demo", btn2Url: "#",
    bgColor: "#0f172a", bgImage: "", textColor: "#ffffff", btnColor: "#6d28d9",
    align: "split", rounded: false,
  },
  render(props) {
    const align   = String(props["align"] ?? "split");
    const bgImg   = cssUrl(props["bgImage"]);
    const rounded = props["rounded"] ? "border-radius:20px;overflow:hidden;" : "";
    const tc      = cssColor(props["textColor"], "#ffffff");
    const bg      = cssColor(props["bgColor"], "#0f172a");
    const bgStyle = bgImg
      ? `background:${bgImg} center/cover no-repeat;`
      : `background:${bg};`;
    const btn2 = props["btn2Label"]
      ? `<a href="${e(safeUrl(props["btn2Url"]))}" class="ps-cta-btn ps-cta-ghost" style="border-color:${tc};color:${tc}">${e(props["btn2Label"])}</a>`
      : "";
    const isCentered = align === "centered";
    return `<section class="ps-cta${isCentered ? " ps-cta-centered" : ""}" style="${bgStyle}color:${tc};${rounded}">
  ${bgImg ? `<div class="ps-cta-overlay" style="background:${bg};opacity:.75"></div>` : ""}
  <div class="ps-cta-inner${isCentered ? " ps-cta-inner-c" : ""}">
    <div class="ps-cta-text">
      <h2>${e(props["heading"])}</h2>
      ${props["sub"] ? `<p>${e(props["sub"])}</p>` : ""}
    </div>
    <div class="ps-cta-btns">
      ${props["btnLabel"] ? `<a href="${e(safeUrl(props["btnUrl"]))}" class="ps-cta-btn ps-cta-primary" style="background:${cssColor(props["btnColor"], "#6d28d9")}">${e(props["btnLabel"])}</a>` : ""}
      ${btn2}
    </div>
  </div>
</section>`;
  },
  styles: `
.ps-cta{padding:clamp(3rem,6vw,5rem) 1.25rem;position:relative;overflow:hidden}
.ps-cta-overlay{position:absolute;inset:0;pointer-events:none}
.ps-cta-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:2.5rem;flex-wrap:wrap;position:relative;z-index:1}
.ps-cta-inner-c{flex-direction:column;text-align:center;align-items:center}
.ps-cta-text h2{font-size:clamp(1.4rem,3vw,2rem);font-weight:800;margin:0 0 .4rem;letter-spacing:-.03em}
.ps-cta-text p{margin:0;opacity:.8;font-size:.95rem;line-height:1.6}
.ps-cta-btns{display:flex;gap:.75rem;flex-wrap:wrap;flex-shrink:0}
.ps-cta-btn{display:inline-flex;align-items:center;text-decoration:none;padding:.85rem 2rem;border-radius:50px;font-weight:700;font-size:.95rem;white-space:nowrap;transition:filter .2s,transform .15s;min-height:48px}
.ps-cta-btn:hover{filter:brightness(1.12);transform:translateY(-2px)}
.ps-cta-primary{color:#fff}
.ps-cta-ghost{background:transparent;border:2px solid}
@media(max-width:640px){.ps-cta-inner{flex-direction:column;text-align:center}.ps-cta-btns{justify-content:center}}`,
};
