import type { ComponentDef } from "../types.js";
import { e } from "./utils.js";

export const newsletterSignupComponent: ComponentDef = {
  id: "newsletter-signup",
  name: "Newsletter Signup",
  category: "content",
  description: "Email capture form with heading, subtext and privacy note",
  icon: "📧",
  props: {
    heading:    { type: "text",   label: "Heading",         default: "Stay in the loop" },
    sub:        { type: "text",   label: "Subheading",      default: "Get the latest on security, releases and tips — no spam, ever." },
    btnLabel:   { type: "text",   label: "Button label",    default: "Subscribe" },
    placeholder:{ type: "text",   label: "Input placeholder",default: "you@example.com" },
    privacy:    { type: "text",   label: "Privacy note",    default: "We respect your privacy. Unsubscribe at any time." },
    layout:     { type: "select", label: "Layout",          default: "center", options: ["center","left","card"] },
    bgColor:    { type: "color",  label: "Background",      default: "#f6f7fb" },
    accentColor:{ type: "color",  label: "Button color",    default: "#6d28d9" },
  },
  defaultProps: {
    heading: "Stay in the loop",
    sub: "Get the latest on security, releases and tips — no spam, ever.",
    btnLabel: "Subscribe", placeholder: "you@example.com",
    privacy: "We respect your privacy. Unsubscribe at any time.",
    layout: "center", bgColor: "#f6f7fb", accentColor: "#6d28d9",
  },
  render(props) {
    const layout = String(props["layout"] ?? "center");
    const isCard = layout === "card";
    const align  = layout === "left" ? "left" : "center";
    const acc = e(props["accentColor"]);
    const inner = `
    <h2 class="ps-nl-h">${e(props["heading"])}</h2>
    <p class="ps-nl-sub">${e(props["sub"])}</p>
    <form class="ps-nl-form" onsubmit="event.preventDefault();this.querySelector('input').value='';this.insertAdjacentHTML('afterend','<p class=ps-nl-ok>&#10003; You\\'re subscribed!</p>');this.remove()">
      <input type="email" placeholder="${e(props["placeholder"])}" required class="ps-nl-input" autocomplete="email">
      <button type="submit" class="ps-nl-btn" style="background:${acc}">${e(props["btnLabel"])}</button>
    </form>
    ${props["privacy"] ? `<p class="ps-nl-privacy">${e(props["privacy"])}</p>` : ""}`;
    return isCard
      ? `<section class="ps-nl" style="background:${e(props["bgColor"])}"><div class="ps-nl-inner ps-nl-card">${inner}</div></section>`
      : `<section class="ps-nl" style="background:${e(props["bgColor"])};text-align:${align}"><div class="ps-nl-inner">${inner}</div></section>`;
  },
  styles: `
.ps-nl{padding:clamp(3rem,7vw,5.5rem) 1.25rem}
.ps-nl-inner{max-width:560px;margin:0 auto}
.ps-nl-card{background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:20px;padding:2.5rem;box-shadow:0 8px 30px -8px rgba(15,23,42,.1)}
.ps-nl-h{font-size:clamp(1.4rem,3.5vw,2rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .5rem}
.ps-nl-sub{color:#64748b;font-size:.9rem;line-height:1.65;margin:0 0 1.5rem}
.ps-nl-form{display:flex;gap:.5rem;flex-wrap:wrap}
.ps-nl-input{flex:1;min-width:200px;padding:.7rem .9rem;border:1px solid #e2e8f0;border-radius:10px;font-size:.9rem;font-family:inherit;min-height:44px}
.ps-nl-input:focus{outline:none;border-color:#6d28d9;box-shadow:0 0 0 3px rgba(109,40,217,.18)}
.ps-nl-btn{padding:.7rem 1.3rem;border:none;border-radius:10px;font-size:.9rem;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap;min-height:44px;transition:filter .15s}
.ps-nl-btn:hover{filter:brightness(1.12)}
.ps-nl-privacy{font-size:.73rem;color:#94a3b8;margin:.75rem 0 0;line-height:1.5}
.ps-nl-ok{font-size:.92rem;font-weight:700;color:#16a34a;margin:.75rem 0 0}`,
};
