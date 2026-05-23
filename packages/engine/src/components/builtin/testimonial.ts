import type { ComponentDef } from "../types.js";
import { e, safeUrl } from "./utils.js";

function stars(rating: number): string {
  return Array.from({ length: 5 }, (_, i) =>
    `<span style="color:${i < rating ? "#f59e0b" : "#e2e8f0"};font-size:1.1rem">★</span>`
  ).join("");
}

export const testimonialComponent: ComponentDef = {
  id: "testimonial",
  name: "Testimonial",
  category: "content",
  description: "Quote card with author name, role and optional star rating",
  icon: "💬",
  props: {
    quote:       { type: "richtext", label: "Quote",              default: "Pressh has completely transformed how we manage our content. The security model gives us total peace of mind." },
    author:      { type: "text",     label: "Author name",        default: "Jane Smith" },
    role:        { type: "text",     label: "Role / company",     default: "CTO, Acme Corp" },
    avatar:      { type: "image-url",label: "Avatar URL",         default: "", placeholder: "https://..." },
    starRating:  { type: "number",   label: "Star rating (0–5)",  default: 5, min: 0, max: 5 },
    layout:      { type: "select",   label: "Card layout",        default: "card", options: ["card","minimal","centered"] },
    bgColor:     { type: "color",    label: "Background",         default: "#f6f7fb" },
    accentColor: { type: "color",    label: "Accent color",       default: "#6d28d9" },
    companyLogo: { type: "image-url",label: "Company logo URL",   default: "", placeholder: "Optional logo above quote" },
  },
  defaultProps: {
    quote: "Pressh has completely transformed how we manage our content. The security model gives us total peace of mind.",
    author: "Jane Smith", role: "CTO, Acme Corp", avatar: "",
    starRating: 5, layout: "card",
    bgColor: "#f6f7fb", accentColor: "#6d28d9", companyLogo: "",
  },
  render(props) {
    const avatar = safeUrl(props["avatar"]);
    const initials = String(props["author"] ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const acc = e(props["accentColor"] ?? "#6d28d9");
    const rating = Math.min(5, Math.max(0, Math.round(Number(props["starRating"] ?? 5))));
    const layout = String(props["layout"] ?? "card");
    const logo = safeUrl(props["companyLogo"]);

    const avatarEl = avatar
      ? `<img src="${e(avatar)}" alt="${e(props["author"])}" class="ps-tmn-av" loading="lazy">`
      : `<div class="ps-tmn-av ps-tmn-av-init" style="background:${acc}">${e(initials)}</div>`;

    const ratingEl = rating > 0 ? `<div class="ps-tmn-stars">${stars(rating)}</div>` : "";
    const logoEl   = logo ? `<img src="${e(logo)}" alt="Company logo" class="ps-tmn-logo" loading="lazy">` : "";
    const accentBorder = layout === "card" ? `border-top:4px solid ${acc}` : "";

    const inner = `
    ${logoEl}
    ${ratingEl}
    <blockquote class="ps-tmn-q">&ldquo;${props["quote"] ?? ""}&rdquo;</blockquote>
    <div class="ps-tmn-author${layout === "centered" ? " ps-tmn-author-c" : ""}">
      ${avatarEl}
      <div>
        <strong style="color:${layout==="card"?"#0f172a":"inherit"}">${e(props["author"])}</strong>
        <br><span>${e(props["role"])}</span>
      </div>
    </div>`;

    if (layout === "minimal") {
      return `<section class="ps-tmn" style="background:${e(props["bgColor"])}">
  <div class="ps-tmn-min" style="border-left:3px solid ${acc}">${inner}</div>
</section>`;
    }
    if (layout === "centered") {
      return `<section class="ps-tmn ps-tmn-cen" style="background:${e(props["bgColor"])}">
  <div class="ps-tmn-card" style="${accentBorder}">${inner}</div>
</section>`;
    }
    return `<section class="ps-tmn" style="background:${e(props["bgColor"])}">
  <div class="ps-tmn-card" style="${accentBorder}">${inner}</div>
</section>`;
  },
  styles: `
.ps-tmn{padding:clamp(2.5rem,6vw,5rem) 1.25rem}
.ps-tmn-card{max-width:680px;margin:0 auto;background:#fff;border-radius:20px;padding:2.5rem;box-shadow:0 8px 32px -8px rgba(15,23,42,.1)}
.ps-tmn-min{max-width:680px;margin:0 auto;padding:1rem 1.5rem}
.ps-tmn-cen{text-align:center}
.ps-tmn-logo{height:28px;object-fit:contain;margin-bottom:1.25rem;opacity:.65}
.ps-tmn-stars{margin-bottom:.85rem;display:flex;gap:.1rem}
.ps-tmn-cen .ps-tmn-stars{justify-content:center}
.ps-tmn-q{font-size:clamp(1rem,2.5vw,1.15rem);line-height:1.75;color:#1e293b;margin:0 0 1.5rem;font-style:italic}
.ps-tmn-author{display:flex;align-items:center;gap:.85rem}
.ps-tmn-author-c{justify-content:center}
.ps-tmn-av{width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0}
.ps-tmn-av-init{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.9rem}
.ps-tmn-author strong{font-size:.9rem;display:block}
.ps-tmn-author span{font-size:.8rem;color:#64748b}`,
};
