/**
 * Core client runtime: globals, helpers, auth (setup/login/accept/logout),
 * capability-aware hash routing, sidebar, generic modal + toast, password change.
 * Section renderers live in client-sections.ts; the designer in designer.ts.
 * (Normal template literal — \\' sequences become \' in the served script.)
 */
export const CORE_JS = `
// ── Globals ───────────────────────────────────────
var csrf="";
var ME=null;            // /admin/api/me payload: { user, capabilities, csrfToken }
var authed=false;
var acceptToken="";
var STATE={ types:[] };

// ── Theme ─────────────────────────────────────────
(function(){
  var s=localStorage.getItem("pressh-theme");
  var dark=s?s==="dark":window.matchMedia("(prefers-color-scheme:dark)").matches;
  document.documentElement.dataset.theme=dark?"dark":"light";
})();
function toggleTheme(){
  var n=document.documentElement.dataset.theme==="dark"?"light":"dark";
  document.documentElement.dataset.theme=n;
  localStorage.setItem("pressh-theme",n);
}

// ── Tiny helpers ──────────────────────────────────
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escAttr(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function show(id){ ["setup","login","accept","app","designer"].forEach(function(s){ el(s).classList.add("hide"); }); el(id).classList.remove("hide"); }
function err(id,msg){ var e=el(id); if(!e) return; e.textContent=msg; e.classList.remove("hide"); }
function clearErr(id){ var e=el(id); if(e) e.classList.add("hide"); }
function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }
function busy(id,on,lbl){ var b=el(id); if(!b) return; b.disabled=on; b.textContent=on?lbl:b.dataset.label; }

var _toastT;
function toast(msg,isErr){
  var t=el("toast"); t.textContent=msg; t.className="show"+(isErr?" err":"");
  clearTimeout(_toastT); _toastT=setTimeout(function(){ t.className=""; },2600);
}

function strength(pwId,barId,labelId){
  var v=el(pwId).value,s=0;
  if(v.length>=8)s++; if(v.length>=12)s++;
  if(/[A-Z]/.test(v)&&/[a-z]/.test(v))s++; if(/[0-9]/.test(v))s++; if(/[^A-Za-z0-9]/.test(v))s++;
  var p=[0,25,45,65,85,100],c=["transparent","#e11d48","#d97706","#d97706","#16a34a","#16a34a"],l=["","Weak","Fair","Fair","Strong","Very strong"];
  el(barId).style.width=p[s]+"%"; el(barId).style.background=c[s];
  el(labelId).textContent=v?l[s]:"";
}

async function api(path,opts){
  opts=opts||{};
  var h=Object.assign({"content-type":"application/json"},opts.headers||{});
  if(csrf && opts.method && opts.method!=="GET") h["x-csrf-token"]=csrf;
  var res=await fetch(path,Object.assign({headers:h,credentials:"same-origin"},opts));
  return { status:res.status, body:await res.json().catch(function(){ return {}; }) };
}

// ── Capability matching (mirrors the server gate; server stays authoritative) ──
function can(cap){ return !!(ME&&ME.capabilities)&&ME.capabilities.some(function(g){ return capMatch(g,cap); }); }
function scopeOk(g,r){ if(g==="*") return true; return (g||null)===(r||null); }
function capMatch(granted,required){
  if(granted==="*") return true;
  var gs=granted.split(":"),rs=required.split(":");
  var gp=gs[0].split("."),rp=rs[0].split(".");
  for(var i=0;i<gp.length;i++){
    if(gp[i]==="**") return scopeOk(gs[1],rs[1]);
    if(gp[i]==="*"){ if(rp[i]===undefined) return false; continue; }
    if(rp[i]!==gp[i]) return false;
  }
  if(gp.length!==rp.length) return false;
  return scopeOk(gs[1],rs[1]);
}

// ── Generic modal + confirm ───────────────────────
function openModal(html,opts){
  closeModal();
  var bg=document.createElement("div"); bg.className="modal-bg"; bg.id="modal-bg";
  bg.innerHTML='<div class="modal">'+html+'</div>';
  if(!(opts&&opts.locked)) bg.addEventListener("click",function(e){ if(e.target===bg) closeModal(); });
  document.body.appendChild(bg);
}
function closeModal(){ var m=el("modal-bg"); if(m) m.remove(); }

// ── Auth ──────────────────────────────────────────
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
async function doAccept(){
  clearErr("ac-error");
  var pw=el("ac-password").value;
  if(pw.length<8) return err("ac-error","Password must be at least 8 characters.");
  if(pw!==el("ac-confirm").value) return err("ac-error","Passwords do not match.");
  busy("ac-btn",true,"Activating…");
  var r=await api("/admin/api/invite/accept",{method:"POST",body:JSON.stringify({token:acceptToken,password:pw})});
  busy("ac-btn",false);
  if(r.status===200){ location.hash="#/dashboard"; return boot(); }
  err("ac-error",(r.body.error&&r.body.error.code==="unauthorized")?"This invitation is invalid or has expired.":"Could not activate account.");
}
async function doLogout(){ D.dirty=false; await api("/admin/api/auth/logout",{method:"POST"}); location.hash=""; location.reload(); }

// ── Self-service password change ──────────────────
function openPasswordModal(forced){
  var note=forced?'<div class="notice">You signed in with a temporary password. Choose a new one to continue.</div>':'';
  var cancel=forced?'':'<button class="ghost" onclick="closeModal()">Cancel</button>';
  openModal(
    '<h3>Change password</h3><p class="hint">Use at least 8 characters.</p>'+note+
    '<label>Current password</label><input id="pw-current" type="password" autocomplete="current-password">'+
    '<label>New password</label><input id="pw-new" type="password" autocomplete="new-password">'+
    '<label>Confirm new password</label><input id="pw-confirm" type="password" autocomplete="new-password">'+
    '<div id="pw-error" class="alert hide"></div>'+
    '<div class="actions">'+cancel+'<button class="btn-sm" onclick="submitPassword()">Update password</button></div>',
    { locked: !!forced }
  );
}
async function submitPassword(){
  clearErr("pw-error");
  var cur=el("pw-current").value, nw=el("pw-new").value, cf=el("pw-confirm").value;
  if(nw.length<8) return err("pw-error","New password must be at least 8 characters.");
  if(nw!==cf) return err("pw-error","Passwords do not match.");
  var r=await api("/admin/api/me/password",{method:"POST",body:JSON.stringify({currentPassword:cur,newPassword:nw})});
  if(r.status!==200) return err("pw-error",(r.body.error&&r.body.error.code==="unauthorized")?"Current password is incorrect.":"Could not update password.");
  if(ME&&ME.user) ME.user.mustChangePassword=false;
  closeModal(); toast("Password updated");
}

// ── Routing ───────────────────────────────────────
function currentRoute(){
  var h=location.hash||"";
  var mi=h.match(/^#\\/invite\\/(.+)$/);
  if(mi) return { view:"accept", token:decodeURIComponent(mi[1]) };
  var mp=h.match(/^#\\/page\\/(.+)$/);
  if(mp) return { view:"designer", id:decodeURIComponent(mp[1]) };
  var ms=h.match(/^#\\/([a-z]+)$/);
  if(ms) return { view:"section", section:ms[1] };
  return { view:"section", section:"dashboard" };
}
function navigate(hash){ if((location.hash||"")===hash) applyRoute(); else location.hash=hash; }

var SECTION_CAP={ types:"types.manage", media:"media.read", users:"users.manage", appearance:"themes.manage", settings:"settings.manage", plugins:"plugins.manage", privacy:"gdpr.manage", audit:"audit.read" };
var SECTION_TITLE={ dashboard:"Dashboard", pages:"Pages", types:"Content Types", media:"Media", users:"Users", appearance:"Appearance", settings:"Settings", plugins:"Plugins", privacy:"Privacy & GDPR", audit:"Audit Log" };

async function applyRoute(){
  var route=currentRoute();
  if(route.view==="accept"){ acceptToken=route.token; show("accept"); return; }
  if(!authed) return;
  if(route.view==="designer"){
    if(D.editingId===route.id && !el("designer").classList.contains("hide")) return;
    var ok=await openDesigner(route.id);
    if(!ok) navigate("#/pages");
    return;
  }
  teardownDesigner();
  show("app");
  el("sidebar").classList.remove("open");
  renderSection(route.section);
}

function renderSection(section){
  var renderers={ dashboard:renderDashboard, pages:renderPages, types:renderTypes, media:renderMedia,
    users:renderUsers, appearance:renderAppearance, settings:renderSettings, plugins:renderPlugins,
    privacy:renderPrivacy, audit:renderAudit };
  var fn=renderers[section]; if(!fn){ section="dashboard"; fn=renderDashboard; }
  setActiveNav(section);
  el("view-title").textContent=SECTION_TITLE[section]||"Dashboard";
  var needed=SECTION_CAP[section];
  if(needed && !can(needed)){
    el("view").innerHTML='<div class="card"><div class="empty"><span class="ico">&#128274;</span>'+
      'You do not have permission to view this section.</div></div>';
    return;
  }
  el("view").innerHTML='<div class="loading">Loading&hellip;</div>';
  fn();
}
function setActiveNav(section){
  document.querySelectorAll(".nav-item").forEach(function(n){ n.classList.toggle("active", n.dataset.section===section); });
}
function applyCapNav(){
  document.querySelectorAll("[data-cap]").forEach(function(n){
    if(can(n.dataset.cap)) n.classList.remove("hide"); else n.classList.add("hide");
  });
}
function toggleSidebar(){ el("sidebar").classList.toggle("open"); }

// ── Boot ──────────────────────────────────────────
async function boot(){
  var me=await api("/admin/api/me");
  if(me.status===200){
    authed=true; ME=me.body; csrf=me.body.csrfToken;
    el("sb-user").textContent=me.body.user.email;
    el("site-link").href=location.protocol+"//"+location.hostname+":3000";
    applyCapNav();
    var tr=await api("/admin/api/types"); STATE.types=tr.body.items||[];
    if(me.body.user.mustChangePassword) openPasswordModal(true);
    await applyRoute();
    return;
  }
  authed=false;
  var route=currentRoute();
  if(route.view==="accept"){ acceptToken=route.token; show("accept"); return; }
  var st=await api("/admin/api/setup/status");
  show(st.body.needsSetup?"setup":"login");
}
`;
