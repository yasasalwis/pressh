/** Pressh Studio admin client styles — design tokens, auth, shell+sidebar, sections, designer. */
export const STYLES = String.raw`
/* ─── Design tokens ─────────────────────────────────────────── */
:root {
  --brand:#6d28d9; --brand-2:#0ea5e9; --ring:rgba(109,40,217,.3);
  --bg:#f1f3f9; --card:#fff; --card-border:rgba(15,23,42,.08);
  --text:#0f172a; --muted:#64748b;
  --field:#fff; --field-border:#e2e8f0;
  --shadow:0 24px 60px -20px rgba(15,23,42,.22);
  --panel-bg:#fff; --panel-border:rgba(15,23,42,.09);
  --canvas-bg:#dfe3ed;
  --sidebar-bg:#fff; --sidebar-w:236px;
  --topbar-h:52px; --panel-w-left:260px; --panel-w-right:288px;
  --ok:#16a34a; --warn:#d97706; --danger:#e11d48;
}
[data-theme=dark] {
  --bg:#070b16; --card:#0f1729; --card-border:rgba(148,163,184,.13);
  --text:#e7ecf3; --muted:#94a3b8;
  --field:#0b1322; --field-border:rgba(148,163,184,.2);
  --shadow:0 30px 70px -25px rgba(0,0,0,.7);
  --panel-bg:#0f1729; --panel-border:rgba(148,163,184,.13);
  --canvas-bg:#0b0f1d; --sidebar-bg:#0b1222;
}

/* ─── Reset / base ──────────────────────────────────────────── */
*{box-sizing:border-box}
body{margin:0;min-height:100vh;color:var(--text);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:var(--bg);-webkit-font-smoothing:antialiased}
.hide{display:none!important}
a{color:inherit}

/* ─── Auth screens ──────────────────────────────────────────── */
.center{min-height:100vh;display:grid;place-items:center;padding:1.5rem;
  background:radial-gradient(60rem 60rem at 12% -10%,rgba(109,40,217,.10),transparent 60%),
             radial-gradient(50rem 50rem at 110% 10%,rgba(14,165,233,.10),transparent 55%),var(--bg)}
.auth-card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--card-border);
  border-radius:22px;padding:2.25rem 2rem;box-shadow:var(--shadow);
  animation:rise .45s cubic-bezier(.2,.8,.2,1)}
@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
.brand{display:flex;align-items:center;gap:.75rem;margin-bottom:1.4rem}
.logo{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;
  color:#fff;font-weight:800;font-size:1.35rem;letter-spacing:-.02em;
  background:linear-gradient(135deg,var(--brand),var(--brand-2));box-shadow:0 10px 24px -8px var(--ring)}
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
  background:linear-gradient(135deg,var(--brand),var(--brand-2));transition:opacity .12s,transform .12s}
.btn-sm:hover{opacity:.88;transform:translateY(-1px)}
.btn-sm[disabled]{opacity:.55;cursor:progress;transform:none}
.btn-ok{background:linear-gradient(135deg,#16a34a,#0ea5e9)}
.ghost{background:transparent;border:1px solid var(--card-border);color:var(--text);
  border-radius:9px;padding:.42rem .75rem;cursor:pointer;font-size:.8rem;
  text-decoration:none;display:inline-block;white-space:nowrap;transition:border-color .15s,color .15s}
.ghost:hover{border-color:var(--brand);color:var(--brand)}
.danger{color:#e11d48!important;border-color:rgba(225,29,72,.35)!important}
.danger:hover{background:rgba(225,29,72,.06)!important;color:#e11d48!important}
.alert{margin-top:.9rem;padding:.6rem .75rem;border-radius:9px;font-size:.82rem;
  background:rgba(225,29,72,.1);color:#e11d48;border:1px solid rgba(225,29,72,.22)}
.notice{margin-top:.9rem;padding:.6rem .75rem;border-radius:9px;font-size:.82rem;
  background:rgba(14,165,233,.1);color:#0ea5e9;border:1px solid rgba(14,165,233,.22)}
.meter{height:5px;border-radius:999px;background:var(--field-border);margin-top:.5rem;overflow:hidden}
.meter>span{display:block;height:100%;width:0;border-radius:999px;transition:width .25s,background .25s}
.meter-label{font-size:.7rem;color:var(--muted);margin-top:.25rem;min-height:.85rem}
.foot{margin-top:1.4rem;text-align:center;font-size:.7rem;color:var(--muted)}
.foot b{color:var(--text)}

/* ─── Theme toggle (floating, auth only) ────────────────────── */
.theme-toggle{position:fixed;top:.9rem;right:.9rem;width:36px;height:36px;border-radius:50%;
  border:1px solid var(--card-border);background:var(--card);color:var(--text);cursor:pointer;
  font-size:.95rem;display:grid;place-items:center;box-shadow:var(--shadow);z-index:100}

/* ═══════════════════════════════════════════════════════════════
   APP SHELL  —  sidebar + main
   ═══════════════════════════════════════════════════════════════ */
.shell{display:grid;grid-template-columns:var(--sidebar-w) 1fr;min-height:100vh}

.sidebar{display:flex;flex-direction:column;background:var(--sidebar-bg);
  border-right:1px solid var(--card-border);position:sticky;top:0;height:100vh;overflow-y:auto}
.sb-brand{display:flex;align-items:center;gap:.6rem;padding:.95rem 1rem;border-bottom:1px solid var(--card-border)}
.sb-brand .logo{width:32px;height:32px;border-radius:9px;font-size:.9rem}
.sb-brand h1{font-size:.95rem;margin:0;font-weight:800}
.sb-brand p{font-size:.66rem;margin:.1rem 0 0;color:var(--muted)}
.sb-nav{flex:1;padding:.6rem .55rem}
.nav-group-label{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.09em;
  color:var(--muted);padding:.85rem .6rem .3rem;user-select:none}
.nav-item{display:flex;align-items:center;gap:.6rem;padding:.5rem .65rem;border-radius:9px;
  cursor:pointer;color:var(--text);font-size:.85rem;font-weight:600;border:1px solid transparent;
  text-decoration:none;margin-bottom:.1rem;transition:background .1s,border-color .12s,color .12s}
.nav-item:hover{background:rgba(109,40,217,.06)}
.nav-item.active{background:rgba(109,40,217,.1);border-color:rgba(109,40,217,.2);color:var(--brand)}
.nav-item .ico{width:20px;text-align:center;flex-shrink:0;font-size:.95rem}
.nav-item .pill{margin-left:auto;font-size:.62rem;font-weight:700;background:var(--field-border);
  color:var(--muted);border-radius:999px;padding:.05rem .4rem}
.sb-foot{border-top:1px solid var(--card-border);padding:.7rem .8rem;display:flex;flex-direction:column;gap:.5rem}
.sb-user{font-size:.76rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-foot .row{display:flex;gap:.4rem}
.sb-foot .ghost{flex:1;text-align:center}

.main{display:flex;flex-direction:column;min-width:0}
.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:.65rem;
  height:var(--topbar-h);padding:0 1.4rem;background:var(--card);border-bottom:1px solid var(--card-border)}
.topbar h2{font-size:1rem;margin:0;font-weight:800;letter-spacing:-.01em}
.topbar .crumb{font-size:.78rem;color:var(--muted)}
.spacer{flex:1}
.view{padding:1.5rem 1.6rem 5rem;max-width:1080px;width:100%;margin:0 auto;animation:fade .2s ease}
@keyframes fade{from{opacity:0}to{opacity:1}}

/* ─── Cards, tables, generic surfaces ───────────────────────── */
.card{background:var(--card);border:1px solid var(--card-border);border-radius:16px;
  padding:1.1rem;box-shadow:var(--shadow);margin-bottom:1.1rem}
.card h3{margin:0 0 .2rem;font-size:1rem;font-weight:800}
.card .hint{font-size:.78rem;color:var(--muted);margin:0 0 .9rem;line-height:1.5}
.row-head{display:flex;align-items:center;justify-content:space-between;margin:.1rem 0 1rem;gap:1rem}
.row-head h2{font-size:1.1rem;margin:0;font-weight:800}
.empty{color:var(--muted);font-size:.88rem;padding:1.2rem .3rem;text-align:center}
.empty .ico{font-size:1.8rem;display:block;opacity:.4;margin-bottom:.4rem}
.loading{color:var(--muted);font-size:.85rem;padding:1rem .3rem}

.list-row{display:flex;align-items:center;gap:.6rem;padding:.65rem .15rem;border-top:1px solid var(--card-border)}
.list-row:first-child{border-top:0}
.list-row .grow{flex:1;min-width:0}
.list-row .title{font-weight:600;font-size:.9rem;overflow:hidden;text-overflow:ellipsis}
.list-row .meta{font-size:.75rem;color:var(--muted)}

table.tbl{width:100%;border-collapse:collapse;font-size:.85rem}
table.tbl th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);font-weight:800;padding:.4rem .6rem;border-bottom:1px solid var(--card-border)}
table.tbl td{padding:.6rem .6rem;border-bottom:1px solid var(--card-border);vertical-align:middle}
table.tbl tr:last-child td{border-bottom:0}
table.tbl .actions{display:flex;gap:.35rem;justify-content:flex-end}

.badge{font-size:.66rem;font-weight:700;padding:.13rem .48rem;border-radius:999px;text-transform:capitalize;white-space:nowrap}
.b-draft{background:rgba(217,119,6,.14);color:#d97706}
.b-published{background:rgba(22,163,74,.14);color:#16a34a}
.b-in_review{background:rgba(14,165,233,.14);color:#0ea5e9}
.b-scheduled{background:rgba(109,40,217,.14);color:#6d28d9}
.b-archived{background:rgba(100,116,139,.16);color:#64748b}
.b-active{background:rgba(22,163,74,.14);color:#16a34a}
.b-disabled{background:rgba(225,29,72,.14);color:#e11d48}
.tag{display:inline-block;font-size:.66rem;font-weight:700;background:var(--field-border);
  color:var(--muted);border-radius:6px;padding:.1rem .42rem;margin:.1rem .2rem .1rem 0}
.tag.cap{background:rgba(14,165,233,.12);color:#0ea5e9}
.iconbtn{background:transparent;border:1px solid var(--card-border);color:var(--muted);
  border-radius:7px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem;transition:border-color .12s,color .12s}
.iconbtn:hover{border-color:var(--brand);color:var(--brand)}

.field-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.2rem 1rem}
.field-grid .full{grid-column:1/-1}
.dashboard-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.stat{background:var(--card);border:1px solid var(--card-border);border-radius:14px;padding:1rem 1.1rem}
.stat .n{font-size:1.7rem;font-weight:800;letter-spacing:-.02em}
.stat .l{font-size:.76rem;color:var(--muted);margin-top:.15rem}
.stat.clickable{cursor:pointer;transition:border-color .12s,transform .12s}
.stat.clickable:hover{border-color:var(--brand);transform:translateY(-2px)}

.tk-group{margin-bottom:1rem}
.tk-group h4{font-size:.78rem;margin:.2rem 0 .5rem;color:var(--muted);text-transform:capitalize;font-weight:800}
.color-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem}
.color-row label{margin:0;flex:1;font-weight:600}
.color-row input[type=color]{width:34px;height:30px;padding:1px;border-radius:7px;cursor:pointer;flex:0 0 auto}
.color-row input[type=text]{flex:0 0 130px}

.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.9rem}
.media-tile{border:1px solid var(--card-border);border-radius:12px;overflow:hidden;background:var(--card)}
.media-tile .thumb{aspect-ratio:4/3;background:var(--bg);display:grid;place-items:center;overflow:hidden}
.media-tile .thumb img{width:100%;height:100%;object-fit:cover}
.media-tile .thumb .ext{font-size:1.4rem;font-weight:800;color:var(--muted)}
.media-tile .mi{padding:.5rem .6rem;display:flex;align-items:center;gap:.4rem}
.media-tile .mi .nm{flex:1;min-width:0;font-size:.74rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dropzone{border:2px dashed var(--card-border);border-radius:12px;padding:1.5rem;text-align:center;
  color:var(--muted);font-size:.84rem;cursor:pointer;transition:border-color .15s,background .15s}
.dropzone.dragover{border-color:var(--brand);background:rgba(109,40,217,.06)}

/* ─── Header-nav toggle switch ──────────────────────────────── */
.sw{position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0;vertical-align:middle}
.sw input{opacity:0;position:absolute;width:0;height:0;margin:0}
.sw-track{display:block;width:34px;height:19px;background:var(--field-border);border-radius:999px;transition:background .2s;position:relative}
.sw-track::after{content:'';position:absolute;width:15px;height:15px;background:#fff;border-radius:50%;top:2px;left:2px;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.sw input:checked+.sw-track{background:var(--brand)}
.sw input:checked+.sw-track::after{transform:translateX(15px)}
.nav-lbl{font-size:.72rem;color:var(--muted);font-weight:600;margin-left:.25rem;white-space:nowrap}
/* ─── Appearance search + data sources ──────────────────────── */
.srch-bar{position:relative}
.srch-bar::before{content:'\1F50D';position:absolute;left:.72rem;top:50%;transform:translateY(-50%);font-size:.7rem;pointer-events:none;opacity:.45}
.srch-bar input{padding-left:2rem;font-size:.82rem}
.src-item{display:flex;align-items:center;gap:.65rem;padding:.5rem 0;border-top:1px solid var(--card-border);font-size:.85rem}
.src-item:first-child{border-top:0}
.src-item input[type=checkbox]{width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--brand)}
.src-item .src-name{font-weight:600}
.src-item .src-slug{font-size:.72rem;color:var(--muted)}
/* ─── Generic checkbox label row ─────────────────────────────── */
.dp-check-row{display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.82rem;font-weight:600;padding:.25rem 0}
.dp-check-row input{width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--brand)}
.audit-row{font-size:.8rem;padding:.5rem .15rem;border-top:1px solid var(--card-border);display:flex;gap:.7rem;align-items:baseline}
.audit-row:first-child{border-top:0}
.audit-row .a-time{color:var(--muted);font-size:.72rem;white-space:nowrap;flex:0 0 auto;width:140px}
.audit-row .a-act{font-weight:700;font-family:ui-monospace,monospace;font-size:.74rem}
.audit-row .a-det{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ─── Modal + toast ─────────────────────────────────────────── */
.modal-bg{position:fixed;inset:0;background:rgba(2,6,23,.55);z-index:200;display:grid;place-items:center;padding:1.5rem;animation:fade .15s ease}
.modal{background:var(--card);border:1px solid var(--card-border);border-radius:18px;
  width:100%;max-width:440px;padding:1.4rem 1.5rem;box-shadow:var(--shadow);animation:rise .2s ease}
.modal h3{margin:0 0 .3rem;font-size:1.1rem;font-weight:800}
.modal .hint{font-size:.8rem;color:var(--muted);margin:0 0 1rem;line-height:1.5}
.modal .actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:1.2rem}
.copybox{display:flex;gap:.4rem;margin-top:.4rem}
.copybox input{font-family:ui-monospace,monospace;font-size:.8rem}
#toast{position:fixed;bottom:1.4rem;left:50%;transform:translateX(-50%) translateY(20px);
  background:#0f172a;color:#fff;padding:.7rem 1.1rem;border-radius:11px;font-size:.84rem;font-weight:600;
  box-shadow:0 16px 40px -12px rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:300}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
#toast.err{background:#7f1d1d}

@media(max-width:760px){
  .shell{grid-template-columns:1fr}
  .sidebar{position:fixed;left:0;top:0;z-index:50;width:var(--sidebar-w);transform:translateX(-100%);transition:transform .2s}
  .sidebar.open{transform:none}
  .field-grid{grid-template-columns:1fr}
}
.menu-btn{display:none;background:transparent;border:1px solid var(--card-border);border-radius:8px;
  padding:.3rem .55rem;cursor:pointer;color:var(--text)}
@media(max-width:760px){.menu-btn{display:inline-block}}
`;
