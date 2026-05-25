import type { ComponentDef } from "../types.js";
import { cssColor, e, richtext } from "./utils.js";

export const textContentComponent: ComponentDef = {
  id: "text-content",
  name: "Text Content",
  category: "content",
  description: "Rich paragraph text with optional heading and lead line",
  icon: "📝",
  props: {
    heading:   { type: "text",     label: "Heading (optional)",  default: "", placeholder: "Section heading" },
    lead:      { type: "text",     label: "Lead text (optional)",default: "", placeholder: "Bold intro sentence" },
    body:      { type: "richtext", label: "Body text",           default: "Write your content here. This component supports <strong>rich text</strong> with HTML." },
    align:     { type: "select",   label: "Alignment",           default: "left",    options: ["left","center","right"] },
    fontSize:  { type: "select",   label: "Body font size",      default: "md",      options: ["sm","md","lg"] },
    maxWidth:  { type: "number",   label: "Max width (px)",      default: 760, min: 400, max: 1400 },
    padding:   { type: "select",   label: "Vertical padding",    default: "md",      options: ["sm","md","lg"] },
    bgColor:   { type: "color",    label: "Background",          default: "#ffffff" },
    textColor: { type: "color",    label: "Text color",          default: "#0f172a" },
    accentColor:{ type: "color",   label: "Heading accent",      default: "#6d28d9" },
    divider:   { type: "boolean",  label: "Show top divider",    default: false },
  },
  defaultProps: {
    heading: "", lead: "",
    body: "Write your content here. This component supports <strong>rich text</strong> with HTML.",
    align: "left", fontSize: "md", maxWidth: 760, padding: "md",
    bgColor: "#ffffff", textColor: "#0f172a", accentColor: "#6d28d9", divider: false,
  },
  render(props) {
    const w   = Number(props["maxWidth"] ?? 760);
    const fsMap: Record<string,string> = { sm:".875rem", md:"1rem", lg:"1.1rem" };
    const fs  = fsMap[String(props["fontSize"] ?? "md")] ?? "1rem";
    const padMap: Record<string,string> = { sm:"2rem 1.25rem", md:"3.5rem 1.25rem", lg:"5.5rem 1.25rem" };
    const pad = padMap[String(props["padding"] ?? "md")] ?? "3.5rem 1.25rem";
    const align = ["left", "center", "right"].includes(String(props["align"])) ? String(props["align"]) : "left";
    const divider = props["divider"]
      ? `<hr class="ps-txt-div" style="border-color:${cssColor(props["accentColor"])}">` : "";
    return `<section class="ps-txt" style="background:${cssColor(props["bgColor"])};color:${cssColor(props["textColor"])};text-align:${align};padding:${pad}">
  <div class="ps-txt-inner" style="max-width:${w}px">
    ${divider}
    ${props["heading"] ? `<h2 class="ps-txt-h" style="color:${cssColor(props["textColor"])}">${e(props["heading"])}</h2>` : ""}
    ${props["lead"] ? `<p class="ps-txt-lead">${e(props["lead"])}</p>` : ""}
    <div class="ps-txt-body" style="font-size:${fs}">${richtext(props["body"])}</div>
  </div>
</section>`;
  },
  styles: `
.ps-txt{box-sizing:border-box}
.ps-txt-inner{margin:0 auto}
.ps-txt-div{border:none;border-top:3px solid;width:3rem;margin:0 0 1.5rem}
.ps-txt[style*="center"] .ps-txt-div{margin:0 auto 1.5rem}
.ps-txt-h{font-size:clamp(1.4rem,3vw,2.2rem);font-weight:800;margin:0 0 .65rem;letter-spacing:-.03em;line-height:1.2}
.ps-txt-lead{font-size:1.15rem;font-weight:600;color:#334155;margin:0 0 1.25rem;line-height:1.55}
.ps-txt-body{line-height:1.8;color:inherit}
.ps-txt-body p{margin:0 0 1.1em}
.ps-txt-body p:last-child{margin:0}
.ps-txt-body h2,.ps-txt-body h3{font-weight:700;letter-spacing:-.02em;margin:1.5em 0 .5em}
.ps-txt-body ul,.ps-txt-body ol{padding-left:1.4em;margin:0 0 1em}
.ps-txt-body li{margin-bottom:.4em;line-height:1.65}
.ps-txt-body a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.ps-txt-body blockquote{border-left:4px solid #e2e8f0;margin:1.5em 0;padding:.5em 1.2em;color:#64748b;font-style:italic}`,
};
