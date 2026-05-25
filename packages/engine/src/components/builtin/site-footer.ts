import type { ComponentDef } from "../types.js";
import { e, safeUrl, cssColor } from "./utils.js";

function col(head: unknown, links: [string, string][]): string {
  return `<div class="ps-ft-col">
    <h4>${e(head)}</h4>
    ${links.map(([label, url]) => label ? `<a href="${e(safeUrl(url))}">${e(label)}</a>` : "").join("")}
  </div>`;
}

export const siteFooterComponent: ComponentDef = {
  id: "site-footer",
  name: "Site Footer",
  category: "layout",
  description: "Multi-column footer with tagline, links and social icons",
  icon: "🔻",
  props: {
    brand:       { type: "text",  label: "Brand name",      default: "Pressh" },
    tagline:     { type: "text",  label: "Tagline",         default: "The secure-first CMS for the modern web." },
    col1Head:    { type: "text",  label: "Column 1 heading",default: "Product" },
    col1Link1:   { type: "text",  label: "Col 1 – Link 1",  default: "Features" },
    col1Url1:    { type: "text",  label: "Col 1 – URL 1",   default: "#" },
    col1Link2:   { type: "text",  label: "Col 1 – Link 2",  default: "Pricing" },
    col1Url2:    { type: "text",  label: "Col 1 – URL 2",   default: "#" },
    col1Link3:   { type: "text",  label: "Col 1 – Link 3",  default: "Changelog" },
    col1Url3:    { type: "text",  label: "Col 1 – URL 3",   default: "#" },
    col2Head:    { type: "text",  label: "Column 2 heading",default: "Company" },
    col2Link1:   { type: "text",  label: "Col 2 – Link 1",  default: "About" },
    col2Url1:    { type: "text",  label: "Col 2 – URL 1",   default: "/about" },
    col2Link2:   { type: "text",  label: "Col 2 – Link 2",  default: "Blog" },
    col2Url2:    { type: "text",  label: "Col 2 – URL 2",   default: "/blog" },
    col2Link3:   { type: "text",  label: "Col 2 – Link 3",  default: "Contact" },
    col2Url3:    { type: "text",  label: "Col 2 – URL 3",   default: "/contact" },
    col3Head:    { type: "text",  label: "Column 3 heading",default: "Legal" },
    col3Link1:   { type: "text",  label: "Col 3 – Link 1",  default: "Privacy" },
    col3Url1:    { type: "text",  label: "Col 3 – URL 1",   default: "#" },
    col3Link2:   { type: "text",  label: "Col 3 – Link 2",  default: "Terms" },
    col3Url2:    { type: "text",  label: "Col 3 – URL 2",   default: "#" },
    copyright:   { type: "text",  label: "Copyright text",  default: "© 2025 Pressh. All rights reserved." },
    bgColor:     { type: "color", label: "Background",      default: "#0f172a" },
    textColor:   { type: "color", label: "Text color",      default: "#94a3b8" },
    headingColor:{ type: "color", label: "Heading color",   default: "#e2e8f0" },
    accentColor: { type: "color", label: "Accent / links",  default: "#6d28d9" },
  },
  defaultProps: {
    brand: "Pressh", tagline: "The secure-first CMS for the modern web.",
    col1Head: "Product", col1Link1: "Features", col1Url1: "#", col1Link2: "Pricing", col1Url2: "#", col1Link3: "Changelog", col1Url3: "#",
    col2Head: "Company", col2Link1: "About", col2Url1: "/about", col2Link2: "Blog", col2Url2: "/blog", col2Link3: "Contact", col2Url3: "/contact",
    col3Head: "Legal", col3Link1: "Privacy", col3Url1: "#", col3Link2: "Terms", col3Url2: "#",
    copyright: "© 2025 Pressh. All rights reserved.",
    bgColor: "#0f172a", textColor: "#94a3b8", headingColor: "#e2e8f0", accentColor: "#6d28d9",
  },
  render(props) {
    const tc = cssColor(props["textColor"], "#94a3b8");
    const hc = cssColor(props["headingColor"], "#e2e8f0");
    return `<footer class="ps-ft" style="background:${cssColor(props["bgColor"], "#0f172a")};color:${tc}">
  <div class="ps-ft-inner">
    <div class="ps-ft-brand">
      <div class="ps-ft-logo" style="color:${hc}">${e(props["brand"])}</div>
      <p style="color:${tc}">${e(props["tagline"])}</p>
    </div>
    <div class="ps-ft-cols">
      ${col(props["col1Head"], [[String(props["col1Link1"]||""), String(props["col1Url1"]||"")],[String(props["col1Link2"]||""), String(props["col1Url2"]||"")],[String(props["col1Link3"]||""), String(props["col1Url3"]||"")]])}
      ${col(props["col2Head"], [[String(props["col2Link1"]||""), String(props["col2Url1"]||"")],[String(props["col2Link2"]||""), String(props["col2Url2"]||"")],[String(props["col2Link3"]||""), String(props["col2Url3"]||"")]])}
      ${col(props["col3Head"], [[String(props["col3Link1"]||""), String(props["col3Url1"]||"")],[String(props["col3Link2"]||""), String(props["col3Url2"]||"")]])}
    </div>
  </div>
  <div class="ps-ft-bottom" style="border-top:1px solid rgba(255,255,255,.08)">
    <span style="color:${tc};font-size:.8rem">${e(props["copyright"])}</span>
  </div>
</footer>`;
  },
  styles: `
.ps-ft{padding:clamp(2.5rem,6vw,5rem) 1.25rem 0}
.ps-ft-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:3rem;align-items:start}
.ps-ft-logo{font-size:1.2rem;font-weight:900;letter-spacing:-.03em;margin-bottom:.6rem}
.ps-ft-brand p{font-size:.88rem;line-height:1.65;margin:0;max-width:260px}
.ps-ft-cols{grid-column:2/5;display:grid;grid-template-columns:repeat(3,1fr);gap:2rem}
.ps-ft-col h4{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#e2e8f0;margin:0 0 .8rem}
.ps-ft-col a{display:block;font-size:.85rem;text-decoration:none;color:inherit;padding:.22rem 0;transition:color .15s}
.ps-ft-col a:hover{color:#fff}
.ps-ft-bottom{max-width:1200px;margin:2.5rem auto 0;padding:1.1rem 0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
@media(max-width:900px){.ps-ft-inner{grid-template-columns:1fr 1fr;gap:2rem}.ps-ft-cols{grid-column:1/3;grid-template-columns:repeat(3,1fr)}}
@media(max-width:580px){.ps-ft-inner{grid-template-columns:1fr}.ps-ft-cols{grid-column:1;grid-template-columns:1fr 1fr}.ps-ft-brand p{max-width:100%}}`,
};
