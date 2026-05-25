/**
 * Page Designer — primitive-tree editor (palette · live canvas · properties).
 *
 * The page is a tree of PrimitiveNodes (engine/src/primitives). The left panel
 * lists primitives + component presets; dropping/clicking inserts them; the
 * canvas shows the server-rendered tree (POST /admin/api/preview/render, editor
 * mode → data-nid) and clicking an element selects it for editing. Save writes a
 * single "designer-layout" block holding the node tree.
 *
 * Exposed to the router: openDesigner(id) / teardownDesigner(). Markup inline
 * handlers call closeDesigner/setDevice/undoD/redoD/toggleBorders/previewPage/
 * saveD/filterPalette; everything else is wired by delegated listeners.
 */
export const DESIGNER_STYLES = String.raw`
.ds-shell{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--bg);animation:rise .22s ease}
.ds-topbar{display:flex;align-items:center;gap:.55rem;flex-shrink:0;height:var(--topbar-h);padding:0 .9rem;
  background:var(--card);border-bottom:1px solid var(--panel-border);box-shadow:0 1px 4px rgba(15,23,42,.06)}
.ds-topbar .logo{width:28px;height:28px;border-radius:8px;font-size:.82rem;flex-shrink:0}
.ds-back{display:flex;align-items:center;gap:.3rem;font-size:.8rem;font-weight:600;color:var(--muted);cursor:pointer;
  border:1px solid var(--card-border);border-radius:8px;padding:.35rem .65rem;background:transparent;transition:border-color .15s,color .15s}
.ds-back:hover{border-color:var(--brand);color:var(--brand)}
.ds-page-slug{font-size:.82rem;font-weight:700;color:var(--muted);background:var(--bg);border:1px solid var(--card-border);
  border-radius:7px;padding:.28rem .6rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ds-sep{width:1px;height:20px;background:var(--card-border);flex-shrink:0}
.ds-device-btn{font-size:.82rem;padding:.32rem .55rem;border-radius:7px;border:1px solid var(--card-border);
  background:transparent;color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s}
.ds-device-btn:hover,.ds-device-btn.active{border-color:var(--brand);color:var(--brand)}
.ds-topbar .spacer{flex:1}
.ds-undo-btn{font-size:.8rem;padding:.32rem .5rem;border-radius:7px;border:1px solid var(--card-border);
  background:transparent;color:var(--muted);cursor:pointer;transition:all .12s}
.ds-undo-btn:hover{border-color:var(--brand);color:var(--brand)}
.ds-undo-btn.active{border-color:var(--brand);color:var(--brand);background:rgba(109,40,217,.07)}
.ds-save-status{font-size:.73rem;color:var(--muted);min-width:60px;text-align:right}
.ds-body{flex:1;display:grid;overflow:hidden;grid-template-columns:var(--panel-w-left) 1fr var(--panel-w-right)}

/* ── Left: palette ── */
.ds-left{display:flex;flex-direction:column;overflow:hidden;background:var(--panel-bg);border-right:1px solid var(--panel-border)}
.ds-panel-head{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:.6rem .85rem .5rem;border-bottom:1px solid var(--panel-border)}
.ds-panel-title{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.ds-left-search{flex-shrink:0;padding:.55rem .7rem;border-bottom:1px solid var(--panel-border)}
.ds-left-search input{font-size:.8rem;padding:.42rem .65rem;border-radius:8px}
.ds-palette{flex:1;overflow-y:auto;padding:.4rem .55rem .9rem}
.ds-pl-sep{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);padding:.9rem .35rem .25rem;opacity:.8}
.ds-pl-group{margin-bottom:.15rem}
.ds-pl-group>summary{list-style:none;cursor:pointer;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);padding:.45rem .35rem;display:flex;align-items:center;gap:.4rem;user-select:none;border-radius:7px}
.ds-pl-group>summary::-webkit-details-marker{display:none}
.ds-pl-group>summary::before{content:"\25B8";font-size:.7rem;transition:transform .15s;opacity:.6}
.ds-pl-group[open]>summary::before{transform:rotate(90deg)}
.ds-pl-group>summary:hover{color:var(--text);background:rgba(109,40,217,.05)}
.ds-pl-n{margin-left:auto;font-weight:700;opacity:.6}
.ds-pl-items{display:grid;grid-template-columns:1fr 1fr;gap:.35rem;padding:.2rem .15rem .4rem}
.ds-pl-item{display:flex;flex-direction:column;align-items:center;gap:.3rem;padding:.6rem .4rem;border-radius:9px;cursor:grab;
  border:1px solid var(--card-border);background:var(--card);text-align:center;transition:border-color .15s,box-shadow .15s,transform .1s;user-select:none}
.ds-pl-item:hover{border-color:var(--brand);box-shadow:0 4px 14px -6px var(--ring);transform:translateY(-1px)}
.ds-pl-item:active{cursor:grabbing}
.ds-pl-preset{background:linear-gradient(180deg,rgba(109,40,217,.06),transparent)}
.ds-pl-ic{font-size:1.15rem;line-height:1}
.ds-pl-nm{font-size:.66rem;font-weight:700;line-height:1.15;color:var(--text)}

/* ── Centre: canvas ── */
.ds-canvas-wrap{display:flex;flex-direction:column;overflow:hidden;background:var(--canvas-bg)}
.ds-canvas-toolbar{flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.4rem .75rem;background:var(--canvas-bg);border-bottom:1px solid rgba(15,23,42,.08)}
.ds-canvas-label{font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.ds-canvas-scroll{flex:1;overflow-y:auto;padding:1.25rem 1.5rem}
.ds-canvas-inner{margin:0 auto;width:100%;transition:max-width .25s}
.ds-canvas-inner.dv-mobile{max-width:390px}
.ds-canvas-inner.dv-tablet{max-width:768px}
.ds-canvas-inner.dv-desktop{max-width:100%}
.ds-canvas-inner.ds-dragover{outline:2px dashed var(--brand);outline-offset:6px;border-radius:14px}
.dc-empty{border:2px dashed var(--card-border);border-radius:14px;padding:3.5rem 2rem;text-align:center;color:var(--muted);background:var(--card)}
.dc-empty-icon{font-size:2.2rem;margin-bottom:.6rem;opacity:.5}
.dc-empty-title{font-weight:700;margin-bottom:.3rem;font-size:.92rem}
.dc-empty-sub{font-size:.8rem;opacity:.7}
.ds-live{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 10px 40px -18px rgba(15,23,42,.25);min-height:120px}
[data-theme=dark] .ds-live{background:#0c1424}
.ds-live [data-nid]{cursor:pointer;outline:1px solid transparent;outline-offset:-1px;transition:outline-color .1s}
.ds-live.ds-show-outlines [data-nid]{outline-color:rgba(14,165,233,.3)}
.ds-live [data-nid].ds-sel{outline:2px solid var(--brand) !important;outline-offset:-2px}
.ds-live [data-nid].ds-drop-target{outline:2px dashed var(--brand) !important;outline-offset:-2px;background:rgba(109,40,217,.07)}
.ds-live .ps-editor-empty{min-height:46px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:.78rem;
  border:1px dashed #cbd5e1;border-radius:8px;padding:.85rem;margin:.25rem}

/* ── Right: properties ── */
.ds-right{display:flex;flex-direction:column;overflow:hidden;background:var(--panel-bg);border-left:1px solid var(--panel-border)}
.ds-props-scroll{flex:1;overflow-y:auto}
.dp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem 1.5rem;text-align:center;height:100%;color:var(--muted)}
.dp-empty-icon{font-size:2.5rem;margin-bottom:.8rem;opacity:.35}
.dp-empty-title{font-weight:700;font-size:.85rem;margin:0 0 .35rem}
.dp-empty-sub{font-size:.78rem;line-height:1.55;margin:0;max-width:210px}
.dp-comp-header{padding:.75rem .9rem .6rem;border-bottom:1px solid var(--panel-border)}
.dp-comp-title{font-size:.9rem;font-weight:800;display:flex;align-items:center;gap:.45rem}
.dp-comp-desc{font-size:.72rem;color:var(--muted);margin-top:.2rem;line-height:1.4}
.dp-parent{margin-top:.6rem;width:100%;text-align:left;font-size:.72rem;font-weight:600;color:var(--muted);cursor:pointer;
  border:1px solid var(--card-border);border-radius:7px;padding:.35rem .55rem;background:transparent;transition:border-color .15s,color .15s}
.dp-parent:hover{border-color:var(--brand);color:var(--brand)}
.dp-note{font-size:.76rem;color:var(--muted);line-height:1.55;background:var(--bg);border:1px solid var(--card-border);border-radius:9px;padding:.65rem .75rem;margin:0}
.dp-props-form{padding:.7rem .9rem 1.2rem;display:flex;flex-direction:column;gap:.7rem}
.dp-field{display:flex;flex-direction:column;gap:.28rem}
.dp-label{font-size:.73rem;font-weight:700;color:var(--text)}
.dp-in{font-size:.82rem;padding:.48rem .65rem;border-radius:8px;width:100%}
textarea.dp-in{min-height:64px;resize:vertical}
.dp-tabs{display:flex;gap:.3rem;padding:.6rem .9rem .2rem}
.dp-tab{flex:1;font-size:.74rem;font-weight:700;padding:.42rem .3rem;border:1px solid var(--card-border);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;transition:border-color .12s,color .12s}
.dp-tab:hover{color:var(--text)}
.dp-tab.active{border-color:var(--brand);color:var(--brand);background:rgba(109,40,217,.07)}
.dp-group{font-size:.64rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:.55rem 0 .05rem;opacity:.85}
.dp-color-row{display:flex;gap:.4rem;align-items:center}
.dp-color-row input[type=color]{width:34px;height:30px;padding:1px;border:1px solid var(--card-border);border-radius:6px;cursor:pointer;flex-shrink:0;background:var(--field)}
.dp-color-row .dp-in{flex:1}
.dp-box4{display:grid;grid-template-columns:repeat(4,1fr);gap:.3rem}
.dp-box-in{text-align:center;padding-left:.2rem !important;padding-right:.2rem !important}
.dp-check{flex-direction:row;align-items:center}
.dp-check label{display:flex;align-items:center;gap:.5rem;font-size:.8rem;font-weight:600;color:var(--text);cursor:pointer}
.dp-check input{width:15px;height:15px}
.dp-footer,#ds-props-footer{flex-shrink:0}
.dp-actions{padding:.65rem .9rem;border-top:1px solid var(--panel-border);background:var(--panel-bg);display:flex;flex-direction:column;gap:.4rem}
.dp-act-row{display:flex;gap:.4rem}
.dp-actions .ghost{width:100%;text-align:center;justify-content:center}

/* ── Right panel split: Layers / Properties ── */
.ds-right{display:flex;flex-direction:column;overflow:hidden;background:var(--panel-bg);border-left:1px solid var(--panel-border)}
.ds-rp-collapse{margin-left:auto;background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:.72rem;padding:.1rem .3rem;border-radius:5px;line-height:1}
.ds-rp-collapse:hover{color:var(--brand)}
.ds-rp-layers{display:flex;flex-direction:column;overflow:hidden;height:240px;min-height:33px;flex-shrink:0}
.ds-rp-layers.collapsed{height:auto !important}
.ds-rp-layers.collapsed .ds-layers-scroll{display:none}
.ds-rp-divider{height:7px;flex-shrink:0;cursor:row-resize;background:var(--panel-bg);border-top:1px solid var(--panel-border);border-bottom:1px solid var(--panel-border);position:relative}
.ds-rp-divider::before{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:3px;border-radius:3px;background:var(--card-border)}
.ds-rp-divider:hover::before{background:var(--brand)}
.ds-rp-divider.hide{display:none}
.ds-rp-props{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:33px}
.ds-rp-props.collapsed{flex:0 0 auto}
.ds-rp-props.collapsed .ds-props-scroll,.ds-rp-props.collapsed #ds-props-footer{display:none}
.ds-layers-scroll{flex:1;overflow-y:auto;padding:.3rem .25rem .6rem}
.ds-layers-empty{color:var(--muted);font-size:.78rem;padding:.6rem .5rem}
.ds-lr{display:flex;align-items:center;gap:.35rem;padding:.28rem .4rem;border-radius:6px;cursor:pointer;font-size:.76rem;white-space:nowrap;overflow:hidden;user-select:none}
.ds-lr:hover{background:rgba(109,40,217,.06)}
.ds-lr.sel{background:rgba(109,40,217,.14);color:var(--brand);font-weight:700}
.ds-lr-caret{width:14px;flex-shrink:0;text-align:center;color:var(--muted);font-size:.65rem}
.ds-lr-spacer{visibility:hidden}
.ds-lr-ic{flex-shrink:0;font-size:.82rem;width:16px;text-align:center}
.ds-lr-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.ds-lr-del{flex-shrink:0;opacity:0;color:#e11d48;font-size:.72rem;padding:0 .25rem;border-radius:4px;transition:opacity .12s}
.ds-lr:hover .ds-lr-del{opacity:.65}
.ds-lr-del:hover{opacity:1;background:rgba(225,29,72,.12)}
.ds-lr.ds-lr-over{box-shadow:inset 0 0 0 2px var(--brand)}
`;

export const DESIGNER_MARKUP = String.raw`
<section id="designer" class="ds-shell hide">
  <div class="ds-topbar">
    <div class="logo">P</div>
    <button class="ds-back" onclick="closeDesigner()">&#8592; Back</button>
    <span class="ds-page-slug" id="ds-slug">/page</span>
    <div class="ds-sep"></div>
    <button class="ds-device-btn active" id="dv-desktop" onclick="setDevice('desktop')" title="Desktop">&#128444;</button>
    <button class="ds-device-btn" id="dv-tablet" onclick="setDevice('tablet')" title="Tablet">&#9645;</button>
    <button class="ds-device-btn" id="dv-mobile" onclick="setDevice('mobile')" title="Mobile">&#128241;</button>
    <div class="ds-sep"></div>
    <button class="ds-undo-btn" onclick="undoD()" title="Undo (Ctrl+Z)">&#8629; Undo</button>
    <button class="ds-undo-btn" onclick="redoD()" title="Redo (Ctrl+Y)">&#8631; Redo</button>
    <div class="ds-sep"></div>
    <button class="ds-undo-btn" id="ds-border-btn" onclick="toggleBorders()" title="Show element outlines">&#9636; Outlines</button>
    <div class="spacer"></div>
    <span class="ds-save-status" id="ds-save-status"></span>
    <button class="ghost" onclick="previewPage()" style="font-size:.8rem">Preview &#8599;</button>
    <button class="btn-sm" onclick="saveD(false)" id="ds-save-btn">Save draft</button>
    <button class="btn-sm btn-ok" onclick="saveD(true)" id="ds-pub-btn">Publish</button>
  </div>
  <div class="ds-body">
    <div class="ds-left">
      <div class="ds-panel-head">
        <span class="ds-panel-title">Add</span>
        <span style="font-size:.7rem;color:var(--muted)" id="ds-comp-count"></span>
      </div>
      <div class="ds-left-search"><input type="text" placeholder="Search blocks…" oninput="filterPalette(this.value)"></div>
      <div class="ds-palette" id="ds-palette"><div class="empty" style="font-size:.8rem;padding:.75rem .25rem">Loading&hellip;</div></div>
    </div>
    <div class="ds-canvas-wrap">
      <div class="ds-canvas-toolbar"><span class="ds-canvas-label">Canvas</span></div>
      <div class="ds-canvas-scroll" id="ds-canvas-scroll">
        <div class="ds-canvas-inner dv-desktop" id="ds-canvas"></div>
      </div>
    </div>
    <div class="ds-right" id="ds-right">
      <div class="ds-rp-layers" id="ds-rp-layers">
        <div class="ds-panel-head">
          <span class="ds-panel-title">Layers</span>
          <button class="ds-rp-collapse" data-collapse="layers" title="Collapse layers">&#9662;</button>
        </div>
        <div class="ds-layers-scroll" id="ds-layers"><div class="ds-layers-empty">No elements yet</div></div>
      </div>
      <div class="ds-rp-divider" id="ds-rp-divider" title="Drag to resize"></div>
      <div class="ds-rp-props" id="ds-rp-props">
        <div class="ds-panel-head">
          <span class="ds-panel-title">Properties</span>
          <span style="font-size:.7rem;color:var(--muted)" id="ds-sel-name"></span>
          <button class="ds-rp-collapse" data-collapse="props" title="Collapse properties">&#9662;</button>
        </div>
        <div class="ds-props-scroll" id="ds-props-scroll">
          <div class="dp-empty">
            <div class="dp-empty-icon">&#9965;</div>
            <p class="dp-empty-title">Nothing selected</p>
            <p class="dp-empty-sub">Click an element on the canvas or in Layers to edit it.</p>
          </div>
        </div>
        <div id="ds-props-footer"></div>
      </div>
    </div>
  </div>
</section>
`;

export const DESIGNER_JS = `
// ═══════════════════════════════════════════════════
//  PAGE DESIGNER (primitive tree)
// ═══════════════════════════════════════════════════
var D = {
  layout: [], fields: {}, selected: null,
  prims: [], presets: [], tokens: {},
  editingId: null, editingSlug: "", editingStatus: "",
  device: "desktop", showBorders: false, paletteQuery: "", drag: null,
  history: [], histIdx: -1, dirty: false,
  _wired: false, _renderTimer: null, _histTimer: null,
};

// ─── library + lifecycle ───────────────────────────
async function loadLibrary(){
  if(D.prims.length) return;
  var r=await api("/admin/api/designer/library");
  D.prims=(r.body&&r.body.primitives)||[];
  D.presets=(r.body&&r.body.presets)||[];
  var themes=(r.body&&r.body.themes)||[], tk={};
  if(themes[0]&&themes[0].tokens){ for(var i=0;i<themes[0].tokens.length;i++){ var t=themes[0].tokens[i]; tk[t.key]=t.default; } }
  D.tokens=tk;
}

async function openDesigner(id){
  await loadLibrary();
  var r=await api("/admin/api/content/"+id);
  if(r.status!==200) return false;
  var entry=r.body.entry, rev=r.body.revision||{blocks:[],fields:{}};
  D.editingId=id; D.editingSlug=entry.slug; D.editingStatus=entry.status; D.fields=rev.fields||{};
  D.selected=null; D.history=[]; D.histIdx=-1; D.drag=null;
  var blocks=rev.blocks||[], lb=null;
  for(var i=0;i<blocks.length;i++){ if(blocks[i].type==="designer-layout"){ lb=blocks[i]; break; } }
  D.layout=(lb&&lb.props&&Array.isArray(lb.props.nodes))?lb.props.nodes:[];
  el("ds-slug").textContent="/"+entry.slug;
  el("ds-pub-btn").textContent=entry.status==="published"?"Update & publish":"Publish";
  setSaveStatus(""); show("designer"); wireDesigner(); renderPalette(); await renderCanvas(); renderProps(); pushHist(); D.dirty=false;
  document.onkeydown=function(e){
    var tag=document.activeElement?document.activeElement.tagName:"";
    var typing=tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT";
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&(e.key==="z"||e.key==="Z")){ e.preventDefault(); undoD(); }
    else if((e.ctrlKey||e.metaKey)&&((e.shiftKey&&(e.key==="z"||e.key==="Z"))||e.key==="y"||e.key==="Y")){ e.preventDefault(); redoD(); }
    else if(e.key==="Escape"){ if(D.selected){ D.selected=null; highlightSelected(); renderProps(); } }
    else if((e.key==="Delete"||e.key==="Backspace")&&D.selected&&!typing){ e.preventDefault(); removeNode(D.selected); }
  };
  return true;
}
function closeDesigner(){ if(D.dirty&&!confirm("You have unsaved changes. Leave the designer and discard them?")) return; navigate("#/pages"); }
function teardownDesigner(){ document.onkeydown=null; D.editingId=null; D.dirty=false; }
function setSaveStatus(m){ var n=el("ds-save-status"); if(n) n.textContent=m; }
function setDevice(dv){
  D.device=dv;
  ["desktop","tablet","mobile"].forEach(function(d){ el("dv-"+d).classList.toggle("active",d===dv); });
  var ci=el("ds-canvas"); ci.classList.remove("dv-desktop","dv-tablet","dv-mobile"); ci.classList.add("dv-"+dv);
}
function toggleBorders(){ D.showBorders=!D.showBorders; var live=el("ds-live"); if(live) live.classList.toggle("ds-show-outlines",D.showBorders); el("ds-border-btn").classList.toggle("active",D.showBorders); }
function previewPage(){ window.open(location.protocol+"//"+location.hostname+":3000/"+D.editingSlug,"_blank"); }

// ─── left palette ──────────────────────────────────
var PRIM_CATS=[["layout","Layout"],["content","Content"],["data","Data"],["form","Forms"]];
function renderPalette(){
  if(el("ds-comp-count")) el("ds-comp-count").textContent=(D.prims.length+D.presets.length)+" blocks";
  var q=(D.paletteQuery||"").toLowerCase();
  function match(name,desc){ if(!q) return true; return ((name||"")+" "+(desc||"")).toLowerCase().indexOf(q)>=0; }
  function item(kind,id,icon,name,desc){
    return '<div class="ds-pl-item'+(kind==="preset"?" ds-pl-preset":"")+'" draggable="true" data-kind="'+kind+'" data-pid="'+escAttr(id)+'" title="'+escAttr(desc||"")+'">'+
      '<span class="ds-pl-ic">'+esc(icon)+'</span><span class="ds-pl-nm">'+esc(name)+'</span></div>';
  }
  var html="";
  for(var c=0;c<PRIM_CATS.length;c++){
    var cat=PRIM_CATS[c][0], label=PRIM_CATS[c][1];
    var items=D.prims.filter(function(d){ return d.category===cat&&match(d.name,d.description); });
    if(!items.length) continue;
    html+='<details class="ds-pl-group" open><summary>'+esc(label)+'<span class="ds-pl-n">'+items.length+'</span></summary><div class="ds-pl-items">';
    for(var i=0;i<items.length;i++){ var d=items[i]; html+=item("prim",d.type,d.icon,d.name,d.description); }
    html+='</div></details>';
  }
  var cats=[], byCat={};
  for(var p=0;p<D.presets.length;p++){ var pr=D.presets[p]; if(!match(pr.name,pr.description)) continue; if(!byCat[pr.category]){ byCat[pr.category]=[]; cats.push(pr.category); } byCat[pr.category].push(pr); }
  if(cats.length) html+='<div class="ds-pl-sep">Components</div>';
  for(var ci=0;ci<cats.length;ci++){
    var cn=cats[ci], list=byCat[cn];
    html+='<details class="ds-pl-group" open><summary>'+esc(cn)+'<span class="ds-pl-n">'+list.length+'</span></summary><div class="ds-pl-items">';
    for(var li=0;li<list.length;li++){ var ps=list[li]; html+=item("preset",ps.id,ps.icon,ps.name,ps.description); }
    html+='</div></details>';
  }
  el("ds-palette").innerHTML=html||'<div class="empty" style="font-size:.8rem;padding:.75rem .25rem">No matches</div>';
}
function filterPalette(v){ D.paletteQuery=v; renderPalette(); }

// ─── tree helpers ──────────────────────────────────
function defFor(type){ for(var i=0;i<D.prims.length;i++){ if(D.prims[i].type===type) return D.prims[i]; } return null; }
function isContainer(type){ var d=defFor(type); return d?!!d.isContainer:false; }
function findNode(id,nodes,parent){
  nodes=nodes||D.layout;
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i];
    if(n.id===id) return { node:n, arr:nodes, index:i, parent:parent||null };
    if(n.children){ var f=findNode(id,n.children,n); if(f) return f; }
  }
  return null;
}
function cloneTree(nodes){
  function c(n){ var o={id:uid(),type:n.type};
    if(n.props) o.props=JSON.parse(JSON.stringify(n.props));
    if(n.bindings) o.bindings=JSON.parse(JSON.stringify(n.bindings));
    if(n.styles) o.styles=JSON.parse(JSON.stringify(n.styles));
    if(n.children) o.children=n.children.map(c);
    return o; }
  return nodes.map(c);
}
function childrenOf(nid){
  var f=findNode(nid); if(!f) return D.layout;
  if(isContainer(f.node.type)){ f.node.children=f.node.children||[]; return f.node.children; }
  if(f.parent){ f.parent.children=f.parent.children||[]; return f.parent.children; }
  return D.layout;
}
// Nearest container element under the cursor (the element itself if it is a
// container, else its closest container ancestor). null → drop at page root.
function dropTargetFor(node){
  var e=node&&node.closest?node.closest("[data-nid]"):null;
  while(e){
    var f=findNode(e.getAttribute("data-nid"));
    if(f&&isContainer(f.node.type)) return e;
    e=e.parentElement?e.parentElement.closest("[data-nid]"):null;
  }
  return null;
}
function clearDropTarget(){
  var canvas=el("ds-canvas"); if(canvas) canvas.classList.remove("ds-dragover");
  var live=el("ds-live"); if(!live) return;
  var els=live.querySelectorAll(".ds-drop-target"); for(var i=0;i<els.length;i++) els[i].classList.remove("ds-drop-target");
}
function setDropTarget(node){
  clearDropTarget();
  if(node) node.classList.add("ds-drop-target");
  else { var c=el("ds-canvas"); if(c) c.classList.add("ds-dragover"); }
}
// Moving EXISTING nodes (reorganize). Guard against dropping a node into itself
// or one of its own descendants.
function isDescendant(ancestorId,childId){
  var f=findNode(ancestorId); if(!f||!f.node.children) return false;
  function has(nodes){ for(var i=0;i<nodes.length;i++){ if(nodes[i].id===childId) return true; if(nodes[i].children&&has(nodes[i].children)) return true; } return false; }
  return has(f.node.children);
}
function moveInto(dragId,containerId){
  if(dragId===containerId||(containerId&&isDescendant(dragId,containerId))) return;
  var df=findNode(dragId); if(!df) return;
  var node=df.arr.splice(df.index,1)[0];
  var arr=containerId?childrenOf(containerId):D.layout; arr.push(node);
  D.selected=node.id; pushHist(); renderCanvas(); renderProps();
}
function moveAfter(dragId,targetId){
  if(dragId===targetId||isDescendant(dragId,targetId)) return;
  var df=findNode(dragId); if(!df) return;
  var node=df.arr.splice(df.index,1)[0];
  var tf=findNode(targetId); if(!tf) D.layout.push(node); else tf.arr.splice(tf.index+1,0,node);
  D.selected=node.id; pushHist(); renderCanvas(); renderProps();
}

// ─── mutate ────────────────────────────────────────
function addFromPalette(kind,id,targetNid,fromDrop){
  var nodes;
  if(kind==="preset"){ var p=null; for(var i=0;i<D.presets.length;i++){ if(D.presets[i].id===id){ p=D.presets[i]; break; } } if(!p) return; nodes=cloneTree(p.template); }
  else { var def=defFor(id); if(!def) return; var node={id:uid(),type:id};
    if(def.defaultProps) node.props=JSON.parse(JSON.stringify(def.defaultProps));
    if(def.defaultStyles) node.styles=JSON.parse(JSON.stringify(def.defaultStyles));
    if(def.isContainer) node.children=[]; nodes=[node]; }
  // Drop: insert into the container under the cursor (or root). Click: presets
  // are whole page sections → root; primitives → the selected container.
  var arr;
  if(fromDrop) arr = targetNid ? childrenOf(targetNid) : D.layout;
  else if(kind==="preset") arr = D.layout;
  else arr = D.selected ? childrenOf(D.selected) : D.layout;
  for(var k=0;k<nodes.length;k++) arr.push(nodes[k]);
  D.selected=nodes[0].id; pushHist(); renderCanvas(); renderProps();
}
function moveNode(id,dir){ var f=findNode(id); if(!f) return; var j=f.index+dir; if(j<0||j>=f.arr.length) return; var t=f.arr[f.index]; f.arr[f.index]=f.arr[j]; f.arr[j]=t; pushHist(); renderCanvas(); renderLayers(); }
function duplicateNode(id){ var f=findNode(id); if(!f) return; var clone=cloneTree([f.node])[0]; f.arr.splice(f.index+1,0,clone); D.selected=clone.id; pushHist(); renderCanvas(); renderProps(); }
function removeNode(id){ var f=findNode(id); if(!f) return; f.arr.splice(f.index,1); if(D.selected===id) D.selected=f.parent?f.parent.id:null; pushHist(); renderCanvas(); renderProps(); }
function selectNode(id){ D.selected=id; highlightSelected(); renderProps(); }
function selectParent(id){ var f=findNode(id); if(f&&f.parent) selectNode(f.parent.id); }
function highlightSelected(){
  var live=el("ds-live"); if(!live) return;
  var prev=live.querySelectorAll(".ds-sel"); for(var i=0;i<prev.length;i++) prev[i].classList.remove("ds-sel");
  if(D.selected){ var n=live.querySelector('[data-nid="'+D.selected+'"]'); if(n) n.classList.add("ds-sel"); }
}

// ─── canvas render (server) ────────────────────────
function scheduleRender(){ clearTimeout(D._renderTimer); D._renderTimer=setTimeout(function(){ renderCanvas(); },180); }
async function renderCanvas(){
  var canvas=el("ds-canvas"); if(!canvas) return;
  if(!D.layout.length){
    canvas.innerHTML='<div class="dc-empty"><div class="dc-empty-icon">&#43;</div>'+
      '<div class="dc-empty-title">Your page is empty</div>'+
      '<div class="dc-empty-sub">Click or drag a primitive or component from the left to start building.</div></div>';
    return;
  }
  var r;
  try{ r=await api("/admin/api/preview/render",{method:"POST",body:JSON.stringify({nodes:D.layout})}); }
  catch(ex){ canvas.innerHTML='<div class="dc-empty">Preview failed.</div>'; return; }
  if(!r||r.status!==200){ canvas.innerHTML='<div class="dc-empty">Preview failed.</div>'; return; }
  var css=(r.body&&r.body.css)||"", html=(r.body&&r.body.html)||"";
  var vars=Object.keys(D.tokens).map(function(k){ return "--"+k+":"+D.tokens[k]; }).join(";");
  var outl=D.showBorders?" ds-show-outlines":"";
  canvas.innerHTML='<style>'+css+'</style><div class="ds-live'+outl+'" id="ds-live" style="'+escAttr(vars)+'">'+html+'</div>';
  highlightSelected();
}

// ─── right properties ──────────────────────────────
function emptyPropsHtml(){
  return '<div class="dp-empty"><div class="dp-empty-icon">&#9965;</div>'+
    '<p class="dp-empty-title">Nothing selected</p>'+
    '<p class="dp-empty-sub">Click an element on the canvas to edit its content.</p></div>';
}
function contentFields(node){
  var t=node.type;
  if(t==="heading") return [{k:"text",l:"Text",t:"text"},{k:"level",l:"Heading level",t:"select",o:["1","2","3","4","5","6"]}];
  if(t==="text") return [{k:"text",l:"Text",t:"textarea"}];
  if(t==="button") return [{k:"label",l:"Label",t:"text"},{k:"href",l:"Link URL",t:"text"}];
  if(t==="image") return [{k:"src",l:"Image URL",t:"text"},{k:"alt",l:"Alt text",t:"text"}];
  if(t==="icon") return [{k:"name",l:"Icon name",t:"text"}];
  if(t==="video") return [{k:"url",l:"Video URL (https)",t:"text"},{k:"title",l:"Title",t:"text"}];
  if(t==="list") return [{k:"ordered",l:"Numbered list",t:"checkbox"}];
  if(t==="listItem") return [{k:"text",l:"Text",t:"text"}];
  if(t==="collectionList") return [{k:"limit",l:"Max items",t:"number"},{k:"order",l:"Order",t:"select",o:["desc","asc"]},{k:"emptyText",l:"Empty message",t:"text"}];
  if(t==="form") return [{k:"action",l:"Submit URL",t:"text"}];
  if(t==="input") return [{k:"label",l:"Label",t:"text"},{k:"name",l:"Field name",t:"text"},{k:"inputType",l:"Input type",t:"select",o:["text","email","tel","number","password","url","date"]},{k:"placeholder",l:"Placeholder",t:"text"},{k:"required",l:"Required",t:"checkbox"}];
  if(t==="textarea") return [{k:"label",l:"Label",t:"text"},{k:"name",l:"Field name",t:"text"},{k:"placeholder",l:"Placeholder",t:"text"},{k:"rows",l:"Rows",t:"number"}];
  if(t==="submit") return [{k:"label",l:"Label",t:"text"}];
  return [];
}
function fieldHtml(fld,value){
  var v=value==null?"":value;
  if(fld.t==="checkbox") return '<div class="dp-field dp-check"><label><input type="checkbox" data-prop="'+escAttr(fld.k)+'"'+(v?" checked":"")+'> '+esc(fld.l)+'</label></div>';
  var inp;
  if(fld.t==="textarea") inp='<textarea class="dp-in" rows="3" data-prop="'+escAttr(fld.k)+'">'+esc(v)+'</textarea>';
  else if(fld.t==="select"){ inp='<select class="dp-in" data-prop="'+escAttr(fld.k)+'">'; var o=fld.o||[]; for(var i=0;i<o.length;i++){ inp+='<option value="'+escAttr(o[i])+'"'+(String(v)===o[i]?" selected":"")+'>'+esc(o[i])+'</option>'; } inp+='</select>'; }
  else if(fld.t==="number") inp='<input class="dp-in" type="number" data-num="1" data-prop="'+escAttr(fld.k)+'" value="'+escAttr(v)+'">';
  else inp='<input class="dp-in" type="text" data-prop="'+escAttr(fld.k)+'" value="'+escAttr(v)+'">';
  return '<div class="dp-field"><label class="dp-label">'+esc(fld.l)+'</label>'+inp+'</div>';
}
// ─── style controls (edit node.styles.base.default) ───
function styleVal(node,key){ var s=node.styles&&node.styles.base&&node.styles.base.default; return s?s[key]:undefined; }
function setStyleVal(node,key,val){
  node.styles=node.styles||{}; node.styles.base=node.styles.base||{}; node.styles.base.default=node.styles.base.default||{};
  if(val===""||val==null) delete node.styles.base.default[key]; else node.styles.base.default[key]=val;
}
// Preset values for combobox (<input list>) fields — pick a default or type a custom value.
var SPACE_OPTS=["0","0.25rem","0.5rem","0.75rem","1rem","1.5rem","2rem","3rem","4rem","auto"];
var COLOR_OPTS=["token:colorPrimary","token:colorText","token:colorBackground","#ffffff","#000000","transparent"];
var STYLE_PRESETS={
  width:["auto","100%","75%","50%","33%","320px","480px","640px"],
  maxWidth:["none","1280px","1100px","960px","760px","640px","100%"],
  minHeight:["0","120px","240px","360px","480px","100vh"],
  height:["auto","120px","240px","360px","480px","100vh"],
  maxHeight:["none","240px","360px","480px","640px","100vh"],
  fontSize:["0.75rem","0.875rem","1rem","1.125rem","1.25rem","1.5rem","2rem","2.5rem","3rem","3.5rem"],
  lineHeight:["1","1.1","1.2","1.4","1.6","1.8"],
  letterSpacing:["normal","-0.04em","-0.02em","0.02em","0.06em"],
  fontFamily:["token:fontBody","token:fontHeading","system-ui, sans-serif","Georgia, serif","'Times New Roman', serif","'Courier New', monospace"],
  gap:["0","0.25rem","0.5rem","0.75rem","1rem","1.5rem","2rem","3rem"],
  borderWidth:["0","1px","2px","3px","4px"],
  borderRadius:["0","4px","8px","12px","16px","24px","32px","999px"]
};
function dlist(id,opts){ var s='<datalist id="'+id+'">'; for(var i=0;i<opts.length;i++) s+='<option value="'+escAttr(opts[i])+'">'; return s+'</datalist>'; }
function grp(t){ return '<div class="dp-group">'+esc(t)+'</div>'; }
function sField(node,label,key,type,opts){
  var v=styleVal(node,key); v=(v==null?"":v);
  if(type==="color"){
    var hex=(typeof v==="string"&&/^#[0-9a-fA-F]{3,8}$/.test(v))?v:"#888888", cid="dl-"+key;
    return '<div class="dp-field"><label class="dp-label">'+esc(label)+'</label><div class="dp-color-row">'+
      '<input type="color" data-stylecolor="'+escAttr(key)+'" value="'+escAttr(hex)+'">'+
      '<input class="dp-in" type="text" list="'+cid+'" data-style="'+escAttr(key)+'" value="'+escAttr(v)+'" placeholder="'+escAttr((opts&&opts.ph)||"#hex / token:colorPrimary")+'"></div>'+dlist(cid,COLOR_OPTS)+'</div>';
  }
  if(type==="select"){
    var o=(opts&&opts.o)||[]; var s='<select class="dp-in" data-style="'+escAttr(key)+'"><option value="">default</option>';
    for(var i=0;i<o.length;i++) s+='<option value="'+escAttr(o[i])+'"'+(String(v)===o[i]?" selected":"")+'>'+esc(o[i])+'</option>';
    return '<div class="dp-field"><label class="dp-label">'+esc(label)+'</label>'+s+'</select></div>';
  }
  var presets=STYLE_PRESETS[key], tid="dl-"+key, la=presets?(' list="'+tid+'"'):"", dl=presets?dlist(tid,presets):"";
  return '<div class="dp-field"><label class="dp-label">'+esc(label)+'</label><input class="dp-in" type="text"'+la+' data-style="'+escAttr(key)+'" value="'+escAttr(v)+'" placeholder="'+escAttr((opts&&opts.ph)||"")+'">'+dl+'</div>';
}
function boxField(node,label,prefix){
  var keys=[prefix+"Top",prefix+"Right",prefix+"Bottom",prefix+"Left"], labs=["T","R","B","L"], did="dl-"+prefix;
  var h='<div class="dp-field"><label class="dp-label">'+esc(label)+'</label><div class="dp-box4">';
  for(var i=0;i<4;i++){ var v=styleVal(node,keys[i]); h+='<input class="dp-in dp-box-in" type="text" list="'+did+'" data-style="'+keys[i]+'" value="'+escAttr(v==null?"":v)+'" placeholder="'+labs[i]+'" title="'+labs[i]+'">'; }
  return h+'</div>'+dlist(did,SPACE_OPTS)+'</div>';
}
function buildContentTab(node){
  var html="", fields=contentFields(node);
  for(var i=0;i<fields.length;i++){ var fld=fields[i]; html+=fieldHtml(fld,node.props?node.props[fld.k]:undefined); }
  html+=grp("Text")+
    sField(node,"Text colour","color","color")+
    sField(node,"Font size","fontSize","text",{ph:"e.g. 1.25rem"})+
    sField(node,"Font weight","fontWeight","select",{o:["400","500","600","700","800","900"]})+
    sField(node,"Text align","textAlign","select",{o:["left","center","right","justify"]})+
    sField(node,"Line height","lineHeight","text",{ph:"e.g. 1.6"})+
    sField(node,"Font family","fontFamily","text",{ph:"token:fontHeading"});
  return html;
}
function buildLayoutTab(node){
  var cont=isContainer(node.type), html="";
  html+=grp("Size")+
    sField(node,"Width","width","text",{ph:"auto / 100% / 320px"})+
    sField(node,"Max width","maxWidth","text",{ph:"none = full width"})+
    sField(node,"Height","height","text",{ph:"auto / 320px"})+
    sField(node,"Min height","minHeight","text",{ph:"e.g. 320px"})+
    sField(node,"Max height","maxHeight","text",{ph:"none / e.g. 480px"});
  if(cont){
    html+=grp("Layout");
    if(node.type==="row"||node.type==="column"||node.type==="grid"||node.type==="form") html+=sField(node,"Direction","flexDirection","select",{o:["row","column"]});
    html+=sField(node,"Justify","justifyContent","select",{o:["flex-start","center","flex-end","space-between","space-around","space-evenly"]})+
      sField(node,"Align items","alignItems","select",{o:["stretch","flex-start","center","flex-end","baseline"]})+
      sField(node,"Gap","gap","text",{ph:"e.g. 1rem"});
  }
  html+=grp("Spacing")+boxField(node,"Padding","padding")+boxField(node,"Margin","margin");
  html+=grp("Background")+sField(node,"Background","background","color");
  html+=grp("Border")+
    sField(node,"Border width","borderWidth","text",{ph:"e.g. 1px"})+
    sField(node,"Border style","borderStyle","select",{o:["solid","dashed","dotted","none"]})+
    sField(node,"Border colour","borderColor","color")+
    sField(node,"Radius","borderRadius","text",{ph:"e.g. 12px"});
  return html;
}
function renderProps(){
  renderLayers();
  var scroll=el("ds-props-scroll"), footer=el("ds-props-footer"); el("ds-sel-name").textContent="";
  if(!D.selected){ scroll.innerHTML=emptyPropsHtml(); footer.innerHTML=""; return; }
  var f=findNode(D.selected);
  if(!f){ D.selected=null; scroll.innerHTML=emptyPropsHtml(); footer.innerHTML=""; return; }
  var node=f.node, def=defFor(node.type), name=def?def.name:node.type, ic=def?def.icon:"◦";
  el("ds-sel-name").textContent=name; D.propTab=D.propTab||"content";
  var html='<div class="dp-comp-header"><div class="dp-comp-title"><span>'+esc(ic)+'</span>'+esc(name)+'</div>';
  if(f.parent){ var pd=defFor(f.parent.type); html+='<button class="dp-parent" data-action="parent">&#8593; Select parent ('+esc(pd?pd.name:f.parent.type)+')</button>'; }
  html+='</div>';
  html+='<div class="dp-tabs"><button class="dp-tab'+(D.propTab==="content"?" active":"")+'" data-tab="content">Content</button>'+
        '<button class="dp-tab'+(D.propTab==="layout"?" active":"")+'" data-tab="layout">Layout</button></div>';
  html+='<div class="dp-props-form">'+(D.propTab==="layout"?buildLayoutTab(node):buildContentTab(node))+'</div>';
  scroll.innerHTML=html;
  footer.innerHTML='<div class="dp-actions"><div class="dp-act-row">'+
    '<button class="ghost" data-action="up">&#8593; Up</button><button class="ghost" data-action="down">&#8595; Down</button></div>'+
    '<button class="ghost" data-action="dup">&#10070; Duplicate</button>'+
    '<button class="ghost danger" data-action="del">&#10005; Remove</button></div>';
}
// ─── layers tree (right panel, top) ────────────────
function layerLabel(node){
  var d=defFor(node.type), nm=d?d.name:node.type, extra="";
  if(node.props){ var txt=node.props.text||node.props.label||node.props.heading||node.props.alt; if(txt) extra=" · "+String(txt).slice(0,20); }
  return nm+extra;
}
function renderLayers(){
  var box=el("ds-layers"); if(!box) return;
  if(!D.layout.length){ box.innerHTML='<div class="ds-layers-empty">No elements yet</div>'; return; }
  D.layersCollapsed=D.layersCollapsed||{};
  var html="";
  function walk(nodes,depth){
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i], d=defFor(n.type), ic=d?d.icon:"◦";
      var hasKids=n.children&&n.children.length, coll=!!D.layersCollapsed[n.id];
      var caret=hasKids?'<span class="ds-lr-caret" data-caret="'+escAttr(n.id)+'">'+(coll?"&#9656;":"&#9662;")+'</span>':'<span class="ds-lr-caret ds-lr-spacer">&#8226;</span>';
      html+='<div class="ds-lr'+(D.selected===n.id?" sel":"")+'" draggable="true" data-lnid="'+escAttr(n.id)+'" style="padding-left:'+(depth*14+6)+'px">'+caret+'<span class="ds-lr-ic">'+esc(ic)+'</span><span class="ds-lr-nm">'+esc(layerLabel(n))+'</span><span class="ds-lr-del" data-del="'+escAttr(n.id)+'" title="Delete">&#10005;</span></div>';
      if(hasKids&&!coll) walk(n.children,depth+1);
    }
  }
  walk(D.layout,0);
  box.innerHTML=html;
}
function toggleRpSection(which){
  if(which==="layers"){ var s=el("ds-rp-layers"); s.classList.toggle("collapsed"); el("ds-rp-divider").classList.toggle("hide",s.classList.contains("collapsed")); }
  else { el("ds-rp-props").classList.toggle("collapsed"); }
  var lb=document.querySelector('[data-collapse="layers"]'); if(lb) lb.innerHTML=el("ds-rp-layers").classList.contains("collapsed")?"&#9656;":"&#9662;";
  var pb=document.querySelector('[data-collapse="props"]'); if(pb) pb.innerHTML=el("ds-rp-props").classList.contains("collapsed")?"&#9656;":"&#9662;";
}
function initRpResize(){
  var div=el("ds-rp-divider"), layers=el("ds-rp-layers"), right=el("ds-right"); if(!div) return;
  var dragging=false, startY=0, startH=0;
  div.addEventListener("pointerdown",function(e){ dragging=true; startY=e.clientY; startH=layers.getBoundingClientRect().height; try{ div.setPointerCapture(e.pointerId); }catch(ex){} e.preventDefault(); });
  div.addEventListener("pointermove",function(e){ if(!dragging) return; var max=right.getBoundingClientRect().height-120; var h=Math.max(80,Math.min(startH+(e.clientY-startY),max)); layers.style.height=h+"px"; });
  div.addEventListener("pointerup",function(e){ dragging=false; try{ div.releasePointerCapture(e.pointerId); }catch(ex){} });
}

function onPropInput(e){
  var t=e.target;
  var skey=t.getAttribute("data-style")||t.getAttribute("data-stylecolor");
  if(skey){
    if(!D.selected) return; var sf=findNode(D.selected); if(!sf) return;
    setStyleVal(sf.node,skey,t.value);
    if(t.getAttribute("data-stylecolor")){ var pair=t.parentElement.querySelector('[data-style="'+skey+'"]'); if(pair) pair.value=t.value; }
    D.dirty=true; scheduleRender(); scheduleHist(); return;
  }
  var key=t.getAttribute("data-prop"); if(!key) return;
  if(!D.selected) return; var f=findNode(D.selected); if(!f) return;
  f.node.props=f.node.props||{};
  var val; if(t.type==="checkbox") val=t.checked; else if(t.getAttribute("data-num")) val=Number(t.value); else val=t.value;
  f.node.props[key]=val; D.dirty=true; scheduleRender(); scheduleHist();
}

// ─── history ───────────────────────────────────────
function pushHist(){ D.history=D.history.slice(0,D.histIdx+1); D.history.push(JSON.stringify(D.layout)); D.histIdx=D.history.length-1; if(D.history.length>80){ D.history.shift(); D.histIdx--; } D.dirty=true; }
function scheduleHist(){ clearTimeout(D._histTimer); D._histTimer=setTimeout(function(){ pushHist(); },500); }
function undoD(){ if(D.histIdx<=0) return; D.histIdx--; D.layout=JSON.parse(D.history[D.histIdx]); if(D.selected&&!findNode(D.selected)) D.selected=null; renderCanvas(); renderProps(); D.dirty=true; }
function redoD(){ if(D.histIdx>=D.history.length-1) return; D.histIdx++; D.layout=JSON.parse(D.history[D.histIdx]); if(D.selected&&!findNode(D.selected)) D.selected=null; renderCanvas(); renderProps(); D.dirty=true; }

// ─── save ──────────────────────────────────────────
async function saveD(publish){
  var saveBtn=el("ds-save-btn"), pubBtn=el("ds-pub-btn");
  saveBtn.disabled=true; pubBtn.disabled=true; setSaveStatus("Saving…");
  var blocks=[{type:"designer-layout",props:{nodes:D.layout}}];
  var r=await api("/admin/api/content/"+D.editingId,{method:"PUT",body:JSON.stringify({fields:D.fields,blocks:blocks})});
  if(r.status!==200){ saveBtn.disabled=false; pubBtn.disabled=false; setSaveStatus("Save failed ✗"); setTimeout(function(){ setSaveStatus(""); },3000); return; }
  D.dirty=false;
  if(publish){ await api("/admin/api/content/"+D.editingId+"/publish",{method:"POST",body:"{}"}); D.editingStatus="published"; pubBtn.textContent="Update & publish"; setSaveStatus("Published ✓"); }
  else setSaveStatus("Saved ✓");
  saveBtn.disabled=false; pubBtn.disabled=false; setTimeout(function(){ setSaveStatus(""); },2500);
}

// ─── delegated wiring (once) ───────────────────────
function wireDesigner(){
  if(D._wired) return; D._wired=true;
  var pal=el("ds-palette");
  pal.addEventListener("click",function(e){ var it=e.target.closest("[data-pid]"); if(!it) return; addFromPalette(it.getAttribute("data-kind"),it.getAttribute("data-pid")); });
  pal.addEventListener("dragstart",function(e){ var it=e.target.closest("[data-pid]"); if(!it) return; D.drag={kind:it.getAttribute("data-kind"),id:it.getAttribute("data-pid")}; if(e.dataTransfer){ e.dataTransfer.effectAllowed="copy"; try{ e.dataTransfer.setData("text/plain",it.getAttribute("data-pid")); }catch(ex){} } });
  pal.addEventListener("dragend",function(){ D.drag=null; clearDropTarget(); });
  var canvas=el("ds-canvas");
  canvas.addEventListener("click",function(e){ var t=e.target.closest("[data-nid]"); if(!t) return; e.preventDefault(); e.stopPropagation(); selectNode(t.getAttribute("data-nid")); });
  canvas.addEventListener("dragstart",function(e){ var t=e.target.closest("[data-nid]"); if(!t) return; D.dragNode=t.getAttribute("data-nid"); D.drag=null; if(e.dataTransfer) e.dataTransfer.effectAllowed="move"; });
  canvas.addEventListener("dragover",function(e){ if(!D.drag&&!D.dragNode) return; e.preventDefault(); setDropTarget(dropTargetFor(e.target)); });
  canvas.addEventListener("dragleave",function(e){ if(e.target===canvas) clearDropTarget(); });
  canvas.addEventListener("drop",function(e){ if(!D.drag&&!D.dragNode){ clearDropTarget(); return; } e.preventDefault(); var tgt=dropTargetFor(e.target); var nid=tgt?tgt.getAttribute("data-nid"):null; clearDropTarget(); if(D.dragNode){ moveInto(D.dragNode,nid); D.dragNode=null; } else if(D.drag){ addFromPalette(D.drag.kind,D.drag.id,nid,true); D.drag=null; } });
  canvas.addEventListener("dragend",function(){ D.dragNode=null; clearDropTarget(); });
  var scroll=el("ds-props-scroll");
  scroll.addEventListener("input",onPropInput);
  scroll.addEventListener("change",onPropInput);
  var lay=el("ds-layers");
  lay.addEventListener("click",function(e){
    var del=e.target.closest("[data-del]"); if(del){ e.stopPropagation(); removeNode(del.getAttribute("data-del")); return; }
    var c=e.target.closest("[data-caret]");
    if(c){ var id=c.getAttribute("data-caret"); D.layersCollapsed=D.layersCollapsed||{}; D.layersCollapsed[id]=!D.layersCollapsed[id]; renderLayers(); return; }
    var r=e.target.closest("[data-lnid]"); if(r) selectNode(r.getAttribute("data-lnid"));
  });
  function clearLayerOver(){ var p=lay.querySelectorAll(".ds-lr-over"); for(var i=0;i<p.length;i++) p[i].classList.remove("ds-lr-over"); }
  lay.addEventListener("dragstart",function(e){ var r=e.target.closest("[data-lnid]"); if(!r) return; D.dragNode=r.getAttribute("data-lnid"); if(e.dataTransfer) e.dataTransfer.effectAllowed="move"; });
  lay.addEventListener("dragover",function(e){ if(!D.dragNode) return; var r=e.target.closest("[data-lnid]"); if(!r) return; e.preventDefault(); clearLayerOver(); r.classList.add("ds-lr-over"); });
  lay.addEventListener("dragleave",function(e){ var r=e.target.closest("[data-lnid]"); if(r) r.classList.remove("ds-lr-over"); });
  lay.addEventListener("drop",function(e){ if(!D.dragNode){ clearLayerOver(); return; } e.preventDefault(); var r=e.target.closest("[data-lnid]"); clearLayerOver(); if(r){ var tid=r.getAttribute("data-lnid"); var tf=findNode(tid); if(tf){ if(isContainer(tf.node.type)) moveInto(D.dragNode,tid); else moveAfter(D.dragNode,tid); } } D.dragNode=null; });
  lay.addEventListener("dragend",function(){ D.dragNode=null; clearLayerOver(); });
  el("ds-right").addEventListener("click",function(e){
    var cb=e.target.closest("[data-collapse]"); if(cb){ toggleRpSection(cb.getAttribute("data-collapse")); return; }
    var tb=e.target.closest("[data-tab]"); if(tb){ D.propTab=tb.getAttribute("data-tab"); renderProps(); return; }
    var b=e.target.closest("[data-action]"); if(!b||!D.selected) return; var a=b.getAttribute("data-action");
    if(a==="up") moveNode(D.selected,-1); else if(a==="down") moveNode(D.selected,1);
    else if(a==="dup") duplicateNode(D.selected); else if(a==="del") removeNode(D.selected);
    else if(a==="parent") selectParent(D.selected); });
  initRpResize();
}
`;
