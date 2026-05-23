import type { ComponentDef } from "../types.js";
import { e, safeUrl } from "./utils.js";

function card(name: unknown, role: unknown, bio: unknown, avatar: unknown, acc: string): string {
  if (!name) return "";
  const initials = String(name).split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
  const safeAvatar = safeUrl(avatar);
  const av = safeAvatar
    ? `<img src="${e(safeAvatar)}" alt="${e(name)}" class="ps-tg-av">`
    : `<div class="ps-tg-av ps-tg-initials" style="background:${acc}">${e(initials)}</div>`;
  return `<div class="ps-tg-card">
    ${av}
    <div class="ps-tg-name">${e(name)}</div>
    <div class="ps-tg-role">${e(role)}</div>
    ${bio ? `<p class="ps-tg-bio">${e(bio)}</p>` : ""}
  </div>`;
}

export const teamGridComponent: ComponentDef = {
  id: "team-grid",
  name: "Team Grid",
  category: "content",
  description: "Grid of team member cards with avatar, name, role and bio",
  icon: "👥",
  props: {
    heading:  { type: "text",   label: "Section heading", default: "Meet the team" },
    sub:      { type: "text",   label: "Subheading",      default: "The people behind Pressh." },
    columns:  { type: "select", label: "Columns",         default: "3", options: ["2","3","4"] },
    bgColor:  { type: "color",  label: "Background",      default: "#f6f7fb" },
    cardBg:   { type: "color",  label: "Card background", default: "#ffffff" },
    accent:   { type: "color",  label: "Avatar accent",   default: "#6d28d9" },
    // Members
    name1:    { type: "text",   label: "Member 1 name",   default: "Alex Johnson" },
    role1:    { type: "text",   label: "Member 1 role",   default: "Co-founder & CEO" },
    bio1:     { type: "text",   label: "Member 1 bio",    default: "10 years building secure developer tools." },
    avatar1:  { type: "image-url", label: "Member 1 avatar", default: "" },
    name2:    { type: "text",   label: "Member 2 name",   default: "Sam Lee" },
    role2:    { type: "text",   label: "Member 2 role",   default: "Head of Engineering" },
    bio2:     { type: "text",   label: "Member 2 bio",    default: "Former lead at a major cloud provider." },
    avatar2:  { type: "image-url", label: "Member 2 avatar", default: "" },
    name3:    { type: "text",   label: "Member 3 name",   default: "Jordan Rivera" },
    role3:    { type: "text",   label: "Member 3 role",   default: "Head of Design" },
    bio3:     { type: "text",   label: "Member 3 bio",    default: "Obsessed with clarity and pixel-perfect interfaces." },
    avatar3:  { type: "image-url", label: "Member 3 avatar", default: "" },
    name4:    { type: "text",   label: "Member 4 name",   default: "" },
    role4:    { type: "text",   label: "Member 4 role",   default: "" },
    bio4:     { type: "text",   label: "Member 4 bio",    default: "" },
    avatar4:  { type: "image-url", label: "Member 4 avatar", default: "" },
  },
  defaultProps: {
    heading: "Meet the team", sub: "The people behind Pressh.", columns: "3",
    bgColor: "#f6f7fb", cardBg: "#ffffff", accent: "#6d28d9",
    name1: "Alex Johnson", role1: "Co-founder & CEO",       bio1: "10 years building secure developer tools.", avatar1: "",
    name2: "Sam Lee",      role2: "Head of Engineering",    bio2: "Former lead at a major cloud provider.",    avatar2: "",
    name3: "Jordan Rivera",role3: "Head of Design",         bio3: "Obsessed with clarity and pixel-perfect interfaces.", avatar3: "",
    name4: "", role4: "", bio4: "", avatar4: "",
  },
  render(props) {
    const acc = e(props["accent"] as string ?? "#6d28d9");
    const cols = Number(props["columns"] ?? 3);
    const cards = [1,2,3,4].map(i => card(props[`name${i}`],props[`role${i}`],props[`bio${i}`],props[`avatar${i}`],acc)).join("");
    return `<section class="ps-tg" style="background:${e(props["bgColor"])}">
  <div class="ps-tg-inner">
    <div class="ps-tg-head">
      <h2>${e(props["heading"])}</h2>
      ${props["sub"] ? `<p>${e(props["sub"])}</p>` : ""}
    </div>
    <div class="ps-tg-grid" style="--tg-cols:${cols};--tg-card-bg:${e(props["cardBg"])}">${cards}</div>
  </div>
</section>`;
  },
  styles: `
.ps-tg{padding:clamp(3rem,7vw,5.5rem) 1.25rem}
.ps-tg-inner{max-width:1100px;margin:0 auto}
.ps-tg-head{text-align:center;margin-bottom:clamp(2rem,4vw,3.5rem)}
.ps-tg-head h2{font-size:clamp(1.5rem,3.5vw,2.2rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .5rem}
.ps-tg-head p{color:#64748b;font-size:.95rem;margin:0}
.ps-tg-grid{display:grid;grid-template-columns:repeat(var(--tg-cols,3),1fr);gap:1.5rem}
.ps-tg-card{background:var(--tg-card-bg,#fff);border:1px solid rgba(15,23,42,.08);border-radius:18px;padding:1.75rem 1.5rem;text-align:center;transition:transform .2s,box-shadow .2s}
.ps-tg-card:hover{transform:translateY(-4px);box-shadow:0 16px 40px -12px rgba(15,23,42,.12)}
.ps-tg-av{width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 1rem;display:block}
.ps-tg-initials{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1.3rem}
.ps-tg-name{font-size:1rem;font-weight:800;margin-bottom:.2rem;color:#0f172a}
.ps-tg-role{font-size:.8rem;font-weight:600;color:#6d28d9;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.6rem}
.ps-tg-bio{font-size:.85rem;color:#64748b;line-height:1.6;margin:0}
@media(max-width:768px){.ps-tg-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:480px){.ps-tg-grid{grid-template-columns:1fr}}`,
};
