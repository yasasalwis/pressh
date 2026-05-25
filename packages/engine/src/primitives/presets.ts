/**
 * Presets: the former "components" re-expressed as editable primitive trees.
 *
 * A preset is a template (PrimitiveNode[]). The studio deep-clones it with fresh
 * ids on drop (`instantiatePreset`), after which every node is a normal,
 * individually-editable primitive — there is no remaining "Hero component".
 * Brand-able colours/fonts reference theme tokens (token:* → var(--*)).
 */
import type {
  Binding,
  PrimitiveNode,
  PrimitiveType,
  ResponsiveStyles,
  StateStyles,
  StyleProps,
} from "./types.js";

export interface PresetDef {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  template: PrimitiveNode[];
}

// ── tiny builders ─────────────────────────────────────────────────────────────
interface NodeInit {
  props?: Record<string, unknown>;
  bindings?: Record<string, Binding>;
  styles?: ResponsiveStyles;
  children?: PrimitiveNode[];
}
function n(id: string, type: PrimitiveType, init: NodeInit = {}): PrimitiveNode {
  const node: PrimitiveNode = { id, type };
  if (init.props) node.props = init.props;
  if (init.bindings) node.bindings = init.bindings;
  if (init.styles) node.styles = init.styles;
  if (init.children) node.children = init.children;
  return node;
}

interface StyleExtra {
  hover?: StyleProps;
  tablet?: StyleProps;
  mobile?: StyleProps;
}
function st(d: StyleProps, extra: StyleExtra = {}): ResponsiveStyles {
  const baseState: StateStyles = { default: d };
  if (extra.hover) baseState.hover = extra.hover;
  const r: ResponsiveStyles = { base: baseState };
  if (extra.tablet) r.tablet = { default: extra.tablet };
  if (extra.mobile) r.mobile = { default: extra.mobile };
  return r;
}

const MUTED = "#64748b";
const SURFACE_BORDER = "#e2e8f0";

/** Deep-clones a template, assigning a fresh id to every node. */
export function cloneWithNewIds(nodes: PrimitiveNode[], genId: () => string): PrimitiveNode[] {
  const clone = (node: PrimitiveNode): PrimitiveNode => {
    const copy: PrimitiveNode = { id: genId(), type: node.type };
    if (node.props) copy.props = { ...node.props };
    if (node.bindings) copy.bindings = { ...node.bindings };
    if (node.styles) copy.styles = JSON.parse(JSON.stringify(node.styles)) as ResponsiveStyles;
    if (node.children) copy.children = node.children.map(clone);
    return copy;
  };
  return nodes.map(clone);
}

export function instantiatePreset(preset: PresetDef, genId: () => string): PrimitiveNode[] {
  return cloneWithNewIds(preset.template, genId);
}

// common style fragments
const HEADING = (size: string): ResponsiveStyles =>
  st({ fontSize: size, fontWeight: "800", color: "token:colorText", fontFamily: "token:fontHeading", letterSpacing: "-0.02em", lineHeight: "1.15" });
const BODY = st({ color: MUTED, lineHeight: "1.7", fontSize: "1rem" });
const PRIMARY_BTN = st(
  { background: "token:colorPrimary", color: "#ffffff", paddingTop: "0.8rem", paddingBottom: "0.8rem", paddingLeft: "1.6rem", paddingRight: "1.6rem", borderRadius: "10px", fontWeight: "700" },
  { hover: { opacity: "0.9" } },
);
const CARD = st({ background: "#ffffff", borderWidth: "1px", borderStyle: "solid", borderColor: SURFACE_BORDER, borderRadius: "16px", paddingTop: "1.75rem", paddingBottom: "1.75rem", paddingLeft: "1.75rem", paddingRight: "1.75rem", gap: "0.75rem" });
const SECTION = (bg?: string): ResponsiveStyles =>
  st({ paddingTop: "5rem", paddingBottom: "5rem", ...(bg ? { background: bg } : {}) });

function heading(id: string, text: string, size = "2rem", level = 2): PrimitiveNode {
  return n(id, "heading", { props: { text, level }, styles: HEADING(size) });
}
function body(id: string, text: string, styles: ResponsiveStyles = BODY): PrimitiveNode {
  return n(id, "text", { props: { text }, styles });
}
function primaryBtn(id: string, label: string, href = "#"): PrimitiveNode {
  return n(id, "button", { props: { label, href }, styles: PRIMARY_BTN });
}
function icon(id: string, name: string): PrimitiveNode {
  return n(id, "icon", { props: { name }, styles: st({ color: "token:colorPrimary", width: "2.25rem", height: "2.25rem" }) });
}
function container(id: string, children: PrimitiveNode[], styles?: ResponsiveStyles): PrimitiveNode {
  // The engine no longer bakes horizontal padding into the container base CSS
  // (so bare primitives stay flush), so presets carry their own gutter here.
  const gutter: StyleProps = { paddingLeft: "1.5rem", paddingRight: "1.5rem" };
  const merged: ResponsiveStyles = {
    ...styles,
    base: { ...styles?.base, default: { ...gutter, ...(styles?.base?.default ?? {}) } },
  };
  return n(id, "container", { styles: merged, children });
}

// repeats a card builder n times with sample copy
function repeat<T>(count: number, fn: (i: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => fn(i));
}

// ── presets ────────────────────────────────────────────────────────────────
export const PRESETS: PresetDef[] = [
  {
    id: "hero",
    name: "Hero",
    icon: "🦸",
    category: "Hero & CTA",
    description: "Full-width headline with call-to-action buttons",
    template: [
      n("hero-sec", "section", {
        styles: st({ paddingTop: "7rem", paddingBottom: "7rem", background: "token:colorPrimary" }),
        children: [
          container("hero-cont", [
            n("hero-col", "column", {
              styles: st({ gap: "1.4rem", alignItems: "center", textAlign: "center", maxWidth: "780px", marginLeft: "auto", marginRight: "auto" }),
              children: [
                n("hero-badge", "text", { props: { text: "New · v2.0 is here" }, styles: st({ color: "#ffffff", opacity: "0.85", fontWeight: "700", letterSpacing: "0.06em", fontSize: "0.8rem" }) }),
                n("hero-h", "heading", { props: { text: "Build something amazing", level: 1 }, styles: st({ fontSize: "3.25rem", fontWeight: "900", color: "#ffffff", fontFamily: "token:fontHeading", letterSpacing: "-0.035em", lineHeight: "1.08" }, { mobile: { fontSize: "2.1rem" } }) }),
                n("hero-sub", "text", { props: { text: "A beautiful, secure CMS for the modern web." }, styles: st({ color: "#ffffff", opacity: "0.9", fontSize: "1.2rem", lineHeight: "1.6" }) }),
                n("hero-actions", "row", {
                  styles: st({ gap: "0.85rem", justifyContent: "center" }, { mobile: { flexDirection: "column" } }),
                  children: [
                    n("hero-cta1", "button", { props: { label: "Get started", href: "#" }, styles: st({ background: "#ffffff", color: "token:colorPrimary", paddingTop: "0.85rem", paddingBottom: "0.85rem", paddingLeft: "2rem", paddingRight: "2rem", borderRadius: "50px", fontWeight: "700" }, { hover: { opacity: "0.92" } }) }),
                    n("hero-cta2", "button", { props: { label: "Learn more", href: "#" }, styles: st({ background: "transparent", color: "#ffffff", borderWidth: "2px", borderStyle: "solid", borderColor: "#ffffff", paddingTop: "0.85rem", paddingBottom: "0.85rem", paddingLeft: "2rem", paddingRight: "2rem", borderRadius: "50px", fontWeight: "700" }) }),
                  ],
                }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "feature-grid",
    name: "Feature Grid",
    icon: "🔲",
    category: "Features",
    description: "Grid of features, each with icon, title and text",
    template: [
      n("fg-sec", "section", {
        styles: SECTION(),
        children: [
          container("fg-cont", [
            n("fg-head", "column", {
              styles: st({ gap: "0.6rem", alignItems: "center", textAlign: "center", marginBottom: "3rem" }),
              children: [heading("fg-h", "Everything you need", "2.25rem"), body("fg-sub", "Powerful features that scale with your team.")],
            }),
            n("fg-grid", "grid", {
              styles: st({ gridTemplateColumns: "repeat(3,1fr)", gap: "1.5rem" }, { mobile: { gridTemplateColumns: "1fr" } }),
              children: repeat(3, (i) =>
                n(`fg-card-${i}`, "column", {
                  styles: CARD,
                  children: [
                    icon(`fg-icon-${i}`, ["zap", "shield", "globe"][i] ?? "star"),
                    heading(`fg-ct-${i}`, ["Fast", "Secure", "Global"][i] ?? "Feature", "1.15rem", 3),
                    body(`fg-cb-${i}`, "A concise description of this feature and the value it brings."),
                  ],
                }),
              ),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "columns",
    name: "Columns",
    icon: "▥",
    category: "Features",
    description: "Two columns with icon, heading and text",
    template: [
      n("cols-sec", "section", {
        styles: SECTION(),
        children: [
          container("cols-cont", [
            n("cols-grid", "grid", {
              styles: st({ gridTemplateColumns: "repeat(2,1fr)", gap: "2.5rem" }, { mobile: { gridTemplateColumns: "1fr" } }),
              children: repeat(2, (i) =>
                n(`cols-col-${i}`, "column", {
                  styles: st({ gap: "0.6rem" }),
                  children: [
                    icon(`cols-icon-${i}`, ["zap", "shield"][i] ?? "star"),
                    heading(`cols-h-${i}`, ["Move fast", "Stay secure"][i] ?? "Heading", "1.2rem", 3),
                    body(`cols-b-${i}`, "Deploy content changes instantly while every plugin runs sandboxed."),
                  ],
                }),
              ),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "two-col-feature",
    name: "Two-Column Feature",
    icon: "◧",
    category: "Features",
    description: "Text beside an image",
    template: [
      n("tcf-sec", "section", {
        styles: SECTION(),
        children: [
          container("tcf-cont", [
            n("tcf-row", "row", {
              styles: st({ gap: "3rem", alignItems: "center" }, { mobile: { flexDirection: "column" } }),
              children: [
                n("tcf-text", "column", {
                  styles: st({ gap: "1rem", width: "50%" }, { mobile: { width: "100%" } }),
                  children: [heading("tcf-h", "Designed for focus", "2rem"), body("tcf-b", "Everything is where you expect it. Spend time on content, not configuration."), primaryBtn("tcf-btn", "See how")],
                }),
                n("tcf-img", "image", { props: { src: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=900", alt: "Team collaborating" }, styles: st({ width: "50%", borderRadius: "16px" }, { mobile: { width: "100%" } }) }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "cta-banner",
    name: "CTA Banner",
    icon: "📣",
    category: "Hero & CTA",
    description: "Bold call-to-action strip",
    template: [
      n("cta-sec", "section", {
        styles: st({ paddingTop: "4.5rem", paddingBottom: "4.5rem", background: "token:colorPrimary" }),
        children: [
          container("cta-cont", [
            n("cta-col", "column", {
              styles: st({ gap: "1.1rem", alignItems: "center", textAlign: "center" }),
              children: [
                n("cta-h", "heading", { props: { text: "Ready to get started?", level: 2 }, styles: st({ fontSize: "2.25rem", fontWeight: "800", color: "#ffffff", fontFamily: "token:fontHeading", letterSpacing: "-0.02em" }) }),
                n("cta-sub", "text", { props: { text: "Join thousands of teams shipping with confidence." }, styles: st({ color: "#ffffff", opacity: "0.9", fontSize: "1.05rem" }) }),
                n("cta-btn", "button", { props: { label: "Start free", href: "#" }, styles: st({ background: "#ffffff", color: "token:colorPrimary", paddingTop: "0.85rem", paddingBottom: "0.85rem", paddingLeft: "2rem", paddingRight: "2rem", borderRadius: "50px", fontWeight: "700" }, { hover: { opacity: "0.92" } }) }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "testimonial",
    name: "Testimonial",
    icon: "💬",
    category: "Social proof",
    description: "Single quote with attribution",
    template: [
      n("tm-sec", "section", {
        styles: SECTION("#f8fafc"),
        children: [
          container("tm-cont", [
            n("tm-col", "column", {
              styles: st({ gap: "1.25rem", alignItems: "center", textAlign: "center", maxWidth: "720px", marginLeft: "auto", marginRight: "auto" }),
              children: [
                n("tm-quote", "text", { props: { text: "“This is the first CMS that hasn't gotten in our way. Secure by default and a joy to use.”" }, styles: st({ fontSize: "1.6rem", fontWeight: "600", color: "token:colorText", lineHeight: "1.5", fontFamily: "token:fontHeading" }) }),
                n("tm-author", "text", { props: { text: "Alex Rivera · CTO, Northwind" }, styles: st({ color: MUTED, fontWeight: "700", fontSize: "0.95rem" }) }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "pricing-table",
    name: "Pricing Table",
    icon: "💳",
    category: "Commerce",
    description: "Three pricing tiers",
    template: [
      n("pr-sec", "section", {
        styles: SECTION(),
        children: [
          container("pr-cont", [
            n("pr-head", "column", { styles: st({ gap: "0.5rem", alignItems: "center", textAlign: "center", marginBottom: "3rem" }), children: [heading("pr-h", "Simple pricing", "2.25rem"), body("pr-sub", "No hidden fees. Cancel anytime.")] }),
            n("pr-grid", "grid", {
              styles: st({ gridTemplateColumns: "repeat(3,1fr)", gap: "1.5rem" }, { mobile: { gridTemplateColumns: "1fr" } }),
              children: repeat(3, (i) => {
                const names = ["Starter", "Pro", "Scale"];
                const prices = ["$0", "$29", "$99"];
                return n(`pr-card-${i}`, "column", {
                  styles: CARD,
                  children: [
                    heading(`pr-name-${i}`, names[i] ?? "Plan", "1.2rem", 3),
                    n(`pr-price-${i}`, "heading", { props: { text: `${prices[i]}/mo`, level: 4 }, styles: st({ fontSize: "2rem", fontWeight: "900", color: "token:colorPrimary" }) }),
                    n(`pr-feats-${i}`, "list", {
                      props: { ordered: false },
                      styles: st({ color: MUTED, lineHeight: "1.9" }),
                      children: repeat(3, (j) => n(`pr-li-${i}-${j}`, "listItem", { props: { text: ["Unlimited pages", "Custom domain", "Priority support"][j] ?? "Feature" } })),
                    }),
                    primaryBtn(`pr-btn-${i}`, "Choose plan"),
                  ],
                });
              }),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "faq-list",
    name: "FAQ",
    icon: "❓",
    category: "Content",
    description: "List of questions and answers",
    template: [
      n("faq-sec", "section", {
        styles: SECTION(),
        children: [
          container("faq-cont", [
            n("faq-h", "heading", { props: { text: "Frequently asked questions", level: 2 }, styles: st({ ...{ fontSize: "2rem", fontWeight: "800", color: "token:colorText", fontFamily: "token:fontHeading" }, marginBottom: "2rem", textAlign: "center" }) }),
            n("faq-col", "column", {
              styles: st({ gap: "1.25rem", maxWidth: "760px", marginLeft: "auto", marginRight: "auto" }),
              children: repeat(3, (i) =>
                n(`faq-item-${i}`, "column", {
                  styles: st({ gap: "0.4rem", paddingBottom: "1.25rem", borderWidth: "1px", borderStyle: "solid", borderColor: "transparent" }),
                  children: [
                    heading(`faq-q-${i}`, ["Is my data secure?", "Can I self-host?", "Do plugins run safely?"][i] ?? "Question", "1.1rem", 3),
                    body(`faq-a-${i}`, "Yes — Pressh is secure by default and every plugin runs in an isolated sandbox."),
                  ],
                }),
              ),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "stats-row",
    name: "Stats Row",
    icon: "📊",
    category: "Social proof",
    description: "Row of headline numbers",
    template: [
      n("stat-sec", "section", {
        styles: SECTION("#f8fafc"),
        children: [
          container("stat-cont", [
            n("stat-grid", "grid", {
              styles: st({ gridTemplateColumns: "repeat(4,1fr)", gap: "1.5rem" }, { mobile: { gridTemplateColumns: "repeat(2,1fr)" } }),
              children: repeat(4, (i) =>
                n(`stat-col-${i}`, "column", {
                  styles: st({ gap: "0.25rem", alignItems: "center", textAlign: "center" }),
                  children: [
                    n(`stat-num-${i}`, "heading", { props: { text: ["10k+", "99.9%", "24/7", "50ms"][i] ?? "0", level: 3 }, styles: st({ fontSize: "2.5rem", fontWeight: "900", color: "token:colorPrimary" }) }),
                    body(`stat-lbl-${i}`, ["Active sites", "Uptime", "Support", "Response"][i] ?? "Label", st({ color: MUTED, fontSize: "0.9rem", fontWeight: "600" })),
                  ],
                }),
              ),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "team-grid",
    name: "Team Grid",
    icon: "👥",
    category: "Social proof",
    description: "Grid of team members",
    template: [
      n("team-sec", "section", {
        styles: SECTION(),
        children: [
          container("team-cont", [
            n("team-h", "heading", { props: { text: "Meet the team", level: 2 }, styles: st({ fontSize: "2.25rem", fontWeight: "800", color: "token:colorText", fontFamily: "token:fontHeading", textAlign: "center", marginBottom: "2.5rem" }) }),
            n("team-grid", "grid", {
              styles: st({ gridTemplateColumns: "repeat(4,1fr)", gap: "1.5rem" }, { mobile: { gridTemplateColumns: "repeat(2,1fr)" } }),
              children: repeat(4, (i) =>
                n(`team-card-${i}`, "column", {
                  styles: st({ gap: "0.5rem", alignItems: "center", textAlign: "center" }),
                  children: [
                    n(`team-img-${i}`, "image", { props: { src: `https://i.pravatar.cc/200?img=${i + 10}`, alt: "Team member" }, styles: st({ width: "96px", height: "96px", borderRadius: "999px" }) }),
                    heading(`team-name-${i}`, ["Sam Lee", "Jo Park", "Max Cho", "Ada Kim"][i] ?? "Name", "1.05rem", 3),
                    body(`team-role-${i}`, ["Founder", "Design", "Engineering", "Support"][i] ?? "Role", st({ color: MUTED, fontSize: "0.85rem", fontWeight: "600" })),
                  ],
                }),
              ),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "logo-cloud",
    name: "Logo Cloud",
    icon: "🏷",
    category: "Social proof",
    description: "Row of client logos",
    template: [
      n("lc-sec", "section", {
        styles: st({ paddingTop: "3rem", paddingBottom: "3rem" }),
        children: [
          container("lc-cont", [
            body("lc-label", "Trusted by teams everywhere", st({ color: MUTED, textAlign: "center", fontWeight: "700", letterSpacing: "0.06em", fontSize: "0.8rem", marginBottom: "1.5rem" })),
            n("lc-row", "row", {
              styles: st({ gap: "2.5rem", justifyContent: "center", flexWrap: "wrap" }),
              children: repeat(5, (i) =>
                n(`lc-logo-${i}`, "image", { props: { src: `https://dummyimage.com/120x36/cbd5e1/64748b&text=Logo`, alt: "Client logo" }, styles: st({ height: "28px", opacity: "0.6" }) }),
              ),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "quote-block",
    name: "Quote",
    icon: "❝",
    category: "Content",
    description: "Large pull-quote",
    template: [
      n("q-sec", "section", {
        styles: SECTION(),
        children: [
          container("q-cont", [
            n("q-text", "text", { props: { text: "“The details are not the details. They make the design.”" }, styles: st({ fontSize: "1.8rem", fontWeight: "600", color: "token:colorText", textAlign: "center", lineHeight: "1.45", fontFamily: "token:fontHeading", maxWidth: "760px", marginLeft: "auto", marginRight: "auto" }) }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "icon-list",
    name: "Icon List",
    icon: "✅",
    category: "Content",
    description: "Checklist with icons",
    template: [
      n("il-sec", "section", {
        styles: SECTION(),
        children: [
          container("il-cont", [
            n("il-col", "column", {
              styles: st({ gap: "1rem", maxWidth: "560px", marginLeft: "auto", marginRight: "auto" }),
              children: repeat(4, (i) =>
                n(`il-row-${i}`, "row", {
                  styles: st({ gap: "0.75rem", alignItems: "center" }),
                  children: [
                    n(`il-icon-${i}`, "icon", { props: { name: "check-circle" }, styles: st({ color: "token:colorPrimary", width: "1.4rem", height: "1.4rem" }) }),
                    body(`il-text-${i}`, ["Unlimited content types", "Role-based access", "Audit logging", "GDPR export"][i] ?? "Item", st({ color: "token:colorText", fontWeight: "500" })),
                  ],
                }),
              ),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "gallery",
    name: "Gallery",
    icon: "🖼",
    category: "Media",
    description: "Grid of images",
    template: [
      n("gal-sec", "section", {
        styles: SECTION(),
        children: [
          container("gal-cont", [
            n("gal-grid", "grid", {
              styles: st({ gridTemplateColumns: "repeat(3,1fr)", gap: "1rem" }, { mobile: { gridTemplateColumns: "repeat(2,1fr)" } }),
              children: repeat(6, (i) => n(`gal-img-${i}`, "image", { props: { src: `https://picsum.photos/seed/p${i}/500/400`, alt: "Gallery image" }, styles: st({ width: "100%", borderRadius: "12px" }) })),
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "image-block",
    name: "Image",
    icon: "🏞",
    category: "Media",
    description: "Single image with caption",
    template: [
      n("ib-sec", "section", {
        styles: SECTION(),
        children: [
          container("ib-cont", [
            n("ib-col", "column", {
              styles: st({ gap: "0.6rem", alignItems: "center" }),
              children: [
                n("ib-img", "image", { props: { src: "https://picsum.photos/seed/hero/1000/560", alt: "" }, styles: st({ width: "100%", borderRadius: "16px" }) }),
                body("ib-cap", "Add a caption to describe this image.", st({ color: MUTED, fontSize: "0.85rem", textAlign: "center" })),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "text-content",
    name: "Text Content",
    icon: "📝",
    category: "Content",
    description: "Heading and paragraph",
    template: [
      n("tx-sec", "section", {
        styles: SECTION(),
        children: [
          container("tx-cont", [
            n("tx-col", "column", {
              styles: st({ gap: "1rem", maxWidth: "720px", marginLeft: "auto", marginRight: "auto" }),
              children: [heading("tx-h", "A section heading", "1.9rem"), body("tx-b", "Write your story here. This paragraph is a normal text primitive you can style, split, or extend with more primitives.")],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "video-embed",
    name: "Video",
    icon: "▶",
    category: "Media",
    description: "Embedded video player",
    template: [
      n("ve-sec", "section", {
        styles: SECTION(),
        children: [
          container("ve-cont", [
            n("ve-video", "video", { props: { url: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "Embedded video" }, styles: st({ borderRadius: "16px" }) }),
          ], st({ maxWidth: "900px" })),
        ],
      }),
    ],
  },

  {
    id: "nav-header",
    name: "Navigation",
    icon: "🧭",
    category: "Navigation",
    description: "Top navigation bar",
    template: [
      n("nav-sec", "section", {
        styles: st({ paddingTop: "1rem", paddingBottom: "1rem", borderWidth: "1px", borderStyle: "solid", borderColor: SURFACE_BORDER }),
        children: [
          container("nav-cont", [
            n("nav-row", "row", {
              styles: st({ justifyContent: "space-between", alignItems: "center" }),
              children: [
                n("nav-brand", "heading", { props: { text: "Pressh", level: 1 }, styles: st({ fontSize: "1.15rem", fontWeight: "900", color: "token:colorText", fontFamily: "token:fontHeading" }) }),
                n("nav-links", "row", {
                  styles: st({ gap: "0.4rem", alignItems: "center" }),
                  children: [
                    n("nav-l1", "button", { props: { label: "Home", href: "/" }, styles: st({ background: "transparent", color: MUTED, fontWeight: "600" }) }),
                    n("nav-l2", "button", { props: { label: "About", href: "/about" }, styles: st({ background: "transparent", color: MUTED, fontWeight: "600" }) }),
                    n("nav-l3", "button", { props: { label: "Contact", href: "/contact" }, styles: st({ background: "transparent", color: MUTED, fontWeight: "600" }) }),
                    primaryBtn("nav-cta", "Sign up"),
                  ],
                }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "site-footer",
    name: "Footer",
    icon: "📎",
    category: "Navigation",
    description: "Page footer with links",
    template: [
      n("ft-sec", "section", {
        styles: st({ paddingTop: "2.5rem", paddingBottom: "2.5rem", background: "#f8fafc", borderWidth: "1px", borderStyle: "solid", borderColor: SURFACE_BORDER }),
        children: [
          container("ft-cont", [
            n("ft-row", "row", {
              styles: st({ justifyContent: "space-between", alignItems: "center" }, { mobile: { flexDirection: "column", gap: "1rem" } }),
              children: [
                body("ft-copy", "© 2026 Pressh. All rights reserved.", st({ color: MUTED, fontSize: "0.85rem" })),
                n("ft-links", "row", {
                  styles: st({ gap: "1.25rem" }),
                  children: repeat(3, (i) => n(`ft-link-${i}`, "button", { props: { label: ["Privacy", "Terms", "Contact"][i] ?? "Link", href: "#" }, styles: st({ background: "transparent", color: MUTED, fontWeight: "600", fontSize: "0.85rem" }) })),
                }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "banner-strip",
    name: "Banner Strip",
    icon: "🎗",
    category: "Hero & CTA",
    description: "Thin announcement bar",
    template: [
      n("bn-sec", "section", {
        styles: st({ paddingTop: "0.7rem", paddingBottom: "0.7rem", background: "token:colorPrimary" }),
        children: [
          n("bn-text", "text", { props: { text: "🎉 We just launched v2.0 — read the announcement." }, styles: st({ color: "#ffffff", textAlign: "center", fontWeight: "600", fontSize: "0.9rem" }) }),
        ],
      }),
    ],
  },

  {
    id: "recent-posts",
    name: "Recent Posts",
    icon: "📰",
    category: "Data",
    description: "Auto-updating grid of published pages (bound to content)",
    template: [
      n("rp-sec", "section", {
        styles: SECTION("#f8fafc"),
        children: [
          container("rp-cont", [
            n("rp-h", "heading", { props: { text: "Latest posts", level: 2 }, styles: st({ fontSize: "2rem", fontWeight: "800", color: "token:colorText", fontFamily: "token:fontHeading", marginBottom: "2rem" }) }),
            n("rp-list", "collectionList", {
              props: { limit: 6, order: "desc", sortBy: "publishedAt", emptyText: "No posts published yet." },
              styles: st({ gridTemplateColumns: "repeat(3,1fr)", gap: "1.25rem" }, { mobile: { gridTemplateColumns: "1fr" } }),
              children: [
                n("rp-card", "column", {
                  styles: st({ background: "#ffffff", borderWidth: "1px", borderStyle: "solid", borderColor: SURFACE_BORDER, borderRadius: "16px", paddingTop: "1.5rem", paddingBottom: "1.5rem", paddingLeft: "1.5rem", paddingRight: "1.5rem", gap: "0.5rem" }, { hover: { borderColor: "token:colorPrimary" } }),
                  children: [
                    n("rp-title", "heading", { props: { text: "Post title", level: 3 }, bindings: { text: { field: "title" } }, styles: st({ fontSize: "1.1rem", fontWeight: "700", color: "token:colorText" }) }),
                    n("rp-link", "button", { props: { label: "Read post →", href: "#" }, bindings: { href: { field: "slug", as: "url" } }, styles: st({ background: "transparent", color: "token:colorPrimary", fontWeight: "700", fontSize: "0.9rem", paddingLeft: "0", paddingRight: "0" }) }),
                  ],
                }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "contact-form",
    name: "Contact Form",
    icon: "✉️",
    category: "Forms",
    description: "Name, email and message fields",
    template: [
      n("cf-sec", "section", {
        styles: SECTION(),
        children: [
          container("cf-cont", [
            n("cf-col", "column", {
              styles: st({ gap: "1.5rem", maxWidth: "560px", marginLeft: "auto", marginRight: "auto" }),
              children: [
                n("cf-head", "column", {
                  styles: st({ gap: "0.4rem", textAlign: "center" }),
                  children: [heading("cf-h", "Get in touch", "1.9rem"), body("cf-sub", "We typically respond within 24 hours.")],
                }),
                n("cf-form", "form", {
                  props: { action: "#" },
                  styles: st({ gap: "1rem" }),
                  children: [
                    n("cf-name", "input", { props: { name: "name", label: "Name", inputType: "text", placeholder: "Your name", required: true } }),
                    n("cf-email", "input", { props: { name: "email", label: "Email", inputType: "email", placeholder: "you@example.com", required: true } }),
                    n("cf-msg", "textarea", { props: { name: "message", label: "Message", rows: 5, placeholder: "Tell us more…", required: true } }),
                    n("cf-submit", "submit", { props: { label: "Send message" }, styles: st({ background: "token:colorPrimary", color: "#ffffff", paddingTop: "0.8rem", paddingBottom: "0.8rem", borderRadius: "10px", fontWeight: "700" }, { hover: { opacity: "0.9" } }) }),
                  ],
                }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },

  {
    id: "newsletter-signup",
    name: "Newsletter",
    icon: "📩",
    category: "Forms",
    description: "Inline email capture",
    template: [
      n("ns-sec", "section", {
        styles: SECTION("#f8fafc"),
        children: [
          container("ns-cont", [
            n("ns-col", "column", {
              styles: st({ gap: "1.1rem", alignItems: "center", textAlign: "center", maxWidth: "560px", marginLeft: "auto", marginRight: "auto" }),
              children: [
                heading("ns-h", "Stay in the loop", "1.8rem"),
                body("ns-sub", "Get product updates in your inbox. No spam."),
                n("ns-form", "form", {
                  props: { action: "#" },
                  styles: st({ flexDirection: "row", gap: "0.6rem", width: "100%" }, { mobile: { flexDirection: "column" } }),
                  children: [
                    n("ns-email", "input", { props: { name: "email", label: "", inputType: "email", placeholder: "you@example.com", required: true }, styles: st({ width: "100%" }) }),
                    n("ns-submit", "submit", { props: { label: "Subscribe" }, styles: st({ background: "token:colorPrimary", color: "#ffffff", paddingLeft: "1.5rem", paddingRight: "1.5rem", borderRadius: "10px", fontWeight: "700" }) }),
                  ],
                }),
              ],
            }),
          ]),
        ],
      }),
    ],
  },
];

const PRESET_BY_ID = new Map<string, PresetDef>(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): PresetDef | undefined {
  return PRESET_BY_ID.get(id);
}

export function listPresets(): PresetDef[] {
  return PRESETS;
}
