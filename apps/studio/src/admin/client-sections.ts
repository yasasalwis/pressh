/**
 * Section renderers wired to the admin API. One render function per sidebar
 * section; each handles loading/empty/error states and escapes all interpolation.
 * (Normal template literal — \\' becomes \' in the served script.)
 */
export const SECTIONS_JS = `
var ROLES=["owner","admin","editor","author","viewer"];
var TYPE_FIELD_TYPES=["text","richtext","number","boolean","date","select"];
var LAST_USERS=[];
var HEADER_NAV=[];
var CONNECTED_SOURCES=[];
var APP_SEARCH="";
var APP_TYPES=[];

function fmtDate(iso){ try{ return new Date(iso).toLocaleString(); }catch(e){ return iso; } }
function confirmAction(title,msg,onYes){ _confirmYes=onYes; openModal('<h3>'+esc(title)+'</h3><p class="hint">'+esc(msg)+'</p><div class="actions"><button class="ghost" onclick="closeModal()">Cancel</button><button class="btn-sm danger" onclick="confirmYes()">Confirm</button></div>'); }
var _confirmYes=null;
function confirmYes(){ var f=_confirmYes; _confirmYes=null; closeModal(); if(f) f(); }
function copyField(id){ var i=el(id); i.select(); try{ document.execCommand("copy"); }catch(e){} if(navigator.clipboard) navigator.clipboard.writeText(i.value).catch(function(){}); toast("Copied"); }

// ═══════════════ DASHBOARD ═══════════════
function statCard(n,label,hash){
  var cls=hash?"stat clickable":"stat";
  var oc=hash?' onclick="navigate(\\''+hash+'\\')"':'';
  return '<div class="'+cls+'"'+oc+'><div class="n">'+esc(n)+'</div><div class="l">'+esc(label)+'</div></div>';
}
async function renderDashboard(){
  var content=await api("/admin/api/content");
  var pages=content.body.items||[];
  var pub=pages.filter(function(p){ return p.status==="published"; }).length;
  var cards=[ statCard(pages.length,"Pages","#/pages"), statCard(pub,"Published",""), statCard(pages.length-pub,"Drafts","") ];
  if(can("media.read")){ var m=await api("/admin/api/media"); cards.push(statCard((m.body.items||[]).length,"Media files","#/media")); }
  if(can("users.manage")){ var u=await api("/admin/api/users"); cards.push(statCard((u.body.users||[]).length,"Users","#/users")); cards.push(statCard((u.body.invites||[]).length,"Pending invites","#/users")); }
  if(can("plugins.manage")){ var pl=await api("/admin/api/plugins"); cards.push(statCard((pl.body.items||[]).length,"Plugins","#/plugins")); }
  var create=(can("types.manage")&&can("content.create"))?'<button class="btn-sm" onclick="navigate(\\'#/pages\\')">Manage pages</button>':'';
  el("view").innerHTML='<div class="card"><div class="row-head"><div><h3>Welcome to Pressh Studio</h3>'+
    '<p class="hint" style="margin:0">Manage content, people, and configuration from one place.</p></div>'+create+'</div>'+
    '<div class="dashboard-grid">'+cards.join("")+'</div></div>';
}

// ═══════════════ PAGES ═══════════════
function newPageFormHtml(){
  return '<div id="new-page-form" class="card hide"><h3>New page</h3>'+
    '<label>Title</label><input id="pg-title" placeholder="e.g. About Us" oninput="suggestSlug()">'+
    '<label>Slug <span class="meta">(letters, numbers, hyphens)</span></label><input id="pg-slug" placeholder="about-us" oninput="this.dataset.touched=1">'+
    '<div id="pg-error" class="alert hide"></div>'+
    '<div style="display:flex;gap:.5rem;margin-top:.8rem"><button id="pg-save" class="btn-sm" onclick="createPage(false)">Create draft</button>'+
    '<button class="btn-sm btn-ok" onclick="createPage(true)">Create &amp; publish</button>'+
    '<button class="ghost" onclick="toggleNewPage()">Cancel</button></div></div>';
}
function toggleNewPage(){ var f=el("new-page-form"); if(f){ f.classList.toggle("hide"); if(!f.classList.contains("hide")) el("pg-title").focus(); } }
function suggestSlug(){ var s=el("pg-slug"); if(!s||s.dataset.touched) return; s.value=el("pg-title").value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }
var LAYOUT_FRAGMENT_SLUGS=["header","footer"];
var SYSTEM_PAGE_SLUGS=["home","404","500","maintenance"];
var SYSTEM_SLUGS_SET=LAYOUT_FRAGMENT_SLUGS.concat(SYSTEM_PAGE_SLUGS);
function isSystemPage(p){ return !!p.system||SYSTEM_SLUGS_SET.indexOf(p.slug)>=0; }
function isLayoutFragment(p){ return LAYOUT_FRAGMENT_SLUGS.indexOf(p.slug)>=0; }
var SYSTEM_PAGE_LABELS={header:"Header Layout",footer:"Footer Layout",home:"Homepage","404":"404 \\u2014 Not Found","500":"500 \\u2014 Server Error",maintenance:"Maintenance Page"};
function systemPageLabel(slug){ return SYSTEM_PAGE_LABELS[slug]||slug; }
function systemRow(p){
  return '<div class="list-row">'+
    '<span class="ico" style="font-size:1rem;margin-right:.4rem">&#128274;</span>'+
    '<div class="grow"><div class="title">'+esc(systemPageLabel(p.slug))+'</div>'+
    '<div class="meta">/'+esc(p.slug)+' &middot; rev '+(p.currentRevision||1)+'</div></div>'+
    '<span class="badge b-published">published</span>'+
    '<button class="btn-sm" onclick="navigate(\\'#/page/'+esc(p.id)+'\\')">&#9998; Edit</button></div>';
}
function lockedCard(title,sub,list){
  // title/sub are trusted static labels (never user input), passed as raw HTML
  // so entities like &middot; render correctly.
  if(!list.length) return '';
  return '<div class="card" style="margin-bottom:.8rem"><div class="row-head" style="margin-bottom:.6rem">'+
    '<h3 style="margin:0;font-size:.9rem">'+title+'</h3>'+
    '<span class="meta" style="font-size:.78rem">'+sub+'</span></div>'+
    list.map(systemRow).join("")+'</div>';
}

async function renderPages(){
  var promises=[api("/admin/api/content")];
  if(can("settings.manage")) promises.push(api("/admin/api/settings"));
  var results=await Promise.all(promises);
  var r=results[0]; var sr=results[1]||null;
  var allItems=r.body.items||[];
  if(sr) HEADER_NAV=(sr.body.settings||{}).headerNav||[];

  var systemItems=allItems.filter(isSystemPage);
  var items=allItems.filter(function(p){ return !isSystemPage(p); });
  el("nav-pages-count").textContent=items.length||"";
  var canNav=can("settings.manage");

  // Built-in pages — always at the top, locked & non-deletable. Header/footer
  // are injected into every page; home/404/500/maintenance are standalone pages.
  var fragmentItems=systemItems.filter(isLayoutFragment);
  var pageItems=systemItems.filter(function(p){ return !isLayoutFragment(p); });
  var systemSection=
    lockedCard("Layout fragments","Injected into every page &middot; always published",fragmentItems)+
    lockedCard("System pages","Built-in pages &middot; non-deletable",pageItems);

  var rows;
  if(!items.length){ rows='<div class="empty"><span class="ico">&#128196;</span>No pages yet. Create your first one.</div>'; }
  else {
    rows=items.map(function(p){
      var type=STATE.types.find(function(t){ return t.id===p.typeId; });
      var label=type?esc(type.name):esc(p.slug);
      var view=p.status==="published"?'<a class="ghost" href="'+location.protocol+'//'+location.hostname+':3000/'+esc(p.slug)+'" target="_blank" rel="noopener">View</a>':'';
      var pubBtn=p.status==="published"
        ?'<button class="ghost" onclick="pageTransition(\\''+esc(p.id)+'\\',\\'draft\\')">Unpublish</button>'
        :'<button class="btn-sm btn-ok" onclick="pageTransition(\\''+esc(p.id)+'\\',\\'published\\')">Publish</button>';
      var inNav=HEADER_NAV.indexOf(p.id)>=0;
      var navToggle=canNav
        ?'<label class="sw" title="Show in header navigation"><input type="checkbox"'+(inNav?' checked':'')+' onchange="toggleHeaderNav(\\''+esc(p.id)+'\\',this.checked)"><span class="sw-track"></span></label><span class="nav-lbl">Header</span>'
        :'';
      return '<div class="list-row"><div class="grow"><div class="title">'+label+'</div>'+
        '<div class="meta">/'+esc(p.slug)+' &middot; rev '+(p.currentRevision||1)+'</div></div>'+
        '<span class="badge b-'+esc(p.status)+'">'+esc(p.status)+'</span>'+
        navToggle+
        '<button class="iconbtn" title="Revision history" onclick="openRevisions(\\''+esc(p.id)+'\\',\\''+esc(p.slug)+'\\')">&#8635;</button>'+
        view+'<button class="btn-sm" onclick="navigate(\\'#/page/'+esc(p.id)+'\\')">&#9998; Edit</button>'+pubBtn+'</div>';
    }).join("");
  }
  var canCreate=can("types.manage")&&can("content.create");
  var newBtn=canCreate?'<button class="btn-sm" onclick="toggleNewPage()">+ New page</button>':'';
  el("view").innerHTML='<div class="row-head"><h2>Pages</h2>'+newBtn+'</div>'+(canCreate?newPageFormHtml():'')+
    systemSection+
    '<div class="card">'+rows+'</div>';
}
async function toggleHeaderNav(id,on){
  var idx=HEADER_NAV.indexOf(id);
  if(on&&idx<0) HEADER_NAV.push(id);
  else if(!on&&idx>=0) HEADER_NAV.splice(idx,1);
  var r=await api("/admin/api/settings",{method:"PUT",body:JSON.stringify({headerNav:HEADER_NAV})});
  if(r.status===200) toast(on?"Added to header navigation":"Removed from header navigation");
  else{ toast("Could not update navigation",true); if(on&&idx<0)HEADER_NAV.pop(); else if(!on&&idx>=0)HEADER_NAV.splice(idx,0,id); }
}
async function createPage(publish){
  clearErr("pg-error");
  var title=el("pg-title").value.trim(), slug=el("pg-slug").value.trim();
  if(!title) return err("pg-error","A title is required.");
  if(!slug) return err("pg-error","A slug is required.");
  el("pg-save").dataset.label="Create draft"; busy("pg-save",true,"Creating…");
  var tr=await api("/admin/api/types",{method:"POST",body:JSON.stringify({name:title,slug:slug,fields:[{id:"f0",name:"title",type:"text",required:true}]})});
  if(tr.status!==200){ busy("pg-save",false); return err("pg-error",(tr.body.error&&tr.body.error.message)||"Could not create."); }
  var typeId=tr.body.data.id;
  var er=await api("/admin/api/content",{method:"POST",body:JSON.stringify({typeId:typeId,slug:slug,fields:{title:title},blocks:[]})});
  if(er.status!==200){ busy("pg-save",false); return err("pg-error",(er.body.error&&er.body.error.message)||"Could not create."); }
  var entryId=er.body.data.id;
  if(publish&&entryId) await api("/admin/api/content/"+entryId+"/publish",{method:"POST",body:"{}"});
  var tr2=await api("/admin/api/types"); STATE.types=tr2.body.items||[];
  if(entryId) navigate("#/page/"+entryId);
}
async function pageTransition(id,to){
  var path=to==="published"?"/admin/api/content/"+id+"/publish":"/admin/api/content/"+id+"/transition";
  await api(path,{method:"POST",body:JSON.stringify({to:to})});
  renderPages();
}
async function openRevisions(id,slug){
  var r=await api("/admin/api/content/"+id+"/revisions");
  var items=(r.body.items||[]).slice().reverse();
  var rows=items.length?items.map(function(rev){
    return '<div class="list-row"><div class="grow"><div class="title">Revision '+esc(rev.version)+'</div><div class="meta">'+esc(fmtDate(rev.createdAt))+'</div></div>'+
      '<button class="btn-sm" onclick="restoreRevision(\\''+esc(id)+'\\','+Number(rev.version)+')">Restore</button></div>';
  }).join(""):'<div class="empty">No revisions.</div>';
  openModal('<h3>Revision history</h3><p class="hint">/'+esc(slug)+' — restoring creates a new revision from the chosen one.</p><div style="max-height:340px;overflow:auto">'+rows+'</div><div class="actions"><button class="ghost" onclick="closeModal()">Close</button></div>');
}
async function restoreRevision(id,version){
  var r=await api("/admin/api/content/"+id+"/revisions/"+version+"/restore",{method:"POST"});
  if(r.status===200){ closeModal(); toast("Revision "+version+" restored"); renderPages(); } else toast("Restore failed",true);
}

// ═══════════════ CONTENT TYPES ═══════════════
function newTypeFormHtml(){
  return '<div id="new-type-form" class="card hide"><h3>New content type</h3>'+
    '<div class="field-grid"><div><label>Name</label><input id="nt-name" placeholder="e.g. Article" oninput="suggestTypeSlug()"></div>'+
    '<div><label>Slug</label><input id="nt-slug" placeholder="article" oninput="this.dataset.touched=1"></div></div>'+
    '<label style="margin-top:.8rem">Fields <span class="meta">(&#128274; marks a field as sensitive PII — encrypted &amp; redacted)</span></label>'+
    '<div id="tf-rows"></div><button class="ghost" style="margin-top:.5rem" onclick="addTypeField()">+ Add field</button>'+
    '<div id="nt-error" class="alert hide"></div>'+
    '<div style="display:flex;gap:.5rem;margin-top:.9rem"><button class="btn-sm" onclick="saveType()">Create type</button><button class="ghost" onclick="toggleNewType()">Cancel</button></div></div>';
}
async function renderTypes(){
  var r=await api("/admin/api/types");
  var items=r.body.items||[];
  var table=items.length?'<table class="tbl"><thead><tr><th>Name</th><th>Slug</th><th>Fields</th></tr></thead><tbody>'+
    items.map(function(t){
      var fields=(t.fields||[]).map(function(f){ return '<span class="tag">'+esc(f.name)+':'+esc(f.type)+(f.sensitive?' &#128274;':'')+'</span>'; }).join("");
      return '<tr><td><b>'+esc(t.name)+'</b></td><td>/'+esc(t.slug)+'</td><td>'+(fields||'<span class="meta">none</span>')+'</td></tr>';
    }).join("")+'</tbody></table>':'<div class="empty"><span class="ico">&#129521;</span>No content types yet.</div>';
  el("view").innerHTML='<div class="row-head"><h2>Content Types</h2><button class="btn-sm" onclick="toggleNewType()">+ New type</button></div>'+newTypeFormHtml()+'<div class="card">'+table+'</div>';
}
function toggleNewType(){ var f=el("new-type-form"); if(!f) return; f.classList.toggle("hide"); if(!f.classList.contains("hide")){ renderTypeFields([{name:"title",type:"text",required:true,sensitive:false,options:""}]); el("nt-name").focus(); } }
function suggestTypeSlug(){ var s=el("nt-slug"); if(!s||s.dataset.touched) return; s.value=el("nt-name").value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }
function readTF(){ return [].slice.call(document.querySelectorAll(".tf-row")).map(function(row){ return { name:row.querySelector(".tf-name").value.trim(), type:row.querySelector(".tf-type").value, required:row.querySelector(".tf-req").checked, sensitive:row.querySelector(".tf-sens").checked, options:row.querySelector(".tf-opts").value }; }); }
function tfTypeChange(sel){ var row=sel.closest(".tf-row"); var opts=row.querySelector(".tf-opts"); opts.style.display=(sel.value==="select")?"block":"none"; }
function renderTypeFields(list){
  el("tf-rows").innerHTML=list.map(function(f,i){
    var typeOpts=TYPE_FIELD_TYPES.map(function(t){ return '<option value="'+t+'"'+(t===f.type?' selected':'')+'>'+t+'</option>'; }).join("");
    var showOpts=(f.type==="select")?"block":"none";
    return '<div class="tf-row" data-i="'+i+'" style="display:grid;grid-template-columns:1fr 110px auto auto auto;gap:.4rem;align-items:center;margin-bottom:.45rem">'+
      '<input class="tf-name" placeholder="field name" value="'+escAttr(f.name)+'">'+
      '<select class="tf-type" onchange="tfTypeChange(this)">'+typeOpts+'</select>'+
      '<label class="dp-check-row" style="padding:0"><input type="checkbox" class="tf-req"'+(f.required?' checked':'')+'><span>req</span></label>'+
      '<label class="dp-check-row" style="padding:0" title="Sensitive PII"><input type="checkbox" class="tf-sens"'+(f.sensitive?' checked':'')+'><span>&#128274;</span></label>'+
      '<button class="iconbtn danger" onclick="removeTypeField('+i+')">&#10005;</button>'+
      '<input class="tf-opts" placeholder="comma,separated,options" value="'+escAttr(f.options||"")+'" style="grid-column:1/-1;display:'+showOpts+'">'+
      '</div>';
  }).join("");
}
function addTypeField(){ var cur=readTF(); cur.push({name:"",type:"text",required:false,sensitive:false,options:""}); renderTypeFields(cur); }
function removeTypeField(i){ var cur=readTF(); cur.splice(i,1); renderTypeFields(cur); }
async function saveType(){
  clearErr("nt-error");
  var name=el("nt-name").value.trim(), slug=el("nt-slug").value.trim();
  if(!name) return err("nt-error","A name is required.");
  if(!slug) return err("nt-error","A slug is required.");
  var raw=readTF(), fields=[];
  for(var i=0;i<raw.length;i++){
    var f=raw[i]; if(!f.name) continue;
    var fd={ id:"f"+i, name:f.name, type:f.type, required:!!f.required };
    if(f.sensitive) fd.sensitive=true;
    if(f.type==="select"){ var opts=f.options.split(",").map(function(s){ return s.trim(); }).filter(function(s){ return s; }); if(!opts.length) return err("nt-error","Select field "+f.name+" needs options."); fd.options=opts; }
    fields.push(fd);
  }
  if(!fields.length) return err("nt-error","Add at least one field.");
  var r=await api("/admin/api/types",{method:"POST",body:JSON.stringify({name:name,slug:slug,fields:fields})});
  if(r.status!==200) return err("nt-error",(r.body.error&&r.body.error.message)||"Could not create the type.");
  var tr=await api("/admin/api/types"); STATE.types=tr.body.items||[];
  toast("Content type created"); renderTypes();
}

// ═══════════════ MEDIA ═══════════════
async function renderMedia(){
  var r=await api("/admin/api/media");
  var items=r.body.items||[];
  var canWrite=can("media.write");
  var dz=canWrite?'<div class="card"><div class="dropzone" id="media-dz" onclick="el(\\'media-file\\').click()" ondragover="mediaDragOver(event)" ondragleave="mediaDragLeave(event)" ondrop="mediaDrop(event)">Drag &amp; drop an image or PDF here, or click to choose.<input type="file" id="media-file" class="hide" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" onchange="mediaUpload(this.files[0])"></div></div>':'';
  var grid=items.length?'<div class="media-grid">'+items.map(mediaTile).join("")+'</div>':'<div class="empty"><span class="ico">&#128247;</span>No media uploaded yet.</div>';
  el("view").innerHTML='<div class="row-head"><h2>Media</h2></div>'+dz+'<div class="card">'+grid+'</div>';
}
function mediaTile(m){
  var isImg=["png","jpg","jpeg","gif","webp"].indexOf(m.ext)>=0;
  var thumb=isImg?'<img src="/admin/api/media/'+esc(m.id)+'/raw" alt="'+escAttr(m.filename)+'" loading="lazy">':'<span class="ext">'+esc(String(m.ext||"file").toUpperCase())+'</span>';
  var del=can("media.write")?'<button class="iconbtn danger" title="Delete" onclick="deleteMedia(\\''+esc(m.id)+'\\',\\''+escAttr(m.filename)+'\\')">&#10005;</button>':'';
  return '<div class="media-tile"><div class="thumb">'+thumb+'</div><div class="mi"><span class="nm" title="'+escAttr(m.filename)+'">'+esc(m.filename)+'</span>'+del+'</div></div>';
}
function mediaDragOver(e){ e.preventDefault(); e.currentTarget.classList.add("dragover"); }
function mediaDragLeave(e){ e.currentTarget.classList.remove("dragover"); }
function mediaDrop(e){ e.preventDefault(); e.currentTarget.classList.remove("dragover"); var f=e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) mediaUpload(f); }
async function mediaUpload(file){
  if(!file) return;
  var fd=new FormData(); fd.append("file",file);
  var res=await fetch("/admin/api/media",{method:"POST",headers:{"x-csrf-token":csrf},credentials:"same-origin",body:fd});
  if(res.status===200){ toast("Uploaded"); renderMedia(); }
  else { var b=await res.json().catch(function(){ return {}; }); toast((b.error&&b.error.message)||"Upload failed",true); }
}
function deleteMedia(id,name){
  confirmAction("Delete media?","Permanently remove "+name+"? This cannot be undone.",function(){
    api("/admin/api/media/"+id,{method:"DELETE"}).then(function(r){ if(r.status===200){ toast("Deleted"); renderMedia(); } else toast("Delete failed",true); });
  });
}

// ═══════════════ USERS ═══════════════
async function renderUsers(){
  var r=await api("/admin/api/users");
  var users=r.body.users||[], invites=r.body.invites||[];
  LAST_USERS=users;
  var urows=users.map(function(u){
    var roles=(u.roles||[]).map(function(x){ return '<span class="tag">'+esc(x)+'</span>'; }).join("");
    var mcp=u.mustChangePassword?' <span class="tag" title="Must change temporary password">temp pw</span>':'';
    var toggle=u.status==="active"
      ?'<button class="iconbtn danger" onclick="setUserStatus(\\''+esc(u.id)+'\\',\\'disabled\\')">Disable</button>'
      :'<button class="iconbtn" onclick="setUserStatus(\\''+esc(u.id)+'\\',\\'active\\')">Enable</button>';
    return '<tr><td><b>'+esc(u.email)+'</b>'+mcp+'</td><td>'+roles+'</td><td><span class="badge b-'+esc(u.status)+'">'+esc(u.status)+'</span></td>'+
      '<td class="actions"><button class="iconbtn" title="Change roles" onclick="openRolesModal(\\''+esc(u.id)+'\\')">&#9998;</button>'+toggle+'</td></tr>';
  }).join("");
  var usersTable=users.length?'<table class="tbl"><thead><tr><th>Email</th><th>Roles</th><th>Status</th><th></th></tr></thead><tbody>'+urows+'</tbody></table>':'<div class="empty">No users.</div>';
  var inviteRows=invites.map(function(i){
    return '<tr><td>'+esc(i.email)+'</td><td>'+(i.roles||[]).map(function(x){ return '<span class="tag">'+esc(x)+'</span>'; }).join("")+'</td>'+
      '<td class="meta">expires '+esc(fmtDate(new Date(i.expiresAt).toISOString()))+'</td>'+
      '<td class="actions"><button class="iconbtn danger" onclick="revokeInvite(\\''+esc(i.id)+'\\')">Revoke</button></td></tr>';
  }).join("");
  var invitesCard=invites.length?'<div class="card"><h3>Pending invitations</h3><table class="tbl"><tbody>'+inviteRows+'</tbody></table></div>':'';
  el("view").innerHTML='<div class="row-head"><h2>Users</h2><div style="display:flex;gap:.5rem">'+
    '<button class="ghost" onclick="openInviteModal()">Invite by email</button><button class="btn-sm" onclick="openCreateUserModal()">+ Add user</button></div></div>'+
    '<div class="card">'+usersTable+'</div>'+invitesCard;
}
function roleOptions(sel){ return ROLES.map(function(r){ return '<option value="'+r+'"'+(r===sel?' selected':'')+'>'+r+'</option>'; }).join(""); }
function openRolesModal(id){
  var u=LAST_USERS.find(function(x){ return x.id===id; }); if(!u) return;
  var boxes=ROLES.map(function(role){ var ck=(u.roles||[]).indexOf(role)>=0?' checked':''; return '<label class="dp-check-row" style="padding:.2rem 0"><input type="checkbox" class="role-ck" value="'+role+'"'+ck+'><span>'+role+'</span></label>'; }).join("");
  openModal('<h3>Roles — '+esc(u.email)+'</h3><p class="hint">Select one or more roles.</p>'+boxes+'<div id="roles-error" class="alert hide"></div><div class="actions"><button class="ghost" onclick="closeModal()">Cancel</button><button class="btn-sm" onclick="saveRoles(\\''+esc(id)+'\\')">Save roles</button></div>');
}
async function saveRoles(id){
  clearErr("roles-error");
  var roles=[].slice.call(document.querySelectorAll(".role-ck")).filter(function(c){ return c.checked; }).map(function(c){ return c.value; });
  if(!roles.length) return err("roles-error","Select at least one role.");
  var r=await api("/admin/api/users/"+id,{method:"PUT",body:JSON.stringify({roles:roles})});
  if(r.status===200){ closeModal(); toast("Roles updated"); renderUsers(); }
  else if(r.status===409) err("roles-error","Cannot remove the last active owner.");
  else err("roles-error","Could not update roles.");
}
async function setUserStatus(id,status){
  var r=await api("/admin/api/users/"+id,{method:"PUT",body:JSON.stringify({status:status})});
  if(r.status===200){ toast("User "+(status==="active"?"enabled":"disabled")); renderUsers(); }
  else if(r.status===409) toast("Cannot disable the last active owner",true);
  else toast("Update failed",true);
}
function openInviteModal(){
  openModal('<h3>Invite a user</h3><p class="hint">Creates a single-use, expiring link. They set their own password.</p>'+
    '<label>Email</label><input id="inv-email" type="email" placeholder="person@example.com">'+
    '<label>Role</label><select id="inv-role">'+roleOptions("author")+'</select>'+
    '<div id="inv-error" class="alert hide"></div>'+
    '<div class="actions"><button class="ghost" onclick="closeModal()">Cancel</button><button class="btn-sm" onclick="sendInvite()">Create invite</button></div>');
}
async function sendInvite(){
  clearErr("inv-error");
  var email=el("inv-email").value.trim(), role=el("inv-role").value;
  if(!email) return err("inv-error","Email is required.");
  var r=await api("/admin/api/users/invite",{method:"POST",body:JSON.stringify({email:email,roles:[role]})});
  if(r.status!==200) return err("inv-error",(r.body.error&&r.body.error.code==="conflict")?"A user with this email already exists.":"Could not create invite.");
  var link=location.origin+"/admin#/invite/"+encodeURIComponent(r.body.data.token);
  openModal('<h3>Invitation created</h3><p class="hint">Share this single-use link with '+esc(email)+'. It expires in 7 days.</p>'+
    '<div class="copybox"><input id="inv-link" type="text" readonly value="'+escAttr(link)+'"><button class="btn-sm" onclick="copyField(\\'inv-link\\')">Copy</button></div>'+
    '<div class="actions"><button class="btn-sm" onclick="closeModal();renderUsers()">Done</button></div>');
}
function openCreateUserModal(){
  openModal('<h3>Add user</h3><p class="hint">Creates an account with a temporary password you relay. They must change it on first sign-in.</p>'+
    '<label>Email</label><input id="cu-email" type="email" placeholder="person@example.com">'+
    '<label>Role</label><select id="cu-role">'+roleOptions("author")+'</select>'+
    '<div id="cu-error" class="alert hide"></div>'+
    '<div class="actions"><button class="ghost" onclick="closeModal()">Cancel</button><button class="btn-sm" onclick="createUserTemp()">Create user</button></div>');
}
async function createUserTemp(){
  clearErr("cu-error");
  var email=el("cu-email").value.trim(), role=el("cu-role").value;
  if(!email) return err("cu-error","Email is required.");
  var r=await api("/admin/api/users",{method:"POST",body:JSON.stringify({email:email,roles:[role]})});
  if(r.status!==200) return err("cu-error",(r.body.error&&r.body.error.code==="conflict")?"A user with this email already exists.":"Could not create user.");
  var tmp=r.body.data.temporaryPassword;
  openModal('<h3>User created</h3><p class="hint">Give '+esc(email)+' this temporary password. They will be required to change it after signing in.</p>'+
    '<div class="copybox"><input id="cu-tmp" type="text" readonly value="'+escAttr(tmp)+'"><button class="btn-sm" onclick="copyField(\\'cu-tmp\\')">Copy</button></div>'+
    '<div class="actions"><button class="btn-sm" onclick="closeModal();renderUsers()">Done</button></div>');
}
async function revokeInvite(id){
  var r=await api("/admin/api/invites/"+id,{method:"DELETE"});
  if(r.status===200){ toast("Invitation revoked"); renderUsers(); } else toast("Failed",true);
}

// ═══════════════ APPEARANCE (theme customizer) ═══════════════
var THEMES=[]; var THEME_STATE=null; var _pvT;
async function renderAppearance(){
  var results=await Promise.all([api("/admin/api/theme"),api("/admin/api/settings"),api("/admin/api/types")]);
  var r=results[0]; var sr=results[1]; var tr=results[2];
  var settings=r.body.settings||{ theme:"default", tokens:{}, siteName:"Pressh" };
  THEMES=r.body.themes||[];
  THEME_STATE={ theme:settings.theme, tokens:Object.assign({},settings.tokens||{}), siteName:settings.siteName||"Pressh" };
  CONNECTED_SOURCES=(sr.body.settings||{}).connectedSources||[];
  APP_TYPES=tr.body.items||[];
  APP_SEARCH="";
  paintAppearance(); refreshPreview();
}
function curThemeDef(){ return THEMES.find(function(t){ return t.slug===THEME_STATE.theme; })||THEMES[0]||{ tokens:[] }; }
function buildTkControls(groups,q){
  var ql=(q||"").toLowerCase().trim();
  var html="";
  Object.keys(groups).forEach(function(g){
    var tokens=groups[g];
    if(ql){ tokens=tokens.filter(function(tk){ return tk.label.toLowerCase().indexOf(ql)>=0||tk.key.toLowerCase().indexOf(ql)>=0||g.toLowerCase().indexOf(ql)>=0; }); }
    if(!tokens.length) return;
    html+='<div class="tk-group"><h4>'+esc(g)+'</h4>';
    tokens.forEach(function(tk){
      var val=THEME_STATE.tokens[tk.key]!=null?THEME_STATE.tokens[tk.key]:tk.default;
      if(tk.type==="color"){
        html+='<div class="color-row"><label>'+esc(tk.label)+'</label>'+
          '<input type="color" id="tkc-'+esc(tk.key)+'" value="'+escAttr(val)+'" oninput="tkColor(\\''+esc(tk.key)+'\\',this.value)">'+
          '<input type="text" id="tkt-'+esc(tk.key)+'" value="'+escAttr(val)+'" oninput="tkColor(\\''+esc(tk.key)+'\\',this.value)"></div>';
      } else {
        html+='<label>'+esc(tk.label)+'</label><input type="text" value="'+escAttr(val)+'" oninput="tkText(\\''+esc(tk.key)+'\\',this.value)">';
      }
    });
    html+='</div>';
  });
  if(ql&&!html) return '<div class="empty" style="padding:.6rem 0">No tokens match your search.</div>';
  return html;
}
function paintAppearance(){
  var theme=curThemeDef(), groups={};
  (theme.tokens||[]).forEach(function(tk){ (groups[tk.group]=groups[tk.group]||[]).push(tk); });
  var controls=buildTkControls(groups,APP_SEARCH);
  var themeOpts=THEMES.map(function(t){ return '<option value="'+escAttr(t.slug)+'"'+(t.slug===THEME_STATE.theme?' selected':'')+'>'+esc(t.name)+'</option>'; }).join("");
  var srcRows=APP_TYPES.length?APP_TYPES.map(function(t){
    var on=CONNECTED_SOURCES.indexOf(t.slug)>=0;
    return '<div class="src-item"><input type="checkbox"'+(on?' checked':'')+' onchange="toggleSource(\\''+esc(t.slug)+'\\',this.checked)">'+
      '<div><div class="src-name">'+esc(t.name)+'</div><div class="src-slug">/'+esc(t.slug)+'</div></div></div>';
  }).join(""):'<div class="empty" style="font-size:.82rem">No content types yet — create one under Content Types first.</div>';
  el("view").innerHTML='<div class="row-head"><h2>Appearance</h2><button class="btn-sm" onclick="saveTheme()">Save changes</button></div>'+
    '<div style="display:grid;grid-template-columns:340px 1fr;gap:1.1rem;align-items:start">'+
      '<div class="card"><h3>Theme</h3><label>Active theme</label><select onchange="switchTheme(this.value)">'+themeOpts+'</select>'+
        '<label>Site name</label><input value="'+escAttr(THEME_STATE.siteName)+'" oninput="thName(this.value)">'+
        '<div class="srch-bar" style="margin-top:1rem"><input placeholder="Search tokens..." value="'+escAttr(APP_SEARCH)+'" oninput="appSearch(this.value)"></div>'+
        '<div id="tk-controls">'+controls+'</div></div>'+
      '<div class="card"><h3>Live preview</h3><p class="hint">Sandboxed — exactly how the public site renders.</p>'+
        '<iframe id="th-preview" sandbox="allow-same-origin" style="width:100%;height:520px;border:1px solid var(--card-border);border-radius:10px;background:#fff"></iframe></div></div>'+
    '<div class="card"><div class="row-head" style="margin:0 0 .75rem"><div>'+
      '<h3 style="margin:0">Data Sources</h3>'+
      '<p class="hint" style="margin:.2rem 0 0">Select which content types are connected as data sources for dynamic collection lists on your site.</p></div>'+
      '<button class="btn-sm" onclick="saveDataSources()">Save sources</button></div>'+
      srcRows+'</div>';
}
function appSearch(q){
  APP_SEARCH=q;
  var theme=curThemeDef(), groups={};
  (theme.tokens||[]).forEach(function(tk){ (groups[tk.group]=groups[tk.group]||[]).push(tk); });
  var ctrl=el("tk-controls"); if(ctrl) ctrl.innerHTML=buildTkControls(groups,q);
}
function toggleSource(slug,on){
  var idx=CONNECTED_SOURCES.indexOf(slug);
  if(on&&idx<0) CONNECTED_SOURCES.push(slug);
  else if(!on&&idx>=0) CONNECTED_SOURCES.splice(idx,1);
}
async function saveDataSources(){
  var r=await api("/admin/api/settings",{method:"PUT",body:JSON.stringify({connectedSources:CONNECTED_SOURCES})});
  if(r.status===200) toast("Data sources saved"); else toast("Could not save data sources",true);
}
function switchTheme(slug){ THEME_STATE.theme=slug; APP_SEARCH=""; paintAppearance(); refreshPreview(); }
function tkColor(key,val){ THEME_STATE.tokens[key]=val; var c=el("tkc-"+key),t=el("tkt-"+key); if(c&&c.value!==val)c.value=val; if(t&&t.value!==val)t.value=val; schedulePreview(); }
function tkText(key,val){ THEME_STATE.tokens[key]=val; schedulePreview(); }
function thName(val){ THEME_STATE.siteName=val; schedulePreview(); }
function schedulePreview(){ clearTimeout(_pvT); _pvT=setTimeout(refreshPreview,400); }
async function refreshPreview(){
  var r=await api("/admin/api/theme/preview",{method:"POST",body:JSON.stringify({theme:THEME_STATE.theme,tokens:THEME_STATE.tokens,siteName:THEME_STATE.siteName})});
  var fr=el("th-preview"); if(fr&&r.body.html) fr.srcdoc=r.body.html;
}
async function saveTheme(){
  var r=await api("/admin/api/theme",{method:"PUT",body:JSON.stringify({theme:THEME_STATE.theme,tokens:THEME_STATE.tokens,siteName:THEME_STATE.siteName})});
  if(r.status===200) toast("Appearance saved"); else toast("Save failed",true);
}

// ═══════════════ SETTINGS ═══════════════
async function renderSettings(){
  var r=await api("/admin/api/settings");
  var s=r.body.settings||{}; var smtp=s.smtp||{};
  var smtpNote=s.smtpAvailable?'':'<div class="notice">Secrets vault not configured — set PRESSH_MASTER_KEY to store SMTP credentials.</div>';
  var passPlaceholder=smtp.hasPassword?"unchanged":"Enter SMTP password";
  el("view").innerHTML='<div class="row-head"><h2>Settings</h2><button class="btn-sm" onclick="saveSettings()">Save changes</button></div>'+
    '<div class="card"><h3>General</h3><div class="field-grid">'+
      '<div class="full"><label>Public base URL</label><input id="set-baseurl" placeholder="https://example.com" value="'+escAttr(s.baseUrl||"")+'"></div>'+
      '<div><label>Default locale</label><input id="set-locale" placeholder="en" value="'+escAttr(s.defaultLocale||"en")+'"></div>'+
      '<div><label>Timezone</label><input id="set-tz" placeholder="UTC" value="'+escAttr(s.timezone||"UTC")+'"></div></div></div>'+
    '<div class="card"><h3>Maintenance mode</h3>'+
      '<p class="hint">When on, the public site returns HTTP 503 and serves your Maintenance page to every visitor. The admin Studio stays reachable. Edit the page under Pages &middot; System pages.</p>'+
      '<label class="dp-check-row"><input type="checkbox" id="set-maint"'+(s.maintenanceMode?' checked':'')+'><span>Take the public site offline for maintenance</span></label></div>'+
    '<div class="card"><h3>Email (SMTP)</h3><p class="hint">Used for invitations and notifications. The password is sealed in the secrets vault.</p>'+smtpNote+
      '<div class="field-grid">'+
        '<div><label>Host</label><input id="smtp-host" value="'+escAttr(smtp.host||"")+'"></div>'+
        '<div><label>Port</label><input id="smtp-port" type="number" value="'+escAttr(smtp.port||587)+'"></div>'+
        '<div><label>From address</label><input id="smtp-from" value="'+escAttr(smtp.fromEmail||"")+'"></div>'+
        '<div><label>Username</label><input id="smtp-user" value="'+escAttr(smtp.username||"")+'"></div>'+
        '<div class="full"><label>Password '+(smtp.hasPassword?'<span class="tag">set</span>':'')+'</label><input id="smtp-pass" type="password" placeholder="'+escAttr(passPlaceholder)+'"'+(s.smtpAvailable?'':' disabled')+'></div>'+
        '<div class="full"><label class="dp-check-row"><input type="checkbox" id="smtp-secure"'+(smtp.secure?' checked':'')+'><span>Use TLS (secure)</span></label></div></div>'+
      '<div style="margin-top:.6rem"><button class="ghost danger" onclick="clearSmtp()">Remove SMTP config</button></div>'+
      '<div id="set-error" class="alert hide"></div></div>';
}
async function saveSettings(){
  clearErr("set-error");
  var body={ baseUrl:el("set-baseurl").value.trim(), defaultLocale:el("set-locale").value.trim(), timezone:el("set-tz").value.trim(), maintenanceMode:el("set-maint").checked };
  var host=el("smtp-host").value.trim();
  if(host){
    body.smtp={ host:host, port:Number(el("smtp-port").value)||587, secure:el("smtp-secure").checked, fromEmail:el("smtp-from").value.trim(), username:el("smtp-user").value.trim() };
    var pass=el("smtp-pass").value; if(pass) body.smtpPassword=pass;
  }
  var r=await api("/admin/api/settings",{method:"PUT",body:JSON.stringify(body)});
  if(r.status===200){ toast("Settings saved"); renderSettings(); }
  else err("set-error","Could not save — check the base URL, locale (e.g. en or en-US), timezone, and SMTP fields.");
}
async function clearSmtp(){
  var r=await api("/admin/api/settings",{method:"PUT",body:JSON.stringify({smtp:null})});
  if(r.status===200){ toast("SMTP configuration removed"); renderSettings(); } else toast("Failed",true);
}

// ═══════════════ PLUGINS ═══════════════
async function togglePlugin(name,enable){
  var verb=enable?"enable":"disable";
  var r=await api("/admin/api/plugins/"+encodeURIComponent(name)+"/"+verb,{method:"POST",body:"{}"});
  if(r.status===200){ toast(enable?"Plugin enabled":"Plugin disabled"); renderPlugins(); }
  else toast((r.body.error&&r.body.error.code)||"Could not "+verb+" plugin",true);
}
async function renderPlugins(){
  var r=await api("/admin/api/plugins");
  var items=r.body.items||[];
  var cve=await api("/admin/api/plugins/cve");
  var advisories=cve.body.items||[];
  var table=items.length?'<table class="tbl"><thead><tr><th>Plugin</th><th>Capabilities</th><th>Status</th><th></th></tr></thead><tbody>'+
    items.map(function(p){
      var caps=(p.capabilities||[]).map(function(c){ return '<span class="tag cap">'+esc(c)+'</span>'; }).join("")||'<span class="meta">none</span>';
      var badge=p.builtin?' <span class="tag">built-in</span>':'';
      var status=p.enabled
        ?'<span class="tag" style="background:#16a34a22;color:#16a34a">Enabled</span>'
        :'<span class="tag" style="background:#64748b22;color:#64748b">Disabled</span>';
      var panel=(p.enabled&&p.hasPanel)?'<a class="ghost" href="/admin/plugins/'+encodeURIComponent(p.name)+'" target="_blank" rel="noopener">Open panel &#8599;</a>':'';
      var toggle='<button class="btn-sm'+(p.enabled?' ghost':'')+'" onclick="togglePlugin(\\''+esc(p.name)+'\\','+(p.enabled?'false':'true')+')">'+(p.enabled?'Disable':'Enable')+'</button>';
      return '<tr><td><b>'+esc(p.name)+'</b> <span class="meta">v'+esc(p.version)+'</span>'+badge+'</td><td>'+caps+'</td><td>'+status+'</td><td class="actions">'+panel+toggle+'</td></tr>';
    }).join("")+'</tbody></table>':'<div class="empty"><span class="ico">&#129513;</span>No plugins installed.</div>';
  var cveCard=advisories.length?'<div class="card"><h3>Security advisories</h3><table class="tbl"><tbody>'+
    advisories.map(function(a){ return '<tr><td><b>'+esc(a.name||a.plugin||"?")+'</b></td><td class="meta">'+esc(a.id||a.cve||"")+'</td><td>'+esc(a.severity||"")+'</td></tr>'; }).join("")+'</tbody></table></div>':'';
  el("view").innerHTML='<div class="row-head"><h2>Plugins</h2></div><div class="card"><p class="hint">Plugins run in isolated worker threads with only the capabilities you approve. Disabled plugins run no worker at all &mdash; enable only what you need.</p>'+table+'</div>'+cveCard;
}

// ═══════════════ PRIVACY / GDPR ═══════════════
async function renderPrivacy(){
  el("view").innerHTML='<div class="row-head"><h2>Privacy &amp; GDPR</h2></div>'+
    '<div class="card"><h3>Data subject requests</h3><p class="hint">Export or erase all personal data linked to a subject reference (e.g. an email). Erasure is irreversible (crypto-shred + audited tombstone).</p>'+
      '<label>Subject reference</label><input id="gd-subject" placeholder="person@example.com">'+
      '<div style="display:flex;gap:.5rem;margin-top:.8rem"><button class="btn-sm" onclick="gdprExport()">Export data</button><button class="ghost danger" onclick="gdprErase()">Erase data</button></div>'+
      '<div id="gd-error" class="alert hide"></div><div id="gd-result" style="margin-top:1rem"></div></div>';
}
async function gdprExport(){
  clearErr("gd-error");
  var subjectRef=el("gd-subject").value.trim(); if(!subjectRef) return err("gd-error","Enter a subject reference.");
  var r=await api("/admin/api/gdpr/export",{method:"POST",body:JSON.stringify({subjectRef:subjectRef})});
  if(r.status!==200) return err("gd-error","Export failed.");
  el("gd-result").innerHTML='<label>Export result</label><textarea readonly style="min-height:220px;font-family:ui-monospace,monospace;font-size:.78rem">'+esc(JSON.stringify(r.body.data,null,2))+'</textarea>';
}
function gdprErase(){
  var subjectRef=el("gd-subject").value.trim(); if(!subjectRef){ err("gd-error","Enter a subject reference."); return; }
  confirmAction("Erase all data?","This permanently erases data for "+subjectRef+". This cannot be undone.",function(){
    api("/admin/api/gdpr/erase",{method:"POST",body:JSON.stringify({subjectRef:subjectRef})}).then(function(r){
      if(r.status===200){ var d=r.body.data||{}; toast("Erased "+(d.erasedCount!=null?d.erasedCount:"")+" record(s)"); el("gd-result").innerHTML='<div class="notice">Erasure complete. Tombstone: '+esc(d.tombstoneId||"")+'</div>'; }
      else err("gd-error","Erase failed.");
    });
  });
}

// ═══════════════ AUDIT LOG ═══════════════
async function renderAudit(){
  var r=await api("/admin/api/audit?limit=200");
  var items=r.body.items||[];
  var rows=items.length?items.map(function(e){
    return '<div class="audit-row"><span class="a-time">'+esc(fmtDate(e.at))+'</span><span class="a-act">'+esc(e.action)+'</span><span class="a-det">'+esc(e.detail?JSON.stringify(e.detail):"")+'</span></div>';
  }).join(""):'<div class="empty"><span class="ico">&#128220;</span>No audit entries yet.</div>';
  el("view").innerHTML='<div class="row-head"><h2>Audit Log</h2><button class="ghost" onclick="renderAudit()">Refresh</button></div>'+
    '<div class="card"><p class="hint">Append-only, hash-chained record of every mutation, login, and capability use.</p>'+rows+'</div>';
}

// ═══════════════ DATABASE MANAGER ═══════════════
var DB_POLL=null;
var DB_CONNECTORS=[];
var DB_VAULT=false;
var DB_RESTART_TRIES=0;
var DB_MIG_STEPS=[
  ["testing","Test connection"],["locking","Maintenance mode"],["copying","Copy data"],
  ["verifying","Verify"],["backing-up","Back up old store"],["cutover","Cut over"],["awaiting-restart","Restart"]
];
function dbStopPoll(){ if(DB_POLL){ clearTimeout(DB_POLL); DB_POLL=null; } }
function dbActivePhase(p){ return p && p!=="done" && p!=="failed"; }
function dbCon(backend){ for(var i=0;i<DB_CONNECTORS.length;i++){ if(DB_CONNECTORS[i].backend===backend) return DB_CONNECTORS[i]; } return null; }

async function renderDatabase(){
  dbStopPoll();
  var r=await api("/admin/api/db/status");
  if(r.status===404){ el("view").innerHTML='<div class="card"><div class="empty"><span class="ico">&#128190;</span>The database manager is not enabled on this server.</div></div>'; return; }
  if(r.status!==200){ el("view").innerHTML='<div class="card"><div class="empty">Could not load database status.</div></div>'; return; }
  var d=r.body.data||{};
  DB_CONNECTORS=d.connectors||[]; DB_VAULT=!!d.vaultConfigured;
  if(d.migration && dbActivePhase(d.migration.phase)){ return dbRenderProgress(d.migration); }
  if(d.pendingCleanup){ return dbRenderPending(d); }
  dbRenderConnectors(d);
}

function dbRenderConnectors(d){
  var active=(d.active&&d.active.backend)||"fs";
  var vaultNote=DB_VAULT?'':'<div class="notice">The secrets vault is not configured. Set <b>PRESSH_MASTER_KEY</b> to store database credentials securely &mdash; until then only the File and SQLite backends are available.</div>';
  var failed=(d.migration&&d.migration.phase==="failed")
    ?'<div class="alert">Last migration failed: '+esc(d.migration.error||"unknown error")+'. Nothing was changed &mdash; you are still on the current database.</div>':'';
  var cards=(d.connectors||[]).map(function(c){ return dbConnectorCard(c,active); }).join("");
  el("view").innerHTML='<div class="row-head"><h2>Database</h2></div>'+
    '<div class="card"><p class="hint">Choose where Pressh stores your content. The default is the built-in File store. '+
    'Switching copies all your data to the new database, verifies it, takes a backup, then restarts Pressh on the new backend.</p>'+vaultNote+failed+'</div>'+
    '<div class="db-grid">'+cards+'</div>';
}

function dbConnectorCard(c,active){
  var isActive=c.backend===active;
  var badge=isActive?'<span class="tag" style="background:#16a34a22;color:#16a34a">Active</span>':'';
  var blockedByVault=c.requiresVault && !DB_VAULT;
  var action='';
  if(isActive){ action='<span class="meta">In use</span>'; }
  else if(c.backend==="fs"){ action='<button class="btn-sm" onclick="dbOpenMigrate(\\'fs\\')">Switch to File</button>'; }
  else if(blockedByVault){ action='<button class="btn-sm" disabled title="Set PRESSH_MASTER_KEY first">Vault required</button>'; }
  else { action='<button class="btn-sm" onclick="dbOpenMigrate(\\''+esc(c.backend)+'\\')">Switch to this</button>'; }
  return '<div class="db-card'+(isActive?' active':'')+'">'+
    '<div class="db-card-head"><b>'+esc(c.label)+'</b>'+badge+'</div>'+
    '<p class="hint">'+esc(c.description)+'</p>'+
    '<div class="db-card-foot">'+action+'</div></div>';
}

function dbOpenMigrate(backend){
  var c=dbCon(backend); if(!c) return;
  var fields=(c.fields||[]).map(function(f){
    var type=f.secret?"password":"text";
    return '<label>'+esc(f.label)+(f.required?' *':'')+'</label>'+
      '<input id="dbf-'+esc(f.key)+'" type="'+type+'" placeholder="'+escAttr(f.placeholder||"")+'"'+(f.secret?' autocomplete="off"':'')+'>';
  }).join("");
  openModal(
    '<h3>Switch to '+esc(c.label)+'</h3>'+
    '<p class="hint">'+esc(c.description)+'</p>'+fields+
    '<div id="db-test-result" class="meta" style="margin:.5rem 0"></div>'+
    '<label class="dp-check-row"><input type="checkbox" id="db-removeold" checked><span>Back up, then remove the current store after a verified switch (recommended)</span></label>'+
    '<div class="notice">This takes the public site offline briefly, copies all data, switches over, and restarts Pressh.</div>'+
    '<div id="db-mig-error" class="alert hide"></div>'+
    '<div class="actions"><button class="ghost" onclick="closeModal()">Cancel</button>'+
    '<button class="ghost" id="db-test-btn" data-label="Test connection" onclick="dbTest(\\''+esc(backend)+'\\')">Test connection</button>'+
    '<button class="btn-sm" id="db-mig-btn" data-label="Start migration" onclick="dbConfirmMigrate(\\''+esc(backend)+'\\')">Start migration</button></div>'
  );
}

function dbCollectValues(c){ var v={}; (c.fields||[]).forEach(function(f){ var n=el("dbf-"+f.key); if(n) v[f.key]=n.value; }); return v; }

async function dbTest(backend){
  var c=dbCon(backend); if(!c) return;
  var res=el("db-test-result"); res.textContent="Testing connection\\u2026"; res.style.color="";
  busy("db-test-btn",true,"Testing\\u2026");
  var r=await api("/admin/api/db/test",{method:"POST",body:JSON.stringify({backend:backend,values:dbCollectValues(c)})});
  busy("db-test-btn",false);
  if(r.status===200){ res.textContent="\\u2713 Connection succeeded"; res.style.color="#16a34a"; }
  else { res.textContent="\\u2717 "+((r.body.error&&r.body.error.message)||"Connection failed"); res.style.color="#e11d48"; }
}

function dbConfirmMigrate(backend){
  var c=dbCon(backend); if(!c) return;
  var values=dbCollectValues(c);
  for(var i=0;i<c.fields.length;i++){ var f=c.fields[i]; if(f.required && !(values[f.key]||"").trim()){ return err("db-mig-error",f.label+" is required."); } }
  clearErr("db-mig-error");
  var removeOld=el("db-removeold").checked;
  confirmAction("Migrate to "+c.label+"?",
    "Pressh will go offline briefly, copy all data, switch over, and restart. "+(removeOld?"The current store will be backed up, then removed.":"The current store will be kept."),
    function(){ dbStartMigrate(backend,values,removeOld); });
}

async function dbStartMigrate(backend,values,removeOld){
  var r=await api("/admin/api/db/migrate",{method:"POST",body:JSON.stringify({backend:backend,values:values,removeOld:removeOld})});
  if(r.status!==200){ openModal('<h3>Could not start migration</h3><div class="alert">'+esc((r.body.error&&r.body.error.message)||"Failed to start.")+'</div><div class="actions"><button class="btn-sm" onclick="closeModal()">Close</button></div>'); return; }
  closeModal();
  renderDatabase();
}

function dbStepRow(phase,key,label){
  var order=DB_MIG_STEPS.map(function(s){ return s[0]; });
  var cur=order.indexOf(phase), me=order.indexOf(key);
  var cls=me<cur?"done":(me===cur?"active":"");
  var mark=me<cur?"\\u2713":(me===cur?"\\u2026":"");
  return '<div class="db-step '+cls+'"><span class="db-step-mark">'+mark+'</span>'+esc(label)+'</div>';
}

function dbRenderProgress(mig){
  if(mig.phase==="awaiting-restart") return dbRenderRestarting();
  var steps=DB_MIG_STEPS.map(function(s){ return dbStepRow(mig.phase,s[0],s[1]); }).join("");
  var detail=mig.records?'<p class="meta">'+esc(mig.records)+' records copied across '+esc(mig.collections)+' collections.</p>':'';
  el("view").innerHTML='<div class="row-head"><h2>Migrating to '+esc(mig.to)+'</h2></div>'+
    '<div class="card"><p class="hint">Migration in progress. The public site is in maintenance mode and admin changes are paused until this completes. Do not close this tab.</p>'+
    '<div class="db-steps">'+steps+'</div>'+detail+'</div>';
  dbStopPoll();
  DB_POLL=setTimeout(dbPollProgress,1500);
}

async function dbPollProgress(){
  var r;
  try{ r=await api("/admin/api/db/migrate/status"); }catch(e){ DB_POLL=setTimeout(dbPollProgress,1500); return; }
  if(r.status!==200){ DB_POLL=setTimeout(dbPollProgress,1500); return; }
  var mig=(r.body.data&&r.body.data.migration)||null;
  if(!mig){ return renderDatabase(); }
  if(mig.phase==="failed"){ dbStopPoll(); return renderDatabase(); }
  if(!dbActivePhase(mig.phase)){ dbStopPoll(); return renderDatabase(); }
  dbRenderProgress(mig);
}

function dbRenderRestarting(){
  el("view").innerHTML='<div class="row-head"><h2>Finishing up</h2></div>'+
    '<div class="card"><div class="loading">Cutover complete &mdash; restarting Pressh on the new database&hellip;</div>'+
    '<p class="hint" id="db-restart-hint">This usually takes a few seconds. The page will refresh automatically.</p></div>';
  DB_RESTART_TRIES=0;
  dbStopPoll();
  DB_POLL=setTimeout(dbPollRestart,2500);
}

async function dbPollRestart(){
  DB_RESTART_TRIES++;
  var r=null;
  try{ r=await api("/admin/api/db/status"); }catch(e){ r=null; }
  if(r && r.status===200){
    var mig=r.body.data&&r.body.data.migration;
    if(!mig || !dbActivePhase(mig.phase)){ dbStopPoll(); location.reload(); return; }
    // Same process still awaiting a restart (no supervisor): nudge the operator.
    if(DB_RESTART_TRIES>6){
      var h=el("db-restart-hint");
      if(h) h.innerHTML='The new database is configured, but Pressh is still running the old one. If it does not restart automatically, restart the Pressh processes to finish. <button class="ghost" onclick="location.reload()">Reload</button>';
    }
  } else if(DB_RESTART_TRIES>18){
    var h2=el("db-restart-hint");
    if(h2) h2.innerHTML='Still waiting for Pressh to come back. <button class="ghost" onclick="location.reload()">Reload now</button>';
  }
  DB_POLL=setTimeout(dbPollRestart,2500);
}

function dbRenderPending(d){
  var pc=d.pendingCleanup||{};
  var backupNote=pc.backupPath?'<p class="meta">A backup was saved to <code>'+esc(pc.backupPath)+'</code>.</p>':'';
  el("view").innerHTML='<div class="row-head"><h2>Database</h2></div>'+
    '<div class="card"><h3>Migration complete</h3>'+
    '<p class="hint">Pressh is now running on the <b>'+esc((d.active&&d.active.backend)||"")+'</b> backend. '+
    'The previous <b>'+esc(pc.backend||"")+'</b> store has been retained so you can roll back if needed.</p>'+backupNote+
    '<div class="actions"><button class="ghost" onclick="dbCleanup(true)">Keep it</button>'+
    '<button class="btn-sm danger" id="db-clean-btn" data-label="Remove previous store" onclick="dbCleanup(false)">Remove previous store</button></div>'+
    '<div id="db-clean-msg" class="meta" style="margin-top:.5rem"></div></div>';
  if(pc.autoRemove){
    var m=el("db-clean-msg"); if(m) m.textContent="Removing the previous store as requested\\u2026";
    dbCleanup(false);
  }
}

async function dbCleanup(keep){
  busy("db-clean-btn",true,"Working\\u2026");
  var r=await api("/admin/api/db/cleanup",{method:"POST",body:JSON.stringify({keep:!!keep})});
  busy("db-clean-btn",false);
  if(r.status!==200){ return toast("Could not complete cleanup",true); }
  var d=r.body.data||{};
  if(keep){ toast("Previous store kept"); return renderDatabase(); }
  if(d.removed){ toast("Previous store removed"); return renderDatabase(); }
  // Refused as a safeguard (the new store could not be verified). Keep the
  // prompt and explain why instead of silently reporting success.
  var m=el("db-clean-msg");
  if(m){ m.textContent=d.reason||"The previous store was kept as a safeguard."; m.style.color="#e11d48"; }
}
`;
