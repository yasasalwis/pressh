import type { ComponentDef } from "../types.js";
import { cssColor } from "./utils.js";

export const spacerComponent: ComponentDef = {
  id: "spacer",
  name: "Spacer",
  category: "layout",
  description: "Vertical space between components",
  icon: "↕️",
  props: {
    height:  { type: "number", label: "Height (px)", default: 60,  min: 8, max: 400 },
    bgColor: { type: "color",  label: "Background",  default: "transparent" },
    divider: { type: "boolean",label: "Show divider",default: false },
  },
  defaultProps: { height: 60, bgColor: "transparent", divider: false },
  render(props) {
    const h = Number(props["height"] ?? 60);
    const line = props["divider"] ? '<hr style="border:none;border-top:1px solid rgba(15,23,42,.1);margin:0">' : "";
    return `<div class="ps-spacer" style="height:${h}px;background:${cssColor(props["bgColor"], "transparent")};display:flex;align-items:center">${line}</div>`;
  },
};
