import type { ComponentDef } from "../types.js";
import { e, safeUrl, cssColor } from "./utils.js";

export const logoCloudComponent: ComponentDef = {
  id: "logo-cloud",
  name: "Logo Cloud",
  category: "content",
  description: "Trusted-by strip with partner or client logos",
  icon: "☁️",
  props: {
    label:    { type: "text",    label: "Label text",     default: "Trusted by teams at" },
    logo1:    { type: "image-url",label: "Logo 1 image",  default: "", placeholder: "https://..." },
    name1:    { type: "text",    label: "Logo 1 alt",     default: "Acme Corp" },
    logo2:    { type: "image-url",label: "Logo 2 image",  default: "", placeholder: "https://..." },
    name2:    { type: "text",    label: "Logo 2 alt",     default: "Globex" },
    logo3:    { type: "image-url",label: "Logo 3 image",  default: "", placeholder: "https://..." },
    name3:    { type: "text",    label: "Logo 3 alt",     default: "Initech" },
    logo4:    { type: "image-url",label: "Logo 4 image",  default: "", placeholder: "https://..." },
    name4:    { type: "text",    label: "Logo 4 alt",     default: "Umbrella" },
    logo5:    { type: "image-url",label: "Logo 5 image",  default: "", placeholder: "https://..." },
    name5:    { type: "text",    label: "Logo 5 alt",     default: "Stark Industries" },
    bgColor:  { type: "color",   label: "Background",     default: "#ffffff" },
    grayscale:{ type: "boolean", label: "Greyscale logos",default: true },
  },
  defaultProps: {
    label: "Trusted by teams at",
    logo1: "", name1: "Acme Corp",        logo2: "", name2: "Globex",
    logo3: "", name3: "Initech",          logo4: "", name4: "Umbrella",
    logo5: "", name5: "Stark Industries",
    bgColor: "#ffffff", grayscale: true,
  },
  render(props) {
    const filter = props["grayscale"] ? "filter:grayscale(1);opacity:.6;" : "";
    const logos = [1,2,3,4,5].map(i => {
      const src = safeUrl(props[`logo${i}`]);
      const name = String(props[`name${i}`] ?? "");
      return src
        ? `<img src="${e(src)}" alt="${e(name)}" class="ps-lc-logo" style="${filter}">`
        : name
          ? `<span class="ps-lc-text" style="${filter}">${e(name)}</span>`
          : "";
    }).join("");
    return `<section class="ps-lc" style="background:${cssColor(props["bgColor"], "#ffffff")}">
  <div class="ps-lc-inner">
    ${props["label"] ? `<p class="ps-lc-label">${e(props["label"])}</p>` : ""}
    <div class="ps-lc-logos">${logos}</div>
  </div>
</section>`;
  },
  styles: `
.ps-lc{padding:clamp(2rem,4vw,3.5rem) 1.25rem;border-top:1px solid rgba(15,23,42,.06);border-bottom:1px solid rgba(15,23,42,.06)}
.ps-lc-inner{max-width:1100px;margin:0 auto;text-align:center}
.ps-lc-label{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin:0 0 1.5rem}
.ps-lc-logos{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:2rem 3rem}
.ps-lc-logo{height:clamp(24px,4vw,40px);width:auto;max-width:130px;object-fit:contain;transition:filter .2s,opacity .2s}
.ps-lc-logo:hover{filter:grayscale(0)!important;opacity:1!important}
.ps-lc-text{font-size:clamp(.9rem,2vw,1.1rem);font-weight:800;letter-spacing:-.02em;color:#94a3b8}`,
};
