import type { ComponentDef } from "../types.js";
import { e, safeUrl, cssColor } from "./utils.js";

export const imageBlockComponent: ComponentDef = {
  id: "image-block",
  name: "Image",
  category: "media",
  description: "Full-width or contained image with optional caption",
  icon: "🖼️",
  props: {
    src:       { type: "image-url", label: "Image URL",   default: "",                        placeholder: "https://..." },
    alt:       { type: "text",      label: "Alt text",    default: "",                        placeholder: "Describe the image" },
    caption:   { type: "text",      label: "Caption",     default: "",                        placeholder: "Optional caption text" },
    width:     { type: "select",    label: "Width",       default: "contained",               options: ["contained", "wide", "full"] },
    rounded:   { type: "boolean",   label: "Rounded",     default: true },
    shadow:    { type: "boolean",   label: "Shadow",      default: true },
    bgColor:   { type: "color",     label: "Background",  default: "#f6f7fb" },
  },
  defaultProps: {
    src: "", alt: "", caption: "", width: "contained", rounded: true, shadow: true, bgColor: "#f6f7fb",
  },
  render(props) {
    const maxW = props["width"] === "full" ? "100%" : props["width"] === "wide" ? "1200px" : "820px";
    const radius = props["rounded"] ? "border-radius:14px;" : "";
    const shadow = props["shadow"] ? "box-shadow:0 20px 60px -20px rgba(15,23,42,.22);" : "";
    const src = safeUrl(props["src"]);
    if (!src) {
      return `<section class="ps-img" style="background:${cssColor(props["bgColor"], "#f6f7fb")}"><div class="ps-img-inner" style="max-width:${e(maxW)}"><div class="ps-img-placeholder">No image selected</div></div></section>`;
    }
    return `<section class="ps-img" style="background:${cssColor(props["bgColor"], "#f6f7fb")}">
  <div class="ps-img-inner" style="max-width:${e(maxW)}">
    <img src="${e(src)}" alt="${e(props["alt"])}" loading="lazy" style="width:100%;display:block;${radius}${shadow}">
    ${props["caption"] ? `<p class="ps-img-caption">${e(props["caption"])}</p>` : ""}
  </div>
</section>`;
  },
  styles: `
.ps-img{padding:2.5rem 1.5rem}
.ps-img-inner{margin:0 auto}
.ps-img img{max-width:100%}
.ps-img-caption{text-align:center;color:#64748b;font-size:.88rem;margin:.75rem 0 0}
.ps-img-placeholder{border:2px dashed #cbd5e1;border-radius:12px;height:180px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:.9rem}`,
};
