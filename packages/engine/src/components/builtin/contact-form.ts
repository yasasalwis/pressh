import type { ComponentDef } from "../types.js";
import { cssColor, e } from "./utils.js";

export const contactFormComponent: ComponentDef = {
  id: "contact-form",
  name: "Contact Form",
  category: "content",
  description: "Contact form with name, email, subject and message fields",
  icon: "✉️",
  props: {
    heading:    { type: "text",   label: "Heading",          default: "Get in touch" },
    sub:        { type: "text",   label: "Subheading",       default: "We typically respond within 24 hours." },
    showSubject:{ type: "boolean",label: "Show subject field",default: true },
    btnLabel:   { type: "text",   label: "Submit button",    default: "Send message" },
    successMsg: { type: "text",   label: "Success message",  default: "Thanks! We'll be in touch soon." },
    bgColor:    { type: "color",  label: "Background",       default: "#ffffff" },
    accentColor:{ type: "color",  label: "Accent color",     default: "#6d28d9" },
    layout:     { type: "select", label: "Layout",           default: "centered", options: ["centered","card","split"] },
    infoHead:   { type: "text",   label: "Info column heading (split only)", default: "Contact us" },
    infoEmail:  { type: "text",   label: "Email address",    default: "hello@example.com" },
    infoPhone:  { type: "text",   label: "Phone number",     default: "+1 (555) 000-0000" },
    infoAddress:{ type: "text",   label: "Address",          default: "123 Main St, San Francisco CA" },
  },
  defaultProps: {
    heading: "Get in touch", sub: "We typically respond within 24 hours.",
    showSubject: true, btnLabel: "Send message",
    successMsg: "Thanks! We'll be in touch soon.",
    bgColor: "#ffffff", accentColor: "#6d28d9", layout: "centered",
    infoHead: "Contact us", infoEmail: "hello@example.com",
    infoPhone: "+1 (555) 000-0000", infoAddress: "123 Main St, San Francisco CA",
  },
  render(props) {
    const acc = cssColor(props["accentColor"], "#6d28d9");
    const layout = String(props["layout"] ?? "centered");
    const subjectField = props["showSubject"]
      ? `<div class="ps-cf-field"><label class="ps-cf-label">Subject</label><input type="text" class="ps-cf-input" placeholder="How can we help?" required></div>`
      : "";
    const form = `
  <div class="ps-cf-form-wrap">
    <div class="ps-cf-head">
      <h2>${e(props["heading"])}</h2>
      ${props["sub"] ? `<p>${e(props["sub"])}</p>` : ""}
    </div>
    <form class="ps-cf-form" onsubmit="event.preventDefault();this.hidden=true;this.nextElementSibling.hidden=false">
      <div class="ps-cf-row">
        <div class="ps-cf-field"><label class="ps-cf-label">Name *</label><input type="text" class="ps-cf-input" placeholder="Your name" required></div>
        <div class="ps-cf-field"><label class="ps-cf-label">Email *</label><input type="email" class="ps-cf-input" placeholder="you@example.com" required></div>
      </div>
      ${subjectField}
      <div class="ps-cf-field"><label class="ps-cf-label">Message *</label><textarea class="ps-cf-input ps-cf-ta" placeholder="Tell us more…" rows="5" required></textarea></div>
      <button type="submit" class="ps-cf-btn" style="background:${acc}">${e(props["btnLabel"])}</button>
    </form>
    <div class="ps-cf-ok" hidden><span>&#10003;</span> ${e(props["successMsg"])}</div>
  </div>`;
    const info = layout === "split" ? `
  <div class="ps-cf-info">
    <h3>${e(props["infoHead"])}</h3>
    ${props["infoEmail"] ? `<div class="ps-cf-info-item"><span>&#9993;</span> <a href="mailto:${e(props["infoEmail"])}">${e(props["infoEmail"])}</a></div>` : ""}
    ${props["infoPhone"] ? `<div class="ps-cf-info-item"><span>&#128222;</span> <span>${e(props["infoPhone"])}</span></div>` : ""}
    ${props["infoAddress"] ? `<div class="ps-cf-info-item"><span>&#128205;</span> <span>${e(props["infoAddress"])}</span></div>` : ""}
  </div>` : "";
    const isCard = layout === "card";
    const isSplit = layout === "split";
    return `<section class="ps-cf" style="background:${cssColor(props["bgColor"])}">
  <div class="ps-cf-inner${isSplit ? " ps-cf-split" : isCard ? " ps-cf-card" : ""}">
    ${isSplit ? info : ""}
    ${form}
  </div>
</section>`;
  },
  styles: `
.ps-cf{padding:clamp(3rem,7vw,5.5rem) 1.25rem}
.ps-cf-inner{max-width:640px;margin:0 auto}
.ps-cf-card{background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:20px;padding:2.5rem;box-shadow:0 8px 32px -8px rgba(15,23,42,.1)}
.ps-cf-split{max-width:1050px;display:grid;grid-template-columns:1fr 1.5fr;gap:3rem;align-items:start}
.ps-cf-info h3{font-size:1.2rem;font-weight:800;margin:0 0 1.5rem}
.ps-cf-info-item{display:flex;align-items:flex-start;gap:.65rem;font-size:.9rem;margin-bottom:1rem;color:#475569}
.ps-cf-info-item a{color:inherit;text-decoration:none}.ps-cf-info-item a:hover{color:#6d28d9}
.ps-cf-form-wrap{min-width:0}
.ps-cf-head h2{font-size:clamp(1.4rem,3vw,2rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .4rem}
.ps-cf-head p{color:#64748b;font-size:.9rem;margin:0 0 1.5rem;line-height:1.6}
.ps-cf-row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.ps-cf-field{margin-bottom:.85rem}
.ps-cf-label{display:block;font-size:.75rem;font-weight:700;margin-bottom:.3rem;color:#0f172a}
.ps-cf-input{width:100%;padding:.65rem .8rem;border:1px solid #e2e8f0;border-radius:9px;font-size:.9rem;font-family:inherit;min-height:44px;transition:border-color .15s,box-shadow .15s;background:#fff;color:#0f172a}
.ps-cf-input:focus{outline:none;border-color:#6d28d9;box-shadow:0 0 0 3px rgba(109,40,217,.16)}
.ps-cf-ta{min-height:120px;resize:vertical}
.ps-cf-btn{width:100%;padding:.8rem 1.25rem;border:none;border-radius:10px;font-size:.92rem;font-weight:700;color:#fff;cursor:pointer;min-height:48px;transition:filter .15s;margin-top:.25rem}
.ps-cf-btn:hover{filter:brightness(1.12)}
.ps-cf-ok{padding:1.25rem;border-radius:12px;background:rgba(22,163,74,.1);color:#16a34a;font-weight:700;font-size:.92rem;display:flex;align-items:center;gap:.6rem}
@media(max-width:640px){.ps-cf-row{grid-template-columns:1fr}.ps-cf-split{grid-template-columns:1fr}}`,
};
