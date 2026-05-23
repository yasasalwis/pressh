/**
 * Pressh Studio admin client — self-contained, no build step.
 * Includes: setup wizard · login · pages list · fullscreen Page Designer
 * (left: component palette, centre: canvas, right: properties panel).
 */
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pressh Studio</title>
<style>
/* ─── Design tokens ─────────────────────────────────────────── */
:root {
  --brand:#6d28d9; --brand-2:#0ea5e9; --ring:rgba(109,40,217,.3);
  --bg:#f1f3f9; --card:#fff; --card-border:rgba(15,23,42,.08);
  --text:#0f172a; --muted:#64748b;
  --field:#fff; --field-border:#e2e8f0;
  --shadow:0 24px 60px -20px rgba(15,23,42,.22);
  --panel-bg:#fff; --panel-border:rgba(15,23,42,.09);
  --canvas-bg:#dfe3ed;
  --topbar-h:52px; --panel-w-left:260px; --panel-w-right:288px;
}
[data-theme=dark] {
  --bg:#070b16; --card:#0f1729; --card-border:rgba(148,163,184,.13);
  --text:#e7ecf3; --muted:#94a3b8;
  --field:#0b1322; --field-border:rgba(148,163,184,.2);
  --shadow:0 30px 70px -25px rgba(0,0,0,.7);
  --panel-bg:#0f1729; --panel-border:rgba(148,163,184,.13);
  --canvas-bg:#0b0f1d;
}

/* ─── Reset / base ──────────────────────────────────────────── */
*{box-sizing:border-box}
body{margin:0;min-height:100vh;color:var(--text);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:radial-gradient(60rem 60rem at 12% -10%,rgba(109,40,217,.10),transparent 60%),
             radial-gradient(50rem 50rem at 110% 10%,rgba(14,165,233,.10),transparent 55%),
             var(--bg);
  -webkit-font-smoothing:antialiased}
.hide{display:none!important}

/* ─── Auth screens ──────────────────────────────────────────── */
.center{min-height:100vh;display:grid;place-items:center;padding:1.5rem}
.auth-card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--card-border);
  border-radius:22px;padding:2.25rem 2rem;box-shadow:var(--shadow);
  animation:rise .45s cubic-bezier(.2,.8,.2,1)}
@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
.brand{display:flex;align-items:center;gap:.75rem;margin-bottom:1.4rem}
.logo{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;
  color:#fff;font-weight:800;font-size:1.35rem;letter-spacing:-.02em;
  background:linear-gradient(135deg,var(--brand),var(--brand-2));
  box-shadow:0 10px 24px -8px var(--ring)}
.brand h1{font-size:1.1rem;margin:0;font-weight:800}
.brand p{margin:.1rem 0 0;font-size:.75rem;color:var(--muted)}
.auth-card h2{font-size:1.35rem;margin:0 0 .3rem;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:.88rem;margin:0 0 1.4rem;line-height:1.55}
label{display:block;font-size:.78rem;font-weight:600;margin:.85rem 0 .3rem;color:var(--text)}
input,select,textarea{width:100%;padding:.6rem .8rem;font-size:.9rem;color:var(--text);
  font-family:inherit;background:var(--field);border:1px solid var(--field-border);
  border-radius:10px;transition:border-color .15s,box-shadow .15s}
textarea{min-height:80px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--ring)}
.btn{width:100%;margin-top:1.3rem;padding:.78rem 1rem;font-size:.93rem;font-weight:700;
  color:#fff;border:0;border-radius:12px;cursor:pointer;
  background:linear-gradient(135deg,var(--brand),var(--brand-2));
  box-shadow:0 12px 26px -10px var(--ring);transition:transform .12s,opacity .12s}
.btn:hover{transform:translateY(-1px)}.btn:active{transform:none}
.btn[disabled]{opacity:.6;cursor:progress;transform:none}
.btn-sm{padding:.45rem .85rem;font-size:.82rem;font-weight:700;color:#fff;border:0;
  border-radius:9px;cursor:pointer;white-space:nowrap;
  background:linear-gradient(135deg,var(--brand),var(--brand-2));
  transition:opacity .12s,transform .12s}
.btn-sm:hover{opacity:.88;transform:translateY(-1px)}
.ghost{background:transparent;border:1px solid var(--card-border);color:var(--text);
  border-radius:9px;padding:.42rem .75rem;cursor:pointer;font-size:.8rem;
  text-decoration:none;display:inline-block;white-space:nowrap;transition:border-color .15s,color .15s}
.ghost:hover{border-color:var(--brand);color:var(--brand)}
.danger{color:#e11d48!important;border-color:rgba(225,29,72,.35)!important}
.danger:hover{background:rgba(225,29,72,.06)!important;color:#e11d48!important}
.alert{margin-top:.9rem;padding:.6rem .75rem;border-radius:9px;font-size:.82rem;
  background:rgba(225,29,72,.1);color:#e11d48;border:1px solid rgba(225,29,72,.22)}
.meter{height:5px;border-radius:999px;background:var(--field-border);margin-top:.5rem;overflow:hidden}
.meter>span{display:block;height:100%;width:0;border-radius:999px;transition:width .25s,background .25s}
.meter-label{font-size:.7rem;color:var(--muted);margin-top:.25rem;min-height:.85rem}
.foot{margin-top:1.4rem;text-align:center;font-size:.7rem;color:var(--muted)}
.foot b{color:var(--text)}

/* ─── Theme toggle (floating) ───────────────────────────────── */
.theme-toggle{position:fixed;top:.9rem;right:.9rem;width:36px;height:36px;border-radius:50%;
  border:1px solid var(--card-border);background:var(--card);color:var(--text);cursor:pointer;
  font-size:.95rem;display:grid;place-items:center;box-shadow:var(--shadow);z-index:100}

/* ─── Dashboard ─────────────────────────────────────────────── */
.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:.65rem;
  padding:.72rem 1.25rem;padding-right:4rem;background:var(--card);
  border-bottom:1px solid var(--card-border)}
.topbar .logo{width:32px;height:32px;border-radius:9px;font-size:.9rem}
.topbar h1{font-size:.95rem;margin:0;font-weight:800}
.spacer{flex:1}
.who{font-size:.82rem;color:var(--muted)}
.panel{max-width:900px;margin:1.25rem auto 5rem;padding:0 1.25rem}
.row-head{display:flex;align-items:center;justify-content:space-between;margin:.35rem 0 .85rem}
.row-head h2{font-size:1.05rem;margin:0;font-weight:800}
.surface{background:var(--card);border:1px solid var(--card-border);border-radius:16px;
  padding:1.1rem;box-shadow:var(--shadow)}
.list-row{display:flex;align-items:center;gap:.55rem;padding:.6rem .15rem;
  border-top:1px solid var(--card-border)}
.list-row:first-child{border-top:0}
.list-row .grow{flex:1;min-width:0}
.list-row .title{font-weight:600;font-size:.9rem}
.list-row .meta{font-size:.75rem;color:var(--muted)}
.empty{color:var(--muted);font-size:.88rem;padding:.35rem .15rem}
.badge{font-size:.66rem;font-weight:700;padding:.13rem .48rem;border-radius:999px;text-transform:capitalize}
.b-draft{background:rgba(217,119,6,.14);color:#d97706}
.b-published{background:rgba(22,163,74,.14);color:#16a34a}
.b-in_review{background:rgba(14,165,233,.14);color:#0ea5e9}
.b-scheduled{background:rgba(109,40,217,.14);color:#6d28d9}
.b-archived{background:rgba(100,116,139,.16);color:#64748b}
.iconbtn{background:transparent;border:1px solid var(--card-border);color:var(--muted);
  border-radius:7px;width:26px;height:26px;cursor:pointer;font-size:.75rem;
  transition:border-color .12s,color .12s}
.iconbtn:hover{border-color:var(--brand);color:var(--brand)}

/* ─── Quick-create form (new page) ──────────────────────────── */
.qc-wrap{margin-top:1rem}

/* ═══════════════════════════════════════════════════════════════
   PAGE DESIGNER  —  fullscreen 3-panel overlay
   ═══════════════════════════════════════════════════════════════ */

/* Shell */
.ds-shell{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;
  background:var(--bg);animation:rise .22s ease}

/* Top bar */
.ds-topbar{
  display:flex;align-items:center;gap:.55rem;flex-shrink:0;
  height:var(--topbar-h);padding:0 .9rem;
  background:var(--card);border-bottom:1px solid var(--panel-border);
  box-shadow:0 1px 4px rgba(15,23,42,.06)}
.ds-topbar .logo{width:28px;height:28px;border-radius:8px;font-size:.82rem;flex-shrink:0}
.ds-back{display:flex;align-items:center;gap:.3rem;font-size:.8rem;font-weight:600;
  color:var(--muted);cursor:pointer;border:1px solid var(--card-border);border-radius:8px;
  padding:.35rem .65rem;background:transparent;transition:border-color .15s,color .15s}
.ds-back:hover{border-color:var(--brand);color:var(--brand)}
.ds-page-slug{font-size:.82rem;font-weight:700;color:var(--muted);
  background:var(--bg);border:1px solid var(--card-border);border-radius:7px;
  padding:.28rem .6rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ds-sep{width:1px;height:20px;background:var(--card-border);flex-shrink:0}
.ds-device-btn{font-size:.82rem;padding:.32rem .55rem;border-radius:7px;border:1px solid var(--card-border);
  background:transparent;color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s}
.ds-device-btn:hover,.ds-device-btn.active{border-color:var(--brand);color:var(--brand)}
.ds-topbar .spacer{flex:1}
.ds-undo-btn{font-size:.8rem;padding:.32rem .5rem;border-radius:7px;border:1px solid var(--card-border);
  background:transparent;color:var(--muted);cursor:pointer;transition:all .12s}
.ds-undo-btn:hover{border-color:var(--brand);color:var(--brand)}
.ds-save-status{font-size:.73rem;color:var(--muted);min-width:60px;text-align:right}

/* Body: 3-column grid */
.ds-body{flex:1;display:grid;overflow:hidden;
  grid-template-columns:var(--panel-w-left) 1fr var(--panel-w-right)}

/* ── Left panel — Components ──────────────────────────────────── */
.ds-left{
  display:flex;flex-direction:column;overflow:hidden;
  background:var(--panel-bg);border-right:1px solid var(--panel-border)}
.ds-panel-head{
  flex-shrink:0;display:flex;align-items:center;justify-content:space-between;
  padding:.6rem .85rem .5rem;border-bottom:1px solid var(--panel-border)}
.ds-panel-title{font-size:.72rem;font-weight:800;text-transform:uppercase;
  letter-spacing:.08em;color:var(--muted)}
.ds-left-search{flex-shrink:0;padding:.55rem .7rem;border-bottom:1px solid var(--panel-border)}
.ds-left-search input{font-size:.8rem;padding:.42rem .65rem;border-radius:8px}
.ds-comp-list{flex:1;overflow-y:auto;padding:.5rem .6rem .9rem}
.ds-cat-label{font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.09em;
  color:var(--muted);padding:.7rem .25rem .2rem;user-select:none}
.ds-comp-item{
  display:flex;align-items:center;gap:.55rem;padding:.52rem .55rem;
  border-radius:9px;cursor:grab;border:1px solid transparent;
  transition:background .1s,border-color .15s;user-select:none;margin-bottom:.22rem}
.ds-comp-item:hover{background:rgba(109,40,217,.06);border-color:rgba(109,40,217,.18)}
.ds-comp-item:active{cursor:grabbing}
.dci-icon{font-size:1rem;width:26px;text-align:center;flex-shrink:0}
.dci-text{flex:1;min-width:0}
.dci-name{font-size:.8rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dci-desc{font-size:.68rem;color:var(--muted);line-height:1.3;
  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.dci-server{font-size:.58rem;font-weight:700;padding:.08rem .32rem;border-radius:999px;
  background:rgba(14,165,233,.12);color:#0ea5e9;flex-shrink:0;letter-spacing:.03em}

/* ── Centre — Canvas ──────────────────────────────────────────── */
.ds-canvas-wrap{
  display:flex;flex-direction:column;overflow:hidden;background:var(--canvas-bg)}
.ds-canvas-toolbar{
  flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:.5rem;
  padding:.4rem .75rem;background:var(--canvas-bg);border-bottom:1px solid rgba(15,23,42,.08)}
.ds-canvas-label{font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.ds-canvas-scroll{flex:1;overflow-y:auto;padding:1.25rem 1.5rem}

/* Constrain canvas to selected "device" width */
.ds-canvas-inner{margin:0 auto;width:100%;transition:max-width .25s}
.ds-canvas-inner.dv-mobile{max-width:390px}
.ds-canvas-inner.dv-tablet{max-width:768px}
.ds-canvas-inner.dv-desktop{max-width:100%}

/* Empty drop zone */
.dc-empty{
  border:2px dashed var(--card-border);border-radius:14px;
  padding:3.5rem 2rem;text-align:center;color:var(--muted);
  transition:border-color .15s,background .15s;cursor:default}
.dc-empty.dragover{border-color:var(--brand);background:rgba(109,40,217,.06)}
.dc-empty-icon{font-size:2.2rem;margin-bottom:.6rem;opacity:.5}
.dc-empty-title{font-weight:700;margin-bottom:.3rem;font-size:.92rem}
.dc-empty-sub{font-size:.8rem;opacity:.7}

/* Between-component drop zone */
.dc-dropzone{
  height:8px;border-radius:6px;margin:2px 0;
  border:2px dashed transparent;transition:all .15s}
.dc-dropzone.dragover{height:40px;border-color:var(--brand);background:rgba(109,40,217,.07)}

/* Component node card */
.dc-node{
  background:#fff;border:2px solid transparent;border-radius:12px;
  overflow:hidden;cursor:pointer;margin:2px 0;
  transition:border-color .15s,box-shadow .15s;position:relative}
[data-theme=dark] .dc-node{background:#131e35}
.dc-node:hover{border-color:rgba(14,165,233,.25);box-shadow:0 2px 8px -4px rgba(14,165,233,.08)}
.dc-node.selected{border-color:var(--brand);box-shadow:0 0 0 3px var(--ring)}
/* show-borders mode: controlled by the Borders toggle */
.ds-show-borders .dc-node{border-color:var(--card-border)}
.ds-show-borders .dc-node:hover{border-color:rgba(14,165,233,.5);box-shadow:0 4px 18px -4px rgba(14,165,233,.14)}

/* Undo/undo-style button active state (reused for Borders toggle) */
.ds-undo-btn.active{border-color:var(--brand);color:var(--brand);background:rgba(109,40,217,.07)}

/* Node preview area */
.dc-node-preview{background:#fff;min-height:64px}
[data-theme=dark] .dc-node-preview{background:#1a2640}
/* Preview is non-interactive: clicks select the node (editing is in the right panel). */
.dc-node-preview iframe{width:100%;border:none;display:block;min-height:64px;pointer-events:none}
.dc-preview-placeholder{padding:.75rem 1rem;font-size:.75rem;color:var(--muted);
  display:flex;align-items:center;gap:.4rem}

/* Canvas add button */
.dc-add-row{text-align:center;margin-top:1rem}

/* ── Right panel — Properties ─────────────────────────────────── */
.ds-right{
  display:flex;flex-direction:column;overflow:hidden;
  background:var(--panel-bg);border-left:1px solid var(--panel-border)}
.ds-props-scroll{flex:1;overflow-y:auto}

/* Empty state */
.dp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:3rem 1.5rem;text-align:center;height:100%;color:var(--muted)}
.dp-empty-icon{font-size:2.5rem;margin-bottom:.8rem;opacity:.35}
.dp-empty-title{font-weight:700;font-size:.85rem;margin:0 0 .35rem}
.dp-empty-sub{font-size:.78rem;line-height:1.55;margin:0;max-width:200px}

/* Props content */
.dp-comp-header{padding:.75rem .9rem .5rem;border-bottom:1px solid var(--panel-border)}
.dp-comp-title{font-size:.9rem;font-weight:800;display:flex;align-items:center;gap:.45rem}
.dp-comp-desc{font-size:.72rem;color:var(--muted);margin-top:.2rem;line-height:1.4}
.dp-server-badge{
  margin-top:.6rem;display:flex;align-items:flex-start;gap:.4rem;
  background:rgba(14,165,233,.07);border:1px solid rgba(14,165,233,.18);
  border-radius:9px;padding:.5rem .65rem;font-size:.73rem;color:#0ea5e9;line-height:1.45}
.dp-server-badge b{flex-shrink:0}
.dp-props-form{padding:.7rem .9rem 1.2rem}
.dp-field{margin-bottom:.85rem}
.dp-label{font-size:.73rem;font-weight:700;margin-bottom:.28rem;display:flex;align-items:center;gap:.3rem;color:var(--text)}
.dp-type-tag{font-size:.6rem;font-weight:600;color:var(--muted);background:var(--bg);
  border:1px solid var(--card-border);border-radius:4px;padding:.05rem .3rem}
.dp-field input,.dp-field select,.dp-field textarea{font-size:.82rem;padding:.48rem .65rem;border-radius:8px}
.dp-field textarea{min-height:72px}
.dp-color-row{display:flex;align-items:center;gap:.4rem}
.dp-color-row input[type=color]{width:32px;height:28px;padding:1px;border-radius:6px;cursor:pointer;flex-shrink:0}
.dp-color-row input[type=text]{flex:1}
.dp-check-row{display:flex;align-items:center;gap:.5rem;padding:.3rem 0}
.dp-check-row input[type=checkbox]{width:15px;height:15px;flex-shrink:0;cursor:pointer}
.dp-check-row span{font-size:.8rem;color:var(--muted)}
.dp-footer{
  flex-shrink:0;padding:.65rem .9rem;border-top:1px solid var(--panel-border);
  background:var(--panel-bg);display:flex;flex-direction:column;gap:.4rem}
.dp-footer .ghost,.dp-footer .btn-sm{width:100%;text-align:center;justify-content:center}

</style>
</head>
<body>
<button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">&#9681;</button>

<!-- ══════════════════ SETUP WIZARD ══════════════════ -->
<section id="setup" class="center hide">
  <div class="auth-card">
    <div class="brand">
      <div class="logo">P</div>
      <div><h1>Pressh</h1><p>Secure-by-default CMS</p></div>
    </div>
    <h2>Welcome aboard</h2>
    <p class="sub">Create your administrator account to get started — this only happens once.</p>
    <label for="su-email">Email</label>
    <input id="su-email" type="email" autocomplete="username" placeholder="you@example.com">
    <label for="su-password">Password</label>
    <input id="su-password" type="password" autocomplete="new-password" placeholder="At least 8 characters" oninput="strength()">
    <div class="meter"><span id="su-bar"></span></div>
    <div class="meter-label" id="su-strength"></div>
    <label for="su-confirm">Confirm password</label>
    <input id="su-confirm" type="password" autocomplete="new-password" placeholder="Re-enter password">
    <div id="su-error" class="alert hide"></div>
    <button id="su-btn" class="btn" onclick="doSetup()">Create account &amp; sign in</button>
    <p class="foot">Plugins run <b>sandboxed</b>. Your data stays yours.</p>
  </div>
</section>

<!-- ══════════════════ LOGIN ══════════════════ -->
<section id="login" class="center hide">
  <div class="auth-card">
    <div class="brand">
      <div class="logo">P</div>
      <div><h1>Pressh</h1><p>Secure-by-default CMS</p></div>
    </div>
    <h2>Sign in</h2>
    <p class="sub">Welcome back. Sign in to your Studio.</p>
    <label for="lg-email">Email</label>
    <input id="lg-email" type="email" autocomplete="username" placeholder="you@example.com">
    <label for="lg-password">Password</label>
    <input id="lg-password" type="password" autocomplete="current-password" placeholder="Your password">
    <div id="login-error" class="alert hide"></div>
    <button id="login-btn" class="btn" onclick="doLogin()">Sign in</button>
    <p class="foot">Pressh Studio</p>
  </div>
</section>

<!-- ══════════════════ DASHBOARD ══════════════════ -->
<section id="app" class="hide">
  <div class="topbar">
    <div class="logo">P</div>
    <h1>Pressh Studio</h1>
    <div class="spacer"></div>
    <a id="site-link" class="ghost" href="#" target="_blank" rel="noopener">View site &#8599;</a>
    <span class="who" id="who"></span>
    <button class="ghost" onclick="doLogout()">Sign out</button>
  </div>
  <div class="panel">
    <div class="row-head">
      <h2>Pages</h2>
      <button class="btn-sm" onclick="showNewPage()">+ New page</button>
    </div>
    <!-- Quick-create form (hidden until + New page) -->
    <div id="new-page-form" class="surface qc-wrap hide" style="margin-bottom:1rem">
      <div style="font-size:.92rem;font-weight:700;margin-bottom:.8rem">New page</div>
      <label for="pg-title">Title</label>
      <input id="pg-title" placeholder="e.g. About Us" oninput="suggestSlug()">
      <label for="pg-slug">Slug <span style="font-weight:400;color:var(--muted);font-size:.72rem">(letters, numbers, hyphens)</span></label>
      <input id="pg-slug" placeholder="about-us" oninput="this.dataset.touched=1">
      <div id="pg-error" class="alert hide"></div>
      <div style="display:flex;gap:.5rem;margin-top:.9rem">
        <button id="pg-save" class="btn-sm" onclick="createPage(false)">Create draft</button>
        <button class="btn-sm" onclick="createPage(true)" style="background:linear-gradient(135deg,#16a34a,#0ea5e9)">Create &amp; publish</button>
        <button class="ghost" onclick="hideNewPage()">Cancel</button>
      </div>
    </div>
    <!-- Pages list -->
    <div id="pages-list" class="surface"><div class="empty">Loading&hellip;</div></div>
  </div>
</section>

<!-- ══════════════════ PAGE DESIGNER ══════════════════ -->
<section id="designer" class="ds-shell hide">

  <!-- Top bar -->
  <div class="ds-topbar">
    <div class="logo">P</div>
    <button class="ds-back" onclick="closeDesigner()">&#8592; Back</button>
    <span class="ds-page-slug" id="ds-slug">/page</span>
    <div class="ds-sep"></div>
    <!-- Device switcher -->
    <button class="ds-device-btn active" id="dv-desktop" onclick="setDevice('desktop')" title="Desktop">&#128444;</button>
    <button class="ds-device-btn" id="dv-tablet" onclick="setDevice('tablet')" title="Tablet">&#9645;</button>
    <button class="ds-device-btn" id="dv-mobile" onclick="setDevice('mobile')" title="Mobile">&#128241;</button>
    <div class="ds-sep"></div>
    <button class="ds-undo-btn" onclick="undoD()" title="Undo (Ctrl+Z)">&#8629; Undo</button>
    <button class="ds-undo-btn" onclick="redoD()" title="Redo (Ctrl+Y)">&#8631; Redo</button>
    <div class="ds-sep"></div>
    <button class="ds-undo-btn" id="ds-border-btn" onclick="toggleBorders()" title="Show/hide component borders">&#9636; Borders</button>
    <div class="spacer"></div>
    <span class="ds-save-status" id="ds-save-status"></span>
    <button class="ghost" onclick="previewPage()" style="font-size:.8rem">Preview &#8599;</button>
    <button class="btn-sm" onclick="saveD(false)" id="ds-save-btn">Save draft</button>
    <button class="btn-sm" onclick="saveD(true)" id="ds-pub-btn" style="background:linear-gradient(135deg,#16a34a,#0ea5e9)">Publish</button>
  </div>

  <!-- 3-column body -->
  <div class="ds-body">

    <!-- ── LEFT: Components ── -->
    <div class="ds-left">
      <div class="ds-panel-head">
        <span class="ds-panel-title">Components</span>
        <span style="font-size:.7rem;color:var(--muted)" id="ds-comp-count"></span>
      </div>
      <div class="ds-left-search">
        <input type="text" placeholder="Search components…" oninput="filterComponents(this.value)">
      </div>
      <div class="ds-comp-list" id="ds-comp-list">
        <div class="empty" style="font-size:.8rem;padding:.75rem .25rem">Loading&hellip;</div>
      </div>
    </div>

    <!-- ── CENTRE: Canvas ── -->
    <div class="ds-canvas-wrap">
      <div class="ds-canvas-toolbar">
        <span class="ds-canvas-label">Canvas</span>
      </div>
      <div class="ds-canvas-scroll" id="ds-canvas-scroll">
        <div class="ds-canvas-inner dv-desktop" id="ds-canvas">
          <!-- nodes rendered here -->
        </div>
      </div>
    </div>

    <!-- ── RIGHT: Properties ── -->
    <div class="ds-right">
      <div class="ds-panel-head">
        <span class="ds-panel-title">Properties</span>
        <span style="font-size:.7rem;color:var(--muted)" id="ds-sel-name"></span>
      </div>
      <div class="ds-props-scroll" id="ds-props-scroll">
        <!-- empty state -->
        <div class="dp-empty">
          <div class="dp-empty-icon">&#9965;</div>
          <p class="dp-empty-title">No component selected</p>
          <p class="dp-empty-sub">Click any component on the canvas to edit its settings here</p>
        </div>
      </div>
      <div class="ds-footer-placeholder" id="ds-props-footer"></div>
    </div>

  </div>
</section>

<script>
// ═══════════════════════════════════════════════════
//  Globals
// ═══════════════════════════════════════════════════
var csrf = "";
var STATE = { types: [] };
var authed = false;   // set once /admin/api/me confirms a session

// Designer state
var D = {
  layout: [],       // LayoutNode[]
  fields: {},       // preserved revision fields (e.g. title) sent back on every save
  selected: null,   // selected node id
  comps: [],        // ComponentDef[] from API
  editingId: null,  // content entry id (the page UUID reflected in the URL hash)
  editingSlug: "",
  editingStatus: "",
  device: "desktop",
  showBorders: false,
  history: [],      // JSON snapshots (undo stack)
  histIdx: -1,
  dirty: false,     // unsaved edits since the last load/save
};

// ═══════════════════════════════════════════════════
//  Theme
// ═══════════════════════════════════════════════════
(function(){
  var s = localStorage.getItem("pressh-theme");
  var dark = s ? s === "dark" : window.matchMedia("(prefers-color-scheme:dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
function toggleTheme(){
  var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = n;
  localStorage.setItem("pressh-theme", n);
}

// ═══════════════════════════════════════════════════
//  Tiny helpers
// ═══════════════════════════════════════════════════
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escAttr(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;"); }
function show(id){ ["setup","login","app","designer"].forEach(function(s){ el(s).classList.add("hide"); }); el(id).classList.remove("hide"); }
function err(id, msg){ var e=el(id); e.textContent=msg; e.classList.remove("hide"); }
function clearErr(id){ el(id).classList.add("hide"); }
function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }

function strength(){
  var v=el("su-password").value, s=0;
  if(v.length>=8)s++; if(v.length>=12)s++;
  if(/[A-Z]/.test(v)&&/[a-z]/.test(v))s++; if(/[0-9]/.test(v))s++; if(/[^A-Za-z0-9]/.test(v))s++;
  var p=[0,25,45,65,85,100],c=["transparent","#e11d48","#d97706","#d97706","#16a34a","#16a34a"],l=["","Weak","Fair","Fair","Strong","Very strong"];
  el("su-bar").style.width=p[s]+"%"; el("su-bar").style.background=c[s];
  el("su-strength").textContent=v?l[s]:"";
}

async function api(path, opts){
  opts=opts||{};
  var h=Object.assign({"content-type":"application/json"},opts.headers||{});
  if(csrf && opts.method && opts.method!=="GET") h["x-csrf-token"]=csrf;
  var res=await fetch(path,Object.assign({headers:h,credentials:"same-origin"},opts));
  return {status:res.status,body:await res.json().catch(function(){return {};})};
}
function busy(id,on,lbl){ var b=el(id); b.disabled=on; b.textContent=on?lbl:b.dataset.label; }

// ═══════════════════════════════════════════════════
//  Auth
// ═══════════════════════════════════════════════════
async function doSetup(){
  clearErr("su-error");
  var email=el("su-email").value.trim(), pw=el("su-password").value;
  if(!email) return err("su-error","Please enter an email address.");
  if(pw.length<8) return err("su-error","Password must be at least 8 characters.");
  if(pw!==el("su-confirm").value) return err("su-error","Passwords do not match.");
  busy("su-btn",true,"Creating account…");
  var r=await api("/admin/api/setup",{method:"POST",body:JSON.stringify({email,password:pw})});
  busy("su-btn",false);
  if(r.status===200) return boot();
  err("su-error",(r.body.error&&r.body.error.message)||"Setup failed.");
}
async function doLogin(){
  clearErr("login-error");
  busy("login-btn",true,"Signing in…");
  var r=await api("/admin/api/auth/login",{method:"POST",body:JSON.stringify({email:el("lg-email").value.trim(),password:el("lg-password").value})});
  busy("login-btn",false);
  if(r.status===200) return boot();
  err("login-error","Invalid email or password.");
}
async function doLogout(){ D.dirty=false; await api("/admin/api/auth/logout",{method:"POST"}); location.reload(); }

// ═══════════════════════════════════════════════════
//  Routing — the URL hash is the source of truth so a
//  refresh restores the view (incl. the page being edited).
//    #/            → dashboard
//    #/page/<uuid> → designer editing that page
// ═══════════════════════════════════════════════════
function currentRoute(){
  var m=(location.hash||"").match(/^#\\/page\\/(.+)$/);
  return m?{view:"designer",id:decodeURIComponent(m[1])}:{view:"app"};
}
function navigate(hash){
  if((location.hash||"")===hash) applyRoute();   // already there → apply directly (no hashchange fires)
  else location.hash=hash;                        // triggers hashchange → applyRoute
}
async function applyRoute(){
  if(!authed) return;                             // ignore the hash on setup/login screens
  var route=currentRoute();
  if(route.view==="designer"){
    if(D.editingId===route.id && !el("designer").classList.contains("hide")) return; // already open
    var ok=await openDesigner(route.id);
    if(!ok) navigate("#/");                        // page missing/deleted → fall back home
    return;
  }
  teardownDesigner();
  show("app");
  loadPages();
}

async function boot(){
  var me=await api("/admin/api/me");
  if(me.status===200){
    authed=true;
    csrf=me.body.csrfToken;
    el("who").textContent=me.body.user.email;
    el("site-link").href=location.protocol+"//"+location.hostname+":3000";
    var tr=await api("/admin/api/types");
    STATE.types=tr.body.items||[];
    await applyRoute();   // honor the current URL (dashboard or a specific page)
    return;
  }
  authed=false;
  var st=await api("/admin/api/setup/status");
  show(st.body.needsSetup?"setup":"login");
}

// ═══════════════════════════════════════════════════
//  Pages list
// ═══════════════════════════════════════════════════
async function loadPages(){
  var r=await api("/admin/api/content");
  var items=r.body.items||[];
  var box=el("pages-list");
  if(!items.length){ box.innerHTML='<div class="empty">No pages yet. Click &ldquo;+ New page&rdquo; to create one.</div>'; return; }
  box.innerHTML=items.map(function(p){
    var type=STATE.types.find(function(t){ return t.id===p.typeId; });
    var label=type?esc(type.name):esc(p.slug);
    return '<div class="list-row">'+
      '<div class="grow"><div class="title">'+label+'</div>'+
        '<div class="meta">/'+esc(p.slug)+' &middot; rev '+(p.currentRevision||1)+'</div></div>'+
      '<span class="badge b-'+esc(p.status)+'">'+esc(p.status)+'</span>'+
      (p.status==="published"?'<a class="ghost" href="'+location.protocol+'//'+location.hostname+':3000/'+esc(p.slug)+'" target="_blank" rel="noopener">View</a>':'')+
      '<button class="btn-sm" onclick="navigate(\\'#/page/'+ esc(p.id) +'\\')">&#9998; Edit</button>'+
      (p.status==="published"
        ?'<button class="ghost" onclick="transition(\\''+ esc(p.id) +'\\',\\'draft\\')">Unpublish</button>'
        :'<button class="btn-sm" style="background:linear-gradient(135deg,#16a34a,#0ea5e9)" onclick="transition(\\''+ esc(p.id) +'\\',\\'published\\')">Publish</button>')+
      '</div>';
  }).join("");
}

async function transition(id,to){
  var path=to==="published"?"/admin/api/content/"+id+"/publish":"/admin/api/content/"+id+"/transition";
  await api(path,{method:"POST",body:JSON.stringify({to})});
  loadPages();
}

// ─── Quick create form ────────────────────────────
function showNewPage(){ el("new-page-form").classList.remove("hide"); el("pg-title").focus(); }
function hideNewPage(){ el("new-page-form").classList.add("hide"); clearErr("pg-error"); }
function suggestSlug(){
  var s=el("pg-slug");
  if(!s||s.dataset.touched) return;
  s.value=el("pg-title").value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}
async function createPage(publish){
  clearErr("pg-error");
  var title=el("pg-title").value.trim(), slug=el("pg-slug").value.trim();
  if(!title) return err("pg-error","A title is required.");
  if(!slug) return err("pg-error","A slug is required.");
  el("pg-save").disabled=true; el("pg-save").textContent="Creating…";
  var tr=await api("/admin/api/types",{method:"POST",body:JSON.stringify({name:title,slug,fields:[{id:"f0",name:"title",type:"text",required:true}]})});
  if(tr.status!==200){ el("pg-save").disabled=false; el("pg-save").textContent="Create draft"; return err("pg-error",(tr.body.error&&tr.body.error.message)||"Could not create."); }
  var typeId=tr.body.data.id;
  var er=await api("/admin/api/content",{method:"POST",body:JSON.stringify({typeId,slug,fields:{title},blocks:[]})});
  if(er.status!==200){ el("pg-save").disabled=false; el("pg-save").textContent="Create draft"; return err("pg-error",(er.body.error&&er.body.error.message)||"Could not create."); }
  var entryId=er.body.data.id;
  if(publish&&entryId) await api("/admin/api/content/"+entryId+"/publish",{method:"POST",body:"{}"});
  var tr2=await api("/admin/api/types"); STATE.types=tr2.body.items||[];
  hideNewPage();
  await loadPages();
  if(entryId) navigate("#/page/"+entryId);
}

// ═══════════════════════════════════════════════════
//  PAGE DESIGNER
// ═══════════════════════════════════════════════════

// ─── Load component definitions (once) ───────────
async function loadCompDefs(){
  if(D.comps.length) return;
  var r=await api("/admin/api/components");
  D.comps=r.body.items||[];
}

// ─── Open designer ────────────────────────────────
async function openDesigner(id){
  await loadCompDefs();
  var r=await api("/admin/api/content/"+id);
  if(r.status!==200){ return false; }
  var entry=r.body.entry;
  var rev=r.body.revision||{blocks:[],fields:{}};
  D.editingId=id; D.editingSlug=entry.slug; D.editingStatus=entry.status;
  D.fields=rev.fields||{};
  D.selected=null; D.history=[]; D.histIdx=-1;
  var blocks=rev.blocks||[];
  var lb=blocks.find(function(b){ return b.type==="designer-layout"; });
  D.layout=lb?((lb.props&&lb.props.nodes)||[]):[];
  el("ds-slug").textContent="/"+entry.slug;
  el("ds-pub-btn").textContent=entry.status==="published"?"Update & publish":"Publish";
  setSaveStatus("");
  show("designer");
  renderCompList();
  renderCanvas();
  renderProps();
  pushHist();
  D.dirty=false;   // freshly loaded state is not "unsaved"
  // Keyboard shortcuts
  document.onkeydown=function(e){
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==="z"){ e.preventDefault(); undoD(); }
    if((e.ctrlKey||e.metaKey)&&(e.shiftKey&&e.key==="z"||e.key==="y")){ e.preventDefault(); redoD(); }
    if(e.key==="Escape"){ if(D.selected){ D.selected=null; highlightSelected(); renderProps(); } }
  };
  return true;
}

// Back button → navigate home; the router runs teardownDesigner().
function closeDesigner(){
  if(D.dirty && !confirm("You have unsaved changes. Leave the designer and discard them?")) return;
  navigate("#/");
}
function teardownDesigner(){
  document.onkeydown=null;
  D.editingId=null;
  D.dirty=false;
}

function setSaveStatus(msg){ el("ds-save-status").textContent=msg; }

// ─── Device switcher ──────────────────────────────
function setDevice(dv){
  D.device=dv;
  ["desktop","tablet","mobile"].forEach(function(d){
    el("dv-"+d).classList.toggle("active",d===dv);
    var ci=el("ds-canvas");
    ci.classList.remove("dv-desktop","dv-tablet","dv-mobile");
    ci.classList.add("dv-"+D.device);
  });
}

// ═══════════════════════════════════════════════════
//  LEFT PANEL — component palette
// ═══════════════════════════════════════════════════
var CAT_ORDER=["layout","content","media","data"];
var CAT_LABELS={layout:"Layout",content:"Content",media:"Media",data:"Data · Server"};

function renderCompList(){
  var total=D.comps.length;
  el("ds-comp-count").textContent=total+" component"+(total!==1?"s":"");
  el("ds-comp-list").innerHTML=buildPaletteHtml(D.comps);
}

function buildPaletteHtml(comps){
  if(!comps.length) return '<div class="empty" style="font-size:.8rem;padding:.75rem .25rem">No components found</div>';
  var bycat={};
  CAT_ORDER.forEach(function(c){ bycat[c]=[]; });
  comps.forEach(function(c){ (bycat[c.category]=bycat[c.category]||[]).push(c); });
  var html="";
  CAT_ORDER.forEach(function(cat){
    var list=bycat[cat]; if(!list||!list.length) return;
    html+='<div class="ds-cat-label">'+esc(CAT_LABELS[cat]||cat)+'</div>';
    list.forEach(function(c){
      html+='<div class="ds-comp-item" draggable="true"'+
        ' ondragstart="palDragStart(event,\\''+ esc(c.id) +'\\')"'+
        ' onclick="addComp(\\''+ esc(c.id) +'\\')"'+
        ' title="'+ escAttr(c.description) +'"'+
        ' data-cid="'+ escAttr(c.id) +'"'+
        '>'+
          '<span class="dci-icon">'+ esc(c.icon) +'</span>'+
          '<div class="dci-text">'+
            '<div class="dci-name">'+ esc(c.name) +'</div>'+
            '<div class="dci-desc">'+ esc(c.description) +'</div>'+
          '</div>'+
          (c.hasServerData?'<span class="dci-server">SERVER</span>':'')+
        '</div>';
    });
  });
  return html;
}

function filterComponents(q){
  q=q.trim().toLowerCase();
  if(!q){ renderCompList(); return; }
  var filtered=D.comps.filter(function(c){
    return c.name.toLowerCase().includes(q)||c.description.toLowerCase().includes(q);
  });
  el("ds-comp-list").innerHTML=buildPaletteHtml(filtered);
}

function palDragStart(e, cid){
  e.dataTransfer.effectAllowed="copy";
  e.dataTransfer.setData("ps-cid",cid);
}

// ═══════════════════════════════════════════════════
//  CENTRE — Canvas
// ═══════════════════════════════════════════════════
function renderCanvas(){
  var canvas=el("ds-canvas");
  if(!D.layout.length){
    canvas.innerHTML=
      '<div class="dc-empty" id="dc-empty" ondragover="emptyDragOver(event)" ondrop="emptyDrop(event)">'+
        '<div class="dc-empty-icon">&#43;</div>'+
        '<div class="dc-empty-title">Your page is empty</div>'+
        '<div class="dc-empty-sub">Drag a component from the left panel, or click any component to add it</div>'+
      '</div>';
    return;
  }
  var html=dz(0);
  D.layout.forEach(function(node,i){
    var sel=D.selected===node.id?" selected":"";
    html+=
      '<div class="dc-node'+sel+'" id="cn-'+esc(node.id)+'"'+
          ' draggable="true"'+
          ' ondragstart="nodeDragStart(event,\\''+ esc(node.id) +'\\')"'+
          ' onclick="selectNode(\\''+ esc(node.id) +'\\')" data-idx="'+i+'">'+
        '<div class="dc-node-preview" id="cnp-'+ esc(node.id) +'">'+
          '<div class="dc-preview-placeholder"><span>&#8987;</span> Loading preview…</div>'+
        '</div>'+
      '</div>'+
      dz(i+1);
  });
  html+='<div class="dc-add-row"><button class="ghost" onclick="scrollToLeft()" style="font-size:.78rem">&#43; Add component</button></div>';
  canvas.innerHTML=html;
  D.layout.forEach(function(node){ fetchPreview(node); });
}

function dz(idx){
  return '<div class="dc-dropzone"'+
    ' ondragover="dzOver(event)"'+
    ' ondragleave="dzLeave(event)"'+
    ' ondrop="dzDrop(event,'+ idx +')"'+
  '></div>';
}

function nodeDragStart(e, nid){
  if(e.target.closest&&e.target.closest('button')){ e.preventDefault(); return; }
  e.dataTransfer.effectAllowed="move";
  e.dataTransfer.setData("ps-nid", nid);
}
function toggleBorders(){
  D.showBorders=!D.showBorders;
  el("designer").classList.toggle("ds-show-borders", D.showBorders);
  el("ds-border-btn").classList.toggle("active", D.showBorders);
}

function emptyDragOver(e){ e.preventDefault(); e.currentTarget.classList.add("dragover"); }
function emptyDrop(e){
  e.preventDefault(); e.currentTarget.classList.remove("dragover");
  var cid=e.dataTransfer.getData("ps-cid"); if(cid) addComp(cid);
}
function dzOver(e){ e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add("dragover"); }
function dzLeave(e){ e.currentTarget.classList.remove("dragover"); }
function dzDrop(e,idx){
  e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove("dragover");
  var nid=e.dataTransfer.getData("ps-nid");
  if(nid){
    var fi=D.layout.findIndex(function(n){ return n.id===nid; }); if(fi<0) return;
    if(idx===fi||idx===fi+1) return;
    var moved=D.layout.splice(fi,1)[0];
    var ti=fi<idx?idx-1:idx;
    D.layout.splice(ti,0,moved);
    renderCanvas(); selectNode(nid); pushHist();
    return;
  }
  var cid=e.dataTransfer.getData("ps-cid"); if(!cid) return;
  addCompAt(cid,idx);
}

function addComp(cid){ addCompAt(cid,null); }
function addCompAt(cid,idx){
  var def=D.comps.find(function(c){ return c.id===cid; }); if(!def) return;
  var node={id:uid(),componentId:cid,props:JSON.parse(JSON.stringify(def.defaultProps||{}))};
  if(idx===null||idx>=D.layout.length) D.layout.push(node);
  else D.layout.splice(idx,0,node);
  renderCanvas();
  selectNode(node.id);
  pushHist();
}

function removeNode(id){
  D.layout=D.layout.filter(function(n){ return n.id!==id; });
  if(D.selected===id){ D.selected=null; }
  renderCanvas(); renderProps(); pushHist();
}

function moveNode(id,dir){
  var i=D.layout.findIndex(function(n){ return n.id===id; }); if(i<0) return;
  var j=i+dir; if(j<0||j>=D.layout.length) return;
  var t=D.layout[i]; D.layout[i]=D.layout[j]; D.layout[j]=t;
  renderCanvas(); pushHist();
}

function selectNode(id){
  D.selected=id;
  highlightSelected();
  renderProps();
  // Scroll canvas node into view
  var node=el("cn-"+id);
  if(node) node.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function highlightSelected(){
  document.querySelectorAll(".dc-node").forEach(function(n){ n.classList.remove("selected"); });
  if(D.selected){ var n=el("cn-"+D.selected); if(n) n.classList.add("selected"); }
}

function scrollToLeft(){
  el("ds-comp-list").scrollIntoView({behavior:"smooth",block:"start"});
}

// ─── Preview fetch (debounced) ────────────────────
var _pvTimers={};
async function fetchPreview(node){
  var box=el("cnp-"+node.id); if(!box) return;
  try{
    var r=await api("/admin/api/preview/component",{method:"POST",body:JSON.stringify({componentId:node.componentId,props:node.props})});
    if(!r.body.html){ box.innerHTML='<div class="dc-preview-placeholder">No preview</div>'; return; }
    box.innerHTML='<iframe srcdoc="'+ escAttr(r.body.html) +'" sandbox="allow-same-origin" style="width:100%;border:none;display:block;pointer-events:none" onload="resizeIframe(this)"></iframe>';
  }catch(ex){
    box.innerHTML='<div class="dc-preview-placeholder" style="color:#e11d48">Preview failed</div>';
  }
}
function resizeIframe(fr){
  try{ fr.style.height=Math.max(64,fr.contentDocument.documentElement.scrollHeight)+"px"; }catch(e){}
}
function schedulePv(node){
  clearTimeout(_pvTimers[node.id]);
  _pvTimers[node.id]=setTimeout(function(){ fetchPreview(node); },650);
}

// ═══════════════════════════════════════════════════
//  RIGHT PANEL — Properties
// ═══════════════════════════════════════════════════
function renderProps(){
  var scroll=el("ds-props-scroll");
  var footer=el("ds-props-footer");
  el("ds-sel-name").textContent="";

  if(!D.selected){
    scroll.innerHTML=
      '<div class="dp-empty">'+
        '<div class="dp-empty-icon">&#9965;</div>'+
        '<p class="dp-empty-title">No component selected</p>'+
        '<p class="dp-empty-sub">Click any component on the canvas to edit its settings here</p>'+
      '</div>';
    footer.innerHTML="";
    return;
  }
  var node=D.layout.find(function(n){ return n.id===D.selected; });
  if(!node){ scroll.innerHTML='<div class="dp-empty"><p class="dp-empty-title">Not found</p></div>'; footer.innerHTML=""; return; }
  var def=D.comps.find(function(c){ return c.id===node.componentId; });
  if(!def){ scroll.innerHTML='<div class="dp-empty"><p class="dp-empty-title">Unknown component</p></div>'; footer.innerHTML=""; return; }

  el("ds-sel-name").textContent=def.name;

  var html='<div class="dp-comp-header">'+
    '<div class="dp-comp-title"><span>'+ esc(def.icon) +'</span>'+ esc(def.name) +'</div>'+
    '<div class="dp-comp-desc">'+ esc(def.description) +'</div>';
  if(def.hasServerData){
    html+='<div class="dp-server-badge"><b>&#9881; Server</b>&nbsp;Logic runs on Node and data is fetched fresh on every page render.</div>';
  }
  html+='</div><div class="dp-props-form">';

  Object.keys(def.props||{}).forEach(function(key){
    var pd=def.props[key];
    var val=node.props[key]!=null?node.props[key]:(def.defaultProps[key]!=null?def.defaultProps[key]:"");
    var nid=esc(node.id); var k=esc(key);
    html+='<div class="dp-field"><label class="dp-label">'+
      esc(pd.label)+'<span class="dp-type-tag">'+esc(pd.type)+'</span></label>';

    if(pd.type==="color"){
      html+='<div class="dp-color-row">'+
        '<input type="color" value="'+ escAttr(val) +'" oninput="propSet(\\''+ nid +'\\',\\''+ k +'\\',this.value)">'+
        '<input type="text" value="'+ escAttr(val) +'" placeholder="#rrggbb or name" oninput="propSet(\\''+ nid +'\\',\\''+ k +'\\',this.value)">'+
        '</div>';
    }else if(pd.type==="select"){
      html+='<select onchange="propSet(\\''+ nid +'\\',\\''+ k +'\\',this.value)">';
      (pd.options||[]).forEach(function(o){
        html+='<option'+(o===String(val)?' selected':'')+' value="'+ escAttr(o) +'">'+ esc(o) +'</option>';
      });
      html+='</select>';
    }else if(pd.type==="boolean"){
      html+='<div class="dp-check-row">'+
        '<input type="checkbox"'+(val?' checked':'')+' onchange="propSet(\\''+ nid +'\\',\\''+ k +'\\',this.checked)">'+
        '<span>'+ esc(pd.label) +'</span></div>';
    }else if(pd.type==="richtext"){
      html+='<textarea rows="4" oninput="propSet(\\''+ nid +'\\',\\''+ k +'\\',this.value)">'+ esc(val) +'</textarea>';
    }else if(pd.type==="number"){
      html+='<input type="number" value="'+ escAttr(val) +'"'+
        (pd.min!=null?' min="'+pd.min+'"':'')+
        (pd.max!=null?' max="'+pd.max+'"':'')+
        ' oninput="propSet(\\''+ nid +'\\',\\''+ k +'\\',Number(this.value))">';
    }else{
      html+='<input type="text" value="'+ escAttr(val) +'" placeholder="'+ escAttr(pd.placeholder||"") +'" oninput="propSet(\\''+ nid +'\\',\\''+ k +'\\',this.value)">';
    }
    html+='</div>';
  });

  html+='</div>';
  scroll.innerHTML=html;

  footer.innerHTML=
    '<div class="ds-footer-placeholder" style="padding:.65rem .9rem;border-top:1px solid var(--panel-border);display:flex;flex-direction:column;gap:.4rem;background:var(--panel-bg)">'+
      '<div style="display:flex;gap:.4rem">'+
        '<button class="ghost" style="flex:1;text-align:center" onclick="moveNode(\\''+ esc(node.id) +'\\', -1)" title="Move up">&#8593; Move up</button>'+
        '<button class="ghost" style="flex:1;text-align:center" onclick="moveNode(\\''+ esc(node.id) +'\\', 1)" title="Move down">&#8595; Move down</button>'+
      '</div>'+
      '<button class="ghost" style="text-align:center" onclick="dupeNode(\\''+ esc(node.id) +'\\')">&#10070; Duplicate</button>'+
      '<button class="ghost danger" style="text-align:center" onclick="removeNode(\\''+ esc(node.id) +'\\')">&#10005; Remove component</button>'+
    '</div>';
}

function propSet(nodeId, key, value){
  var node=D.layout.find(function(n){ return n.id===nodeId; }); if(!node) return;
  node.props[key]=value;
  D.dirty=true;
  schedulePv(node);
}

function dupeNode(id){
  var idx=D.layout.findIndex(function(n){ return n.id===id; }); if(idx<0) return;
  var src=D.layout[idx];
  var clone={id:uid(),componentId:src.componentId,props:JSON.parse(JSON.stringify(src.props))};
  D.layout.splice(idx+1,0,clone);
  renderCanvas(); selectNode(clone.id); pushHist();
}

// ═══════════════════════════════════════════════════
//  History (undo / redo)
// ═══════════════════════════════════════════════════
function pushHist(){
  D.history=D.history.slice(0,D.histIdx+1);
  D.history.push(JSON.stringify(D.layout));
  D.histIdx=D.history.length-1;
  if(D.history.length>60){ D.history.shift(); D.histIdx--; }
  D.dirty=true;
}
function undoD(){
  if(D.histIdx<=0) return;
  D.histIdx--;
  D.layout=JSON.parse(D.history[D.histIdx]);
  if(D.selected&&!D.layout.find(function(n){ return n.id===D.selected; })) D.selected=null;
  renderCanvas(); renderProps(); D.dirty=true;
}
function redoD(){
  if(D.histIdx>=D.history.length-1) return;
  D.histIdx++;
  D.layout=JSON.parse(D.history[D.histIdx]);
  renderCanvas(); renderProps(); D.dirty=true;
}

// ═══════════════════════════════════════════════════
//  Save / Publish / Preview
// ═══════════════════════════════════════════════════
async function saveD(publish){
  var saveBtn=el("ds-save-btn"), pubBtn=el("ds-pub-btn");
  saveBtn.disabled=true; pubBtn.disabled=true;
  setSaveStatus("Saving…");
  var blocks=[{type:"designer-layout",props:{nodes:D.layout}}];
  var r=await api("/admin/api/content/"+D.editingId,{method:"PUT",body:JSON.stringify({fields:D.fields,blocks})});
  if(r.status!==200){
    saveBtn.disabled=false; pubBtn.disabled=false;
    setSaveStatus("Save failed ✗");
    setTimeout(function(){ setSaveStatus(""); },3000);
    return;
  }
  D.dirty=false;
  if(publish){
    await api("/admin/api/content/"+D.editingId+"/publish",{method:"POST",body:"{}"});
    D.editingStatus="published";
    pubBtn.textContent="Update & publish";
    setSaveStatus("Published ✓");
  } else {
    setSaveStatus("Saved ✓");
  }
  saveBtn.disabled=false; pubBtn.disabled=false;
  setTimeout(function(){ setSaveStatus(""); },2500);
}

function previewPage(){
  window.open(location.protocol+"//"+location.hostname+":3000/"+D.editingSlug,"_blank");
}

// ═══════════════════════════════════════════════════
//  Startup
// ═══════════════════════════════════════════════════
el("su-btn").dataset.label="Create account & sign in";
el("login-btn").dataset.label="Sign in";
el("pg-save").dataset.label="Create draft";

// React to back/forward navigation and manual hash edits.
window.addEventListener("hashchange", function(){ applyRoute(); });
// Warn before a refresh/close would drop unsaved designer edits.
window.addEventListener("beforeunload", function(e){
  if(authed && D.editingId && D.dirty){ e.preventDefault(); e.returnValue=""; }
});

boot();
</script>
</body>
</html>`;
