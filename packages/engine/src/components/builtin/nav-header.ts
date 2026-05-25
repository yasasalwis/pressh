import type { ComponentDef } from "../types.js";
import { e, safeUrl, cssColor } from "./utils.js";

export const navHeaderComponent: ComponentDef = {
  id: "nav-header",
  name: "Navigation Header",
  category: "layout",
  description: "Sticky top nav with logo, links and CTA — mobile hamburger included",
  icon: "🧭",
  props: {
    logoText:   { type: "text",    label: "Logo text",          default: "Pressh" },
    logoUrl:    { type: "text",    label: "Logo URL",           default: "/", placeholder: "/" },
    link1Label: { type: "text",    label: "Nav link 1",         default: "Home" },
    link1Url:   { type: "text",    label: "Nav link 1 URL",     default: "/" },
    link2Label: { type: "text",    label: "Nav link 2",         default: "Features" },
    link2Url:   { type: "text",    label: "Nav link 2 URL",     default: "#features" },
    link3Label: { type: "text",    label: "Nav link 3",         default: "Blog" },
    link3Url:   { type: "text",    label: "Nav link 3 URL",     default: "/blog" },
    link4Label: { type: "text",    label: "Nav link 4",         default: "Pricing" },
    link4Url:   { type: "text",    label: "Nav link 4 URL",     default: "#pricing" },
    ctaLabel:   { type: "text",    label: "CTA button",         default: "Get started" },
    ctaUrl:     { type: "text",    label: "CTA URL",            default: "#" },
    bgColor:    { type: "color",   label: "Background",         default: "#ffffff" },
    textColor:  { type: "color",   label: "Link color",         default: "#0f172a" },
    ctaBg:      { type: "color",   label: "CTA background",     default: "#6d28d9" },
    sticky:     { type: "boolean", label: "Sticky on scroll",   default: true },
    shadow:     { type: "boolean", label: "Drop shadow",        default: true },
  },
  defaultProps: {
    logoText: "Pressh", logoUrl: "/",
    link1Label: "Home",     link1Url: "/",
    link2Label: "Features", link2Url: "#features",
    link3Label: "Blog",     link3Url: "/blog",
    link4Label: "Pricing",  link4Url: "#pricing",
    ctaLabel: "Get started", ctaUrl: "#",
    bgColor: "#ffffff", textColor: "#0f172a", ctaBg: "#6d28d9",
    sticky: true, shadow: true,
  },
  render(props) {
    const sticky = props["sticky"] ? "position:sticky;top:0;z-index:200;" : "";
    const shadow = props["shadow"] ? "box-shadow:0 1px 12px rgba(15,23,42,.10);" : "border-bottom:1px solid rgba(15,23,42,.08);";
    const lc = cssColor(props["textColor"], "#0f172a");
    const bg = cssColor(props["bgColor"], "#ffffff");
    const ctaBg = cssColor(props["ctaBg"], "#6d28d9");
    const links = [1,2,3,4].map(i =>
      props[`link${i}Label`] ? `<a href="${e(safeUrl(props[`link${i}Url`]))}" class="ps-nh-link" style="color:${lc}">${e(props[`link${i}Label`])}</a>` : ""
    ).join("");
    return `<header class="ps-nh" style="background:${bg};${sticky}${shadow}">
  <div class="ps-nh-inner">
    <a href="${e(safeUrl(props["logoUrl"]))}" class="ps-nh-logo" style="color:${lc}">${e(props["logoText"])}</a>
    <!-- desktop nav -->
    <nav class="ps-nh-desk">${links}</nav>
    <a href="${e(safeUrl(props["ctaUrl"]))}" class="ps-nh-cta" style="background:${ctaBg}">${e(props["ctaLabel"])}</a>
    <!-- mobile nav (CSS-only <details> toggle) -->
    <details class="ps-nh-mob">
      <summary class="ps-nh-burger" aria-label="Toggle navigation">
        <span></span><span></span><span></span>
      </summary>
      <nav class="ps-nh-drawer" style="background:${bg}">
        ${links}
        <a href="${e(safeUrl(props["ctaUrl"]))}" class="ps-nh-cta-mob" style="background:${ctaBg}">${e(props["ctaLabel"])}</a>
      </nav>
    </details>
  </div>
</header>`;
  },
  styles: `
.ps-nh{width:100%;padding:.75rem 1.25rem}
.ps-nh-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:1rem}
.ps-nh-logo{font-weight:900;font-size:1.15rem;text-decoration:none;letter-spacing:-.03em;flex-shrink:0}
.ps-nh-desk{display:flex;align-items:center;gap:.15rem;flex:1;margin-left:.5rem}
.ps-nh-link{text-decoration:none;font-size:.88rem;font-weight:600;padding:.45rem .65rem;border-radius:7px;transition:background .15s;white-space:nowrap}
.ps-nh-link:hover{background:rgba(15,23,42,.06)}
.ps-nh-cta{text-decoration:none;font-size:.85rem;font-weight:700;color:#fff;padding:.55rem 1.1rem;border-radius:8px;white-space:nowrap;min-height:40px;display:inline-flex;align-items:center;margin-left:auto;flex-shrink:0;transition:filter .15s}
.ps-nh-cta:hover{filter:brightness(1.12)}
.ps-nh-mob{display:none;position:relative;margin-left:auto}
.ps-nh-burger{list-style:none;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:5px;width:40px;height:40px;padding:8px;border-radius:8px;border:1px solid rgba(15,23,42,.12)}
.ps-nh-burger::-webkit-details-marker{display:none}
.ps-nh-burger span{display:block;height:2px;background:currentColor;border-radius:2px;transition:transform .2s}
.ps-nh-mob[open] .ps-nh-burger span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.ps-nh-mob[open] .ps-nh-burger span:nth-child(2){opacity:0}
.ps-nh-mob[open] .ps-nh-burger span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
.ps-nh-drawer{position:absolute;right:0;top:calc(100% + .5rem);min-width:220px;border-radius:14px;padding:.6rem;box-shadow:0 12px 40px -8px rgba(15,23,42,.2);border:1px solid rgba(15,23,42,.08);display:flex;flex-direction:column;gap:.15rem;z-index:300}
.ps-nh-drawer .ps-nh-link{padding:.6rem .85rem;border-radius:9px;display:block}
.ps-nh-cta-mob{display:block;text-align:center;text-decoration:none;color:#fff;font-weight:700;font-size:.88rem;padding:.65rem 1rem;border-radius:9px;margin-top:.4rem;min-height:44px;display:flex;align-items:center;justify-content:center}
@media(max-width:768px){.ps-nh-desk,.ps-nh-cta{display:none}.ps-nh-mob{display:block;margin-left:auto}}`,
};
