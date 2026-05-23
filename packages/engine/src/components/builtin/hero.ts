import type { ComponentDef } from "../types.js";
import { e, safeUrl } from "./utils.js";

export const heroComponent: ComponentDef = {
  id: "hero",
  name: "Hero Section",
  category: "content",
  description: "Full-width hero with headline, subtitle and CTA",
  icon: "🦸",
  props: {
    heading:        { type: "text",    label: "Heading",              default: "Build something amazing",                     placeholder: "Your headline" },
    subheading:     { type: "text",    label: "Subheading",           default: "A beautiful, secure CMS for the modern web.", placeholder: "Supporting text" },
    ctaLabel:       { type: "text",    label: "Primary CTA label",    default: "Get started" },
    ctaUrl:         { type: "text",    label: "Primary CTA URL",      default: "#",          placeholder: "/about" },
    cta2Label:      { type: "text",    label: "Secondary CTA label",  default: "Learn more", placeholder: "Leave blank to hide" },
    cta2Url:        { type: "text",    label: "Secondary CTA URL",    default: "#" },
    bgFrom:         { type: "color",   label: "Gradient start",       default: "#6d28d9" },
    bgTo:           { type: "color",   label: "Gradient end",         default: "#0ea5e9" },
    bgImage:        { type: "image-url",label: "Background image URL",default: "", placeholder: "Optional overlay image" },
    overlayOpacity: { type: "number",  label: "Image overlay opacity",default: 40, min: 0, max: 100 },
    align:          { type: "select",  label: "Alignment",            default: "center",     options: ["left","center","right"] },
    paddingSize:    { type: "select",  label: "Vertical padding",     default: "lg",         options: ["sm","md","lg","xl"] },
    contentWidth:   { type: "number",  label: "Content max-width (px)",default: 860, min: 400, max: 1400 },
    minHeight:      { type: "number",  label: "Min height (px)",      default: 420, min: 200, max: 1000 },
    badgeText:      { type: "text",    label: "Badge label",          default: "", placeholder: "e.g. New · v2.0 launched" },
  },
  defaultProps: {
    heading: "Build something amazing",
    subheading: "A beautiful, secure CMS for the modern web.",
    ctaLabel: "Get started", ctaUrl: "#",
    cta2Label: "Learn more", cta2Url: "#",
    bgFrom: "#6d28d9", bgTo: "#0ea5e9",
    bgImage: "", overlayOpacity: 40,
    align: "center", paddingSize: "lg", contentWidth: 860, minHeight: 420, badgeText: "",
  },
  render(props) {
    const align = e(props["align"] ?? "center");
    const minH  = Number(props["minHeight"] ?? 420);
    const cw    = Number(props["contentWidth"] ?? 860);
    const padMap: Record<string,string> = { sm:"3rem 1.5rem", md:"5rem 1.5rem", lg:"7rem 1.5rem", xl:"10rem 1.5rem" };
    const padding = padMap[String(props["paddingSize"] ?? "lg")] ?? "7rem 1.5rem";
    const bgImg = safeUrl(props["bgImage"]);
    const opacity = Number(props["overlayOpacity"] ?? 40) / 100;
    const gradStyle = `linear-gradient(135deg,${e(props["bgFrom"])},${e(props["bgTo"])})`;
    const overlayLayer = bgImg
      ? `<div class="ps-hero-overlay" style="background:url('${e(bgImg)}') center/cover no-repeat;opacity:${(1 - opacity).toFixed(2)}"></div>`
      : "";
    const badge = props["badgeText"]
      ? `<div class="ps-hero-badge">${e(props["badgeText"])}</div>` : "";
    const cta2 = props["cta2Label"]
      ? `<a href="${e(safeUrl(props["cta2Url"]))}" class="ps-hero-cta ps-hero-cta2">${e(props["cta2Label"])}</a>` : "";
    return `<section class="ps-hero" style="background:${gradStyle};min-height:${minH}px;padding:${padding}">
  ${overlayLayer}
  <div class="ps-hero-inner" style="max-width:${cw}px;text-align:${align}">
    ${badge}
    <h1 class="ps-hero-h">${e(props["heading"])}</h1>
    <p class="ps-hero-sub">${e(props["subheading"])}</p>
    <div class="ps-hero-actions${align === "center" ? " ps-hero-center" : ""}">
      ${props["ctaLabel"] ? `<a href="${e(safeUrl(props["ctaUrl"]))}" class="ps-hero-cta ps-hero-cta1">${e(props["ctaLabel"])}</a>` : ""}
      ${cta2}
    </div>
  </div>
</section>`;
  },
  styles: `
.ps-hero{display:flex;align-items:center;justify-content:center;color:#fff;position:relative;overflow:hidden;box-sizing:border-box}
.ps-hero-overlay{position:absolute;inset:0;pointer-events:none}
.ps-hero-inner{width:100%;position:relative;z-index:1}
.ps-hero-badge{display:inline-block;font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:.25rem .75rem;margin-bottom:1rem}
.ps-hero-h{font-size:clamp(2rem,5vw,3.75rem);font-weight:900;letter-spacing:-.035em;margin:0 0 1rem;line-height:1.08}
.ps-hero-sub{font-size:clamp(1rem,2vw,1.2rem);opacity:.88;margin:0 0 2.4rem;max-width:580px;line-height:1.65}
.ps-hero-actions{display:flex;gap:.85rem;flex-wrap:wrap}
.ps-hero-center{justify-content:center}
.ps-hero-center .ps-hero-sub{margin-left:auto;margin-right:auto}
.ps-hero-cta{display:inline-flex;align-items:center;gap:.3rem;text-decoration:none;padding:.85rem 2.2rem;border-radius:50px;font-weight:700;font-size:1rem;transition:filter .2s,transform .15s;min-height:48px}
.ps-hero-cta:hover{transform:translateY(-2px)}
.ps-hero-cta1{background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.55);color:#fff}
.ps-hero-cta1:hover{background:rgba(255,255,255,.28)}
.ps-hero-cta2{background:transparent;border:2px solid rgba(255,255,255,.35);color:rgba(255,255,255,.9)}
.ps-hero-cta2:hover{background:rgba(255,255,255,.1)}
@media(max-width:480px){.ps-hero-actions{flex-direction:column;align-items:stretch;gap:.6rem}.ps-hero-cta{justify-content:center}}`,
};
