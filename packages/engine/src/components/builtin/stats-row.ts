import type { ComponentDef } from "../types.js";
import { e } from "./utils.js";

function stat(val: unknown, label: unknown): string {
  return `<div class="ps-sr-stat"><div class="ps-sr-num">${e(val)}</div><div class="ps-sr-lbl">${e(label)}</div></div>`;
}

export const statsRowComponent: ComponentDef = {
  id: "stats-row",
  name: "Stats Row",
  category: "content",
  description: "Row of 3–4 key statistics with large numbers",
  icon: "📊",
  props: {
    val1:      { type: "text",  label: "Stat 1 value",   default: "10k+" },
    label1:    { type: "text",  label: "Stat 1 label",   default: "Active sites" },
    val2:      { type: "text",  label: "Stat 2 value",   default: "99.9%" },
    label2:    { type: "text",  label: "Stat 2 label",   default: "Uptime SLA" },
    val3:      { type: "text",  label: "Stat 3 value",   default: "0" },
    label3:    { type: "text",  label: "Stat 3 label",   default: "Known breaches" },
    val4:      { type: "text",  label: "Stat 4 value",   default: "< 100ms" },
    label4:    { type: "text",  label: "Stat 4 label",   default: "Avg page load" },
    bgColor:   { type: "color", label: "Background",     default: "#0f172a" },
    textColor: { type: "color", label: "Number color",   default: "#6d28d9" },
  },
  defaultProps: {
    val1: "10k+", label1: "Active sites",
    val2: "99.9%", label2: "Uptime SLA",
    val3: "0", label3: "Known breaches",
    val4: "< 100ms", label4: "Avg page load",
    bgColor: "#0f172a",
    textColor: "#6d28d9",
  },
  render(props) {
    return `<section class="ps-sr" style="background:${e(props["bgColor"])}">
  <div class="ps-sr-inner" style="--sr-accent:${e(props["textColor"])}">
    ${stat(props["val1"], props["label1"])}
    ${stat(props["val2"], props["label2"])}
    ${stat(props["val3"], props["label3"])}
    ${stat(props["val4"], props["label4"])}
  </div>
</section>`;
  },
  styles: `
.ps-sr{padding:3.5rem 1.5rem}
.ps-sr-inner{max-width:1000px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:1.5rem}
@media(max-width:640px){.ps-sr-inner{grid-template-columns:repeat(2,1fr)}}
.ps-sr-stat{text-align:center;padding:1.2rem}
.ps-sr-num{font-size:clamp(2rem,5vw,3rem);font-weight:900;color:var(--sr-accent);letter-spacing:-.03em;line-height:1}
.ps-sr-lbl{font-size:.88rem;color:rgba(255,255,255,.65);margin-top:.4rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}`,
};
