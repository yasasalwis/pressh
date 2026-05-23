import type { ComponentDef } from "../types.js";
import { e } from "./utils.js";

export const faqListComponent: ComponentDef = {
  id: "faq-list",
  name: "FAQ / Accordion",
  category: "content",
  description: "Expandable questions & answers — no JavaScript required",
  icon: "❓",
  props: {
    heading:   { type: "text",   label: "Section heading",  default: "Frequently asked questions" },
    sub:       { type: "text",   label: "Subheading",       default: "Everything you need to know." },
    q1:        { type: "text",   label: "Question 1",       default: "Is Pressh free to use?" },
    a1:        { type: "richtext",label: "Answer 1",        default: "Yes! Pressh has a generous free tier that covers most personal projects and small websites." },
    q2:        { type: "text",   label: "Question 2",       default: "How is Pressh different from WordPress?" },
    a2:        { type: "richtext",label: "Answer 2",        default: "Pressh runs plugins in isolated sandboxes — a compromised plugin can't access your database or execute server code. WordPress has no such isolation." },
    q3:        { type: "text",   label: "Question 3",       default: "Can I migrate my existing content?" },
    a3:        { type: "richtext",label: "Answer 3",        default: "We provide importers for WordPress XML exports, Ghost JSON exports, and Contentful. Custom importers can be built with our SDK." },
    q4:        { type: "text",   label: "Question 4",       default: "Do I need to know how to code?" },
    a4:        { type: "richtext",label: "Answer 4",        default: "Not at all. The Studio provides a no-code drag-and-drop page builder and a visual content modeller. Developers can extend via the plugin SDK." },
    q5:        { type: "text",   label: "Question 5",       default: "What databases are supported?" },
    a5:        { type: "richtext",label: "Answer 5",        default: "Out of the box: SQLite, PostgreSQL, and MongoDB via storage adapters. The adapter interface makes it easy to add any database." },
    q6:        { type: "text",   label: "Question 6 (optional)", default: "" },
    a6:        { type: "richtext",label: "Answer 6",        default: "" },
    bgColor:   { type: "color",  label: "Background",       default: "#ffffff" },
    accentColor:{ type: "color", label: "Accent color",     default: "#6d28d9" },
    maxWidth:  { type: "number", label: "Max width (px)",   default: 760, min: 400, max: 1200 },
  },
  defaultProps: {
    heading: "Frequently asked questions", sub: "Everything you need to know.",
    q1: "Is Pressh free to use?",            a1: "Yes! Pressh has a generous free tier that covers most personal projects and small websites.",
    q2: "How is Pressh different from WordPress?", a2: "Pressh runs plugins in isolated sandboxes — a compromised plugin can't access your database or execute server code. WordPress has no such isolation.",
    q3: "Can I migrate my existing content?",a3: "We provide importers for WordPress XML exports, Ghost JSON exports, and Contentful. Custom importers can be built with our SDK.",
    q4: "Do I need to know how to code?",    a4: "Not at all. The Studio provides a no-code drag-and-drop page builder and a visual content modeller. Developers can extend via the plugin SDK.",
    q5: "What databases are supported?",     a5: "Out of the box: SQLite, PostgreSQL, and MongoDB via storage adapters. The adapter interface makes it easy to add any database.",
    q6: "", a6: "",
    bgColor: "#ffffff", accentColor: "#6d28d9", maxWidth: 760,
  },
  render(props) {
    const acc = e(props["accentColor"]);
    const w   = Number(props["maxWidth"] ?? 760);
    const items = [1,2,3,4,5,6]
      .filter(i => props[`q${i}`])
      .map(i => `<details class="ps-fq-item">
  <summary class="ps-fq-q" style="--fq-acc:${acc}">${e(props[`q${i}`])}<span class="ps-fq-icon">+</span></summary>
  <div class="ps-fq-a">${props[`a${i}`] ?? ""}</div>
</details>`).join("");
    return `<section class="ps-fq" style="background:${e(props["bgColor"])}">
  <div class="ps-fq-inner" style="max-width:${w}px">
    <div class="ps-fq-head">
      <h2>${e(props["heading"])}</h2>
      ${props["sub"] ? `<p>${e(props["sub"])}</p>` : ""}
    </div>
    ${items}
  </div>
</section>`;
  },
  styles: `
.ps-fq{padding:clamp(3rem,7vw,5.5rem) 1.25rem}
.ps-fq-inner{margin:0 auto}
.ps-fq-head{text-align:center;margin-bottom:clamp(1.5rem,4vw,3rem)}
.ps-fq-head h2{font-size:clamp(1.5rem,3.5vw,2.2rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .5rem}
.ps-fq-head p{color:#64748b;font-size:.95rem;margin:0}
.ps-fq-item{border-bottom:1px solid rgba(15,23,42,.08);overflow:hidden}
.ps-fq-q{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.1rem .25rem;font-size:.97rem;font-weight:700;cursor:pointer;list-style:none;line-height:1.4;color:#0f172a;user-select:none}
.ps-fq-q::-webkit-details-marker{display:none}
.ps-fq-q:hover{color:var(--fq-acc,#6d28d9)}
.ps-fq-icon{font-size:1.1rem;font-weight:400;flex-shrink:0;transition:transform .2s;color:var(--fq-acc,#6d28d9)}
details[open] .ps-fq-icon{transform:rotate(45deg)}
.ps-fq-a{padding:.1rem .25rem 1.1rem;color:#475569;font-size:.9rem;line-height:1.7}
.ps-fq-a p{margin:0 0 .75em}
.ps-fq-a p:last-child{margin:0}`,
};
