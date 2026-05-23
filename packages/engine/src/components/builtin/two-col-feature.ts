import type { ComponentDef } from "../types.js";
import { e, safeUrl } from "./utils.js";

export const twoColFeatureComponent: ComponentDef = {
  id: "two-col-feature",
  name: "Two-Column Feature",
  category: "content",
  description: "Image on one side, heading + body + optional CTA on the other",
  icon: "◧",
  props: {
    imageUrl:    { type: "image-url",label: "Image URL",          default: "", placeholder: "https://..." },
    imageAlt:    { type: "text",     label: "Image alt text",     default: "" },
    imagePos:    { type: "select",   label: "Image position",     default: "right", options: ["left","right"] },
    badge:       { type: "text",     label: "Badge text",         default: "", placeholder: "New feature" },
    heading:     { type: "text",     label: "Heading",            default: "Designed for security from the ground up" },
    body:        { type: "richtext", label: "Body text",          default: "Pressh isolates every plugin in its own worker thread. Even if a plugin is compromised, it cannot access your database, read other plugins' data, or execute arbitrary code on the server." },
    ctaLabel:    { type: "text",     label: "CTA label",          default: "Learn more" },
    ctaUrl:      { type: "text",     label: "CTA URL",            default: "#" },
    ctaStyle:    { type: "select",   label: "CTA style",          default: "link", options: ["link","outline","filled"] },
    accentColor: { type: "color",    label: "Accent color",       default: "#6d28d9" },
    bgColor:     { type: "color",    label: "Background",         default: "#ffffff" },
    imageRadius: { type: "boolean",  label: "Rounded image",      default: true },
    imageShadow: { type: "boolean",  label: "Image shadow",       default: true },
  },
  defaultProps: {
    imageUrl: "", imageAlt: "", imagePos: "right", badge: "",
    heading: "Designed for security from the ground up",
    body: "Pressh isolates every plugin in its own worker thread. Even if a plugin is compromised, it cannot access your database, read other plugins' data, or execute arbitrary code on the server.",
    ctaLabel: "Learn more", ctaUrl: "#", ctaStyle: "link",
    accentColor: "#6d28d9", bgColor: "#ffffff", imageRadius: true, imageShadow: true,
  },
  render(props) {
    const acc    = e(props["accentColor"]);
    const imgPos = String(props["imagePos"] ?? "right");
    const radius = props["imageRadius"] ? "border-radius:16px;" : "";
    const shadow  = props["imageShadow"] ? "box-shadow:0 24px 60px -16px rgba(15,23,42,.2);" : "";
    const ctaStyle = String(props["ctaStyle"] ?? "link");
    let ctaClass = "ps-tc-cta";
    if (ctaStyle === "filled")  ctaClass += " ps-tc-filled";
    if (ctaStyle === "outline") ctaClass += " ps-tc-outline";
    const ctaInlineStyle = ctaStyle === "filled" ? `background:${acc}` : ctaStyle === "outline" ? `border-color:${acc};color:${acc}` : `color:${acc}`;
    const cta = props["ctaLabel"] ? `<a href="${e(safeUrl(props["ctaUrl"]))}" class="${ctaClass}" style="${ctaInlineStyle}">${e(props["ctaLabel"])} &#8594;</a>` : "";
    const badge = props["badge"] ? `<span class="ps-tc-badge" style="background:${acc}18;color:${acc}">${e(props["badge"])}</span>` : "";
    const imgSrc = safeUrl(props["imageUrl"]);
    const imgBlock = imgSrc
      ? `<img src="${e(imgSrc)}" alt="${e(props["imageAlt"])}" class="ps-tc-img" loading="lazy" style="${radius}${shadow}">`
      : `<div class="ps-tc-img-ph" style="${radius}">Image</div>`;
    const textBlock = `<div class="ps-tc-text">
      ${badge}
      <h2 class="ps-tc-h">${e(props["heading"])}</h2>
      <div class="ps-tc-body">${props["body"] ?? ""}</div>
      ${cta}
    </div>`;
    const order = imgPos === "left"
      ? `<div class="ps-tc-img-wrap">${imgBlock}</div>${textBlock}`
      : `${textBlock}<div class="ps-tc-img-wrap">${imgBlock}</div>`;
    return `<section class="ps-tc" style="background:${e(props["bgColor"])}">
  <div class="ps-tc-inner">${order}</div>
</section>`;
  },
  styles: `
.ps-tc{padding:clamp(3rem,7vw,5.5rem) 1.25rem}
.ps-tc-inner{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:clamp(2rem,5vw,5rem);align-items:center}
.ps-tc-img-wrap{min-width:0}
.ps-tc-img{width:100%;height:auto;display:block;max-width:100%}
.ps-tc-img-ph{aspect-ratio:4/3;background:#e2e8f0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:.88rem}
.ps-tc-text{display:flex;flex-direction:column;gap:.75rem;min-width:0}
.ps-tc-badge{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;padding:.25rem .65rem;border-radius:999px;display:inline-block}
.ps-tc-h{font-size:clamp(1.4rem,3.5vw,2.2rem);font-weight:800;letter-spacing:-.03em;margin:0;line-height:1.15}
.ps-tc-body{color:#475569;font-size:.95rem;line-height:1.7}
.ps-tc-body p{margin:0 0 .75em}.ps-tc-body p:last-child{margin:0}
.ps-tc-cta{display:inline-flex;align-items:center;gap:.3rem;font-size:.9rem;font-weight:700;text-decoration:none;padding:.55rem 0;transition:gap .15s}
.ps-tc-cta:hover{gap:.6rem}
.ps-tc-filled{color:#fff;padding:.7rem 1.4rem;border-radius:10px;transition:filter .15s}
.ps-tc-filled:hover{filter:brightness(1.1);gap:.3rem}
.ps-tc-outline{border:2px solid;padding:.65rem 1.3rem;border-radius:10px;background:transparent}
@media(max-width:768px){.ps-tc-inner{grid-template-columns:1fr;gap:2rem}}`,
};
