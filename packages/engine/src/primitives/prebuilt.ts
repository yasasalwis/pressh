/**
 * Prebuilt public-page layouts.
 *
 * The CMS ships with a set of public pages (the home/landing page, the
 * header + footer chrome, the 404/500/maintenance system pages, and the
 * about/blog/contact demo pages). Rather than seeding them as a couple of bare
 * `heading`/`paragraph` blocks — which render as unstyled text — each one is
 * defined here as a full primitive (designer) tree, so a fresh install presents
 * a properly designed, on-brand site out of the box that the operator can then
 * open in the visual designer and edit.
 *
 * These trees use exactly the same primitives and constrained style system the
 * designer produces (see ./types.ts, ./css.ts), reference theme tokens
 * (`token:colorPrimary`, …) so they re-skin with the active theme, and are
 * stored verbatim inside a single `designer-layout` block — the shape the Site's
 * front controller already knows how to render.
 */
import type {Binding, PrimitiveNode, PrimitiveType, ResponsiveStyles, StateStyles, StyleProps,} from "./types.js";
import {DESIGNER_LAYOUT_BLOCK} from "./types.js";

// ── palette ───────────────────────────────────────────────────────────────────
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const SUBTLE = "#f8fafc";
const WHITE = "#ffffff";
const ON_PRIMARY = "rgba(255,255,255,0.9)";
const CARD_SHADOW = "0 1px 3px rgba(15,23,42,0.06)";

// ── builders ────────────────────────────────────────────────────────────────
/** Per-page id allocator → guarantees every node id is unique within its tree. */
interface Ctx {
    next: () => string;
}

function ctx(prefix: string): Ctx {
    let i = 0;
    return {next: () => `${prefix}-${i++}`};
}

interface NodeInit {
    props?: Record<string, unknown>;
    bindings?: Record<string, Binding>;
    styles?: ResponsiveStyles;
    children?: PrimitiveNode[];
}

function node(c: Ctx, type: PrimitiveType, init: NodeInit = {}): PrimitiveNode {
    const n: PrimitiveNode = {id: c.next(), type};
    if (init.props) n.props = init.props;
    if (init.bindings) n.bindings = init.bindings;
    if (init.styles) n.styles = init.styles;
    if (init.children) n.children = init.children;
    return n;
}

interface StyleExtra {
    hover?: StyleProps;
    tablet?: StyleProps;
    mobile?: StyleProps;
}

function st(d: StyleProps, extra: StyleExtra = {}): ResponsiveStyles {
    const baseState: StateStyles = {default: d};
    if (extra.hover) baseState.hover = extra.hover;
    const r: ResponsiveStyles = {base: baseState};
    if (extra.tablet) r.tablet = {default: extra.tablet};
    if (extra.mobile) r.mobile = {default: extra.mobile};
    return r;
}

// shared style fragments
const SECTION_PAD = (bg?: string): ResponsiveStyles =>
    st({paddingTop: "5.5rem", paddingBottom: "5.5rem", ...(bg ? {background: bg} : {})});
const GUTTER: StyleProps = {paddingLeft: "1.5rem", paddingRight: "1.5rem"};

function container(c: Ctx, children: PrimitiveNode[], extra: StyleProps = {}): PrimitiveNode {
    return node(c, "container", {
        styles: st({...GUTTER, ...extra}),
        children,
    });
}

function section(c: Ctx, children: PrimitiveNode[], styles?: ResponsiveStyles): PrimitiveNode {
    return node(c, "section", {...(styles ? {styles} : {}), children});
}

function heading(c: Ctx, text: string, size: string, level = 2, extra: StyleProps = {}): PrimitiveNode {
    return node(c, "heading", {
        props: {text, level},
        styles: st({
            fontSize: size,
            fontWeight: "800",
            color: "token:colorText",
            fontFamily: "token:fontHeading",
            letterSpacing: "-0.02em",
            lineHeight: "1.15",
            ...extra,
        }),
    });
}

function body(c: Ctx, text: string, extra: StyleProps = {}): PrimitiveNode {
    return node(c, "text", {
        props: {text},
        styles: st({color: MUTED, lineHeight: "1.7", fontSize: "1.05rem", ...extra}),
    });
}

function primaryBtn(c: Ctx, label: string, href: string, extra: StyleProps = {}): PrimitiveNode {
    return node(c, "button", {
        props: {label, href},
        styles: st(
            {
                background: "token:colorPrimary",
                color: WHITE,
                paddingTop: "0.85rem",
                paddingBottom: "0.85rem",
                paddingLeft: "1.75rem",
                paddingRight: "1.75rem",
                borderRadius: "10px",
                fontWeight: "700",
                ...extra,
            },
            {hover: {opacity: "0.9"}},
        ),
    });
}

function ghostBtn(c: Ctx, label: string, href: string, color = MUTED): PrimitiveNode {
    return node(c, "button", {
        props: {label, href},
        styles: st(
            {background: "transparent", color, fontWeight: "600", paddingLeft: "0.85rem", paddingRight: "0.85rem"},
            {hover: {color: "token:colorPrimary"}},
        ),
    });
}

function icon(c: Ctx, name: string, color = "token:colorPrimary", size = "1.75rem"): PrimitiveNode {
    return node(c, "icon", {props: {name}, styles: st({color, width: size, height: size})});
}

function featureCard(c: Ctx, iconName: string, title: string, text: string): PrimitiveNode {
    return node(c, "column", {
        styles: st({
            background: WHITE,
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: BORDER,
            borderRadius: "16px",
            paddingTop: "1.85rem",
            paddingBottom: "1.85rem",
            paddingLeft: "1.85rem",
            paddingRight: "1.85rem",
            gap: "0.85rem",
            boxShadow: CARD_SHADOW,
        }),
        children: [
            node(c, "column", {
                styles: st({
                    width: "3rem",
                    height: "3rem",
                    background: "token:colorPrimary",
                    borderRadius: "12px",
                    alignItems: "center",
                    justifyContent: "center",
                }),
                children: [icon(c, iconName, WHITE, "1.5rem")],
            }),
            heading(c, title, "1.2rem", 3),
            body(c, text, {fontSize: "0.97rem"}),
        ],
    });
}

function step(c: Ctx, num: string, title: string, text: string): PrimitiveNode {
    return node(c, "column", {
        styles: st({gap: "0.85rem"}),
        children: [
            node(c, "column", {
                styles: st({
                    width: "2.85rem",
                    height: "2.85rem",
                    background: "token:colorPrimary",
                    color: WHITE,
                    borderRadius: "999px",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "800",
                    fontSize: "1.15rem",
                }),
                children: [node(c, "text", {
                    props: {text: num},
                    styles: st({color: WHITE, fontWeight: "800", fontSize: "1.15rem"})
                })],
            }),
            heading(c, title, "1.15rem", 3),
            body(c, text, {fontSize: "0.97rem"}),
        ],
    });
}

function checkRow(c: Ctx, text: string): PrimitiveNode {
    return node(c, "row", {
        styles: st({gap: "0.75rem", alignItems: "center"}),
        children: [
            icon(c, "check-circle", "token:colorPrimary", "1.4rem"),
            body(c, text, {color: "token:colorText", fontWeight: "500", fontSize: "1rem"}),
        ],
    });
}

// ── section presets reused across pages ───────────────────────────────────────
function sectionHeading(c: Ctx, eyebrow: string, title: string, sub: string): PrimitiveNode {
    return node(c, "column", {
        styles: st({
            gap: "0.7rem",
            alignItems: "center",
            textAlign: "center",
            maxWidth: "640px",
            marginLeft: "auto",
            marginRight: "auto",
            marginBottom: "3rem"
        }),
        children: [
            node(c, "text", {
                props: {text: eyebrow},
                styles: st({
                    color: "token:colorPrimary",
                    fontWeight: "700",
                    letterSpacing: "0.08em",
                    fontSize: "0.78rem"
                })
            }),
            heading(c, title, "2.3rem"),
            body(c, sub, {fontSize: "1.1rem"}),
        ],
    });
}

// ── HEADER (sticky nav) ───────────────────────────────────────────────────────
function buildHeader(): PrimitiveNode[] {
    const c = ctx("hd");
    return [
        section(
            c,
            [
                container(
                    c,
                    [
                        node(c, "row", {
                            styles: st({justifyContent: "space-between", alignItems: "center"}),
                            children: [
                                node(c, "button", {
                                    props: {label: "Pressh", href: "/"},
                                    styles: st({
                                        background: "transparent",
                                        color: "token:colorText",
                                        fontWeight: "900",
                                        fontSize: "1.2rem",
                                        paddingLeft: "0",
                                        paddingRight: "0",
                                        letterSpacing: "-0.02em"
                                    }),
                                }),
                                node(c, "row", {
                                    styles: st({gap: "0.35rem", alignItems: "center"}, {mobile: {display: "none"}}),
                                    children: [
                                        ghostBtn(c, "Home", "/"),
                                        ghostBtn(c, "About", "/about"),
                                        ghostBtn(c, "Blog", "/blog"),
                                        ghostBtn(c, "Contact", "/contact"),
                                        primaryBtn(c, "Get started", "/contact", {
                                            paddingTop: "0.6rem",
                                            paddingBottom: "0.6rem",
                                            paddingLeft: "1.25rem",
                                            paddingRight: "1.25rem",
                                            borderRadius: "8px"
                                        }),
                                    ],
                                }),
                            ],
                        }),
                    ],
                    {paddingTop: "0", paddingBottom: "0"},
                ),
            ],
            st({
                paddingTop: "0.9rem",
                paddingBottom: "0.9rem",
                background: WHITE,
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: BORDER,
                position: "sticky",
                top: "0",
                zIndex: "50",
            }),
        ),
    ];
}

// ── FOOTER ──────────────────────────────────────────────────────────────────
function footerLinkGroup(c: Ctx, title: string, links: Array<[string, string]>): PrimitiveNode {
    return node(c, "column", {
        styles: st({gap: "0.6rem", alignItems: "flex-start"}),
        children: [
            node(c, "text", {
                props: {text: title},
                styles: st({color: "token:colorText", fontWeight: "700", fontSize: "0.85rem", letterSpacing: "0.04em"})
            }),
            ...links.map(([label, href]) =>
                node(c, "button", {
                    props: {label, href},
                    styles: st({
                        background: "transparent",
                        color: MUTED,
                        fontWeight: "500",
                        fontSize: "0.9rem",
                        paddingTop: "0.15rem",
                        paddingBottom: "0.15rem",
                        paddingLeft: "0",
                        paddingRight: "0"
                    }, {hover: {color: "token:colorPrimary"}}),
                }),
            ),
        ],
    });
}

function buildFooter(): PrimitiveNode[] {
    const c = ctx("ft");
    return [
        section(
            c,
            [
                container(c, [
                    node(c, "grid", {
                        styles: st({
                            gridTemplateColumns: "2fr 1fr 1fr 1fr",
                            gap: "2.5rem",
                            marginBottom: "2.5rem"
                        }, {mobile: {gridTemplateColumns: "1fr"}}),
                        children: [
                            node(c, "column", {
                                styles: st({gap: "0.6rem", maxWidth: "320px"}),
                                children: [
                                    node(c, "heading", {
                                        props: {text: "Pressh", level: 2},
                                        styles: st({
                                            fontSize: "1.3rem",
                                            fontWeight: "900",
                                            color: "token:colorText",
                                            fontFamily: "token:fontHeading",
                                            letterSpacing: "-0.02em"
                                        })
                                    }),
                                    body(c, "The secure-first, no-code CMS built for the modern web. A safer alternative to legacy platforms.", {fontSize: "0.92rem"}),
                                ],
                            }),
                            footerLinkGroup(c, "Product", [["Features", "/"], ["Blog", "/blog"], ["About", "/about"]]),
                            footerLinkGroup(c, "Company", [["About us", "/about"], ["Contact", "/contact"]]),
                            footerLinkGroup(c, "Legal", [["Privacy", "#"], ["Terms", "#"]]),
                        ],
                    }),
                    node(c, "divider", {styles: st({marginTop: "0", marginBottom: "1.5rem", color: BORDER})}),
                    node(c, "row", {
                        styles: st({
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "1rem"
                        }),
                        children: [
                            body(c, "© 2026 Pressh. All rights reserved.", {fontSize: "0.85rem"}),
                            node(c, "row", {
                                styles: st({gap: "1rem", alignItems: "center"}),
                                children: [
                                    node(c, "button", {
                                        props: {label: "GitHub", href: "#"},
                                        styles: st({
                                            background: "transparent",
                                            color: MUTED,
                                            fontWeight: "500",
                                            fontSize: "0.85rem",
                                            paddingLeft: "0",
                                            paddingRight: "0"
                                        }, {hover: {color: "token:colorPrimary"}})
                                    }),
                                    node(c, "button", {
                                        props: {label: "Contact", href: "/contact"},
                                        styles: st({
                                            background: "transparent",
                                            color: MUTED,
                                            fontWeight: "500",
                                            fontSize: "0.85rem",
                                            paddingLeft: "0",
                                            paddingRight: "0"
                                        }, {hover: {color: "token:colorPrimary"}})
                                    }),
                                ],
                            }),
                        ],
                    }),
                ]),
            ],
            st({
                paddingTop: "3.5rem",
                paddingBottom: "3.5rem",
                background: SUBTLE,
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: BORDER
            }),
        ),
    ];
}

// ── HOME ──────────────────────────────────────────────────────────────────────
function buildHome(): PrimitiveNode[] {
    const c = ctx("hm");
    // Hero
    const hero = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({
                        gap: "1.5rem",
                        alignItems: "center",
                        textAlign: "center",
                        maxWidth: "760px",
                        marginLeft: "auto",
                        marginRight: "auto"
                    }),
                    children: [
                        node(c, "text", {
                            props: {text: "Secure-first CMS"},
                            styles: st({
                                color: WHITE,
                                background: "rgba(255,255,255,0.16)",
                                fontWeight: "700",
                                letterSpacing: "0.06em",
                                fontSize: "0.78rem",
                                paddingTop: "0.45rem",
                                paddingBottom: "0.45rem",
                                paddingLeft: "1rem",
                                paddingRight: "1rem",
                                borderRadius: "50px"
                            })
                        }),
                        node(c, "heading", {
                            props: {text: "Welcome to Pressh", level: 1},
                            styles: st({
                                fontSize: "3.5rem",
                                fontWeight: "900",
                                color: WHITE,
                                fontFamily: "token:fontHeading",
                                letterSpacing: "-0.035em",
                                lineHeight: "1.05"
                            }, {mobile: {fontSize: "2.3rem"}})
                        }),
                        node(c, "text", {
                            props: {text: "The no-code CMS that publishes with confidence. A minimal, auditable core with every plugin sandboxed — the safer alternative to legacy platforms."},
                            styles: st({color: ON_PRIMARY, fontSize: "1.25rem", lineHeight: "1.6"})
                        }),
                        node(c, "row", {
                            styles: st({
                                gap: "0.85rem",
                                justifyContent: "center",
                                marginTop: "0.5rem"
                            }, {mobile: {flexDirection: "column"}}),
                            children: [
                                node(c, "button", {
                                    props: {label: "Get started", href: "/contact"},
                                    styles: st({
                                        background: WHITE,
                                        color: "token:colorPrimary",
                                        paddingTop: "0.9rem",
                                        paddingBottom: "0.9rem",
                                        paddingLeft: "2rem",
                                        paddingRight: "2rem",
                                        borderRadius: "50px",
                                        fontWeight: "700"
                                    }, {hover: {opacity: "0.92"}})
                                }),
                                node(c, "button", {
                                    props: {label: "Learn more", href: "/about"},
                                    styles: st({
                                        background: "transparent",
                                        color: WHITE,
                                        borderWidth: "2px",
                                        borderStyle: "solid",
                                        borderColor: WHITE,
                                        paddingTop: "0.9rem",
                                        paddingBottom: "0.9rem",
                                        paddingLeft: "2rem",
                                        paddingRight: "2rem",
                                        borderRadius: "50px",
                                        fontWeight: "700"
                                    }, {hover: {opacity: "0.85"}})
                                }),
                            ],
                        }),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "7rem", paddingBottom: "7rem", background: "token:colorPrimary"}),
    );

    // Stats
    const stats = section(
        c,
        [
            container(c, [
                node(c, "grid", {
                    styles: st({
                        gridTemplateColumns: "repeat(4,1fr)",
                        gap: "1.5rem"
                    }, {mobile: {gridTemplateColumns: "repeat(2,1fr)"}}),
                    children: [
                        ["100%", "Open source"],
                        ["0", "Trusted plugins by default"],
                        ["14", "Secure-by-default baselines"],
                        ["24/7", "Audit logging"],
                    ].map(([num, label]) =>
                        node(c, "column", {
                            styles: st({gap: "0.25rem", alignItems: "center", textAlign: "center"}),
                            children: [
                                node(c, "heading", {
                                    props: {text: num ?? "", level: 3},
                                    styles: st({
                                        fontSize: "2.5rem",
                                        fontWeight: "900",
                                        color: "token:colorPrimary",
                                        fontFamily: "token:fontHeading"
                                    })
                                }),
                                body(c, label ?? "", {fontSize: "0.9rem", fontWeight: "600"}),
                            ],
                        }),
                    ),
                }),
            ]),
        ],
        SECTION_PAD(SUBTLE),
    );

    // Features
    const features = section(
        c,
        [
            container(c, [
                sectionHeading(c, "WHY PRESSH", "Built for security, designed for speed", "Everything you need to publish safely — without the bloat and attack surface of a legacy CMS."),
                node(c, "grid", {
                    styles: st({
                        gridTemplateColumns: "repeat(3,1fr)",
                        gap: "1.5rem"
                    }, {mobile: {gridTemplateColumns: "1fr"}}),
                    children: [
                        featureCard(c, "shield", "Secure by default", "A minimal, auditable core with 14 secure-by-default baselines. No surprise behaviour, no unaudited third-party code in your runtime."),
                        featureCard(c, "lock", "Sandboxed plugins", "Every plugin runs in an isolated worker with explicit capability grants — a compromised plugin can't reach your data or your server."),
                        featureCard(c, "zap", "No-code modelling", "Define content types, workflow states, immutable revisions and locales from a clean visual studio. No code required."),
                        featureCard(c, "globe", "Own your content", "Self-host anywhere, switch storage backends on demand, and export everything. Your data never leaves your control."),
                        featureCard(c, "settings", "Visual designer", "Compose pages from styled primitives with full responsive control — the same system that renders this very page."),
                        featureCard(c, "check-circle", "Privacy & GDPR", "Built-in consent capture, data-subject export, and audit logging so compliance isn't an afterthought."),
                    ],
                }),
            ]),
        ],
        SECTION_PAD(),
    );

    // Get started steps
    const getStarted = section(
        c,
        [
            container(c, [
                sectionHeading(c, "GET STARTED", "Live in three steps", "From zero to a published, secure site in minutes."),
                node(c, "grid", {
                    styles: st({
                        gridTemplateColumns: "repeat(3,1fr)",
                        gap: "2rem"
                    }, {mobile: {gridTemplateColumns: "1fr"}}),
                    children: [
                        step(c, "1", "Create your account", "Spin up Pressh and create the first owner account. No external services to wire up."),
                        step(c, "2", "Model your content", "Use the no-code studio to define content types and design pages with the visual designer."),
                        step(c, "3", "Publish with confidence", "Hit publish. Your site is served fast and secure, with every change captured in an immutable revision."),
                    ],
                }),
                node(c, "row", {
                    styles: st({justifyContent: "center", marginTop: "3rem"}),
                    children: [primaryBtn(c, "Read the guide", "/blog", {
                        paddingLeft: "2rem",
                        paddingRight: "2rem",
                        borderRadius: "50px"
                    })],
                }),
            ]),
        ],
        SECTION_PAD(SUBTLE),
    );

    // Capabilities checklist (two-column)
    const capabilities = section(
        c,
        [
            container(c, [
                node(c, "grid", {
                    styles: st({
                        gridTemplateColumns: "1fr 1fr",
                        gap: "3.5rem",
                        alignItems: "center"
                    }, {mobile: {gridTemplateColumns: "1fr"}}),
                    children: [
                        node(c, "column", {
                            styles: st({gap: "1.1rem"}),
                            children: [
                                node(c, "text", {
                                    props: {text: "EVERYTHING INCLUDED"},
                                    styles: st({
                                        color: "token:colorPrimary",
                                        fontWeight: "700",
                                        letterSpacing: "0.08em",
                                        fontSize: "0.78rem"
                                    })
                                }),
                                heading(c, "A complete platform, not a starting point", "2rem"),
                                body(c, "Pressh ships with the features teams actually need — without bolting on dozens of risky plugins."),
                            ],
                        }),
                        node(c, "column", {
                            styles: st({gap: "1rem"}),
                            children: [
                                checkRow(c, "Unlimited content types & locales"),
                                checkRow(c, "Role-based access & capability gating"),
                                checkRow(c, "Immutable revision history"),
                                checkRow(c, "Audit logging on every change"),
                                checkRow(c, "GDPR export & consent capture"),
                                checkRow(c, "Swappable storage backends"),
                            ],
                        }),
                    ],
                }),
            ]),
        ],
        SECTION_PAD(),
    );

    // Final CTA
    const cta = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({
                        gap: "1.1rem",
                        alignItems: "center",
                        textAlign: "center",
                        maxWidth: "640px",
                        marginLeft: "auto",
                        marginRight: "auto"
                    }),
                    children: [
                        node(c, "heading", {
                            props: {text: "Ready to publish with confidence?", level: 2},
                            styles: st({
                                fontSize: "2.4rem",
                                fontWeight: "800",
                                color: WHITE,
                                fontFamily: "token:fontHeading",
                                letterSpacing: "-0.02em"
                            })
                        }),
                        node(c, "text", {
                            props: {text: "Join the teams choosing security without sacrificing simplicity."},
                            styles: st({color: ON_PRIMARY, fontSize: "1.1rem"})
                        }),
                        node(c, "row", {
                            styles: st({
                                gap: "0.85rem",
                                justifyContent: "center",
                                marginTop: "0.5rem"
                            }, {mobile: {flexDirection: "column"}}),
                            children: [
                                node(c, "button", {
                                    props: {label: "Get started free", href: "/contact"},
                                    styles: st({
                                        background: WHITE,
                                        color: "token:colorPrimary",
                                        paddingTop: "0.9rem",
                                        paddingBottom: "0.9rem",
                                        paddingLeft: "2rem",
                                        paddingRight: "2rem",
                                        borderRadius: "50px",
                                        fontWeight: "700"
                                    }, {hover: {opacity: "0.92"}})
                                }),
                                node(c, "button", {
                                    props: {label: "Talk to us", href: "/contact"},
                                    styles: st({
                                        background: "transparent",
                                        color: WHITE,
                                        borderWidth: "2px",
                                        borderStyle: "solid",
                                        borderColor: WHITE,
                                        paddingTop: "0.9rem",
                                        paddingBottom: "0.9rem",
                                        paddingLeft: "2rem",
                                        paddingRight: "2rem",
                                        borderRadius: "50px",
                                        fontWeight: "700"
                                    })
                                }),
                            ],
                        }),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "5.5rem", paddingBottom: "5.5rem", background: "token:colorPrimary"}),
    );

    return [hero, stats, features, getStarted, capabilities, cta];
}

// ── ERROR / SYSTEM STANDALONE PAGES ───────────────────────────────────────────
function buildStatusPage(opts: {
    prefix: string;
    code: string;
    title: string;
    message: string;
    iconName: string;
    cta?: { label: string; href: string };
}): PrimitiveNode[] {
    const c = ctx(opts.prefix);
    const children: PrimitiveNode[] = [
        icon(c, opts.iconName, "token:colorPrimary", "3rem"),
        node(c, "heading", {
            props: {text: opts.code, level: 1},
            styles: st({
                fontSize: "4.5rem",
                fontWeight: "900",
                color: "token:colorPrimary",
                fontFamily: "token:fontHeading",
                lineHeight: "1"
            })
        }),
        heading(c, opts.title, "1.9rem", 2),
        body(c, opts.message, {fontSize: "1.1rem"}),
    ];
    if (opts.cta) {
        children.push(
            node(c, "row", {
                styles: st({justifyContent: "center", marginTop: "0.75rem"}),
                children: [primaryBtn(c, opts.cta.label, opts.cta.href, {
                    paddingLeft: "2rem",
                    paddingRight: "2rem",
                    borderRadius: "50px"
                })],
            }),
        );
    }
    return [
        section(
            c,
            [
                container(c, [
                    node(c, "column", {
                        styles: st({
                            gap: "1.25rem",
                            alignItems: "center",
                            textAlign: "center",
                            maxWidth: "560px",
                            marginLeft: "auto",
                            marginRight: "auto"
                        }),
                        children,
                    }),
                ]),
            ],
            st({paddingTop: "6.5rem", paddingBottom: "6.5rem"}),
        ),
    ];
}

// ── ABOUT ─────────────────────────────────────────────────────────────────────
function buildAbout(): PrimitiveNode[] {
    const c = ctx("ab");
    const hero = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({
                        gap: "1.2rem",
                        alignItems: "center",
                        textAlign: "center",
                        maxWidth: "720px",
                        marginLeft: "auto",
                        marginRight: "auto"
                    }),
                    children: [
                        node(c, "text", {
                            props: {text: "ABOUT"},
                            styles: st({
                                color: "token:colorPrimary",
                                fontWeight: "700",
                                letterSpacing: "0.08em",
                                fontSize: "0.78rem"
                            })
                        }),
                        node(c, "heading", {
                            props: {text: "A CMS that puts security first", level: 1},
                            styles: st({
                                fontSize: "3rem",
                                fontWeight: "900",
                                color: "token:colorText",
                                fontFamily: "token:fontHeading",
                                letterSpacing: "-0.03em",
                                lineHeight: "1.1"
                            }, {mobile: {fontSize: "2.1rem"}})
                        }),
                        body(c, "Pressh exists because the web deserves better than the legacy CMS status quo — where a single vulnerable plugin can leak your data or take over your server.", {fontSize: "1.2rem"}),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "6rem", paddingBottom: "4rem"}),
    );

    const mission = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({gap: "1rem", maxWidth: "720px", marginLeft: "auto", marginRight: "auto"}),
                    children: [
                        heading(c, "Our mission", "1.9rem"),
                        body(c, "Traditional platforms bundle thousands of lines of third-party code you never audited. Pressh takes the opposite approach: a minimal, auditable core with plugins running in isolated sandboxes, each granted only the capabilities it explicitly needs."),
                        body(c, "The result is a content management system developers can actually audit and organisations can genuinely trust."),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "2rem", paddingBottom: "4rem"}),
    );

    const values = section(
        c,
        [
            container(c, [
                sectionHeading(c, "WHAT WE BELIEVE", "Our values", "The principles behind every line of code."),
                node(c, "grid", {
                    styles: st({
                        gridTemplateColumns: "repeat(3,1fr)",
                        gap: "1.5rem"
                    }, {mobile: {gridTemplateColumns: "1fr"}}),
                    children: [
                        featureCard(c, "shield", "Security by default", "Safe is the default state, not a setting you have to discover and enable."),
                        featureCard(c, "check-circle", "Minimal surface area", "Less code means less to attack. We add features deliberately, never by accident."),
                        featureCard(c, "globe", "Transparent & open", "Every line is auditable, every decision documented, every plugin sandboxed."),
                    ],
                }),
            ]),
        ],
        SECTION_PAD(SUBTLE),
    );

    const cta = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({
                        gap: "1.1rem",
                        alignItems: "center",
                        textAlign: "center",
                        maxWidth: "600px",
                        marginLeft: "auto",
                        marginRight: "auto"
                    }),
                    children: [
                        heading(c, "Want to learn more?", "2rem"),
                        body(c, "Read the blog or get in touch — we'd love to hear from you."),
                        node(c, "row", {
                            styles: st({
                                gap: "0.85rem",
                                justifyContent: "center",
                                marginTop: "0.5rem"
                            }, {mobile: {flexDirection: "column"}}),
                            children: [primaryBtn(c, "Read the blog", "/blog", {
                                paddingLeft: "2rem",
                                paddingRight: "2rem",
                                borderRadius: "50px"
                            }), node(c, "button", {
                                props: {label: "Contact us", href: "/contact"},
                                styles: st({
                                    background: "transparent",
                                    color: "token:colorPrimary",
                                    borderWidth: "2px",
                                    borderStyle: "solid",
                                    borderColor: "token:colorPrimary",
                                    paddingTop: "0.85rem",
                                    paddingBottom: "0.85rem",
                                    paddingLeft: "2rem",
                                    paddingRight: "2rem",
                                    borderRadius: "50px",
                                    fontWeight: "700"
                                })
                            })],
                        }),
                    ],
                }),
            ]),
        ],
        SECTION_PAD(),
    );

    return [hero, mission, values, cta];
}

// ── BLOG ──────────────────────────────────────────────────────────────────────
function buildBlog(): PrimitiveNode[] {
    const c = ctx("bl");
    const hero = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({
                        gap: "1rem",
                        alignItems: "center",
                        textAlign: "center",
                        maxWidth: "680px",
                        marginLeft: "auto",
                        marginRight: "auto"
                    }),
                    children: [
                        node(c, "heading", {
                            props: {text: "The Pressh Blog", level: 1},
                            styles: st({
                                fontSize: "3rem",
                                fontWeight: "900",
                                color: "token:colorText",
                                fontFamily: "token:fontHeading",
                                letterSpacing: "-0.03em"
                            }, {mobile: {fontSize: "2.1rem"}})
                        }),
                        body(c, "Insights on content security, web performance, and the open web.", {fontSize: "1.2rem"}),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "6rem", paddingBottom: "3rem"}),
    );

    const posts = section(
        c,
        [
            container(c, [
                heading(c, "Latest posts", "1.6rem", 2, {marginBottom: "2rem"}),
                node(c, "collectionList", {
                    props: {
                        limit: 6,
                        order: "desc",
                        sortBy: "publishedAt",
                        emptyText: "No posts published yet — create one in the studio to see it here."
                    },
                    styles: st({
                        gridTemplateColumns: "repeat(3,1fr)",
                        gap: "1.5rem"
                    }, {mobile: {gridTemplateColumns: "1fr"}}),
                    children: [
                        node(c, "column", {
                            styles: st(
                                {
                                    background: WHITE,
                                    borderWidth: "1px",
                                    borderStyle: "solid",
                                    borderColor: BORDER,
                                    borderRadius: "16px",
                                    paddingTop: "1.6rem",
                                    paddingBottom: "1.6rem",
                                    paddingLeft: "1.6rem",
                                    paddingRight: "1.6rem",
                                    gap: "0.6rem",
                                    boxShadow: CARD_SHADOW
                                },
                                {hover: {borderColor: "token:colorPrimary"}},
                            ),
                            children: [
                                node(c, "heading", {
                                    props: {text: "Post title", level: 3},
                                    bindings: {text: {field: "title"}},
                                    styles: st({fontSize: "1.15rem", fontWeight: "700", color: "token:colorText"})
                                }),
                                node(c, "button", {
                                    props: {label: "Read post →", href: "#"},
                                    bindings: {href: {field: "slug", as: "url"}},
                                    styles: st({
                                        background: "transparent",
                                        color: "token:colorPrimary",
                                        fontWeight: "700",
                                        fontSize: "0.92rem",
                                        paddingLeft: "0",
                                        paddingRight: "0"
                                    })
                                }),
                            ],
                        }),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "2rem", paddingBottom: "5.5rem"}),
    );

    const why = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({gap: "1rem", maxWidth: "720px", marginLeft: "auto", marginRight: "auto"}),
                    children: [
                        heading(c, "Why we built Pressh", "1.9rem"),
                        body(c, "After watching yet another CMS get compromised by a vulnerable plugin, we decided enough was enough. The web needs a CMS that is secure by default, not as an afterthought — so we built one."),
                    ],
                }),
            ]),
        ],
        SECTION_PAD(SUBTLE),
    );

    return [hero, posts, why];
}

// ── CONTACT ─────────────────────────────────────────────────────────────────
function buildContact(): PrimitiveNode[] {
    const c = ctx("ct");
    const hero = section(
        c,
        [
            container(c, [
                node(c, "column", {
                    styles: st({
                        gap: "1rem",
                        alignItems: "center",
                        textAlign: "center",
                        maxWidth: "640px",
                        marginLeft: "auto",
                        marginRight: "auto"
                    }),
                    children: [
                        node(c, "heading", {
                            props: {text: "Get in touch", level: 1},
                            styles: st({
                                fontSize: "3rem",
                                fontWeight: "900",
                                color: "token:colorText",
                                fontFamily: "token:fontHeading",
                                letterSpacing: "-0.03em"
                            }, {mobile: {fontSize: "2.1rem"}})
                        }),
                        body(c, "Have questions, feedback, or just want to say hello? We'd love to hear from you.", {fontSize: "1.2rem"}),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "6rem", paddingBottom: "3rem"}),
    );

    const grid = section(
        c,
        [
            container(c, [
                node(c, "grid", {
                    styles: st({
                        gridTemplateColumns: "1fr 1.2fr",
                        gap: "3.5rem",
                        alignItems: "flex-start"
                    }, {mobile: {gridTemplateColumns: "1fr"}}),
                    children: [
                        node(c, "column", {
                            styles: st({gap: "1.5rem"}),
                            children: [
                                heading(c, "Reach us", "1.6rem"),
                                node(c, "row", {
                                    styles: st({gap: "0.75rem", alignItems: "center"}),
                                    children: [icon(c, "mail", "token:colorPrimary", "1.4rem"), body(c, "hello@pressh.dev", {
                                        color: "token:colorText",
                                        fontWeight: "500"
                                    })],
                                }),
                                node(c, "row", {
                                    styles: st({gap: "0.75rem", alignItems: "center"}),
                                    children: [icon(c, "github", "token:colorPrimary", "1.4rem"), body(c, "Open an issue or PR on GitHub", {
                                        color: "token:colorText",
                                        fontWeight: "500"
                                    })],
                                }),
                                body(c, "Pressh is open-source. Bug reports, feature requests, and pull requests are all welcome."),
                            ],
                        }),
                        node(c, "column", {
                            styles: st({gap: "1.25rem"}),
                            children: [
                                node(c, "form", {
                                    props: {action: "#"},
                                    styles: st({gap: "1rem"}),
                                    children: [
                                        node(c, "input", {
                                            props: {
                                                name: "name",
                                                label: "Name",
                                                inputType: "text",
                                                placeholder: "Your name",
                                                required: true
                                            }
                                        }),
                                        node(c, "input", {
                                            props: {
                                                name: "email",
                                                label: "Email",
                                                inputType: "email",
                                                placeholder: "you@example.com",
                                                required: true
                                            }
                                        }),
                                        node(c, "textarea", {
                                            props: {
                                                name: "message",
                                                label: "Message",
                                                rows: 5,
                                                placeholder: "Tell us more…",
                                                required: true
                                            }
                                        }),
                                        node(c, "submit", {
                                            props: {label: "Send message"},
                                            styles: st({
                                                background: "token:colorPrimary",
                                                color: WHITE,
                                                paddingTop: "0.8rem",
                                                paddingBottom: "0.8rem",
                                                borderRadius: "10px",
                                                fontWeight: "700"
                                            }, {hover: {opacity: "0.9"}})
                                        }),
                                    ],
                                }),
                            ],
                        }),
                    ],
                }),
            ]),
        ],
        st({paddingTop: "2rem", paddingBottom: "6rem"}),
    );

    return [hero, grid];
}

// ── registry ────────────────────────────────────────────────────────────────
export interface PrebuiltPage {
    title: string;
    nodes: PrimitiveNode[];
}

/** slug → designed page tree. Built fresh on access so ids/instances aren't shared. */
export function getPrebuiltPage(slug: string): PrebuiltPage | undefined {
    switch (slug) {
        case "header":
            return {title: "Header", nodes: buildHeader()};
        case "footer":
            return {title: "Footer", nodes: buildFooter()};
        case "home":
            return {title: "Home", nodes: buildHome()};
        case "404":
            return {
                title: "Page not found",
                nodes: buildStatusPage({
                    prefix: "e404",
                    code: "404",
                    title: "Page not found",
                    message: "The page you are looking for does not exist or may have moved.",
                    iconName: "search",
                    cta: {label: "Back to home", href: "/"}
                }),
            };
        case "500":
            return {
                title: "Server error",
                nodes: buildStatusPage({
                    prefix: "e500",
                    code: "500",
                    title: "Something went wrong",
                    message: "An unexpected error occurred on our side. Please try again in a moment.",
                    iconName: "settings",
                    cta: {label: "Back to home", href: "/"}
                }),
            };
        case "maintenance":
            return {
                title: "Down for maintenance",
                nodes: buildStatusPage({
                    prefix: "emnt",
                    code: "",
                    title: "We'll be right back",
                    message: "The site is temporarily offline for scheduled maintenance. Please check back shortly.",
                    iconName: "clock"
                }),
            };
        case "about":
            return {title: "About", nodes: buildAbout()};
        case "blog":
            return {title: "Blog", nodes: buildBlog()};
        case "contact":
            return {title: "Contact", nodes: buildContact()};
        default:
            return undefined;
    }
}

/** Wraps a prebuilt page's primitive tree in the single `designer-layout` block the Site renders. */
export function prebuiltLayoutBlocks(slug: string): unknown[] | undefined {
    const page = getPrebuiltPage(slug);
    if (!page) return undefined;
    return [{type: DESIGNER_LAYOUT_BLOCK, props: {nodes: page.nodes}}];
}
