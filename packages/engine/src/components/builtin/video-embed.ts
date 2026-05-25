import type { ComponentDef } from "../types.js";
import { e, safeUrl, cssColor } from "./utils.js";

function youtubeId(url: string): string {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? (m[1] ?? "") : "";
}
function vimeoId(url: string): string {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? (m[1] ?? "") : "";
}

export const videoEmbedComponent: ComponentDef = {
  id: "video-embed",
  name: "Video Embed",
  category: "media",
  description: "Responsive YouTube or Vimeo embed with optional caption",
  icon: "▶️",
  props: {
    url:       { type: "text",   label: "Video URL",        default: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", placeholder: "YouTube or Vimeo URL" },
    caption:   { type: "text",   label: "Caption",          default: "" },
    aspectRatio:{ type: "select",label: "Aspect ratio",     default: "16:9", options: ["16:9","4:3","1:1","9:16"] },
    maxWidth:  { type: "number", label: "Max width (px)",   default: 900, min: 300, max: 1400 },
    bgColor:   { type: "color",  label: "Background",       default: "#0f172a" },
    rounded:   { type: "boolean",label: "Rounded corners",  default: true },
    shadow:    { type: "boolean",label: "Drop shadow",      default: true },
  },
  defaultProps: {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", caption: "",
    aspectRatio: "16:9", maxWidth: 900, bgColor: "#0f172a", rounded: true, shadow: true,
  },
  render(props) {
    const url = String(props["url"] ?? "");
    const ratioMap: Record<string,string> = { "16:9":"56.25%","4:3":"75%","1:1":"100%","9:16":"177.78%" };
    const ratio = ratioMap[String(props["aspectRatio"] ?? "16:9")] ?? "56.25%";
    const radius = props["rounded"] ? "border-radius:14px;overflow:hidden;" : "";
    const shadow  = props["shadow"]  ? "box-shadow:0 24px 60px -16px rgba(0,0,0,.5);" : "";
    let src = "";
    const ytId = youtubeId(url);
    const viId = vimeoId(url);
    if (ytId) src = `https://www.youtube-nocookie.com/embed/${ytId}?rel=0`;
    else if (viId) src = `https://player.vimeo.com/video/${viId}`;
    else src = safeUrl(url);
    return `<section class="ps-ve" style="background:${cssColor(props["bgColor"], "#0f172a")}">
  <div class="ps-ve-inner" style="max-width:${Number(props["maxWidth"] ?? 900)}px">
    <div class="ps-ve-wrap" style="padding-bottom:${ratio};${radius}${shadow}">
      ${src ? `<iframe src="${e(src)}" title="Video" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;web-share" allowfullscreen loading="lazy"></iframe>` : '<div class="ps-ve-nourl">Enter a YouTube or Vimeo URL in the properties panel</div>'}
    </div>
    ${props["caption"] ? `<p class="ps-ve-caption">${e(props["caption"])}</p>` : ""}
  </div>
</section>`;
  },
  styles: `
.ps-ve{padding:clamp(2.5rem,6vw,5rem) 1.25rem}
.ps-ve-inner{margin:0 auto}
.ps-ve-wrap{position:relative;width:100%;height:0;background:#000}
.ps-ve-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:none}
.ps-ve-nourl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:.88rem;background:#1e293b;border-radius:inherit}
.ps-ve-caption{text-align:center;color:#94a3b8;font-size:.85rem;margin:.85rem 0 0}`,
};
