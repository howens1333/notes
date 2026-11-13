/* Leafnote — local-first handwriting notebook. No servers, accounts, or dependencies. */
(() => {
'use strict';
const W=816,H=1056, DB_NAME='leafnote-v1', COLORS=['#293149','#625de6','#e9788b','#2b9d88','#dc963d','#ffffff'], COVERS=['#7770df','#39698d','#529d8b','#c78178','#bd9a61','#49516b'];
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const icon=(name,size=19)=>`<svg class="icon" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=> typeof crypto!=='undefined'&&crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const clone=v=>JSON.parse(JSON.stringify(v));
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const templateOK=x=>['blank','ruled','grid','dots'].includes(x)?x:'blank';
const filename=s=>String(s).replace(/[^\w\- .]/g,'').trim().slice(0,70)||'Notebook';
const dateLabel=ts=>{const d=new Date(ts);return Number.isNaN(+d)?'Recently':d.toLocaleDateString(undefined,{month:'short',day:'numeric'});};
function hydrate(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon,19);});}

class NotebookStorage {
  constructor(){this.db=null;this.fallback=false;}
  async init(){
    try{this.db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('notebooks'))db.createObjectStore('notebooks',{keyPath:'id'});if(!db.objectStoreNames.contains('pages'))db.createObjectStore('pages',{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Database is blocked'));
    });}
    catch(err){console.warn('IndexedDB unavailable, trying localStorage',err);this.fallback=true;try{localStorage.setItem('leafnote-storage-test','1');localStorage.removeItem('leafnote-storage-test');}catch(e){throw new Error('This browser is blocking storage. Open Leafnote in Safari on a normal website, not private browsing.');}}
  }
  readFallback(){try{return JSON.parse(localStorage.getItem('leafnote-data')||'{"notebooks":[],"pages":[]}');}catch(_){return {notebooks:[],pages:[]};}}
  writeFallback(data){localStorage.setItem('leafnote-data',JSON.stringify(data));}
  async all(store){if(this.fallback)return this.readFallback()[store]||[];return new Promise((resolve,reject)=>{const req=this.db.transaction(store,'readonly').objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async put(store,obj){if(this.fallback){const data=this.readFallback();data[store]=data[store]||[];const i=data[store].findIndex(x=>x.id===obj.id);if(i<0)data[store].push(obj);else data[store][i]=obj;this.writeFallback(data);return;}
    await new Promise((resolve,reject)=>{const tx=this.db.transaction(store,'readwrite');tx.objectStore(store).put(obj);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
  async remove(store,id){if(this.fallback){const data=this.readFallback();data[store]=(data[store]||[]).filter(x=>x.id!==id);this.writeFallback(data);return;}
    await new Promise((resolve,reject)=>{const tx=this.db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
}
const storage=new NotebookStorage();
const app={notebooks:[],pages:new Map(),notebookId:null,pageId:null,tool:'pen',color:COLORS[0],sizes:{pen:3.5,marker:25,eraser:23},pencilOnly:true,sidebarOpen:true,zoom:null,scale:1,history:{undo:[],redo:[]},pointer:null,touches:new Map(),pinch:null,lastPenTime:0,pending:0,view:'library'};
let toastTimeout=null;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.classList.remove('visible'),2800);}
function setSaving(on){const el=$('.autosave');if(!el)return;el.classList.toggle('saving',on);$('#save-label').textContent=on?'Saving…':'Saved locally';}
function storeWrite(store,obj){app.pending++;setSaving(true);return storage.put(store,clone(obj)).catch(err=>{console.error(err);toast('Saving failed. Check device storage and make a backup.');}).finally(()=>{app.pending=Math.max(0,app.pending-1);if(!app.pending)setSaving(false);});}
function storeRemove(store,id){return storage.remove(store,id).catch(err=>{console.error(err);toast('Could not delete item from storage.');});}
const nb=()=>app.notebooks.find(n=>n.id===app.notebookId);
const pg=()=>app.pages.get(app.pageId);
function makeNotebook(name='Untitled notebook',color=COVERS[0]){const id=uid(),pageId=uid(),now=Date.now();const notebook={id,name:String(name).slice(0,120),color,createdAt:now,updatedAt:now,pageOrder:[pageId]};const page={id:pageId,notebookId:id,template:'blank',strokes:[],createdAt:now,updatedAt:now};return {notebook,page};}
function markNotebookChanged(n){n.updatedAt=Date.now();storeWrite('notebooks',n);}
function savePage(page){page.updatedAt=Date.now();storeWrite('pages',page);const n=app.notebooks.find(n=>n.id===page.notebookId);if(n)markNotebookChanged(n);}
async function init(){
  hydrate();
  bindEvents();
  try{await storage.init();app.notebooks=await storage.all('notebooks');(await storage.all('pages')).forEach(p=>app.pages.set(p.id,p));}
  catch(err){console.error(err);alert(err.message);return;}
  app.notebooks=app.notebooks.filter(n=>Array.isArray(n.pageOrder));
  if(!app.notebooks.length){const {notebook,page}=makeNotebook('My first notebook');app.notebooks.push(notebook);app.pages.set(page.id,page);await Promise.all([storeWrite('notebooks',notebook),storeWrite('pages',page)]);}
  renderLibrary();
  if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
  window.addEventListener('beforeunload',e=>{if(app.pending){e.preventDefault();e.returnValue='';}});
}
function renderLibrary(){
  const term=$('#search-notebooks').value.toLowerCase().trim();
  const list=[...app.notebooks].filter(n=>n.name.toLowerCase().includes(term)).sort((a,b)=>b.updatedAt-a.updatedAt);
  $('#notebook-count').textContent=app.notebooks.length;
  let html=list.map(n=>{
    const count=n.pageOrder.length;
    return `<article class="notebook-card" data-notebook-id="${escapeHTML(n.id)}" tabindex="0" role="button" aria-label="Open ${escapeHTML(n.name)}">
      <div class="notebook-cover" style="background:${COVERS.includes(n.color)?n.color:COVERS[0]}"><div class="cover-logo">✳</div><div class="cover-short">${escapeHTML(n.name)}</div></div>
      <div class="notebook-card-title">${escapeHTML(n.name)}</div><div class="notebook-card-meta">${count} ${count===1?'page':'pages'} · Edited ${dateLabel(n.updatedAt)}</div>
      <button class="card-menu" type="button" data-action="notebook-options" data-id="${escapeHTML(n.id)}" aria-label="Options for ${escapeHTML(n.name)}">${icon('dots')}</button>
    </article>`;
  }).join('');
  if(term&&!list.length)html='<div class="empty-search">No notebooks match that search.</div>';
  else if(!term)html+=`<button class="new-notebook-card" id="new-notebook-card" type="button"><span class="new-card-icon">${icon('plus',25)}</span> Create a notebook</button>`;
  $('#notebook-grid').innerHTML=html;
}
function showLibrary(){
  cancelPointer();app.view='library';$('#editor-view').classList.add('hidden');$('#library-view').classList.remove('hidden');closeMenu();renderLibrary();
}
function openNotebook(id){
  const n=app.notebooks.find(x=>x.id===id);if(!n)return;
  if(!n.pageOrder.length){const page={id:uid(),notebookId:id,template:'blank',strokes:[],createdAt:Date.now(),updatedAt:Date.now()};app.pages.set(page.id,page);n.pageOrder.push(page.id);storeWrite('pages',page);markNotebookChanged(n);}
  app.view='editor';app.notebookId=n.id;app.pageId=n.pageOrder[0];app.zoom=null;app.history={undo:[],redo:[]};app.sidebarOpen=window.innerWidth>820;
  $('#library-view').classList.add('hidden');$('#editor-view').classList.remove('hidden');$('#page-rail').classList.toggle('collapsed',!app.sidebarOpen);
  renderEditor();
}
function renderEditor(){const n=nb();if(!n)return;$('#editor-notebook-title').textContent=n.name;renderToolbar();renderPageRail();renderPage();}
function renderToolbar(){
  $$('.tool-btn').forEach(b=>{b.classList.toggle('active',b.dataset.tool===app.tool);b.setAttribute('aria-pressed',b.dataset.tool===app.tool?'true':'false');});
  const colors=$('#color-row');colors.innerHTML=COLORS.map(c=>`<button class="color-swatch ${app.color===c?'active':''}" type="button" data-color="${c}" style="--color:${c}" aria-label="${c==='\#ffffff'?'White ink':c+' ink'}" title="${c==='\#ffffff'?'White ink':c}"></button>`).join('');
  colors.querySelectorAll('button').forEach(b=>b.disabled=['eraser','hand'].includes(app.tool));
  const sl=$('#stroke-size');const size=app.sizes[app.tool]||3.5;sl.min=app.tool==='eraser'?'6':app.tool==='marker'?'8':'1';sl.max=app.tool==='eraser'?'70':app.tool==='marker'?'55':'20';sl.value=size;sl.disabled=app.tool==='hand';
  $('#undo-btn').disabled=!app.history.undo.length;$('#redo-btn').disabled=!app.history.redo.length;
  $('#paper').classList.remove('tool-pen','tool-marker','tool-eraser','tool-hand');$('#paper').classList.add(`tool-${app.tool}`);
}
function renderPageRail(){
  const n=nb();if(!n)return;
  $('#page-list').innerHTML=n.pageOrder.map((id,i)=>{
    const active=id===app.pageId;
    return `<div class="page-item ${active?'active':''}" data-page-id="${escapeHTML(id)}" tabindex="0" role="button" aria-label="Go to page ${i+1}">
      <div class="thumbnail-shell"><canvas width="120" height="155" data-thumb-id="${escapeHTML(id)}" aria-hidden="true"></canvas></div>
      <span class="page-item-meta">Page ${i+1}</span>
      ${active?`<div class="page-item-controls" aria-label="Page actions"><button type="button" title="Move page up" data-action="move-page-up" ${i===0?'disabled':''}>${icon('arrow-up',14)}</button><button type="button" title="Move page down" data-action="move-page-down" ${i===n.pageOrder.length-1?'disabled':''}>${icon('arrow-down',14)}</button><button type="button" title="Duplicate page" data-action="duplicate-page">${icon('copy',14)}</button><button type="button" title="Delete page" data-action="delete-page" ${n.pageOrder.length===1?'disabled':''}>${icon('trash',14)}</button></div>`:''}
    </div>`;
  }).join('');
  $$('canvas[data-thumb-id]').forEach(c=>{const p=app.pages.get(c.dataset.thumbId);if(p)paintPage(c.getContext('2d'),p,120,155);});
}
function updateThumbnail(){const c=$(`canvas[data-thumb-id="${app.pageId}"]`);if(c&&pg())paintPage(c.getContext('2d'),pg(),120,155);}
function renderPage(){
  if(!pg())return;
  $('#template-select').value=templateOK(pg().template);
  const n=nb();const number=n.pageOrder.indexOf(app.pageId)+1;
  $('#page-status').textContent=`Page ${number} of ${n.pageOrder.length}`;
  requestAnimationFrame(()=>{fitPaper();paintCurrentPage();});
}
function fitPaper(){
  if(app.view!=='editor')return;
  const scroller=$('#paper-scroll');
  const available=Math.max(200,scroller.clientWidth-(window.innerWidth<600?32:96));
  const fit=clamp(available/W,.33,1.2);
  app.scale=app.zoom===null?fit:app.zoom;
  const paper=$('#paper');paper.style.width=`${Math.round(W*app.scale)}px`;paper.style.height=`${Math.round(H*app.scale)}px`;
  $('#zoom-fit-btn').textContent=app.zoom===null?'Fit':`${Math.round(app.scale*100)}%`;
}
function prepCanvas(canvas){
  if(!canvas)return null;
  const dpr=Math.min(window.devicePixelRatio||1,3),w=Math.max(1,Math.round(W*app.scale*dpr)),h=Math.max(1,Math.round(H*app.scale*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const ctx=canvas.getContext('2d');ctx.setTransform(w/W,0,0,h/H,0,0);ctx.clearRect(0,0,W,H);return ctx;
}
function paintCurrentPage(){const p=pg();if(!p||app.view!=='editor')return;const bg=prepCanvas($('#paper-background'));drawTemplate(bg,p.template);const ink=prepCanvas($('#paper-ink'));for(const s of p.strokes)drawStroke(ink,s);prepCanvas($('#paper-live'));}
function drawTemplate(ctx,style){ctx.save();ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.lineWidth=1;const type=templateOK(style);
  if(type==='ruled'){ctx.strokeStyle='#dce6f4';ctx.beginPath();for(let y=91;y<H-28;y+=36){ctx.moveTo(40,y);ctx.lineTo(W-40,y);}ctx.stroke();}
  else if(type==='grid'){ctx.strokeStyle='#e9edf4';ctx.beginPath();for(let x=0;x<=W;x+=31){ctx.moveTo(x,0);ctx.lineTo(x,H);}for(let y=0;y<=H;y+=31){ctx.moveTo(0,y);ctx.lineTo(W,y);}ctx.stroke();}
  else if(type==='dots'){ctx.fillStyle='#dbe1eb';for(let x=30;x<W;x+=31)for(let y=30;y<H;y+=31){ctx.beginPath();ctx.arc(x,y,1.4,0,2*Math.PI);ctx.fill();}}
  ctx.restore();}
function paintPage(ctx,page,w,h){ctx.save();ctx.setTransform(w/W,0,0,h/H,0,0);ctx.clearRect(0,0,W,H);drawTemplate(ctx,page.template);for(const s of page.strokes)drawStroke(ctx,s);ctx.restore();}
function drawStroke(ctx,s){if(!s||!Array.isArray(s.points)||!s.points.length)return;const points=s.points;ctx.save();ctx.strokeStyle=s.color||'#283047';ctx.fillStyle=s.color||'#283047';ctx.lineJoin='round';ctx.lineCap='round';const size=Number(s.size)||3;
  if(s.tool==='marker'){ctx.globalAlpha=.30;ctx.lineCap='square';ctx.lineWidth=size;ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length-1;i++){const a=points[i],b=points[i+1];ctx.quadraticCurveTo(a[0],a[1],(a[0]+b[0])/2,(a[1]+b[1])/2);}if(points.length>1){const z=points[points.length-1];ctx.lineTo(z[0],z[1]);}else{ctx.lineTo(points[0][0]+.1,points[0][1]+.1);}ctx.stroke();}
  else if(points.length===1){ctx.beginPath();ctx.arc(points[0][0],points[0][1],size*.5,0,Math.PI*2);ctx.fill();}
  else{for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];const pressure=((a[2]||.5)+(b[2]||.5))*.5;ctx.lineWidth=size*(.64+.68*pressure);const p0=points[Math.max(0,i-2)],p3=points[Math.min(points.length-1,i+1)];ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.bezierCurveTo(a[0]+(b[0]-p0[0])/6,a[1]+(b[1]-p0[1])/6,b[0]-(p3[0]-a[0])/6,b[1]-(p3[1]-a[1])/6,b[0],b[1]);ctx.stroke();}}
  ctx.restore();}
function setTool(tool){if(!['pen','marker','eraser','hand'].includes(tool))return;cancelPointer();app.tool=tool;$('#eraser-cursor').classList.add('hidden');renderToolbar();}
function setZoom(scale){const current=app.scale;app.zoom=scale===null?null:clamp(scale,.30,2.3);fitPaper();paintCurrentPage();if(current!==app.scale){/* Preserve scroll position proportionally for zoom-button use. */}}
function newPage(){const n=nb(),old=pg(),now=Date.now(),id=uid();const page={id,notebookId:n.id,template:old?old.template:'blank',strokes:[],createdAt:now,updatedAt:now};const idx=n.pageOrder.indexOf(app.pageId);n.pageOrder.splice(idx+1,0,id);app.pages.set(id,page);storeWrite('pages',page);markNotebookChanged(n);selectPage(id);toast('New page added');}
function selectPage(id){if(!app.pages.has(id))return;cancelPointer();app.pageId=id;app.history={undo:[],redo:[]};renderPageRail();renderToolbar();renderPage();$('#paper-scroll').scrollTop=0;$('#paper-scroll').scrollLeft=0;}
function duplicatePage(){const n=nb(),old=pg(),id=uid(),now=Date.now();const page={...clone(old),id,strokes:clone(old.strokes),createdAt:now,updatedAt:now};const i=n.pageOrder.indexOf(old.id);n.pageOrder.splice(i+1,0,id);app.pages.set(id,page);storeWrite('pages',page);markNotebookChanged(n);selectPage(id);toast('Page duplicated');}
function movePage(direction){const n=nb(),i=n.pageOrder.indexOf(app.pageId),other=i+direction;if(other<0||other>=n.pageOrder.length)return;[n.pageOrder[i],n.pageOrder[other]]=[n.pageOrder[other],n.pageOrder[i]];markNotebookChanged(n);renderPageRail();renderPage();}
function deletePage(){const n=nb();if(n.pageOrder.length<=1){toast('A notebook needs at least one page.');return;}const number=n.pageOrder.indexOf(app.pageId)+1;showConfirm(`Delete page ${number}?`,'Everything written on this page will be permanently deleted.','Delete page',async()=>{const id=app.pageId,idx=n.pageOrder.indexOf(id);n.pageOrder.splice(idx,1);app.pages.delete(id);await storeRemove('pages',id);markNotebookChanged(n);selectPage(n.pageOrder[Math.min(idx,n.pageOrder.length-1)]);toast('Page deleted');});}
function pushUndo(snapshot){app.history.undo.push(snapshot);if(app.history.undo.length>40)app.history.undo.shift();app.history.redo=[];renderToolbar();}
function undo(){if(!app.history.undo.length||!pg())return;app.history.redo.push(clone(pg().strokes));pg().strokes=app.history.undo.pop();savePage(pg());paintCurrentPage();updateThumbnail();renderToolbar();}
function redo(){if(!app.history.redo.length||!pg())return;app.history.undo.push(clone(pg().strokes));pg().strokes=app.history.redo.pop();savePage(pg());paintCurrentPage();updateThumbnail();renderToolbar();}
function showModal(html,onOpen){const dialog=$('#app-modal');$('#modal-inner').innerHTML=html;dialog.showModal();if(onOpen)onOpen();}
function closeModal(){if($('#app-modal').open)$('#app-modal').close();}
function modalActions(primary='Create notebook',isDanger=false){return `<div class="modal-buttons"><button type="button" class="secondary-button" data-modal-cancel>Cancel</button><button type="submit" class="primary-button ${isDanger?'modal-danger':''}">${escapeHTML(primary)}</button></div>`;}
function wireModalForm(onSubmit){$('#modal-inner [data-modal-cancel]')?.addEventListener('click',closeModal);$('#modal-inner form')?.addEventListener('submit',e=>{e.preventDefault();onSubmit();});}
function showNotebookForm(existing=null){let color=existing?.color||COVERS[0];showModal(`<form><h2 class="modal-title">${existing?'Rename notebook':'A fresh start'}</h2><p class="modal-desc">${existing?'Give this notebook a new name or cover.':'Give your ideas a home. You can always change these later.'}</p><div class="form-field"><label for="notebook-name">Notebook name</label><input id="notebook-name" maxlength="120" required autocomplete="off" placeholder="e.g. Biology notes" value="${escapeHTML(existing?.name||'')}"></div><div class="form-field"><label>Cover color</label><div class="cover-colors">${COVERS.map(c=>`<button type="button" class="cover-color ${color===c?'active':''}" style="--color:${c}" data-cover-color="${c}" title="Choose cover color"></button>`).join('')}</div></div>${modalActions(existing?'Save changes':'Create notebook')}</form>`,()=>{$('#notebook-name').focus();$$('[data-cover-color]').forEach(b=>b.addEventListener('click',()=>{color=b.dataset.coverColor;$$('[data-cover-color]').forEach(x=>x.classList.toggle('active',x===b));}));});
  wireModalForm(()=>{const name=$('#notebook-name').value.trim();if(!name){$('#notebook-name').focus();return;}closeModal();if(existing){existing.name=name;existing.color=color;markNotebookChanged(existing);if(app.view==='editor')renderEditor();else renderLibrary();toast('Notebook updated');}else{const {notebook,page}=makeNotebook(name,color);app.notebooks.push(notebook);app.pages.set(page.id,page);storeWrite('notebooks',notebook);storeWrite('pages',page);openNotebook(notebook.id);}});
}
function showConfirm(title,description,button,onConfirm){showModal(`<form><h2 class="modal-title">${escapeHTML(title)}</h2><p class="modal-desc">${escapeHTML(description)}</p>${modalActions(button,true)}</form>`);wireModalForm(()=>{closeModal();onConfirm();});}
function deleteNotebook(notebook){showConfirm('Delete notebook?',`“${notebook.name}” and all ${notebook.pageOrder.length} pages will be permanently deleted.`,'Delete notebook',async()=>{
  const wasActive=app.notebookId===notebook.id;
  app.notebooks=app.notebooks.filter(n=>n.id!==notebook.id);
  for(const id of notebook.pageOrder){app.pages.delete(id);await storeRemove('pages',id);}await storeRemove('notebooks',notebook.id);
  if(wasActive)showLibrary();else renderLibrary();toast('Notebook deleted');
 });}
function notebookOptions(id){const n=app.notebooks.find(n=>n.id===id);if(!n)return;showModal(`<h2 class="modal-title">${escapeHTML(n.name)}</h2><p class="modal-desc">${n.pageOrder.length} pages · Choose what you'd like to do.</p><div class="option-list"><button type="button" data-opt="rename">${icon('pen')} Rename or change cover</button><button type="button" data-opt="pdf">${icon('download')} Export as PDF</button><button type="button" data-opt="delete" class="danger">${icon('trash')} Delete notebook</button></div><div class="modal-buttons" style="margin-top:22px"><button class="secondary-button" type="button" data-modal-cancel>Close</button></div>`);
  $('#modal-inner [data-modal-cancel]').addEventListener('click',closeModal);
  $$('[data-opt]').forEach(b=>b.addEventListener('click',()=>{const action=b.dataset.opt;closeModal();if(action==='rename')showNotebookForm(n);if(action==='pdf')exportPDF(n);if(action==='delete')deleteNotebook(n);}));
}
function closeMenu(){$('#editor-menu').classList.add('hidden');$('#editor-more-btn').setAttribute('aria-expanded','false');}
function toggleMenu(){const m=$('#editor-menu');m.classList.toggle('hidden');$('#editor-more-btn').setAttribute('aria-expanded',m.classList.contains('hidden')?'false':'true');}
function showHelp(){showModal(`<h2 class="modal-title">Your notes belong to you</h2><div class="help-copy"><p><strong>Everything saves automatically on this device.</strong> Leafnote doesn't send anything to a server or require an account.</p><p><strong>Back up regularly.</strong> Use “Back up” to download all notebooks as a JSON file. Browser data can be cleared or evicted, and notes don't automatically sync to another iPad.</p><p><strong>Apple Pencil only.</strong> Only Apple Pencil (or a mouse on desktop) can draw and erase. One finger moves the page; two fingers pinch to zoom. Resting your palm cannot make marks.</p><p><strong>Take notes offline.</strong> When installed from a secure hosted website as a Home Screen app, Leafnote caches its files after the first online visit. If you're just opening the HTML file, offline install isn't available.</p><p><strong>Keyboard shortcuts:</strong> P = pen, H = highlighter, E = eraser, ⌘Z = undo, ⌘⇧Z = redo.</p></div><div class="modal-buttons"><button type="button" class="primary-button" data-modal-cancel>Got it</button></div>`);$('#modal-inner [data-modal-cancel]').addEventListener('click',closeModal);}

// Input: pointer events handle Apple Pencil, mouse, finger, and two-finger pinch zoom.
function pointForEvent(e){const r=$('#paper-live').getBoundingClientRect();return [clamp((e.clientX-r.left)/Math.max(r.width,1)*W,0,W),clamp((e.clientY-r.top)/Math.max(r.height,1)*H,0,H),clamp(e.pressure||.5,.08,1)];}
function addPoint(s,e){const pt=pointForEvent(e),last=s.points[s.points.length-1];if(!last||Math.hypot(pt[0]-last[0],pt[1]-last[1])>.4)s.points.push([Math.round(pt[0]*10)/10,Math.round(pt[1]*10)/10,Math.round(pt[2]*100)/100]);}
let liveFrame=0;
function clearLive(){if(liveFrame){cancelAnimationFrame(liveFrame);liveFrame=0;}const c=$('#paper-live'),ctx=c.getContext('2d');if(ctx){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);}}
function cancelPointer(){app.pointer=null;app.touches.clear();app.pinch=null;clearLive();$('#paper').classList.remove('is-panning');$('#eraser-cursor').classList.add('hidden');}
function drawLive(){const c=$('#paper-live');if(!app.pointer||app.pointer.kind!=='draw')return;const ctx=prepCanvas(c);drawStroke(ctx,app.pointer.stroke);}
function scheduleLive(){if(liveFrame)return;liveFrame=requestAnimationFrame(()=>{liveFrame=0;drawLive();});}
function showEraser(e){const circle=$('#eraser-cursor');if(app.tool!=='eraser'||!app.pointer&&!['mouse','pen'].includes(e.pointerType)){circle.classList.add('hidden');return;}const r=$('#paper-live').getBoundingClientRect();circle.classList.remove('hidden');circle.style.left=`${e.clientX-r.left}px`;circle.style.top=`${e.clientY-r.top}px`;const size=app.sizes.eraser*app.scale;circle.style.width=`${size}px`;circle.style.height=`${size}px`;}
function pointSegmentDistance(px,py,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];const den=dx*dx+dy*dy;if(den<.001)return Math.hypot(px-a[0],py-a[1]);const t=clamp(((px-a[0])*dx+(py-a[1])*dy)/den,0,1);return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));}
function nearStroke(stroke,x,y,r){const points=stroke.points||[];if(!points.length)return false;const threshold=r+(stroke.size||3)*.45;if(points.length===1)return Math.hypot(x-points[0][0],y-points[0][1])<threshold;for(let i=1;i<points.length;i++)if(pointSegmentDistance(x,y,points[i-1],points[i])<threshold)return true;return false;}
function eraseAt(e){const current=app.pointer;if(!current||current.kind!=='erase')return;const pt=pointForEvent(e),last=current.last||pt,distance=Math.hypot(pt[0]-last[0],pt[1]-last[1]),steps=Math.max(1,Math.ceil(distance/Math.max(4,app.sizes.eraser*.33)));let didErase=false;
  for(let k=1;k<=steps;k++){const x=last[0]+(pt[0]-last[0])*k/steps,y=last[1]+(pt[1]-last[1])*k/steps;const before=pg().strokes.length;pg().strokes=pg().strokes.filter(s=>!nearStroke(s,x,y,app.sizes.eraser*.5));if(before!==pg().strokes.length)didErase=true;}
  current.last=pt;if(didErase){current.changed=true;const c=$('#paper-ink');const ctx=prepCanvas(c);for(const stroke of pg().strokes)drawStroke(ctx,stroke);}
}
function onPointerDown(e){
  if(app.view!=='editor'||!pg())return;
  const surface=$('#paper-live');
  if(e.pointerType==='touch'){
    e.preventDefault(); // Fingers and resting palms must NEVER draw or erase.
    if(app.pointer?.pointerType==='pen')return; // Pencil always wins over palm.
    app.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    try{surface.setPointerCapture(e.pointerId);}catch(_){}
    if(app.touches.size>=2){
      const pts=[...app.touches.values()],dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      app.pointer=null;$('#paper').classList.remove('is-panning');
      app.pinch={distance:Math.max(1,dist),startScale:app.scale,scrollLeft:$('#paper-scroll').scrollLeft,scrollTop:$('#paper-scroll').scrollTop};
      return;
    }
    if(app.pointer||app.pinch)return;
    const sc=$('#paper-scroll');
    app.pointer={kind:'pan',pointerType:'touch',id:e.pointerId,startX:e.clientX,startY:e.clientY,scrollLeft:sc.scrollLeft,scrollTop:sc.scrollTop};
    $('#paper').classList.add('is-panning');
    return;
  }
  if(e.pointerType!=='pen'&&e.pointerType!=='mouse')return;
  if(e.pointerType==='mouse'&&(e.button!==0||Date.now()-app.lastPenTime<800))return;
  if(app.pointer?.pointerType==='pen')return;
  if(e.pointerType==='pen'){
    app.lastPenTime=Date.now();
    // If the user's palm landed first, take the pen immediately anyway.
    app.pointer=null;app.touches.clear();app.pinch=null;
    $('#paper').classList.remove('is-panning');
  }else if(app.pointer||app.pinch)return;
  e.preventDefault();
  try{surface.setPointerCapture(e.pointerId);}catch(_){}
  if(app.tool==='hand'){
    const sc=$('#paper-scroll');
    app.pointer={kind:'pan',pointerType:e.pointerType,id:e.pointerId,startX:e.clientX,startY:e.clientY,scrollLeft:sc.scrollLeft,scrollTop:sc.scrollTop};
    $('#paper').classList.add('is-panning');
  }else if(app.tool==='eraser'){
    app.pointer={kind:'erase',pointerType:e.pointerType,id:e.pointerId,before:clone(pg().strokes),last:null,changed:false,pageId:app.pageId};
    eraseAt(e);showEraser(e);
  }else{
    const stroke={id:uid(),tool:app.tool,color:app.color,size:app.sizes[app.tool],points:[]};
    addPoint(stroke,e);
    app.pointer={kind:'draw',pointerType:e.pointerType,id:e.pointerId,stroke,pageId:app.pageId};
    scheduleLive();
  }
}
function onPointerMove(e){
  if(e.pointerType==='touch'){
    if(app.pointer?.pointerType==='pen'||!app.touches.has(e.pointerId))return;
    e.preventDefault();app.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(app.pinch&&app.touches.size>=2){
      const pts=[...app.touches.values()],distance=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const scale=clamp(app.pinch.startScale*distance/app.pinch.distance,.30,2.3);
      app.zoom=scale;fitPaper();paintCurrentPage();
      const sc=$('#paper-scroll'),factor=scale/app.pinch.startScale;
      sc.scrollLeft=app.pinch.scrollLeft*factor;sc.scrollTop=app.pinch.scrollTop*factor;
    }else if(app.pointer?.kind==='pan'&&app.pointer.id===e.pointerId){
      const p=app.pointer,sc=$('#paper-scroll');
      sc.scrollLeft=p.scrollLeft+(p.startX-e.clientX);
      sc.scrollTop=p.scrollTop+(p.startY-e.clientY);
    }
    return;
  }
  if(e.pointerType==='pen')app.lastPenTime=Date.now();
  const p=app.pointer;
  if(!p||p.id!==e.pointerId){showEraser(e);return;}
  e.preventDefault();
  if(p.kind==='pan'){
    const sc=$('#paper-scroll');sc.scrollLeft=p.scrollLeft+(p.startX-e.clientX);sc.scrollTop=p.scrollTop+(p.startY-e.clientY);
  }else if(p.kind==='erase'){
    const coalesced=e.getCoalescedEvents?.();for(const sample of coalesced||[])eraseAt(sample);eraseAt(e);showEraser(e);
  }else if(p.kind==='draw'){
    const coalesced=e.getCoalescedEvents?.();for(const sample of coalesced||[])addPoint(p.stroke,sample);
    addPoint(p.stroke,e);scheduleLive();
  }
}
function finishPointer(e,cancelled=false){
  const p=app.pointer;
  if(!p||p.id!==e.pointerId)return;
  app.pointer=null;$('#paper').classList.remove('is-panning');clearLive();
  if(p.pageId!==undefined&&p.pageId!==app.pageId)return;
  if(p.kind==='draw'){
    if(!cancelled)addPoint(p.stroke,e);
    if(p.stroke.points.length){
      pushUndo(clone(pg().strokes));pg().strokes.push(p.stroke);
      savePage(pg());paintCurrentPage();updateThumbnail();
    }
  }else if(p.kind==='erase'&&p.changed){
    pushUndo(p.before);savePage(pg());paintCurrentPage();updateThumbnail();
  }
}
function onPointerUp(e){
  if(e.pointerType==='touch'){
    app.touches.delete(e.pointerId);
    if(app.pinch){if(app.touches.size<2)app.pinch=null;return;}
  }
  finishPointer(e);
}
function onPointerCancel(e){
  if(e.pointerType==='touch'){
    app.touches.delete(e.pointerId);if(app.touches.size<2)app.pinch=null;
  }
  // iPadOS may interrupt a Pencil stream; retain its partial handwriting.
  finishPointer(e,true);
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
function renderExportCanvas(page,scale=2){const c=document.createElement('canvas');c.width=W*scale;c.height=H*scale;paintPage(c.getContext('2d'),page,c.width,c.height);return c;}
function exportPNG(){if(!pg())return;const c=renderExportCanvas(pg(),2);const file=`${filename(nb().name)}-page-${nb().pageOrder.indexOf(app.pageId)+1}.png`;if(c.toBlob)c.toBlob(blob=>{if(blob){downloadBlob(blob,file);toast('Page image downloaded');}},'image/png');else downloadBlob(dataUrlToBlob(c.toDataURL('image/png')),file);}
function dataUrlToBlob(data){const [prefix,base64]=data.split(','),mime=(prefix.match(/data:(.*?);/)||[])[1]||'application/octet-stream',s=atob(base64),bytes=new Uint8Array(s.length);for(let i=0;i<s.length;i++)bytes[i]=s.charCodeAt(i);return new Blob([bytes],{type:mime});}
class PDFWriter{constructor(){this.chunks=[];this.length=0;this.offsets=[0];this.encoder=new TextEncoder();}write(s){const v=typeof s==='string'?this.encoder.encode(s):s;this.chunks.push(v);this.length+=v.byteLength;}begin(n){this.offsets[n]=this.length;this.write(`${n} 0 obj\n`);}end(){this.write('endobj\n');}finish(count){const xref=this.length;this.write(`xref\n0 ${count+1}\n0000000000 65535 f \n`);for(let i=1;i<=count;i++)this.write(`${String(this.offsets[i]).padStart(10,'0')} 00000 n \n`);this.write(`trailer\n<< /Size ${count+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(this.chunks,{type:'application/pdf'});}}
async function exportPDF(n){if(!n)return;const pages=n.pageOrder.map(id=>app.pages.get(id)).filter(Boolean);if(!pages.length){toast('No pages to export');return;}
  toast('Preparing your PDF…');try{const writer=new PDFWriter(),count=2+3*pages.length;writer.write('%PDF-1.4\n%\xC3\xA2\xC3\xA3\xC3\x8F\xC3\x93\n');writer.begin(1);writer.write('<< /Type /Catalog /Pages 2 0 R >>\n');writer.end();writer.begin(2);writer.write(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>\n`);writer.end();
  for(let i=0;i<pages.length;i++){
    const pageId=3+i*3,contentId=pageId+1,imageId=pageId+2;
    const canvas=renderExportCanvas(pages[i],2),data=canvas.toDataURL('image/jpeg',.9).split(',')[1],binary=atob(data),jpeg=new Uint8Array(binary.length);for(let j=0;j<binary.length;j++)jpeg[j]=binary.charCodeAt(j);
    writer.begin(pageId);writer.write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\n`);writer.end();
    const instructions='q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ\n';writer.begin(contentId);writer.write(`<< /Length ${writer.encoder.encode(instructions).length} >>\nstream\n${instructions}endstream\n`);writer.end();
    writer.begin(imageId);writer.write(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);writer.write(jpeg);writer.write('\nendstream\n');writer.end();
    await new Promise(r=>setTimeout(r,0));
  }
  downloadBlob(writer.finish(count),`${filename(n.name)}.pdf`);toast('Notebook PDF downloaded');
  }catch(e){console.error(e);toast('Could not export the PDF. Try exporting fewer pages.');}
}
function backup(){const data={format:'leafnote-backup',version:1,exportedAt:new Date().toISOString(),notebooks:app.notebooks,pages:[...app.pages.values()]};downloadBlob(new Blob([JSON.stringify(data)],{type:'application/json'}),`leafnote-backup-${new Date().toISOString().slice(0,10)}.json`);toast('All notebooks backed up');}
function normalizeStroke(s){if(!s||!['pen','marker'].includes(s.tool)||!Array.isArray(s.points))return null;const points=s.points.slice(0,20000).filter(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))).map(p=>[clamp(Number(p[0]),0,W),clamp(Number(p[1]),0,H),clamp(Number(p[2])||.5,.08,1)]);if(!points.length)return null;return {id:uid(),tool:s.tool,color:/^#[0-9a-fA-F]{6}$/.test(s.color)?s.color:COLORS[0],size:clamp(Number(s.size)||3,1,80),points};}
async function importBackup(file){try{if(file.size>100*1024*1024)throw new Error('Backup is too large (maximum 100 MB).');const data=JSON.parse(await file.text());if(data.format!=='leafnote-backup'||!Array.isArray(data.notebooks)||!Array.isArray(data.pages))throw new Error('That is not a Leafnote backup file.');if(data.notebooks.length>1000||data.pages.length>20000)throw new Error('Backup has too many notebooks or pages.');
  let imported=0;for(const original of data.notebooks){if(!original||!Array.isArray(original.pageOrder))continue;const n={id:uid(),name:String(original.name||'Imported notebook').slice(0,120),color:COVERS.includes(original.color)?original.color:COVERS[0],createdAt:Date.now(),updatedAt:Date.now(),pageOrder:[]};for(const oldPageId of original.pageOrder){const old=data.pages.find(p=>p.id===oldPageId&&p.notebookId===original.id);if(!old)continue;const p={id:uid(),notebookId:n.id,template:templateOK(old.template),strokes:Array.isArray(old.strokes)?old.strokes.slice(0,150000).map(normalizeStroke).filter(Boolean):[],createdAt:Date.now(),updatedAt:Date.now()};n.pageOrder.push(p.id);app.pages.set(p.id,p);await storeWrite('pages',p);}
    if(!n.pageOrder.length){const p={id:uid(),notebookId:n.id,template:'blank',strokes:[],createdAt:Date.now(),updatedAt:Date.now()};n.pageOrder.push(p.id);app.pages.set(p.id,p);await storeWrite('pages',p);}
    app.notebooks.push(n);await storeWrite('notebooks',n);imported++;
  }
  renderLibrary();toast(`Imported ${imported} ${imported===1?'notebook':'notebooks'} — existing notes kept`);
 }catch(err){console.error(err);toast(err.message||'Could not import this backup.');}}

function bindEvents(){
  $('#new-notebook-btn').addEventListener('click',()=>showNotebookForm());
  $('#notebook-grid').addEventListener('click',e=>{const menu=e.target.closest('[data-action="notebook-options"]');if(menu){e.stopPropagation();notebookOptions(menu.dataset.id);return;}if(e.target.closest('#new-notebook-card')){showNotebookForm();return;}const card=e.target.closest('[data-notebook-id]');if(card)openNotebook(card.dataset.notebookId);});
  $('#notebook-grid').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('notebook-card')){e.preventDefault();openNotebook(e.target.dataset.notebookId);}});
  $('#search-notebooks').addEventListener('input',renderLibrary);
  $('#back-library-btn').addEventListener('click',showLibrary);
  $('#help-btn').addEventListener('click',showHelp);
  $('#import-backup-btn').addEventListener('click',()=>$('#backup-file-input').click());
  $('#export-backup-btn').addEventListener('click',backup);
  $('#backup-file-input').addEventListener('change',async e=>{if(e.target.files?.[0])await importBackup(e.target.files[0]);e.target.value='';});
  $('#export-pdf-btn').addEventListener('click',()=>exportPDF(nb()));
  $('#editor-more-btn').addEventListener('click',e=>{e.stopPropagation();toggleMenu();});
  $('#editor-menu').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;closeMenu();const n=nb();switch(b.dataset.action){case'rename-notebook':showNotebookForm(n);break;case'export-png':exportPNG();break;case'export-backup':backup();break;case'delete-notebook':deleteNotebook(n);break;}});
  document.addEventListener('click',e=>{if(!e.target.closest('.menu-parent'))closeMenu();});
  $('#toggle-rail-btn').addEventListener('click',()=>{app.sidebarOpen=!app.sidebarOpen;$('#page-rail').classList.toggle('collapsed',!app.sidebarOpen);requestAnimationFrame(()=>{fitPaper();paintCurrentPage();});});
  $('#page-list').addEventListener('click',e=>{const action=e.target.closest('[data-action]');if(action){if(action.disabled)return;const a=action.dataset.action;if(a==='duplicate-page')duplicatePage();if(a==='delete-page')deletePage();if(a==='move-page-up')movePage(-1);if(a==='move-page-down')movePage(1);return;}const item=e.target.closest('[data-page-id]');if(item)selectPage(item.dataset.pageId);});
  $('#page-list').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('page-item')){e.preventDefault();selectPage(e.target.dataset.pageId);}});
  $('#rail-add-page-btn').addEventListener('click',newPage);$('#add-page-btn').addEventListener('click',newPage);
  $$('.tool-btn').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  $('#color-row').addEventListener('click',e=>{const b=e.target.closest('[data-color]');if(!b||b.disabled)return;app.color=b.dataset.color;renderToolbar();});
  $('#stroke-size').addEventListener('input',e=>{app.sizes[app.tool]=Number(e.target.value);});
  $('#undo-btn').addEventListener('click',undo);$('#redo-btn').addEventListener('click',redo);
  $('#template-select').addEventListener('change',e=>{if(!pg())return;pg().template=templateOK(e.target.value);savePage(pg());paintCurrentPage();updateThumbnail();});
  $('#zoom-in-btn').addEventListener('click',()=>setZoom(app.scale+.15));$('#zoom-out-btn').addEventListener('click',()=>setZoom(app.scale-.15));$('#zoom-fit-btn').addEventListener('click',()=>setZoom(null));
  const surface=$('#paper-live');surface.addEventListener('pointerdown',onPointerDown);surface.addEventListener('pointermove',onPointerMove);surface.addEventListener('pointerup',onPointerUp);surface.addEventListener('pointercancel',onPointerCancel);surface.addEventListener('pointerleave',()=>{if(!app.pointer)$('#eraser-cursor').classList.add('hidden');});surface.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{if(app.view!=='editor'||$('#app-modal').open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;const k=e.key.toLowerCase(),mod=e.metaKey||e.ctrlKey;if(mod&&k==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}else if(mod&&k==='y'){e.preventDefault();redo();}else if(!mod&&!e.altKey){if(k==='p')setTool('pen');if(k==='h')setTool('marker');if(k==='e')setTool('eraser');}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&app.view==='editor')requestAnimationFrame(()=>{fitPaper();paintCurrentPage();});});
  window.addEventListener('resize',()=>{if(app.view==='editor')requestAnimationFrame(()=>{fitPaper();paintCurrentPage();});});
  $('#app-modal').addEventListener('click',e=>{if(e.target===$('#app-modal'))closeModal();});
}
init();
})();
