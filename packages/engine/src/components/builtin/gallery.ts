import type { ComponentDef } from "../types.js";
import { e, safeUrl } from "./utils.js";

export const galleryComponent: ComponentDef = {
  id: "gallery",
  name: "Image Gallery",
  category: "media",
  description: "Responsive masonry-style image grid with optional captions",
  icon: "🖼️",
  props: {
    heading:  { type: "text",   label: "Section heading",  default: "" },
    columns:  { type: "select", label: "Columns",          default: "3", options: ["2","3","4"] },
    gap:      { type: "select", label: "Gap size",         default: "md", options: ["sm","md","lg"] },
    rounded:  { type: "boolean",label: "Rounded images",   default: true },
    bgColor:  { type: "color",  label: "Background",       default: "#f6f7fb" },
    img1:     { type: "image-url",label:"Image 1 URL",     default: "", placeholder:"https://..." },
    cap1:     { type: "text",   label: "Image 1 caption",  default: "" },
    img2:     { type: "image-url",label:"Image 2 URL",     default: "", placeholder:"https://..." },
    cap2:     { type: "text",   label: "Image 2 caption",  default: "" },
    img3:     { type: "image-url",label:"Image 3 URL",     default: "", placeholder:"https://..." },
    cap3:     { type: "text",   label: "Image 3 caption",  default: "" },
    img4:     { type: "image-url",label:"Image 4 URL",     default: "", placeholder:"https://..." },
    cap4:     { type: "text",   label: "Image 4 caption",  default: "" },
    img5:     { type: "image-url",label:"Image 5 URL",     default: "", placeholder:"https://..." },
    cap5:     { type: "text",   label: "Image 5 caption",  default: "" },
    img6:     { type: "image-url",label:"Image 6 URL",     default: "", placeholder:"https://..." },
    cap6:     { type: "text",   label: "Image 6 caption",  default: "" },
  },
  defaultProps: {
    heading: "", columns: "3", gap: "md", rounded: true, bgColor: "#f6f7fb",
    img1:"",cap1:"", img2:"",cap2:"", img3:"",cap3:"", img4:"",cap4:"", img5:"",cap5:"", img6:"",cap6:"",
  },
  render(props) {
    const cols = Number(props["columns"] ?? 3);
    const gapMap: Record<string,string> = { sm:"0.5rem", md:"1rem", lg:"1.75rem" };
    const gap = gapMap[String(props["gap"] ?? "md")] ?? "1rem";
    const radius = props["rounded"] ? "border-radius:10px;" : "";
    const cells = [1,2,3,4,5,6].map(i => {
      const src = safeUrl(props[`img${i}`]);
      const cap = String(props[`cap${i}`] ?? "");
      return src ? `<figure class="ps-gl-fig">
        <img src="${e(src)}" alt="${e(cap)}" class="ps-gl-img" loading="lazy" style="${radius}">
        ${cap ? `<figcaption class="ps-gl-cap">${e(cap)}</figcaption>` : ""}
      </figure>` : "";
    }).join("");
    const empty = cells.trim() === "" ? '<div class="ps-gl-empty">Add image URLs in the Properties panel →</div>' : "";
    return `<section class="ps-gl" style="background:${e(props["bgColor"])}">
  <div class="ps-gl-inner">
    ${props["heading"] ? `<h2 class="ps-gl-heading">${e(props["heading"])}</h2>` : ""}
    <div class="ps-gl-grid" style="--gl-cols:${cols};--gl-gap:${gap}">${cells}${empty}</div>
  </div>
</section>`;
  },
  styles: `
.ps-gl{padding:clamp(2.5rem,6vw,5rem) 1.25rem}
.ps-gl-inner{max-width:1200px;margin:0 auto}
.ps-gl-heading{font-size:clamp(1.4rem,3vw,2rem);font-weight:800;text-align:center;margin:0 0 2rem;letter-spacing:-.03em}
.ps-gl-grid{display:grid;grid-template-columns:repeat(var(--gl-cols,3),1fr);gap:var(--gl-gap,1rem)}
.ps-gl-fig{margin:0;position:relative;overflow:hidden}
.ps-gl-img{width:100%;height:240px;object-fit:cover;display:block;transition:transform .3s;max-width:100%}
.ps-gl-fig:hover .ps-gl-img{transform:scale(1.04)}
.ps-gl-cap{font-size:.75rem;color:#64748b;margin:.4rem 0 0;text-align:center}
.ps-gl-empty{grid-column:1/-1;text-align:center;color:#94a3b8;padding:2.5rem;font-size:.88rem;border:2px dashed #e2e8f0;border-radius:12px}
@media(max-width:640px){.ps-gl-grid{grid-template-columns:repeat(2,1fr)!important}}
@media(max-width:380px){.ps-gl-grid{grid-template-columns:1fr!important}}`,
};
