/**
 * Served admin client for the Pressh Studio. Self-contained (no build step):
 * a polished, themed first-run setup wizard + login + a no-code authoring
 * dashboard (Content Types, Pages, and a block editor) that talk to the admin
 * API. A Vite/React/ui-kit visual builder can supersede this later.
 */
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pressh Studio</title>
<style>
  :root {
    --brand: #6d28d9; --brand-2: #0ea5e9; --ring: rgba(109,40,217,.35);
    --bg: #f6f7fb; --bg-grad-1: rgba(109,40,217,.10); --bg-grad-2: rgba(14,165,233,.10);
    --card: #ffffff; --card-border: rgba(15,23,42,.08); --text: #0f172a; --muted: #64748b;
    --field: #ffffff; --field-border: #e2e8f0; --shadow: 0 24px 60px -20px rgba(15,23,42,.25);
  }
  [data-theme="dark"] {
    --bg: #070b16; --bg-grad-1: rgba(109,40,217,.22); --bg-grad-2: rgba(14,165,233,.18);
    --card: #0f1729; --card-border: rgba(148,163,184,.14); --text: #e7ecf3; --muted: #94a3b8;
    --field: #0b1322; --field-border: rgba(148,163,184,.2); --shadow: 0 30px 70px -25px rgba(0,0,0,.7);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background:
      radial-gradient(60rem 60rem at 12% -10%, var(--bg-grad-1), transparent 60%),
      radial-gradient(50rem 50rem at 110% 10%, var(--bg-grad-2), transparent 55%),
      var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  .hide { display: none !important; }
  .center { min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; }
  .card {
    width: 100%; max-width: 430px; background: var(--card); border: 1px solid var(--card-border);
    border-radius: 22px; padding: 2.25rem 2rem; box-shadow: var(--shadow);
    animation: rise .5s cubic-bezier(.2,.8,.2,1);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
  .brand { display: flex; align-items: center; gap: .75rem; margin-bottom: 1.4rem; }
  .logo {
    width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center;
    color: #fff; font-weight: 800; font-size: 1.4rem; letter-spacing: -.02em;
    background: linear-gradient(135deg, var(--brand), var(--brand-2));
    box-shadow: 0 10px 24px -8px var(--ring);
  }
  .brand h1 { font-size: 1.15rem; margin: 0; font-weight: 800; }
  .brand p { margin: .1rem 0 0; font-size: .76rem; color: var(--muted); }
  h2 { font-size: 1.4rem; margin: 0 0 .35rem; letter-spacing: -.02em; }
  .sub { color: var(--muted); font-size: .9rem; margin: 0 0 1.4rem; line-height: 1.5; }
  label { display: block; font-size: .8rem; font-weight: 600; margin: .9rem 0 .35rem; color: var(--text); }
  input, select, textarea {
    width: 100%; padding: .6rem .8rem; font-size: .92rem; color: var(--text); font-family: inherit;
    background: var(--field); border: 1px solid var(--field-border); border-radius: 10px;
    transition: border-color .15s, box-shadow .15s;
  }
  textarea { min-height: 80px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 4px var(--ring); }
  .btn {
    width: 100%; margin-top: 1.4rem; padding: .8rem 1rem; font-size: .95rem; font-weight: 700;
    color: #fff; border: 0; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, var(--brand), var(--brand-2));
    box-shadow: 0 12px 26px -10px var(--ring); transition: transform .12s, box-shadow .12s, opacity .12s;
  }
  .btn:hover { transform: translateY(-1px); } .btn:active { transform: translateY(0); }
  .btn[disabled] { opacity: .6; cursor: progress; transform: none; }
  .btn-sm { padding: .5rem .9rem; font-size: .85rem; font-weight: 700; color: #fff; border: 0; border-radius: 10px;
    cursor: pointer; background: linear-gradient(135deg, var(--brand), var(--brand-2)); }
  .ghost { background: transparent; border: 1px solid var(--card-border); color: var(--text); border-radius: 9px;
    padding: .45rem .8rem; cursor: pointer; font-size: .82rem; text-decoration: none; display: inline-block; }
  .ghost:hover { border-color: var(--brand); }
  .danger { color: var(--bad, #e11d48); border-color: rgba(225,29,72,.4); }
  .meter { height: 6px; border-radius: 999px; background: var(--field-border); margin-top: .55rem; overflow: hidden; }
  .meter > span { display: block; height: 100%; width: 0; border-radius: 999px; transition: width .25s, background .25s; }
  .meter-label { font-size: .72rem; color: var(--muted); margin-top: .3rem; min-height: .9rem; }
  .alert { margin-top: 1rem; padding: .65rem .8rem; border-radius: 10px; font-size: .85rem;
    background: rgba(225,29,72,.12); color: #e11d48; border: 1px solid rgba(225,29,72,.25); }
  .foot { margin-top: 1.5rem; text-align: center; font-size: .72rem; color: var(--muted); }
  .foot b { color: var(--text); }
  .theme-toggle { position: fixed; top: 1rem; right: 1rem; width: 38px; height: 38px; border-radius: 50%;
    border: 1px solid var(--card-border); background: var(--card); color: var(--text); cursor: pointer;
    font-size: 1rem; display: grid; place-items: center; box-shadow: var(--shadow); z-index: 5; }
  .topbar { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; gap: .75rem;
    padding: .8rem 1.25rem; padding-right: 4.2rem; background: var(--card); border-bottom: 1px solid var(--card-border); }
  .topbar .logo { width: 34px; height: 34px; border-radius: 10px; font-size: 1rem; }
  .topbar h1 { font-size: 1rem; margin: 0; font-weight: 800; }
  .spacer { margin-left: auto; }
  .who { font-size: .85rem; color: var(--muted); }
  .tabs { display: flex; gap: .25rem; padding: .6rem 1.25rem 0; max-width: 920px; margin: 0 auto; }
  .tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--muted);
    padding: .55rem .9rem; cursor: pointer; font-size: .9rem; font-weight: 600; }
  .tab.active { color: var(--brand); border-bottom-color: var(--brand); }
  .panel { max-width: 920px; margin: 1rem auto 4rem; padding: 0 1.25rem; }
  .row-head { display: flex; align-items: center; justify-content: space-between; margin: .4rem 0 .9rem; }
  .row-head h2 { font-size: 1.1rem; margin: 0; }
  .surface { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.1rem; box-shadow: var(--shadow); }
  .list-row { display: flex; align-items: center; gap: .6rem; padding: .65rem .2rem; border-top: 1px solid var(--card-border); }
  .list-row:first-child { border-top: 0; }
  .list-row .grow { flex: 1; min-width: 0; }
  .list-row .title { font-weight: 600; }
  .list-row .meta { font-size: .78rem; color: var(--muted); }
  .empty { color: var(--muted); font-size: .9rem; padding: .4rem .2rem; }
  .badge { font-size: .68rem; font-weight: 700; padding: .15rem .5rem; border-radius: 999px; text-transform: capitalize; }
  .b-draft { background: rgba(217,119,6,.15); color: #d97706; }
  .b-published { background: rgba(22,163,74,.15); color: #16a34a; }
  .b-in_review { background: rgba(14,165,233,.15); color: #0ea5e9; }
  .b-scheduled { background: rgba(109,40,217,.15); color: #6d28d9; }
  .b-archived { background: rgba(100,116,139,.18); color: #64748b; }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem 1rem; }
  .block { border: 1px solid var(--card-border); border-radius: 12px; padding: .8rem; margin-top: .7rem; background: var(--field); }
  .block-head { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; }
  .block-head .name { font-weight: 700; font-size: .82rem; text-transform: capitalize; flex: 1; }
  .iconbtn { background: transparent; border: 1px solid var(--card-border); color: var(--muted); border-radius: 8px;
    width: 28px; height: 28px; cursor: pointer; font-size: .8rem; }
  .addbar { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .8rem; }
  .editor-actions { display: flex; gap: .6rem; margin-top: 1.2rem; }
  .editor-actions .btn, .editor-actions .ghost { width: auto; margin: 0; }
</style>
</head>
<body>
<button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme" aria-label="Toggle theme">&#9681;</button>

<!-- FIRST-RUN SETUP -->
<section id="setup" class="center hide">
  <div class="card">
    <div class="brand"><div class="logo">P</div><div><h1>Pressh</h1><p>Secure-by-default CMS</p></div></div>
    <h2>Welcome aboard</h2>
    <p class="sub">This is a fresh Pressh install. Create your administrator (Owner) account to get started &mdash; this only happens once.</p>
    <label for="su-email">Email</label>
    <input id="su-email" type="email" autocomplete="username" placeholder="you@example.com">
    <label for="su-password">Password</label>
    <input id="su-password" type="password" autocomplete="new-password" placeholder="At least 8 characters" oninput="strength()">
    <div class="meter"><span id="su-bar"></span></div>
    <div class="meter-label" id="su-strength"></div>
    <label for="su-confirm">Confirm password</label>
    <input id="su-confirm" type="password" autocomplete="new-password" placeholder="Re-enter password">
    <div id="su-error" class="alert hide"></div>
    <button id="su-btn" class="btn" onclick="setup()">Create account &amp; sign in</button>
    <p class="foot">Your plugins run <b>sandboxed</b>. Your data doesn't leak.</p>
  </div>
</section>

<!-- LOGIN -->
<section id="login" class="center hide">
  <div class="card">
    <div class="brand"><div class="logo">P</div><div><h1>Pressh</h1><p>Secure-by-default CMS</p></div></div>
    <h2>Sign in</h2>
    <p class="sub">Welcome back. Sign in to your Studio.</p>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" placeholder="you@example.com">
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" placeholder="Your password">
    <div id="login-error" class="alert hide"></div>
    <button id="login-btn" class="btn" onclick="login()">Sign in</button>
    <p class="foot">Pressh Studio</p>
  </div>
</section>

<!-- DASHBOARD -->
<section id="app" class="hide">
  <div class="topbar">
    <div class="logo">P</div><h1>Pressh Studio</h1>
    <div class="spacer"></div>
    <a id="site-link" class="ghost" href="#" target="_blank" rel="noopener">View site</a>
    <span class="who" id="who"></span>
    <button class="ghost" onclick="logout()">Sign out</button>
  </div>
  <div class="tabs">
    <button id="tab-pages" class="tab active" onclick="tab('pages')">Pages</button>
    <button id="tab-types" class="tab" onclick="tab('types')">Content Types</button>
  </div>
  <div class="panel">
    <div id="view-pages">
      <div class="row-head"><h2>Pages</h2><button class="btn-sm" onclick="newPage()">+ New page</button></div>
      <div id="pages-list" class="surface"><div class="empty">Loading&hellip;</div></div>
      <div id="page-editor" class="surface hide" style="margin-top:1rem"></div>
    </div>
    <div id="view-types" class="hide">
      <div class="row-head"><h2>Content Types</h2><button class="btn-sm" onclick="newType()">+ New type</button></div>
      <div id="types-list" class="surface"><div class="empty">Loading&hellip;</div></div>
      <div id="type-editor" class="surface hide" style="margin-top:1rem"></div>
    </div>
  </div>
</section>

<script>
  var csrf = "";
  var STATE = { types: [], editingId: null, blocks: [] };
  var FIELD_TYPES = ["text", "richtext", "number", "boolean", "date", "select"];
  var BLOCK_TYPES = ["paragraph", "heading", "quote", "code", "image"];

  (function initTheme(){
    var saved = localStorage.getItem("pressh-theme");
    var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  })();
  function toggleTheme(){
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next; localStorage.setItem("pressh-theme", next);
  }
  function el(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function show(id){ ["setup","login","app"].forEach(function(s){ el(s).classList.add("hide"); }); el(id).classList.remove("hide"); }
  function err(id, msg){ var e = el(id); e.textContent = msg; e.classList.remove("hide"); }
  function clearErr(id){ el(id).classList.add("hide"); }
  function strength(){
    var v = el("su-password").value, score = 0;
    if (v.length >= 8) score++; if (v.length >= 12) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++; if (/[0-9]/.test(v)) score++; if (/[^A-Za-z0-9]/.test(v)) score++;
    var pcts = [0,25,45,65,85,100], colors = ["transparent","#e11d48","#d97706","#d97706","#16a34a","#16a34a"], labels = ["","Weak","Fair","Fair","Strong","Very strong"];
    el("su-bar").style.width = pcts[score] + "%"; el("su-bar").style.background = colors[score];
    el("su-strength").textContent = v ? labels[score] : "";
  }
  async function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (csrf && opts.method && opts.method !== "GET") headers["x-csrf-token"] = csrf;
    var res = await fetch(path, Object.assign({ headers: headers, credentials: "same-origin" }, opts));
    return { status: res.status, body: await res.json().catch(function(){ return {}; }) };
  }
  function busy(id, on, label){ var b = el(id); b.disabled = on; b.textContent = on ? label : b.dataset.label; }

  async function setup(){
    clearErr("su-error");
    var email = el("su-email").value.trim(), password = el("su-password").value;
    if (!email) return err("su-error", "Please enter an email address.");
    if (password.length < 8) return err("su-error", "Password must be at least 8 characters.");
    if (password !== el("su-confirm").value) return err("su-error", "Passwords do not match.");
    busy("su-btn", true, "Creating account...");
    var r = await api("/admin/api/setup", { method: "POST", body: JSON.stringify({ email: email, password: password }) });
    busy("su-btn", false);
    if (r.status === 200) return boot();
    err("su-error", (r.body.error && r.body.error.message) || "Setup failed. Please try again.");
  }
  async function login(){
    clearErr("login-error");
    var email = el("email").value.trim(), password = el("password").value;
    busy("login-btn", true, "Signing in...");
    var r = await api("/admin/api/auth/login", { method: "POST", body: JSON.stringify({ email: email, password: password }) });
    busy("login-btn", false);
    if (r.status === 200) return boot();
    err("login-error", "Invalid email or password.");
  }
  async function logout(){ await api("/admin/api/auth/logout", { method: "POST" }); location.reload(); }

  async function boot(){
    var me = await api("/admin/api/me");
    if (me.status === 200){
      csrf = me.body.csrfToken;
      el("who").textContent = me.body.user.email;
      el("site-link").href = location.protocol + "//" + location.hostname + ":3000";
      show("app"); tab("pages");
      return;
    }
    var status = await api("/admin/api/setup/status");
    show(status.body.needsSetup ? "setup" : "login");
  }

  function tab(name){
    el("tab-pages").classList.toggle("active", name === "pages");
    el("tab-types").classList.toggle("active", name === "types");
    el("view-pages").classList.toggle("hide", name !== "pages");
    el("view-types").classList.toggle("hide", name !== "types");
    if (name === "pages") loadPages(); else loadTypes();
  }

  // ---------- Content Types ----------
  async function loadTypes(){
    var r = await api("/admin/api/types");
    STATE.types = r.body.items || [];
    var box = el("types-list");
    if (!STATE.types.length){ box.innerHTML = '<div class="empty">No content types yet. Create one to start modelling content.</div>'; return; }
    box.innerHTML = STATE.types.map(function(t){
      return '<div class="list-row"><div class="grow"><div class="title">' + esc(t.name) +
        '</div><div class="meta">/' + esc(t.slug) + ' &middot; ' + (t.fields ? t.fields.length : 0) + ' field(s)</div></div></div>';
    }).join("");
  }
  function newType(){
    var tf = [{ name: "title", type: "text", required: true }];
    window.__typeFields = tf;
    var ed = el("type-editor"); ed.classList.remove("hide");
    ed.innerHTML =
      '<h2 style="font-size:1.05rem">New content type</h2>' +
      '<label>Name</label><input id="ty-name" placeholder="e.g. Page, Blog Post">' +
      '<label>Slug (lowercase, used internally)</label><input id="ty-slug" placeholder="e.g. page">' +
      '<label>Fields</label><div id="ty-fields"></div>' +
      '<div class="addbar"><button class="ghost" onclick="addField()">+ Add field</button></div>' +
      '<div id="ty-error" class="alert hide"></div>' +
      '<div class="editor-actions"><button class="btn" id="ty-save" onclick="saveType()">Create type</button>' +
      '<button class="ghost" onclick="el(\\'type-editor\\').classList.add(\\'hide\\')">Cancel</button></div>';
    el("ty-save").dataset.label = "Create type";
    renderTypeFields();
  }
  function renderTypeFields(){
    var tf = window.__typeFields;
    el("ty-fields").innerHTML = tf.map(function(f, i){
      var opts = FIELD_TYPES.map(function(t){ return '<option' + (t === f.type ? ' selected' : '') + '>' + t + '</option>'; }).join("");
      return '<div class="field-grid" style="margin-top:.5rem;align-items:end">' +
        '<div><input value="' + esc(f.name) + '" placeholder="field name" onchange="window.__typeFields[' + i + '].name=this.value"></div>' +
        '<div style="display:flex;gap:.4rem"><select onchange="window.__typeFields[' + i + '].type=this.value">' + opts + '</select>' +
        '<label style="display:flex;align-items:center;gap:.3rem;margin:0;white-space:nowrap"><input type="checkbox"' + (f.required ? ' checked' : '') +
        ' style="width:auto" onchange="window.__typeFields[' + i + '].required=this.checked"> req</label>' +
        '<button class="iconbtn" onclick="removeField(' + i + ')">&times;</button></div></div>';
    }).join("");
  }
  function addField(){ window.__typeFields.push({ name: "", type: "text", required: false }); renderTypeFields(); }
  function removeField(i){ window.__typeFields.splice(i, 1); renderTypeFields(); }
  async function saveType(){
    clearErr("ty-error");
    var name = el("ty-name").value.trim(), slug = el("ty-slug").value.trim();
    var fields = window.__typeFields.filter(function(f){ return f.name; }).map(function(f, i){
      return { id: "f" + i, name: f.name, type: f.type, required: !!f.required };
    });
    if (!name || !slug) return err("ty-error", "Name and slug are required.");
    busy("ty-save", true, "Creating...");
    var r = await api("/admin/api/types", { method: "POST", body: JSON.stringify({ name: name, slug: slug, fields: fields }) });
    busy("ty-save", false);
    if (r.status === 200){ el("type-editor").classList.add("hide"); loadTypes(); return; }
    err("ty-error", (r.body.error && r.body.error.message) || "Could not create type.");
  }

  // ---------- Pages ----------
  async function loadPages(){
    var r = await api("/admin/api/content");
    var items = r.body.items || [];
    var box = el("pages-list");
    if (!items.length){ box.innerHTML = '<div class="empty">No pages yet. Click &ldquo;New page&rdquo; to create one.</div>'; return; }
    box.innerHTML = items.map(function(p){
      return '<div class="list-row"><div class="grow"><div class="title">' + esc(p.slug) +
        '</div><div class="meta">' + esc(p.locale || "en") + ' &middot; rev ' + (p.currentRevision || 1) + '</div></div>' +
        '<span class="badge b-' + esc(p.status) + '">' + esc(p.status) + '</span>' +
        '<button class="ghost" onclick="editPage(\\'' + esc(p.id) + '\\')">Edit</button>' +
        (p.status === "published"
          ? '<button class="ghost" onclick="transition(\\'' + esc(p.id) + '\\',\\'draft\\')">Unpublish</button>'
          : '<button class="btn-sm" onclick="transition(\\'' + esc(p.id) + '\\',\\'published\\')">Publish</button>') +
        '</div>';
    }).join("");
  }
  async function transition(id, to){
    var path = to === "published" ? "/admin/api/content/" + id + "/publish" : "/admin/api/content/" + id + "/transition";
    await api(path, { method: "POST", body: JSON.stringify({ to: to }) });
    loadPages();
  }
  function blockEditorHtml(){
    return '<div id="blocks-list"></div>' +
      '<div class="addbar">' + BLOCK_TYPES.map(function(t){
        return '<button class="ghost" onclick="addBlock(\\'' + t + '\\')">+ ' + t + '</button>';
      }).join("") + '</div>';
  }
  function renderFields(type, values){
    values = values || {};
    if (!type) { el("pg-fields").innerHTML = ""; return; }
    el("pg-fields").innerHTML = (type.fields || []).map(function(f){
      var v = values[f.name];
      var lbl = '<label>' + esc(f.name) + (f.required ? ' *' : '') + '</label>';
      if (f.type === "boolean") return lbl + '<input type="checkbox" style="width:auto" id="pf-' + esc(f.name) + '"' + (v ? ' checked' : '') + '>';
      if (f.type === "richtext") return lbl + '<textarea id="pf-' + esc(f.name) + '">' + esc(v) + '</textarea>';
      if (f.type === "select") return lbl + '<select id="pf-' + esc(f.name) + '">' + (f.options || []).map(function(o){ return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join("") + '</select>';
      var t = f.type === "number" ? "number" : (f.type === "date" ? "date" : "text");
      return lbl + '<input type="' + t + '" id="pf-' + esc(f.name) + '" value="' + esc(v) + '">';
    }).join("");
  }
  function openPageEditor(title){
    var typeOpts = '<option value="">Choose a type&hellip;</option>' + STATE.types.map(function(t){ return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; }).join("");
    var ed = el("page-editor"); ed.classList.remove("hide");
    ed.innerHTML =
      '<h2 style="font-size:1.05rem">' + title + '</h2>' +
      '<label>Content type</label><select id="pg-type" onchange="onTypeChange()">' + typeOpts + '</select>' +
      '<label>Slug (the URL path, e.g. about)</label><input id="pg-slug" placeholder="about">' +
      '<div id="pg-fields"></div>' +
      '<label style="margin-top:1rem">Blocks</label>' + blockEditorHtml() +
      '<div id="pg-error" class="alert hide"></div>' +
      '<div class="editor-actions"><button class="btn" id="pg-save" onclick="savePage(false)">Save draft</button>' +
      '<button class="btn-sm" onclick="savePage(true)" style="padding:.8rem 1rem">Save &amp; publish</button>' +
      '<button class="ghost" onclick="el(\\'page-editor\\').classList.add(\\'hide\\')">Cancel</button></div>';
    el("pg-save").dataset.label = "Save draft";
    renderBlocks();
  }
  function newPage(){
    if (!STATE.types.length){ alert("Create a content type first (Content Types tab)."); return; }
    STATE.editingId = null; STATE.blocks = [];
    openPageEditor("New page");
  }
  async function editPage(id){
    var r = await api("/admin/api/content/" + id);
    if (r.status !== 200){ alert("Could not load page."); return; }
    STATE.editingId = id;
    STATE.blocks = (r.body.revision && r.body.revision.blocks) || [];
    openPageEditor("Edit page");
    el("pg-type").value = r.body.entry.typeId; el("pg-type").disabled = true;
    el("pg-slug").value = r.body.entry.slug; el("pg-slug").disabled = true;
    onTypeChange(r.body.revision ? r.body.revision.fields : {});
    renderBlocks();
  }
  function currentType(){ return STATE.types.filter(function(t){ return t.id === el("pg-type").value; })[0]; }
  function onTypeChange(values){ renderFields(currentType(), values); }

  function addBlock(type){ syncBlocks(); STATE.blocks.push(type === "image" ? { type: type, props: { src: "", alt: "" } } : (type === "heading" ? { type: type, props: { level: 2 }, content: "" } : { type: type, content: "" })); renderBlocks(); }
  function removeBlock(i){ syncBlocks(); STATE.blocks.splice(i, 1); renderBlocks(); }
  function moveBlock(i, d){ syncBlocks(); var j = i + d; if (j < 0 || j >= STATE.blocks.length) return; var t = STATE.blocks[i]; STATE.blocks[i] = STATE.blocks[j]; STATE.blocks[j] = t; renderBlocks(); }
  function syncBlocks(){
    STATE.blocks.forEach(function(b, i){
      if (b.type === "image"){ var s = el("blk-src-" + i), a = el("blk-alt-" + i); if (s) b.props = { src: s.value, alt: (a ? a.value : "") }; }
      else { var c = el("blk-" + i); if (c) b.content = c.value; if (b.type === "heading"){ var lv = el("blk-lvl-" + i); if (lv) b.props = { level: Number(lv.value) }; } }
    });
  }
  function renderBlocks(){
    el("blocks-list").innerHTML = STATE.blocks.map(function(b, i){
      var head = '<div class="block-head"><span class="name">' + esc(b.type) + '</span>' +
        '<button class="iconbtn" onclick="moveBlock(' + i + ',-1)">&uarr;</button>' +
        '<button class="iconbtn" onclick="moveBlock(' + i + ',1)">&darr;</button>' +
        '<button class="iconbtn danger" onclick="removeBlock(' + i + ')">&times;</button></div>';
      var body;
      if (b.type === "image"){
        var p = b.props || {};
        body = '<input id="blk-src-' + i + '" placeholder="Image URL (https:// or /path)" value="' + esc(p.src) + '">' +
          '<input id="blk-alt-' + i + '" placeholder="Alt text" value="' + esc(p.alt) + '" style="margin-top:.4rem">';
      } else if (b.type === "heading"){
        var lv = (b.props && b.props.level) || 2;
        var lvs = [1,2,3,4,5,6].map(function(n){ return '<option' + (n === lv ? ' selected' : '') + '>' + n + '</option>'; }).join("");
        body = '<div style="display:flex;gap:.4rem"><select id="blk-lvl-' + i + '" style="width:5rem">' + lvs + '</select>' +
          '<input id="blk-' + i + '" placeholder="Heading text" value="' + esc(b.content) + '"></div>';
      } else {
        body = '<textarea id="blk-' + i + '" placeholder="' + esc(b.type) + ' text">' + esc(b.content) + '</textarea>';
      }
      return '<div class="block">' + head + body + '</div>';
    }).join("");
  }
  async function savePage(publish){
    clearErr("pg-error");
    syncBlocks();
    var type = currentType();
    if (!type) return err("pg-error", "Choose a content type.");
    var slug = el("pg-slug").value.trim();
    if (!slug) return err("pg-error", "A slug is required.");
    var fields = {};
    (type.fields || []).forEach(function(f){
      var node = el("pf-" + f.name); if (!node) return;
      if (f.type === "boolean") fields[f.name] = node.checked;
      else if (f.type === "number") { if (node.value !== "") fields[f.name] = Number(node.value); }
      else if (node.value !== "") fields[f.name] = node.value;
    });
    busy("pg-save", true, "Saving...");
    var r;
    if (STATE.editingId){
      r = await api("/admin/api/content/" + STATE.editingId, { method: "PUT", body: JSON.stringify({ fields: fields, blocks: STATE.blocks }) });
    } else {
      r = await api("/admin/api/content", { method: "POST", body: JSON.stringify({ typeId: type.id, slug: slug, fields: fields, blocks: STATE.blocks }) });
    }
    if (r.status !== 200){ busy("pg-save", false); return err("pg-error", (r.body.error && r.body.error.message) || "Could not save."); }
    var id = STATE.editingId || (r.body.data && r.body.data.id);
    if (publish && id){ await api("/admin/api/content/" + id + "/publish", { method: "POST", body: "{}" }); }
    busy("pg-save", false);
    el("page-editor").classList.add("hide");
    loadPages();
  }

  el("su-btn").dataset.label = "Create account & sign in";
  el("login-btn").dataset.label = "Sign in";
  boot();
</script>
</body>
</html>`;
