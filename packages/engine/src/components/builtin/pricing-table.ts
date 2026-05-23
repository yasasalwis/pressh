import type { ComponentDef } from "../types.js";
import { e, safeUrl } from "./utils.js";

function tier(
  name: unknown, price: unknown, period: unknown, desc: unknown,
  features: string, cta: unknown, ctaUrl: unknown,
  highlight: boolean, highlightColor: string,
): string {
  const border = highlight ? `border-color:${highlightColor};box-shadow:0 20px 60px -16px ${highlightColor}55;` : "";
  const badge  = highlight ? `<div class="ps-pt-badge" style="background:${highlightColor}">Most popular</div>` : "";
  return `<div class="ps-pt-tier${highlight ? " ps-pt-featured" : ""}" style="${border}">
    ${badge}
    <div class="ps-pt-name">${e(name)}</div>
    <div class="ps-pt-price"><span class="ps-pt-amount">${e(price)}</span><span class="ps-pt-per">/${e(period)}</span></div>
    <p class="ps-pt-desc">${e(desc)}</p>
    <ul class="ps-pt-features">${features}</ul>
    <a href="${e(safeUrl(ctaUrl))}" class="ps-pt-cta${highlight ? " ps-pt-cta-hi" : ""}" style="${highlight ? `background:${highlightColor}` : ""}">${e(cta)}</a>
  </div>`;
}

export const pricingTableComponent: ComponentDef = {
  id: "pricing-table",
  name: "Pricing Table",
  category: "content",
  description: "3-tier pricing cards with feature lists and CTAs",
  icon: "💳",
  props: {
    heading:     { type: "text",   label: "Section heading",    default: "Simple, transparent pricing" },
    sub:         { type: "text",   label: "Section subheading", default: "No hidden fees. Cancel any time." },
    period:      { type: "select", label: "Billing period",     default: "month", options: ["month","year"] },
    bgColor:     { type: "color",  label: "Background",         default: "#f6f7fb" },
    accentColor: { type: "color",  label: "Featured accent",    default: "#6d28d9" },
    // Tier 1
    t1Name:      { type: "text",   label: "Tier 1 name",        default: "Starter" },
    t1Price:     { type: "text",   label: "Tier 1 price",       default: "Free" },
    t1Desc:      { type: "text",   label: "Tier 1 description", default: "Perfect for personal projects." },
    t1Features:  { type: "richtext",label:"Tier 1 features (one per line)", default: "1 site\n5 pages\nCommunity support\n1 GB storage" },
    t1Cta:       { type: "text",   label: "Tier 1 CTA",         default: "Get started free" },
    t1CtaUrl:    { type: "text",   label: "Tier 1 CTA URL",     default: "#" },
    // Tier 2 (featured)
    t2Name:      { type: "text",   label: "Tier 2 name",        default: "Pro" },
    t2Price:     { type: "text",   label: "Tier 2 price",       default: "$29" },
    t2Desc:      { type: "text",   label: "Tier 2 description", default: "For growing teams and businesses." },
    t2Features:  { type: "richtext",label:"Tier 2 features (one per line)", default: "Unlimited sites\nUnlimited pages\nPriority support\n100 GB storage\nCustom domain\nAnalytics" },
    t2Cta:       { type: "text",   label: "Tier 2 CTA",         default: "Start free trial" },
    t2CtaUrl:    { type: "text",   label: "Tier 2 CTA URL",     default: "#" },
    // Tier 3
    t3Name:      { type: "text",   label: "Tier 3 name",        default: "Enterprise" },
    t3Price:     { type: "text",   label: "Tier 3 price",       default: "Custom" },
    t3Desc:      { type: "text",   label: "Tier 3 description", default: "Tailored for large organisations." },
    t3Features:  { type: "richtext",label:"Tier 3 features (one per line)", default: "Everything in Pro\nSSO / SAML\nSLA guarantee\nDedicated support\nCustom integrations" },
    t3Cta:       { type: "text",   label: "Tier 3 CTA",         default: "Contact sales" },
    t3CtaUrl:    { type: "text",   label: "Tier 3 CTA URL",     default: "/contact" },
  },
  defaultProps: {
    heading: "Simple, transparent pricing", sub: "No hidden fees. Cancel any time.", period: "month",
    bgColor: "#f6f7fb", accentColor: "#6d28d9",
    t1Name: "Starter", t1Price: "Free",  t1Desc: "Perfect for personal projects.",           t1Features: "1 site\n5 pages\nCommunity support\n1 GB storage",                            t1Cta: "Get started free",  t1CtaUrl: "#",
    t2Name: "Pro",     t2Price: "$29",   t2Desc: "For growing teams and businesses.",        t2Features: "Unlimited sites\nUnlimited pages\nPriority support\n100 GB storage\nCustom domain\nAnalytics", t2Cta: "Start free trial",  t2CtaUrl: "#",
    t3Name: "Enterprise", t3Price: "Custom", t3Desc: "Tailored for large organisations.", t3Features: "Everything in Pro\nSSO / SAML\nSLA guarantee\nDedicated support\nCustom integrations", t3Cta: "Contact sales", t3CtaUrl: "/contact",
  },
  render(props) {
    const acc = e(props["accentColor"] as string ?? "#6d28d9");
    const period = String(props["period"] ?? "month");
    function features(raw: unknown): string {
      return String(raw ?? "").split("\n").filter(Boolean).map(f => `<li>&#10003; ${e(f.trim())}</li>`).join("");
    }
    return `<section class="ps-pt" style="background:${e(props["bgColor"])}">
  <div class="ps-pt-inner">
    <div class="ps-pt-head">
      <h2>${e(props["heading"])}</h2>
      <p>${e(props["sub"])}</p>
    </div>
    <div class="ps-pt-grid">
      ${tier(props["t1Name"],props["t1Price"],period,props["t1Desc"],features(props["t1Features"]),props["t1Cta"],props["t1CtaUrl"],false,acc)}
      ${tier(props["t2Name"],props["t2Price"],period,props["t2Desc"],features(props["t2Features"]),props["t2Cta"],props["t2CtaUrl"],true,acc)}
      ${tier(props["t3Name"],props["t3Price"],period,props["t3Desc"],features(props["t3Features"]),props["t3Cta"],props["t3CtaUrl"],false,acc)}
    </div>
  </div>
</section>`;
  },
  styles: `
.ps-pt{padding:clamp(3rem,7vw,6rem) 1.25rem}
.ps-pt-inner{max-width:1100px;margin:0 auto}
.ps-pt-head{text-align:center;margin-bottom:clamp(2rem,4vw,3.5rem)}
.ps-pt-head h2{font-size:clamp(1.6rem,3.5vw,2.4rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .5rem}
.ps-pt-head p{color:#64748b;font-size:1rem;margin:0}
.ps-pt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;align-items:start}
.ps-pt-tier{background:#fff;border:2px solid rgba(15,23,42,.08);border-radius:20px;padding:2rem;position:relative;overflow:hidden;transition:transform .2s,box-shadow .2s}
.ps-pt-tier:hover{transform:translateY(-4px)}
.ps-pt-featured{transform:scale(1.03)}
.ps-pt-featured:hover{transform:scale(1.03) translateY(-4px)}
.ps-pt-badge{position:absolute;top:1.25rem;right:1.25rem;font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#fff;padding:.2rem .6rem;border-radius:999px}
.ps-pt-name{font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:.6rem}
.ps-pt-price{display:flex;align-items:baseline;gap:.2rem;margin-bottom:.65rem}
.ps-pt-amount{font-size:clamp(2rem,4vw,2.8rem);font-weight:900;letter-spacing:-.04em;color:#0f172a}
.ps-pt-per{font-size:.85rem;color:#64748b}
.ps-pt-desc{font-size:.88rem;color:#64748b;margin:0 0 1.25rem;line-height:1.55}
.ps-pt-features{list-style:none;padding:0;margin:0 0 1.75rem;display:flex;flex-direction:column;gap:.5rem}
.ps-pt-features li{font-size:.88rem;color:#334155;display:flex;align-items:flex-start;gap:.5rem}
.ps-pt-cta{display:block;text-align:center;text-decoration:none;font-size:.88rem;font-weight:700;padding:.8rem 1.25rem;border-radius:10px;border:2px solid rgba(15,23,42,.14);color:#0f172a;min-height:44px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.ps-pt-cta:hover{border-color:#6d28d9;color:#6d28d9}
.ps-pt-cta-hi{color:#fff;border-color:transparent}
.ps-pt-cta-hi:hover{filter:brightness(1.12);color:#fff}
@media(max-width:900px){.ps-pt-grid{grid-template-columns:1fr}.ps-pt-featured{transform:none}.ps-pt-tier:hover{transform:none}}`,
};
