/* Bump this by hand on every publish — the artifact platform's own version id isn't
   readable from page JS, so this is the only way the running page can say which build
   it is when reporting back on testing. */
const BUILD_INFO='v37 · 2026-09-28';
const ROW_H=34, PHASE_H=32, RES_H=44;
const PX={day:36, week:13, month:4.5};
const TODAY=D('2027-03-24');
const state={projectId:'galoc', tab:'gantt', zoom:'week', collapsed:new Set(), selectedId:null, editingResId:null, pendingResources:[], pendingPreds:[], newTaskRes:[], showPOB:true, editingXferId:null, xfManifest:[], visibleCols:new Set(),
  multiSel:new Set(), creatingGroup:false, moveMenuOpen:false, renamingGroupId:null};

/* ---------- WBS grouping (summary tasks) ----------
   A group is a task object with group:true living in the same proj.tasks array,
   scoped to one phase like any other task. A leaf task/milestone points at its
   group via .parent (a group id) or has no .parent at all (top-level, ungrouped).
   Nesting is single-level on purpose: a group's own .parent is always null.
   Dates are never stored on a group — they're always the live min/max of its
   children (rollupOf), so there's nothing to keep in sync when a child moves,
   resizes, or gets added/removed. Dependencies stay leaf-only: a group is never
   a link-drag target and never appears in the predecessor typeahead. */
function leafTasks(proj){ return proj.tasks.filter(x=>!x.group); }
function childrenOf(proj, groupId){ return proj.tasks.filter(x=>x.parent===groupId); }
function rollupOf(proj, g){
  const kids=childrenOf(proj, g.id);
  if(!kids.length) return {start:TODAY, end:TODAY+1};
  return {start:Math.min(...kids.map(k=>k.start)), end:Math.max(...kids.map(k=>k.end))};
}
/* the row that actually represents `id` right now: itself if visible, otherwise
   its group (when that group is collapsed) — used to re-anchor dependency arrows
   instead of letting them vanish when a group closes. */
function anchorTask(proj, id){
  const t=proj.tasks.find(x=>x.id===id); if(!t) return null;
  if(!t.parent) return t;
  const g=proj.tasks.find(x=>x.id===t.parent);
  return (g && g.collapsed) ? g : t;
}
function cleanupEmptyGroup(proj, groupId){
  if(!groupId) return;
  const g=proj.tasks.find(x=>x.id===groupId); if(!g || !g.group) return;
  if(!childrenOf(proj, groupId).length) proj.tasks=proj.tasks.filter(x=>x.id!==groupId);
}
/* A phase header is a valid grouping target too, same as a group — it shows its own
   rollup bar spanning every leaf task in it, regardless of which (if any) sub-group
   they're further nested in. */
function phaseRollup(proj, phaseId){
  const kids=proj.tasks.filter(x=>x.phase===phaseId && !x.group);
  if(!kids.length) return {start:TODAY, end:TODAY+1};
  return {start:Math.min(...kids.map(k=>k.start)), end:Math.max(...kids.map(k=>k.end))};
}
/* the top-level (ungrouped-or-group) sibling immediately before `taskId` in its phase,
   in the same order the Gantt renders them — what "indent" or a drag-drop lands on. */
function precedingTopLevelSibling(proj, phaseId, taskId){
  const top=proj.tasks.filter(x=>x.phase===phaseId && !x.parent).sort((a,b)=>{
    const as=a.group?rollupOf(proj,a).start:a.start, bs=b.group?rollupOf(proj,b).start:b.start;
    return as-bs;
  });
  const idx=top.findIndex(x=>x.id===taskId);
  return idx>0 ? top[idx-1] : null;
}
/* The one function behind indent, drag-drop, and "Move to": reparents `taskId` onto
   `targetId`, whatever kind of row that is. Pure mutation — no persist/render/toast,
   so callers can batch a multi-select move into one save. Returns what happened, or
   null if there was nothing to do. */
function applyReparent(proj, taskId, targetId){
  const t=proj.tasks.find(x=>x.id===taskId); if(!t || taskId===targetId) return null;
  const targetPhase=PHASES.find(p=>p.id===targetId);
  if(targetPhase){
    if(t.phase===targetPhase.id && !t.parent) return null; // already a bare top-level member here
    const oldParent=t.parent;
    t.phase=targetPhase.id; t.parent=null;
    pushHistory(t, `Moved to phase "${targetPhase.name}".`);
    cleanupEmptyGroup(proj, oldParent);
    return {kind:'phase', name:targetPhase.name};
  }
  let target=proj.tasks.find(x=>x.id===targetId); if(!target) return null;
  if(!target.group && target.parent) target=proj.tasks.find(x=>x.id===target.parent) || target;
  if(target.group){
    if(t.parent===target.id) return null; // already in this group
    const oldParent=t.parent;
    t.phase=target.phase; t.parent=target.id;
    pushHistory(t, `Added to "${target.name}".`);
    cleanupEmptyGroup(proj, oldParent);
    target.collapsed=false;
    return {kind:'group', name:target.name};
  }
  // target is a plain top-level leaf: promote it into a brand-new group housing both,
  // named after it (renaming is one click, via the group's own name label).
  const oldParent=t.parent;
  const groupId=uid('g');
  const g={id:groupId, phase:target.phase, name:target.name, group:true, parent:null, collapsed:false, history:[{date:iso(TODAY),text:'By You — Group created.'}]};
  const idx=proj.tasks.findIndex(x=>x.id===target.id);
  proj.tasks.splice(idx,0,g);
  target.parent=groupId;
  t.phase=target.phase; t.parent=groupId;
  pushHistory(target, `Grouped with "${t.name}" under new group "${g.name}".`);
  pushHistory(t, `Grouped with "${target.name}" under new group "${g.name}".`);
  cleanupEmptyGroup(proj, oldParent);
  return {kind:'newgroup', name:g.name};
}
function reparentToast(res){
  if(!res) return null;
  return res.kind==='phase' ? `✓ Moved to "${res.name}".`
    : res.kind==='newgroup' ? `✓ Created "${res.name}" with 2 tasks.`
    : `✓ Added to "${res.name}".`;
}
function indentTask(taskId){
  const proj=project(), t=proj.tasks.find(x=>x.id===taskId); if(!t) return;
  const prev=precedingTopLevelSibling(proj, t.phase, taskId);
  if(!prev){ showToast('✗ Nothing above it in this phase to join — drag it onto another task, or use "+ New group".'); return; }
  const res=applyReparent(proj, taskId, prev.id); if(!res) return;
  persistProject(proj); renderAll();
  showToast(reparentToast(res));
}
/* drag-and-drop grouping: grab a row's grip and drop it on another row (task, group,
   or phase header) to reparent it there — same underlying move as the indent button
   and "Move to" menu, just with an explicit, visually-chosen target. */
function findRowDropTarget(x,y,excludeId){
  const els=document.querySelectorAll('#boardContent [data-row-id]');
  for(const el of els){
    if(el.dataset.rowId===excludeId) continue;
    const r=el.getBoundingClientRect();
    if(x>=r.left && x<=r.right && y>=r.top && y<=r.bottom) return el;
  }
  return null;
}
function attachRowDragHandle(handle, taskId){
  handle.addEventListener('pointerdown', e=>{
    e.stopPropagation(); e.preventDefault();
    document.body.classList.add('row-dragging');
    let hoverEl=null;
    function onMove(ev){
      if(hoverEl) hoverEl.classList.remove('drop-hover');
      hoverEl=findRowDropTarget(ev.clientX, ev.clientY, taskId);
      if(hoverEl) hoverEl.classList.add('drop-hover');
    }
    function onUp(ev){
      document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp);
      document.body.classList.remove('row-dragging');
      if(hoverEl) hoverEl.classList.remove('drop-hover');
      const target=findRowDropTarget(ev.clientX, ev.clientY, taskId);
      if(!target) return;
      const proj=project();
      const res=applyReparent(proj, taskId, target.dataset.rowId);
      if(res){ persistProject(proj); renderAll(); showToast(reparentToast(res)); }
    }
    document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
  });
}
/* Optional inline columns beside each task row (toggled via the toolbar's "Columns" picker).
   Width here drives --label-w, which both .row-label and .axis-corner size against so the
   sticky left column and its header stay in sync as columns are added/removed. */
const INLINE_COLS=[
  {key:'start', label:'Start', width:98},
  {key:'end', label:'End', width:98},
  {key:'days', label:'Days', width:46},
  {key:'pct', label:'% done', width:52},
  {key:'status', label:'Status', width:100},
  {key:'wbs', label:'WBS', width:64},
  {key:'srcDur', label:'Source duration', width:100},
];
function computeLabelWidth(){
  let w=280;
  // +8, not the column's own width alone — .row-label has `gap:8px` between every flex
  // child, so each added column consumes its width plus one more gap, not just its width.
  INLINE_COLS.forEach(c=>{ if(state.visibleCols.has(c.key)) w+=c.width+8; });
  return w;
}

/* is `candidateId` reachable by walking forward (successors) from `ancestorId`? used to block circular dependencies */
function isDescendant(proj, ancestorId, candidateId){
  const visited=new Set(), stack=[ancestorId];
  while(stack.length){
    const cur=stack.pop();
    if(cur===candidateId) return true;
    if(visited.has(cur)) continue; visited.add(cur);
    proj.tasks.forEach(x=>{ if((x.preds||[]).includes(cur)) stack.push(x.id); });
  }
  return false;
}
function wouldCycle(proj, predId, succId){ return isDescendant(proj, succId, predId); }

/* ---------- bundled db: makes this artifact a standalone, persistent app ---------- */
let DB=null;
async function getDb(){
  if(!window.claude || !window.claude.use) return null;
  try{ return await window.claude.use('db'); } catch(e){ return null; }
}
/* Group tasks never carry start/end — their dates are always the live rollup of
   their children (see rollupOf) — so date (de)serialization must skip them; running
   iso()/D() on an undefined date throws (Invalid Date / undefined.split), not just
   produces garbage. */
function serializeTasks(tasks){ return (tasks||[]).map(t=> t.group ? {...t} : {...t, start:iso(t.start), end:iso(t.end)}); }
/* {...t} only clones the top-level task object — nested arrays (history/preds/resources)
   are copied by reference. The db capability's own snap.data() appears to return a
   non-extensible (frozen) snapshot, so those nested arrays stayed frozen even inside an
   otherwise-fresh task object — any later in-place mutation (.push()/.unshift()) on them
   threw "object is not extensible", confirmed via a real stack trace from live testing.
   Explicitly re-cloning each nested array here fixes it at the one place every task passes
   through on load, rather than relying on every call site downstream to never mutate in place. */
function deserializeTasks(tasks){
  return (tasks||[]).map(t=>{
    const base={...t, history:(t.history||[]).map(h=>({...h}))};
    if(t.group) return base;
    return {...base, start:D(t.start), end:D(t.end),
      preds:(t.preds||[]).slice(),
      resources:(t.resources||[]).map(r=>Array.isArray(r)?r.slice():r)};
  });
}
function serializeTransfers(transfers){ return (transfers||[]).map(x=>({...x, day:iso(x.day)})); }
function deserializeTransfers(transfers){ return (transfers||[]).map(x=>({...x, day:D(x.day)})); }

function statusClassFor(status){
  return {Active:'active-status', Planning:'planning-status', 'On Hold':'hold-status', Closed:'closed-status'}[status] || 'active-status';
}
async function loadState(){
  DB=await getDb();
  if(!DB){
    PROJECTS=SEED_PROJECTS.map(p=>({...p})); RES=SEED_RES; SHIFTS=SEED_SHIFTS; POB_CAP=SEED_POB_CAP;
  } else {
    try{
      const cfgSnap=await DB.doc('config/main').get();
      const cfg=cfgSnap.exists?cfgSnap.data():{};
      RES=cfg.resources||SEED_RES; SHIFTS=cfg.shifts||SEED_SHIFTS;
      POB_CAP=(typeof cfg.pobCap==='number')?cfg.pobCap:SEED_POB_CAP;

      const idxSnap=await DB.doc('config/projects').get();
      const ids=(idxSnap.exists && Array.isArray(idxSnap.data().ids) && idxSnap.data().ids.length) ? idxSnap.data().ids : SEED_PROJECTS.map(p=>p.id);

      PROJECTS=[];
      for(const id of ids){
        const sp=SEED_PROJECTS.find(p=>p.id===id);
        const snap=await DB.doc('projects/'+id).get();
        if(snap.exists){
          const d=snap.data();
          const name=d.name||(sp?sp.name:id), status=d.status||(sp?sp.status:'Active');
          PROJECTS.push({id, name, status, statusClass:d.statusClass||statusClassFor(status), tasks:deserializeTasks(d.tasks), transfers:deserializeTransfers(d.transfers)});
        } else if(sp){
          PROJECTS.push({...sp});
        }
      }
      if(!PROJECTS.length) PROJECTS=SEED_PROJECTS.map(p=>({...p}));
    } catch(e){
      DB=null; PROJECTS=SEED_PROJECTS.map(p=>({...p})); RES=SEED_RES; SHIFTS=SEED_SHIFTS; POB_CAP=SEED_POB_CAP;
    }
  }
  // Was an early `return` inside the `if(!DB)` branch above, which skipped this exact
  // check — the one real path found (via a live stack trace) that could leave state.projectId
  // pointing at nothing, so project() returned undefined and crashed renderAll() on the very
  // next render (in renderPobBanner → leafTasks). Now every branch above falls through to here.
  if(!PROJECTS.find(p=>p.id===state.projectId)) state.projectId=PROJECTS[0].id;
}
function persistProject(proj){
  if(!DB||!proj) return;
  DB.doc('projects/'+proj.id).set({name:proj.name, status:proj.status, statusClass:proj.statusClass, tasks:serializeTasks(proj.tasks), transfers:serializeTransfers(proj.transfers||[])}).catch(()=>{});
}
function persistConfig(){ if(!DB) return; DB.doc('config/main').set({resources:RES, shifts:SHIFTS, pobCap:POB_CAP}).catch(()=>{}); }
function persistProjectIndex(){ if(!DB) return; DB.doc('config/projects').set({ids:PROJECTS.map(p=>p.id)}).catch(()=>{}); }

/* ---------- import / export / print ---------- */
async function getDownloads(){
  if(!window.claude || !window.claude.use) return null;
  try{ return await window.claude.use('downloads'); } catch(e){ return null; }
}
function exportSnapshot(){
  return {
    workflowExport: 1, exportedAt: iso(TODAY),
    resources: RES, shifts: SHIFTS, pobCap: POB_CAP,
    projects: PROJECTS.map(p=>({id:p.id, name:p.name, status:p.status, statusClass:p.statusClass, tasks:serializeTasks(p.tasks), transfers:serializeTransfers(p.transfers||[])}))
  };
}
function csvEscape(v){ v=String(v==null?'':v); return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
function exportCSV(){
  const proj=project();
  const rows=[['ID','Phase','Name','Type','Start','End','Duration(d)','Status','%','Resources','Depends on','Notes']];
  leafTasks(proj).forEach(t=>{
    const phase=PHASES.find(p=>p.id===t.phase);
    rows.push([
      t.id, phase?phase.name:t.phase, t.name, t.milestone?'Milestone':'Task',
      iso(t.start), t.milestone?iso(t.start):iso(t.end-1),
      t.milestone?'':String(t.end-t.start),
      t.milestone?'':statusLabel(t.status), t.milestone?'':String(t.pct),
      (t.resources||[]).map(r=>(RES[r[0]]?RES[r[0]].name:r[0])+' x'+r[1]).join('; '),
      (t.preds||[]).map(pid=>{ const p=proj.tasks.find(x=>x.id===pid); return p?p.name:pid; }).join('; '),
      t.notes||''
    ]);
  });
  return rows.map(r=>r.map(csvEscape).join(',')).join('\r\n');
}
async function doExportJSON(){
  const dl=await getDownloads();
  if(!dl){ showToast('Downloads are not available in this view.'); return; }
  try{ await dl.save({filename:'workflow-export.json', data:JSON.stringify(exportSnapshot(), null, 2)}); showToast('✓ Exported workflow-export.json'); }
  catch(e){ if(!e || e.code!=='declined') showToast('✗ Export failed.'); }
}
async function doExportCSV(){
  const dl=await getDownloads();
  if(!dl){ showToast('Downloads are not available in this view.'); return; }
  try{ await dl.save({filename:project().id+'-tasks.csv', data:exportCSV()}); showToast('✓ Exported '+project().id+'-tasks.csv'); }
  catch(e){ if(!e || e.code!=='declined') showToast('✗ Export failed.'); }
}
function importSnapshot(obj){
  if(!obj || typeof obj!=='object' || !Array.isArray(obj.projects)) throw new Error('not a WorkFlow export');
  if(obj.resources && Object.keys(obj.resources).length) RES=obj.resources;
  if(Array.isArray(obj.shifts) && obj.shifts.length) SHIFTS=obj.shifts;
  if(typeof obj.pobCap==='number') POB_CAP=obj.pobCap;
  let addedNew=false;
  obj.projects.forEach(op=>{
    const tasks=deserializeTasks(op.tasks||[]), transfers=deserializeTransfers(op.transfers||[]);
    const existing=PROJECTS.find(p=>p.id===op.id);
    if(existing){
      existing.tasks=tasks; existing.transfers=transfers;
      if(op.name) existing.name=op.name;
      if(op.status){ existing.status=op.status; existing.statusClass=statusClassFor(op.status); }
      persistProject(existing);
    } else {
      const status=op.status||'Active';
      const np={id:op.id, name:op.name||op.id, status, statusClass:statusClassFor(status), tasks, transfers};
      PROJECTS.push(np); persistProject(np); addedNew=true;
    }
  });
  if(addedNew) persistProjectIndex();
  persistConfig();
}

function byId(id){return document.getElementById(id);}
/* Self-heals rather than ever returning undefined: PROJECTS can never be empty (the last
   project can't be deleted — see pjDelete), so if state.projectId ever drifts from it
   (the loadState() early-return bug fixed above was one real way that happened), fall
   back to the first project and correct state on the spot instead of letting every
   caller's proj.tasks / proj.transfers access crash. */
function project(){
  let p=PROJECTS.find(x=>x.id===state.projectId);
  if(!p && PROJECTS.length){ state.projectId=PROJECTS[0].id; p=PROJECTS[0]; }
  return p;
}
function rangeOf(proj){
  const real=leafTasks(proj);
  if(!real.length) return {start:TODAY-5, end:TODAY+25};
  let min=Infinity,max=-Infinity;
  real.forEach(x=>{min=Math.min(min,x.start); max=Math.max(max,x.end);});
  return {start:min-3, end:max+4};
}
function pillClass(s){return {done:'p-done',hold:'p-hold',critical:'p-critical',progress:'p-progress',upcoming:'p-upcoming'}[s]||'p-upcoming';}
function statusLabel(s){return {done:'Complete',hold:'Weather hold',critical:'Flagged critical',progress:'In progress',upcoming:'Upcoming'}[s]||s;}
// Reassigns rather than mutating in place (no .unshift() on the existing array) — belt-
// and-suspenders alongside the deserializeTasks fix above, so this stays safe even if some
// other code path ever hands it a task whose history array wasn't freshly cloned.
function pushHistory(it,text){ it.history=[{date:iso(TODAY), text:'By You — '+text}, ...(it.history||[])]; }
function showToast(msg){ const el=byId('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(showToast._t); showToast._t=setTimeout(()=>el.classList.remove('show'),2600); }

/* ---------- resource math ---------- */
function dailyDemand(proj, rk){
  const days={};
  proj.tasks.filter(x=>!x.milestone && !x.group).forEach(x=>{
    (x.resources||[]).forEach(([rid,c])=>{ if(rid===rk){ for(let d=x.start; d<x.end; d++) days[d]=(days[d]||0)+c; } });
  });
  return days;
}
function computeOverallocation(proj){
  const flagged=new Set(), detail={};
  Object.keys(RES).forEach(rk=>{
    const days=dailyDemand(proj,rk);
    const over=Object.entries(days).map(([d,c])=>[Number(d),c]).filter(([d,c])=>c>RES[rk].cap);
    if(over.length){flagged.add(rk); detail[rk]=over;}
  });
  return {flagged, detail};
}
function totalHeadcountByDay(proj){
  const days={};
  proj.tasks.filter(x=>!x.milestone && !x.group).forEach(x=>{
    (x.resources||[]).forEach(([rid,c])=>{ for(let d=x.start; d<x.end; d++) days[d]=(days[d]||0)+c; });
  });
  return days;
}
function pobBreaches(proj){
  const days=totalHeadcountByDay(proj);
  const over=Object.entries(days).map(([d,c])=>[Number(d),c]).filter(([d,c])=>c>POB_CAP);
  const peak=Object.values(days).reduce((a,b)=>Math.max(a,b),0);
  return {over, peak};
}

/* ---------- shell: sidebar / tabs / toolbar / POB banner ---------- */
function renderSidebar(){
  const list=byId('projList'); list.innerHTML='';
  PROJECTS.forEach(p=>{
    const row=document.createElement('div'); row.className='proj-row';
    const btn=document.createElement('button');
    btn.className='proj-item'+(p.id===state.projectId?' active':'');
    btn.innerHTML=`<span class="proj-dot ${p.statusClass}"></span><span class="proj-meta"><span class="name">${p.name}</span><span class="status">${p.status}</span></span>`;
    btn.onclick=()=>{ state.projectId=p.id; state.selectedId=null; state.multiSel.clear(); state.creatingGroup=false; state.moveMenuOpen=false; state.renamingGroupId=null; renderAll(); };
    const editBtn=document.createElement('button'); editBtn.className='proj-edit-btn'; editBtn.textContent='✎'; editBtn.title='Edit project';
    editBtn.onclick=(e)=>{ e.stopPropagation(); openProjModal(p.id); };
    row.appendChild(btn); row.appendChild(editBtn);
    list.appendChild(row);
  });
}
function switchTab(tab){
  state.tab=tab;
  document.querySelectorAll('#tabbar button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tabpanel').forEach(p=>p.classList.toggle('active', p.id==='panel-'+tab));
  renderAll();
}
function renderPobBanner(){
  const proj=project(); const banner=byId('pobBanner');
  if(!state.showPOB || !leafTasks(proj).length){ banner.classList.remove('show'); return; }
  const {over,peak}=pobBreaches(proj);
  if(over.length){
    banner.classList.add('show');
    banner.innerHTML=`⚠ POB exceeds cap on ${over.length} day(s) this schedule — peak ${peak} / cap ${POB_CAP}<button id="pobJump">View in Resources</button>`;
    byId('pobJump').onclick=()=>switchTab('resources');
  } else banner.classList.remove('show');
}
function renderToolbar(){
  const proj=project();
  byId('projTitle').textContent=proj.name;
  const tc=proj.tasks.filter(x=>!x.milestone && !x.group).length, mc=proj.tasks.filter(x=>x.milestone).length;
  byId('projSub').textContent=proj.status+(leafTasks(proj).length? ` · ${tc} tasks, ${mc} milestones` : ' · no schedule yet');
  const extra=byId('toolbarExtra'); extra.innerHTML='';
  const importBtn=document.createElement('button'); importBtn.className='btn ghost small'; importBtn.textContent='Import';
  importBtn.title='Import from a WorkFlow backup, an Excel/CSV file, or pasted text'; importBtn.onclick=()=>openImportModal();
  const exportBtn=document.createElement('button'); exportBtn.className='btn ghost small'; exportBtn.textContent='Export';
  exportBtn.title='Export this workspace or the current project’s tasks'; exportBtn.onclick=()=>byId('exportModalScrim').classList.add('open');
  const printBtn=document.createElement('button'); printBtn.className='btn ghost small'; printBtn.textContent='Print';
  printBtn.title='Print or save as PDF. If this button does nothing, use your browser’s own Print command (Ctrl/Cmd+P) instead — the page is styled for it either way.';
  printBtn.onclick=()=>{ try{ window.print(); }catch(e){ showToast('Use your browser’s Print command (Ctrl/Cmd+P) instead.'); } };
  extra.appendChild(importBtn); extra.appendChild(exportBtn); extra.appendChild(printBtn);
  if(state.tab==='gantt'||state.tab==='resources'){
    const pobToggle=document.createElement('button'); pobToggle.className='chip'+(state.showPOB?' ok':''); pobToggle.style.cursor='pointer';
    pobToggle.textContent=(state.showPOB?'👁 POB tracking: On':'POB tracking: Off');
    pobToggle.title='Show or hide the POB (persons on board) row and banner';
    pobToggle.onclick=()=>{ state.showPOB=!state.showPOB; renderAll(); };
    extra.appendChild(pobToggle);
  }
  if(state.tab==='gantt'){
    const zoomSeg=document.createElement('div'); zoomSeg.className='seg';
    ['day','week','month'].forEach(z=>{
      const b=document.createElement('button'); b.textContent=z[0].toUpperCase()+z.slice(1); b.className=state.zoom===z?'active':'';
      b.onclick=()=>{ state.zoom=z; renderGantt(); renderToolbar(); };
      zoomSeg.appendChild(b);
    });
    extra.appendChild(zoomSeg);
    const colBtn=document.createElement('button'); colBtn.className='chip'+(state.visibleCols.size?' ok':''); colBtn.style.cursor='pointer';
    colBtn.textContent='Columns'+(state.visibleCols.size?` (${state.visibleCols.size})`:'');
    colBtn.title='Show extra fields inline beside each task, editable in place';
    colBtn.onclick=(e)=>{ e.stopPropagation(); toggleColPicker(colBtn); };
    extra.appendChild(colBtn);
    if(proj.tasks.length){
      const {flagged}=computeOverallocation(proj);
      if(flagged.size){
        const chip=document.createElement('div'); chip.className='chip warn';
        chip.textContent=`⚠ ${flagged.size} resource${flagged.size>1?'s':''} over capacity`;
        chip.onclick=()=>switchTab('resources');
        extra.appendChild(chip);
      }
    }
    const addTask=document.createElement('button'); addTask.className='btn primary small'; addTask.textContent='+ Task';
    addTask.onclick=()=>openTaskModal({milestone:false});
    const addMs=document.createElement('button'); addMs.className='btn ghost small'; addMs.textContent='+ Milestone';
    addMs.onclick=()=>openTaskModal({milestone:true});
    extra.appendChild(addTask); extra.appendChild(addMs);
  } else if(state.tab==='resources'){
    const addRes=document.createElement('button'); addRes.className='btn primary small'; addRes.textContent='+ Resource';
    addRes.onclick=()=>openResModal(null);
    extra.appendChild(addRes);
  }
}

/* ---------- shared axis builder ---------- */
function buildAxisRow(cornerLabel, rangeStart, totalDays, pxPerDay, zoom){
  const axisRow=document.createElement('div'); axisRow.className='axis-row';
  const corner=document.createElement('div'); corner.className='axis-corner'; corner.textContent=cornerLabel;
  const dates=document.createElement('div'); dates.className='axis-dates'; dates.style.width=(totalDays*pxPerDay)+'px';
  for(let i=0;i<=totalDays;i++){
    const dnum=rangeStart+i, dt=dayToDate(dnum), dow=dt.getUTCDay();
    let show=false, strong=false, label='';
    if(zoom==='day'){ show=true; strong=(dow===1); label=String(dt.getUTCDate()); }
    else if(zoom==='week'){ if(dow===1){show=true; strong=true; label=MONTHS[dt.getUTCMonth()]+' '+dt.getUTCDate();} }
    else { if(dt.getUTCDate()===1){show=true; strong=true; label=MONTHS[dt.getUTCMonth()]+" '"+String(dt.getUTCFullYear()).slice(2);} }
    if(!show) continue;
    const tick=document.createElement('div'); tick.className='axis-tick'+(strong?' strong':''); tick.style.left=(i*pxPerDay)+'px'; dates.appendChild(tick);
    const lab=document.createElement('div'); lab.className='axis-label'+(strong?' strong':''); lab.style.left=(i*pxPerDay+4)+'px'; lab.textContent=label; dates.appendChild(lab);
  }
  axisRow.appendChild(corner); axisRow.appendChild(dates);
  return axisRow;
}

/* ---------- Gantt tab ---------- */
function buildVisibleRows(proj){
  const rows=[{type:'transfers', id:'transfers'}];
  if(state.showPOB) rows.push({type:'pob', id:'pob'});
  PHASES.forEach(phase=>{
    const all=proj.tasks.filter(x=>x.phase===phase.id);
    const leafCount=all.filter(x=>!x.group).length;
    if(!leafCount) return;
    rows.push({type:'phase', id:'ph-'+phase.id, phase, count:leafCount});
    if(state.collapsed.has(phase.id)) return;
    // top-level = groups and ungrouped leaves; a group's own children render right
    // beneath it (indented) when it's expanded — single level of nesting, on purpose.
    const top=all.filter(x=>!x.parent).sort((a,b)=>{
      const as=a.group?rollupOf(proj,a).start:a.start, bs=b.group?rollupOf(proj,b).start:b.start;
      return as-bs;
    });
    top.forEach(x=>{
      if(x.group){
        const kids=childrenOf(proj,x.id).sort((a,b)=>a.start-b.start);
        rows.push({type:'group', id:x.id, item:x, phase, count:kids.length});
        if(!x.collapsed) kids.forEach(k=>rows.push({type:k.milestone?'milestone':'task', id:k.id, item:k, phase, indent:true}));
      } else {
        rows.push({type:x.milestone?'milestone':'task', id:x.id, item:x, phase});
      }
    });
  });
  return rows;
}
function heightOf(r){ return r.type==='phase'?PHASE_H : ROW_H; }

/* ---------- optional inline columns (Start/End/Days/%/Status/WBS) rendered beside a task's
   name when toggled on via the Columns picker — each editable field commits immediately
   (writes history + persists), same as a drag or a drawer save; no separate "confirm" step. */
function inlineEditDate(it, field, val){
  const proj=project();
  if(it.milestone){ if(field!=='start') return; it.start=D(val); it.end=it.start; }
  else if(field==='start'){ const ns=D(val); if(ns>=it.end) return; it.start=ns; }
  else { const ne=D(val)+1; if(ne<=it.start) return; it.end=ne; }
  pushHistory(it, `${field==='start'?'Start':'End'} changed to ${fmtShort(field==='start'?it.start:it.end-1)} (inline edit).`);
  persistProject(proj); renderAll();
}
function inlineEditPct(it, val){
  const proj=project();
  let p=Math.max(0,Math.min(100, Number(val)||0));
  if(it.status==='done') p=100; if(it.status==='upcoming') p=0;
  it.pct=p; pushHistory(it, `Progress → ${p}% (inline edit).`);
  persistProject(proj); renderAll();
}
function inlineEditStatus(it, val){
  const proj=project();
  it.status=val;
  if(val==='done') it.pct=100; if(val==='upcoming') it.pct=0;
  pushHistory(it, `Status → ${statusLabel(val)} (inline edit).`);
  persistProject(proj); renderAll();
}
function buildInlineCols(it){
  const cells=[];
  INLINE_COLS.forEach(c=>{
    if(!state.visibleCols.has(c.key)) return;
    const cell=document.createElement('div'); cell.className='icol'; cell.style.flex=`0 0 ${c.width}px`;
    cell.addEventListener('click', e=>e.stopPropagation());
    if(c.key==='wbs'){
      cell.classList.add('wbs-ref'); cell.textContent=it.wbsRef||'—'; if(it.wbsRef) cell.title='WBS '+it.wbsRef;
    } else if(c.key==='srcDur'){
      cell.classList.add('wbs-ref'); cell.textContent=it.sourceDuration||'—'; if(it.sourceDuration) cell.title='As stated in the imported source: '+it.sourceDuration;
    } else if(it.milestone && c.key!=='start'){
      cell.textContent='—';
    } else if(c.key==='start'){
      const inp=document.createElement('input'); inp.type='date'; inp.value=iso(it.start);
      inp.onchange=()=>inlineEditDate(it,'start',inp.value);
      cell.appendChild(inp);
    } else if(c.key==='end'){
      const inp=document.createElement('input'); inp.type='date'; inp.value=iso(it.end-1);
      inp.onchange=()=>inlineEditDate(it,'end',inp.value);
      cell.appendChild(inp);
    } else if(c.key==='days'){
      cell.classList.add('wbs-ref'); cell.textContent=(it.end-it.start)+'d';
    } else if(c.key==='pct'){
      const inp=document.createElement('input'); inp.type='number'; inp.min=0; inp.max=100; inp.value=it.pct;
      inp.onchange=()=>inlineEditPct(it, inp.value);
      cell.appendChild(inp);
    } else if(c.key==='status'){
      const sel=document.createElement('select');
      sel.innerHTML=['upcoming','progress','hold','critical','done'].map(s=>`<option value="${s}"${s===it.status?' selected':''}>${statusLabel(s)}</option>`).join('');
      sel.onchange=()=>inlineEditStatus(it, sel.value);
      cell.appendChild(sel);
    }
    cells.push(cell);
  });
  return cells;
}

function renderGantt(){
  const proj=project();
  const content=byId('boardContent'); content.innerHTML='';
  if(!leafTasks(proj).length){
    content.innerHTML=`<div class="empty-state" style="height:calc(100vh - 180px)"><div class="icon">＋</div><h3>No schedule yet</h3><p>${proj.name} doesn't have a build-out in WorkFlow yet. Add a task to get started, or switch back to see a populated project.</p><button class="btn primary" id="emptyAdd">+ Add first task</button></div>`;
    byId('emptyAdd').onclick=()=>openTaskModal({milestone:false});
    return;
  }
  const {start:rangeStart, end:rangeEnd}=rangeOf(proj);
  const pxPerDay=PX[state.zoom], totalDays=rangeEnd-rangeStart, totalWidth=totalDays*pxPerDay;
  const rows=buildVisibleRows(proj);
  let y=0; const layout={};
  rows.forEach(r=>{ const h=heightOf(r); if(r.id!=='transfers'&&r.id!=='pob') layout[r.id]={y,h}; y+=h; });
  const rowsHeight=y;
  state.rowLayout=layout; state.rowRangeStart=rangeStart; state.rowPxPerDay=pxPerDay;
  byId('panel-gantt').style.setProperty('--label-w', computeLabelWidth()+'px'); // scoped to this tab only — Resources' own .row-label/.axis-corner must stay at 280px

  content.appendChild(buildAxisRow('Task / Phase', rangeStart, totalDays, pxPerDay, state.zoom));

  const rowsWrap=document.createElement('div'); rowsWrap.className='rows-wrap';
  rows.forEach(r=>{
    const row=document.createElement('div');
    row.className='row '+(r.type==='phase'?'phase-row':r.type==='transfers'?'transfer-row':r.type==='pob'?'pob-row':r.type==='group'?'group-row':(r.type==='milestone'?'milestone-row':'task-row'));
    const label=document.createElement('div'); label.className='row-label';
    const tl=document.createElement('div'); tl.className='row-timeline'; tl.style.width=totalWidth+'px';

    if(r.type==='transfers'){
      label.innerHTML=`<span class="name">✈ Personnel Transfers</span>`;
      const addBtn=document.createElement('button'); addBtn.className='addrow-btn'; addBtn.textContent='+'; addBtn.title='Add a transfer';
      addBtn.onclick=(e)=>{ e.stopPropagation(); openTransferModal(null); };
      label.appendChild(addBtn);
      const byDay={};
      (proj.transfers||[]).forEach(x=>{ (byDay[x.day]=byDay[x.day]||[]).push(x); });
      Object.values(byDay).forEach(list=>{
        list.forEach((x,i)=>{
          const cx=(x.day-rangeStart)*pxPerDay + pxPerDay*0.3 + i*13;
          const mk=document.createElement('div'); mk.className='transfer-marker '+x.mode; mk.style.left=cx+'px'; mk.textContent=x.mode==='heli'?'✈':'⛴';
          mk.onclick=(e)=>openTransferPopover(e,x);
          tl.appendChild(mk);
        });
      });
    } else if(r.type==='pob'){
      label.innerHTML=`<span class="name">⚠ Total (POB)</span>`;
      const totals=totalHeadcountByDay(proj);
      let d=rangeStart;
      while(d<rangeEnd){
        let runStart=d, val=totals[d]||0;
        while(d<rangeEnd && (totals[d]||0)===val) d++;
        if(val>0){
          const left=(runStart-rangeStart)*pxPerDay, width=(d-runStart)*pxPerDay, ratio=val/POB_CAP;
          const cell=document.createElement('div'); cell.className='heat-cell';
          cell.style.left=left+'px'; cell.style.width=Math.max(width-1,2)+'px'; cell.style.top='6px'; cell.style.height='22px';
          cell.style.background=ratio>1?'var(--critical)':ratio>=0.75?'var(--hold)':'var(--accent-dim)';
          cell.title=`${val} / ${POB_CAP} POB, ${fmtShort(runStart)}–${fmtShort(d-1)}`;
          if(width>=14){ const lbl=document.createElement('span'); lbl.className='heat-value'; lbl.textContent=val; cell.appendChild(lbl); }
          tl.appendChild(cell);
          if(ratio>1){
            const badge=document.createElement('div'); badge.className='heat-badge'; badge.textContent='!'; badge.style.left=(left+width/2-7)+'px';
            badge.title=`Over POB: ${val} vs ${POB_CAP}`;
            tl.appendChild(badge);
          }
        }
      }
    } else if(r.type==='phase'){
      row.dataset.rowId=r.phase.id; // a phase is a valid drag/indent/"Move to" target too, same as a group
      label.innerHTML=`<span class="chevron${state.collapsed.has(r.phase.id)?' collapsed':''}"></span><span class="phase-swatch" style="background:${r.phase.color}"></span><span class="name">${r.phase.name}</span><span class="dur mono">${r.count}</span>`;
      const addBtn=document.createElement('button'); addBtn.className='addrow-btn'; addBtn.textContent='+'; addBtn.title='Add task to this phase';
      addBtn.onclick=(e)=>{ e.stopPropagation(); openTaskModal({milestone:false, phase:r.phase.id}); };
      label.appendChild(addBtn);
      row.onclick=()=>{ state.collapsed.has(r.phase.id)?state.collapsed.delete(r.phase.id):state.collapsed.add(r.phase.id); renderGantt(); };
      const proll=phaseRollup(proj,r.phase.id);
      const pleft=(proll.start-rangeStart)*pxPerDay, pwidth=Math.max((proll.end-proll.start)*pxPerDay,10);
      const psbar=document.createElement('div'); psbar.className='summary-bar phase-summary-bar';
      psbar.style.left=pleft+'px'; psbar.style.width=pwidth+'px'; psbar.style.setProperty('--phase-c', r.phase.color);
      psbar.innerHTML='<div class="beam"></div><div class="cap l"></div><div class="cap r"></div>';
      tl.appendChild(psbar);
    } else if(r.type==='group'){
      const g=r.item, roll=rollupOf(proj,g);
      row.dataset.rowId=g.id;
      label.insertAdjacentHTML('beforeend', `<span class="chevron${g.collapsed?' collapsed':''}"></span><span class="phase-swatch" style="background:${r.phase.color}"></span>`);
      if(state.renamingGroupId===g.id){
        const input=document.createElement('input'); input.type='text'; input.value=g.name; input.className='group-rename-input';
        input.addEventListener('click', e=>e.stopPropagation());
        const commit=()=>{ const v=input.value.trim(); if(v) g.name=v; state.renamingGroupId=null; persistProject(proj); renderGantt(); };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape'){ state.renamingGroupId=null; renderGantt(); } });
        label.appendChild(input);
        setTimeout(()=>{ input.focus(); input.select(); },0);
      } else {
        const nameSpan=document.createElement('span'); nameSpan.className='name group-name'; nameSpan.textContent=g.name; nameSpan.title='Click to rename';
        nameSpan.addEventListener('click', e=>{ e.stopPropagation(); state.renamingGroupId=g.id; renderGantt(); });
        label.appendChild(nameSpan);
      }
      const badge=document.createElement('span'); badge.className='group-count'; badge.textContent=r.count;
      label.appendChild(badge);
      const delBtn=document.createElement('button'); delBtn.className='group-delete-btn'; delBtn.title='Delete this group — its tasks are kept, just ungrouped'; delBtn.textContent='✕';
      delBtn.addEventListener('click', e=>{ e.stopPropagation(); deleteGroup(g.id); });
      label.appendChild(delBtn);
      row.onclick=()=>{ if(state.renamingGroupId===g.id) return; g.collapsed=!g.collapsed; persistProject(proj); renderGantt(); };
      const left=(roll.start-rangeStart)*pxPerDay, width=Math.max((roll.end-roll.start)*pxPerDay,10);
      const sbar=document.createElement('div'); sbar.className='summary-bar';
      sbar.style.left=left+'px'; sbar.style.width=width+'px';
      sbar.innerHTML='<div class="beam"></div><div class="cap l"></div><div class="cap r"></div>';
      tl.appendChild(sbar);
    } else if(r.type==='task'){
      const it=r.item, selected=it.id===state.selectedId;
      if(selected) row.classList.add('selected');
      if(r.indent) label.classList.add('nested');
      row.dataset.rowId=it.id;
      const grip=document.createElement('span'); grip.className='row-grip'; grip.title='Drag onto another task, a group, or a phase to group/move it';
      grip.textContent='⠿';
      label.appendChild(grip);
      attachRowDragHandle(grip, it.id);
      const chk=document.createElement('input'); chk.type='checkbox'; chk.className='task-chk';
      chk.checked=state.multiSel.has(it.id); chk.title='Select for grouping';
      chk.addEventListener('click', e=>e.stopPropagation());
      chk.addEventListener('change', ()=>toggleMultiSel(it.id));
      label.appendChild(chk);
      label.insertAdjacentHTML('beforeend', `<span class="phase-swatch" style="background:${r.phase.color}"></span><span class="name">${it.name}</span><span class="dur mono">${(it.end-it.start)}d</span>`);
      if(it.parent){
        const ug=document.createElement('button'); ug.className='group-ungroup-btn'; ug.title='Remove from group'; ug.textContent='✕';
        ug.addEventListener('click', e=>{ e.stopPropagation(); removeFromGroup([it.id]); });
        label.appendChild(ug);
      } else {
        const ind=document.createElement('button'); ind.className='indent-btn'; ind.title='Join the task/group above it in this phase'; ind.textContent='⇥';
        ind.addEventListener('click', e=>{ e.stopPropagation(); indentTask(it.id); });
        label.appendChild(ind);
      }
      label.style.cursor='pointer';
      label.addEventListener('click', ()=>openDrawer(it.id));
      buildInlineCols(it).forEach(c=>label.appendChild(c));
      const left=(it.start-rangeStart)*pxPerDay, width=Math.max((it.end-it.start)*pxPerDay,10);
      const bar=document.createElement('div'); bar.className='bar status-'+it.status+(selected?' selected':''); bar.dataset.taskId=it.id;
      bar.style.left=left+'px'; bar.style.width=width+'px'; bar.style.setProperty('--phase-c', r.phase.color);
      bar.innerHTML=(it.status==='progress'
        ? `<div class="bar-track"></div><div class="bar-progress" style="width:${it.pct}%"></div>`
        : `<div class="bar-fill"></div>`)+`<span class="bar-label">${it.name}</span><div class="bar-handle left"></div><div class="bar-handle right"></div>`;
      tl.appendChild(bar);
      attachBarDrag(bar,it,pxPerDay);
      attachResizeHandle(bar.querySelector('.bar-handle.left'),it,'left',pxPerDay);
      attachResizeHandle(bar.querySelector('.bar-handle.right'),it,'right',pxPerDay);
      // Knobs are siblings of the bar in row-timeline, NOT children of it — `.bar` has
      // overflow:hidden (needed to clip the fill/progress bar to its rounded corners), which
      // was silently clipping away anything positioned outside the bar's own box, including
      // the entire enlarged hit-area added a few rounds ago. That's very likely the real
      // reason grabbing the knob has been unreliable this whole time, not a drop-logic bug.
      const knobL=document.createElement('div'); knobL.className='bar-link-knob left'; knobL.title='Drag to link a predecessor onto this task';
      knobL.style.left=(left-6)+'px'; knobL.style.top='11px';
      const knobR=document.createElement('div'); knobR.className='bar-link-knob right'; knobR.title='Drag onto another task to make this one its predecessor';
      knobR.style.left=(left+width-6)+'px'; knobR.style.top='11px';
      tl.appendChild(knobL); tl.appendChild(knobR);
      attachLinkKnob(knobR,it,'end');
      attachLinkKnob(knobL,it,'start');
    } else if(r.type==='milestone'){
      const it=r.item, selected=it.id===state.selectedId;
      if(selected) row.classList.add('selected');
      if(r.indent) label.classList.add('nested');
      row.dataset.rowId=it.id;
      const grip=document.createElement('span'); grip.className='row-grip'; grip.title='Drag onto another task, a group, or a phase to group/move it';
      grip.textContent='⠿';
      label.appendChild(grip);
      attachRowDragHandle(grip, it.id);
      const chk=document.createElement('input'); chk.type='checkbox'; chk.className='task-chk';
      chk.checked=state.multiSel.has(it.id); chk.title='Select for grouping';
      chk.addEventListener('click', e=>e.stopPropagation());
      chk.addEventListener('change', ()=>toggleMultiSel(it.id));
      label.appendChild(chk);
      label.insertAdjacentHTML('beforeend', `<span class="phase-swatch" style="background:${r.phase.color}"></span><span class="name">◆ ${it.name}</span>`);
      if(it.parent){
        const ug=document.createElement('button'); ug.className='group-ungroup-btn'; ug.title='Remove from group'; ug.textContent='✕';
        ug.addEventListener('click', e=>{ e.stopPropagation(); removeFromGroup([it.id]); });
        label.appendChild(ug);
      } else {
        const ind=document.createElement('button'); ind.className='indent-btn'; ind.title='Join the task/group above it in this phase'; ind.textContent='⇥';
        ind.addEventListener('click', e=>{ e.stopPropagation(); indentTask(it.id); });
        label.appendChild(ind);
      }
      label.style.cursor='pointer';
      label.addEventListener('click', ()=>openDrawer(it.id));
      buildInlineCols(it).forEach(c=>label.appendChild(c));
      const cx=(it.start-rangeStart)*pxPerDay + pxPerDay*0.3;
      const dia=document.createElement('div'); dia.className='milestone'+(selected?' selected':''); dia.dataset.taskId=it.id; dia.style.left=cx+'px';
      tl.appendChild(dia);
      const tag=document.createElement('div'); tag.className='milestone-tag'; tag.style.left=(cx+22)+'px'; tag.textContent=it.name;
      tl.appendChild(tag);
      attachMilestoneDrag(dia,it,pxPerDay);
    }
    row.appendChild(label); row.appendChild(tl); rowsWrap.appendChild(row);
  });
  rowsWrap.style.height=rowsHeight+'px';
  content.appendChild(rowsWrap);

  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',totalWidth); svg.setAttribute('height',rowsHeight);
  svg.style.position='absolute'; svg.style.top=0; svg.style.left=0; svg.style.pointerEvents='none';
  proj.tasks.forEach(it=>{
    if(it.group) return; // groups never carry their own dependencies — leaf-only, by design
    (it.preds||[]).forEach(pid=>{
      const predItem=proj.tasks.find(x=>x.id===pid); if(!predItem) return;
      // Re-anchor to a collapsed group's summary bar instead of just skipping the arrow —
      // dependencies aren't affected by grouping, only where the line visually lands.
      const fromA=anchorTask(proj,pid), toA=anchorTask(proj,it.id);
      if(!fromA || !toA || fromA.id===toA.id) return; // both folded into the same visible summary
      if(!layout[fromA.id]||!layout[toA.id]) return;
      const fromY=layout[fromA.id].y+layout[fromA.id].h/2, toY=layout[toA.id].y+layout[toA.id].h/2;
      const fromX = fromA.group ? (rollupOf(proj,fromA).end-rangeStart)*pxPerDay
        : fromA.milestone ? (fromA.start-rangeStart)*pxPerDay+pxPerDay*0.3+9 : (fromA.end-rangeStart)*pxPerDay;
      const toX = toA.group ? (rollupOf(proj,toA).start-rangeStart)*pxPerDay
        : toA.milestone ? (toA.start-rangeStart)*pxPerDay+pxPerDay*0.3-4 : (toA.start-rangeStart)*pxPerDay;
      const midX=fromX+Math.max((toX-fromX)/2,8);
      const d=`M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`;
      // A separate, wide, invisible path carries the click handler — the visible line is only
      // ~1.4px, far too thin to reliably click; this one is only there for hit-testing (svg
      // itself has pointer-events:none, so individual paths opt back in via pointer-events:stroke).
      const hit=document.createElementNS('http://www.w3.org/2000/svg','path');
      hit.setAttribute('d',d); hit.setAttribute('class','dep-path-hit'); hit.setAttribute('fill','none');
      hit.style.cursor='pointer';
      const succTitle=it.name, predTitle=predItem.name;
      const titleEl=document.createElementNS('http://www.w3.org/2000/svg','title'); titleEl.textContent=`Click to remove: "${predTitle}" → "${succTitle}"`;
      hit.appendChild(titleEl);
      hit.addEventListener('click', e=>{
        e.stopPropagation();
        const proj2=project(), succ=proj2.tasks.find(x=>x.id===it.id); if(!succ) return;
        succ.preds=(succ.preds||[]).filter(x=>x!==pid);
        pushHistory(succ, `Dependency on "${predTitle}" removed (clicked the link).`);
        persistProject(proj2); renderAll();
        showToast(`✓ Removed: "${predTitle}" → "${succTitle}".`);
      });
      svg.appendChild(hit);
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','dep-path'); path.setAttribute('d',d); path.setAttribute('marker-end','url(#arrow)');
      svg.appendChild(path);
    });
  });
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML=`<marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)" opacity=".6"/></marker>`;
  svg.appendChild(defs);
  const overlay=document.createElement('div'); overlay.className='overlay'; overlay.style.height=rowsHeight+'px'; overlay.style.width=totalWidth+'px';
  overlay.appendChild(svg);
  const todayX=(TODAY-rangeStart)*pxPerDay;
  if(todayX>=0 && todayX<=totalWidth){
    const line=document.createElement('div'); line.className='today-line'; line.style.left=todayX+'px'; line.style.height=rowsHeight+'px';
    const flag=document.createElement('div'); flag.className='today-flag'; flag.style.left=todayX+'px'; flag.textContent='TODAY · demo';
    overlay.appendChild(line); overlay.appendChild(flag);
  }
  rowsWrap.appendChild(overlay);
  renderMultiSelBar(proj);
}

/* ---------- multi-select grouping (bulk add/remove into a summary task) ---------- */
function toggleMultiSel(id){ state.multiSel.has(id)?state.multiSel.delete(id):state.multiSel.add(id); renderGantt(); }
function clearMultiSel(){ state.multiSel.clear(); state.moveMenuOpen=false; state.creatingGroup=false; renderGantt(); }
function removeFromGroup(ids){
  const proj=project(); const affected=new Set(); let n=0;
  ids.forEach(id=>{ const t=proj.tasks.find(x=>x.id===id); if(t && t.parent){ affected.add(t.parent); t.parent=null; pushHistory(t,'Removed from its group.'); n++; } });
  affected.forEach(gid=>cleanupEmptyGroup(proj,gid));
  state.multiSel.clear();
  persistProject(proj); renderAll();
  if(n) showToast(n===1?'✓ Removed 1 task from its group.':`✓ Removed ${n} tasks from their groups.`);
}
function deleteGroup(groupId){
  const proj=project();
  childrenOf(proj,groupId).forEach(k=>{ k.parent=null; });
  proj.tasks=proj.tasks.filter(x=>x.id!==groupId);
  persistProject(proj); renderAll();
  showToast('✓ Group deleted — its tasks are kept, just ungrouped.');
}
/* targetId is either a group id or a phase id — applyReparent handles both, and moves
   a task cross-phase automatically when the target belongs to a different phase. */
function moveSelectionToTarget(targetId){
  const proj=project();
  const ids=[...state.multiSel];
  let lastRes=null, n=0;
  ids.forEach(id=>{ const res=applyReparent(proj, id, targetId); if(res){ lastRes=res; n++; } });
  state.multiSel.clear(); state.moveMenuOpen=false;
  persistProject(proj); renderAll();
  if(n) showToast(`✓ Moved ${n} task${n===1?'':'s'} to "${lastRes.name}".`);
}
function createGroupFromSelection(name){
  const proj=project();
  const ids=[...state.multiSel]; if(!ids.length) return;
  const first=proj.tasks.find(x=>x.id===ids[0]); if(!first) return;
  const phase=first.phase;
  const groupId=uid('g');
  const g={id:groupId, phase, name:(name||'New group'), group:true, parent:null, collapsed:false, history:[{date:iso(TODAY),text:'By You — Group created.'}]};
  const firstIdx=proj.tasks.findIndex(x=>x.id===ids[0]);
  proj.tasks.splice(firstIdx,0,g);
  const affected=new Set();
  // every selected task joins this group, reassigned to its phase if it wasn't already there —
  // grouping is now allowed to move a task between phases, same as dragging it onto one directly.
  ids.forEach(id=>{ const t=proj.tasks.find(x=>x.id===id); if(!t) return; if(t.parent) affected.add(t.parent); t.phase=phase; t.parent=groupId; pushHistory(t,`Added to new group "${g.name}" (bulk).`); });
  affected.forEach(gid=>cleanupEmptyGroup(proj,gid));
  state.multiSel.clear(); state.creatingGroup=false;
  persistProject(proj); renderAll();
  showToast(`✓ Created "${g.name}" with ${ids.length} task${ids.length===1?'':'s'}.`);
}
function renderMultiSelBar(proj){
  const bar=byId('multiSelBar');
  const n=state.multiSel.size;
  if(!n && !state.creatingGroup){ bar.hidden=true; bar.innerHTML=''; return; }
  bar.hidden=false; bar.innerHTML='';

  if(state.creatingGroup){
    const label=document.createElement('span'); label.innerHTML=`<b>${n}</b> selected — new group name:`;
    const input=document.createElement('input'); input.type='text'; input.placeholder='e.g. Well Testing';
    const ok=document.createElement('button'); ok.className='primary'; ok.textContent='Create';
    const commit=()=>createGroupFromSelection(input.value.trim());
    ok.onclick=commit;
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape'){ state.creatingGroup=false; renderGantt(); } });
    const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=()=>{ state.creatingGroup=false; renderGantt(); };
    bar.append(label, input, ok, cancel);
    setTimeout(()=>input.focus(),0);
    return;
  }

  const label=document.createElement('span'); label.innerHTML=`<b>${n}</b> task${n===1?'':'s'} selected`;
  bar.appendChild(label);
  bar.appendChild(Object.assign(document.createElement('span'),{className:'msb-sep'}));

  const newGroupBtn=document.createElement('button'); newGroupBtn.className='primary'; newGroupBtn.textContent='+ New group';
  newGroupBtn.onclick=()=>{ state.creatingGroup=true; renderGantt(); };
  bar.appendChild(newGroupBtn);

  const wrap=document.createElement('span'); wrap.style.position='relative';
  const groups=proj.tasks.filter(x=>x.group);
  const moveBtn=document.createElement('button'); moveBtn.textContent='Move to ▾';
  moveBtn.onclick=(e)=>{ e.stopPropagation(); state.moveMenuOpen=!state.moveMenuOpen; renderGantt(); };
  wrap.appendChild(moveBtn);
  if(state.moveMenuOpen){
    const menu=document.createElement('div'); menu.className='movegroup-menu';
    if(groups.length){
      const gh=document.createElement('div'); gh.className='movegroup-heading'; gh.textContent='Groups'; menu.appendChild(gh);
      groups.forEach(g=>{ const b=document.createElement('button'); b.textContent=g.name; b.onclick=()=>moveSelectionToTarget(g.id); menu.appendChild(b); });
    }
    const ph=document.createElement('div'); ph.className='movegroup-heading'; ph.textContent='Phases'; menu.appendChild(ph);
    PHASES.forEach(p=>{ const b=document.createElement('button'); b.textContent=p.name; b.onclick=()=>moveSelectionToTarget(p.id); menu.appendChild(b); });
    wrap.appendChild(menu);
  }
  bar.appendChild(wrap);

  const canUngroup=[...state.multiSel].some(id=>{ const t=proj.tasks.find(x=>x.id===id); return t && t.parent; });
  const ungroupBtn=document.createElement('button'); ungroupBtn.textContent='Remove from group'; ungroupBtn.disabled=!canUngroup;
  ungroupBtn.onclick=()=>removeFromGroup([...state.multiSel]);
  bar.appendChild(ungroupBtn);

  bar.appendChild(Object.assign(document.createElement('span'),{className:'msb-sep'}));
  const clearBtn=document.createElement('button'); clearBtn.textContent='Clear'; clearBtn.onclick=clearMultiSel;
  bar.appendChild(clearBtn);
}
document.addEventListener('click', (e)=>{
  if(state.moveMenuOpen && !e.target.closest('#multiSelBar')){ state.moveMenuOpen=false; renderGantt(); }
});

/* ---------- direct-manipulation drag ---------- */
function attachBarDrag(bar, it, pxPerDay){
  bar.addEventListener('pointerdown', e=>{
    e.preventDefault();
    const startX=e.clientX, origStart=it.start, origEnd=it.end; let moved=false;
    function onMove(ev){ const dDays=Math.round((ev.clientX-startX)/pxPerDay); if(dDays!==0) moved=true; it.start=origStart+dDays; it.end=origEnd+dDays; renderGantt(); }
    function onUp(){
      document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp);
      if(moved){ pushHistory(it, `Rescheduled to ${fmtShort(it.start)}–${fmtShort(it.end-1)} (dragged).`); persistProject(project()); renderAll(); showToast('✓ Rescheduled — recorded as a dated update.'); }
      else openDrawer(it.id);
    }
    document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
  });
}
function attachResizeHandle(handle, it, side, pxPerDay){
  handle.addEventListener('pointerdown', e=>{
    e.stopPropagation(); e.preventDefault();
    const startX=e.clientX, origStart=it.start, origEnd=it.end;
    function onMove(ev){
      const dDays=Math.round((ev.clientX-startX)/pxPerDay);
      if(side==='left') it.start=Math.min(origStart+dDays, origEnd-1); else it.end=Math.max(origEnd+dDays, origStart+1);
      renderGantt();
    }
    function onUp(){
      document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp);
      pushHistory(it, `Duration changed to ${it.end-it.start}d (dragged edge).`); persistProject(project()); renderAll(); showToast('✓ Duration updated.');
    }
    document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
  });
}
function attachMilestoneDrag(el, it, pxPerDay){
  el.addEventListener('pointerdown', e=>{
    e.preventDefault(); const startX=e.clientX, orig=it.start; let moved=false;
    function onMove(ev){ const dDays=Math.round((ev.clientX-startX)/pxPerDay); if(dDays!==0) moved=true; it.start=orig+dDays; it.end=it.start; renderGantt(); }
    function onUp(){
      document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp);
      if(moved){ pushHistory(it, `Moved to ${fmtShort(it.start)} (dragged).`); persistProject(project()); renderAll(); showToast('✓ Milestone moved.'); }
      else openDrawer(it.id);
    }
    document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
  });
}
/* Finds a drop target by bounding-box containment (with a padding tolerance) across every
   bar/milestone, rather than a single elementFromPoint() sample at the exact release pixel.
   A short imported task at Week/Month zoom can render just a few pixels wide — landing a
   raw pointer on that exact sliver was the likely reason linking felt broken, not a logic bug. */
function findDropTarget(x,y,excludeId){
  const pad=6;
  const els=document.querySelectorAll('#boardContent [data-task-id]');
  for(const el of els){
    if(el.dataset.taskId===excludeId) continue;
    const r=el.getBoundingClientRect();
    if(r.width===0 && r.height===0) continue;
    if(x>=r.left-pad && x<=r.right+pad && y>=r.top-pad && y<=r.bottom+pad) return el;
  }
  return null;
}
/* dir='end' (right-edge knob): drag FROM this task's finish TO another bar → this task
   becomes that bar's predecessor (the usual finish-to-start read).
   dir='start' (left-edge knob): drag FROM this task's start TO another bar → that bar
   becomes THIS task's predecessor instead — lets you pull in a predecessor by dragging
   backward from "what does this depend on", not just forward from "what comes after me". */
function attachLinkKnob(knob, it, dir){
  knob.addEventListener('pointerdown', e=>{
    console.log('[link] pointerdown on', dir, 'knob of', it.name, '| pointerType:', e.pointerType, 'button:', e.button);
    e.stopPropagation(); e.preventDefault();
    const r=knob.getBoundingClientRect(), x1=r.left+r.width/2, y1=r.top+r.height/2;
    document.body.classList.add('linking-mode');
    let hoverEl=null;
    // While dragging, snap the ghost line to the target's true finish-to-start anchor point
    // (not the raw cursor position) and highlight it — so it's visible *during* the drag,
    // not just true in the saved data, that this always connects end-of-predecessor to
    // start-of-successor regardless of which knob (left or right) you dragged from.
    function onMove(ev){
      if(hoverEl) hoverEl.classList.remove('link-hover');
      hoverEl=findDropTarget(ev.clientX,ev.clientY,it.id);
      let x2=ev.clientX, y2=ev.clientY;
      if(hoverEl){
        hoverEl.classList.add('link-hover');
        const tr=hoverEl.getBoundingClientRect();
        x2 = dir==='start' ? tr.right : tr.left; // dir='end' knob → lands on target's START edge; dir='start' knob → target's END edge
        y2 = tr.top+tr.height/2;
      }
      updateGhost(x1,y1,x2,y2);
    }
    function onUp(ev){
      console.log('[link] pointerup at', ev.clientX, ev.clientY);
      document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp);
      document.body.classList.remove('linking-mode'); removeGhost();
      if(hoverEl) hoverEl.classList.remove('link-hover');
      try{
        const targetEl=findDropTarget(ev.clientX,ev.clientY,it.id);
        console.log('[link] findDropTarget result:', targetEl, targetEl&&targetEl.dataset.taskId);
        // Every branch now ends in a toast — a silent no-op here is indistinguishable from
        // "the feature doesn't work" to anyone watching, which is exactly what got reported.
        if(!targetEl){ showToast('✗ Not dropped on another task — release directly over its bar.'); return; }
        const targetId=targetEl.dataset.taskId;
        const proj=project();
        const fromTask = dir==='start' ? proj.tasks.find(x=>x.id===targetId) : it;
        const toTask = dir==='start' ? it : proj.tasks.find(x=>x.id===targetId);
        console.log('[link] fromTask:', fromTask&&fromTask.id, fromTask&&fromTask.name, '| toTask:', toTask&&toTask.id, toTask&&toTask.name);
        if(!fromTask || !toTask){ showToast('✗ Could not resolve that task — try again.'); return; }
        if((toTask.preds||[]).includes(fromTask.id)){ console.log('[link] already linked'); showToast(`"${toTask.name}" already depends on "${fromTask.name}".`); return; }
        if(wouldCycle(proj, fromTask.id, toTask.id)){ console.log('[link] would cycle'); showToast('✗ That would create a circular dependency.'); return; }
        toTask.preds=[...(toTask.preds||[]), fromTask.id]; // reassign, not .push() in place — see pushHistory's comment above
        pushHistory(toTask, `Linked after "${fromTask.name}" (dragged).`);
        persistProject(proj); renderAll();
        console.log('[link] SUCCESS — toTask.preds now:', JSON.stringify(toTask.preds));
        showToast(`✓ "${fromTask.name}" → "${toTask.name}" linked.`);
      } catch(err){
        console.error('[link] EXCEPTION in onUp:', err);
        showToast('✗ Error while linking — open DevTools console (F12) for details.');
      }
    }
    document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
  });
}
function updateGhost(x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy), ang=Math.atan2(dy,dx)*180/Math.PI;
  let ghost=byId('linkGhost');
  if(!ghost){ ghost=document.createElement('div'); ghost.id='linkGhost'; document.body.appendChild(ghost);
    Object.assign(ghost.style,{position:'fixed', height:'2px', background:'var(--accent)', transformOrigin:'0 0', pointerEvents:'none', zIndex:50}); }
  ghost.style.left=x1+'px'; ghost.style.top=y1+'px'; ghost.style.width=len+'px'; ghost.style.transform=`rotate(${ang}deg)`;
}
function removeGhost(){ const g=byId('linkGhost'); if(g) g.remove(); }
(function(){ const st=document.createElement('style'); st.textContent='body.linking-mode{cursor:crosshair;} body.linking-mode .bar,body.linking-mode .milestone{outline:2px dashed var(--accent); outline-offset:2px;} .link-hover{outline:2px solid var(--accent) !important; outline-offset:2px; box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent) !important;}'; document.head.appendChild(st); })();

/* ---------- transfer popover ---------- */
function openTransferPopover(e,x){
  const pop=byId('transferPop');
  const inC=x.manifest.filter(m=>m[2]==='in').reduce((a,b)=>a+b[1],0);
  const outC=x.manifest.filter(m=>m[2]==='out').reduce((a,b)=>a+b[1],0);
  pop.innerHTML=`<button class="close" id="popClose">✕</button><h4>${x.mode==='heli'?'✈ Helicopter':'⛴ Boat'} — ${fmt(x.day)}</h4>
    <div class="dep-note" style="margin-bottom:6px;">${x.label}</div>
    ${x.manifest.map(m=>`<div class="row"><span>${RES[m[0]]?RES[m[0]].name:m[0]}</span><span>${m[2]==='in'?'+':'−'}${m[1]}</span></div>`).join('')}
    <div class="row" style="border-top:1px solid var(--line); margin-top:6px; padding-top:6px; font-weight:700;"><span>Net</span><span>${inC-outC>=0?'+':''}${inC-outC}</span></div>
    <div style="display:flex; gap:6px; margin-top:10px;"><button class="btn ghost small" id="popEdit">Edit</button></div>`;
  const rect=e.target.getBoundingClientRect();
  pop.style.left=Math.min(rect.left, window.innerWidth-260)+'px';
  pop.style.top=(rect.bottom+8)+'px';
  pop.classList.add('open');
  byId('popClose').onclick=()=>pop.classList.remove('open');
  byId('popEdit').onclick=()=>{ pop.classList.remove('open'); openTransferModal(x); };
}

/* ---------- inline-columns picker popover ---------- */
function toggleColPicker(anchorBtn){
  const pop=byId('colPickerPop');
  if(pop.classList.contains('open')){ pop.classList.remove('open'); return; }
  pop.innerHTML=`<div class="col-picker"><h4>Show inline beside tasks</h4>${INLINE_COLS.map(c=>
    `<label><input type="checkbox" data-col="${c.key}"${state.visibleCols.has(c.key)?' checked':''}> ${c.label}</label>`).join('')}</div>`;
  pop.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.onchange=()=>{ cb.checked?state.visibleCols.add(cb.dataset.col):state.visibleCols.delete(cb.dataset.col); renderGantt(); renderToolbar(); };
  });
  const rect=anchorBtn.getBoundingClientRect();
  pop.style.left=Math.min(rect.left, window.innerWidth-210)+'px';
  pop.style.top=(rect.bottom+6)+'px';
  pop.classList.add('open');
}

/* ---------- transfer add/edit/delete modal ---------- */
let xfMode='heli', xfDeleteArm=false;
function renderManifestRows(){
  const wrap=byId('xfManifestRows'); wrap.innerHTML='';
  if(!state.xfManifest.length){ wrap.innerHTML='<div class="dep-note">No one on the manifest yet — add a line.</div>'; }
  state.xfManifest.forEach((line,idx)=>{
    const row=document.createElement('div'); row.className='manifest-row';
    const sel=document.createElement('select');
    Object.entries(RES).forEach(([rk,r])=>{ const opt=document.createElement('option'); opt.value=rk; opt.textContent=r.name; if(rk===line[0]) opt.selected=true; sel.appendChild(opt); });
    sel.onchange=()=>{ line[0]=sel.value; };
    const cnt=document.createElement('input'); cnt.type='number'; cnt.min='1'; cnt.value=line[1];
    cnt.oninput=()=>{ line[1]=Math.max(1, Number(cnt.value)||1); };
    const dir=document.createElement('div'); dir.className='dir-toggle';
    const inBtn=document.createElement('button'); inBtn.type='button'; inBtn.textContent='In'; inBtn.className=line[2]==='in'?'active':'';
    const outBtn=document.createElement('button'); outBtn.type='button'; outBtn.textContent='Out'; outBtn.className=line[2]==='out'?'active':'';
    inBtn.onclick=()=>{ line[2]='in'; inBtn.className='active'; outBtn.className=''; };
    outBtn.onclick=()=>{ line[2]='out'; outBtn.className='active'; inBtn.className=''; };
    dir.appendChild(inBtn); dir.appendChild(outBtn);
    const rm=document.createElement('button'); rm.className='rm'; rm.textContent='✕'; rm.title='Remove line';
    rm.onclick=()=>{ state.xfManifest.splice(idx,1); renderManifestRows(); };
    row.appendChild(sel); row.appendChild(cnt); row.appendChild(dir); row.appendChild(rm);
    wrap.appendChild(row);
  });
}
function openTransferModal(x){
  state.editingXferId=x?x.id:null;
  byId('xferModalTitle').textContent=x?'Edit transfer':'New transfer';
  xfMode=x?x.mode:'heli';
  byId('xfModeSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.mode===xfMode));
  byId('xfDate').value=x?iso(x.day):iso(TODAY);
  byId('xfLabel').value=x?x.label:'';
  state.xfManifest=x?x.manifest.map(m=>[m[0],m[1],m[2]]):[];
  renderManifestRows();
  byId('xfDelete').style.display=x?'inline-flex':'none';
  xfDeleteArm=false; byId('xfDelete').textContent='Delete transfer';
  byId('xferModalScrim').classList.add('open');
}
document.addEventListener('click', e=>{
  const pop=byId('transferPop');
  if(pop.classList.contains('open') && !pop.contains(e.target) && !e.target.classList.contains('transfer-marker')) pop.classList.remove('open');
  const colPop=byId('colPickerPop');
  if(colPop.classList.contains('open') && !colPop.contains(e.target)) colPop.classList.remove('open');
  const predResults=byId('dAddPredResults');
  if(predResults.classList.contains('open') && !predResults.contains(e.target) && e.target.id!=='dAddPredSearch') predResults.classList.remove('open');
});

/* ---------- Resources tab ---------- */
function renderShiftTable(){
  const wrap=byId('shiftTable'); wrap.innerHTML='';
  SHIFTS.forEach(s=>{
    const card=document.createElement('div'); card.className='shift-card';
    card.innerHTML=`<span class="swatch"></span><span class="sname">${s.name}</span>
      <input type="time" value="${s.start}" data-field="start"><span>–</span><input type="time" value="${s.end}" data-field="end">
      ${s.locked?'':'<button class="del" title="Remove shift">✕</button>'}`;
    card.querySelectorAll('input[type=time]').forEach(inp=>{
      inp.onchange=()=>{ s[inp.dataset.field]=inp.value; persistConfig(); renderResourcesPanel(); showToast('✓ Shift hours updated.'); };
    });
    if(!s.locked){
      card.querySelector('.del').onclick=()=>{
        Object.values(RES).forEach(r=>{ if(r.shift===s.id) r.shift='day'; });
        const idx=SHIFTS.indexOf(s); SHIFTS.splice(idx,1);
        persistConfig(); renderShiftTable(); renderResourcesPanel();
      };
    }
    wrap.appendChild(card);
  });
  const addBtn=document.createElement('button'); addBtn.className='btn ghost small'; addBtn.textContent='+ Custom shift';
  addBtn.onclick=()=>{ SHIFTS.push({id:uid('shift'), name:'Custom Shift', start:'08:00', end:'20:00', locked:false}); persistConfig(); renderShiftTable(); renderResourcesPanel(); };
  wrap.appendChild(addBtn);
}
function appendHeatRow(rowsWrap, y, meta, days, rangeStart, rangeEnd, pxPerDay, totalWidth, isTotal){
  const row=document.createElement('div'); row.className='row resource-row'+(meta.unassigned?' unassigned':'');
  const label=document.createElement('div'); label.className='row-label';
  label.innerHTML=isTotal
    ? `<span class="name" style="font-weight:700;">${meta.name}</span><span class="res-cap mono">cap</span>`
    : `<span class="name">${meta.name}</span><span class="shift-pill">${meta.shift}</span><span class="res-cap mono">cap ${meta.cap}</span>`;
  if(isTotal){
    const capInput=document.createElement('input'); capInput.type='number'; capInput.min='1'; capInput.value=meta.cap;
    capInput.className='mono'; capInput.style.cssText='width:46px; padding:2px 4px; font-size:11px; border:1px solid var(--line-strong); background:var(--bg); color:var(--ink); border-radius:5px;';
    capInput.title='Max persons on board';
    capInput.onchange=()=>{ POB_CAP=Math.max(1, Number(capInput.value)||POB_CAP); persistConfig(); renderAll(); showToast('✓ POB cap updated.'); };
    label.appendChild(capInput);
  }
  if(!isTotal){
    if(meta.unassigned){ const note=document.createElement('span'); note.className='unassigned-note'; note.textContent='not on any task'; label.appendChild(note); }
    const editBtn=document.createElement('button'); editBtn.className='row-edit-btn'; editBtn.textContent='✎'; editBtn.title='Edit resource';
    editBtn.onclick=()=>openResModal(meta.rk);
    label.appendChild(editBtn);
  }
  row.appendChild(label);
  const tl=document.createElement('div'); tl.className='row-timeline'; tl.style.width=totalWidth+'px';
  row.appendChild(tl);
  rowsWrap.appendChild(row);
  let d=rangeStart;
  while(d<rangeEnd){
    let runStart=d, val=days[d]||0;
    while(d<rangeEnd && (days[d]||0)===val) d++;
    if(val>0){
      const left=(runStart-rangeStart)*pxPerDay, width=(d-runStart)*pxPerDay, ratio=val/meta.cap;
      const cell=document.createElement('div'); cell.className='heat-cell';
      cell.style.left=left+'px'; cell.style.width=Math.max(width-1,2)+'px';
      cell.style.background=ratio>1?'var(--critical)':ratio>=0.75?'var(--hold)':'var(--accent-dim)';
      cell.title=`${val} / ${meta.cap}, ${fmtShort(runStart)}–${fmtShort(d-1)}`;
      if(width>=14){ const lbl=document.createElement('span'); lbl.className='heat-value'; lbl.textContent=val; cell.appendChild(lbl); }
      tl.appendChild(cell);
      if(ratio>1){
        const badge=document.createElement('div'); badge.className='heat-badge'; badge.textContent='!';
        badge.style.left=(left+width/2-7)+'px'; badge.title=`Over: ${val} vs ${meta.cap}`;
        tl.appendChild(badge);
      }
    }
  }
  return y+RES_H;
}
function renderResourcesPanel(){
  const proj=project();
  const content=byId('resContent'); content.innerHTML='';
  if(!Object.keys(RES).length){
    content.innerHTML=`<div class="empty-state" style="height:300px"><div class="icon">＋</div><h3>No resources yet</h3><p>Click "+ Resource" above to add your first crew role or discipline — capacity and shift only, no task needed yet.</p></div>`;
    return;
  }
  if(!leafTasks(proj).length){
    content.innerHTML=`<div class="empty-state" style="height:200px"><div class="icon">＋</div><h3>No tasks scheduled yet</h3><p>Your resource roster exists, but nothing is assigned until a task on the Gantt uses it.</p></div>`;
    return;
  }
  const {start:rangeStart, end:rangeEnd}=rangeOf(proj);
  const pxPerDay=PX.week, totalDays=rangeEnd-rangeStart, totalWidth=totalDays*pxPerDay;
  content.appendChild(buildAxisRow('Resource', rangeStart, totalDays, pxPerDay, 'week'));
  const rowsWrap=document.createElement('div'); rowsWrap.className='rows-wrap';
  let ry=0;
  if(state.showPOB) ry=appendHeatRow(rowsWrap, ry, {name:'Total (POB)', cap:POB_CAP}, totalHeadcountByDay(proj), rangeStart, rangeEnd, pxPerDay, totalWidth, true);
  Object.entries(RES).forEach(([rk,r])=>{
    const used=proj.tasks.some(x=>!x.milestone && (x.resources||[]).some(([id])=>id===rk));
    ry=appendHeatRow(rowsWrap, ry, {name:r.name, cap:r.cap, rk, shift:r.shift, unassigned:!used}, dailyDemand(proj,rk), rangeStart, rangeEnd, pxPerDay, totalWidth, false);
  });
  rowsWrap.style.height=ry+'px';
  content.appendChild(rowsWrap);
  const todayX=(TODAY-rangeStart)*pxPerDay;
  if(todayX>=0 && todayX<=totalWidth){
    const overlay=document.createElement('div'); overlay.className='overlay'; overlay.style.height=ry+'px'; overlay.style.width=totalWidth+'px';
    const line=document.createElement('div'); line.className='today-line'; line.style.left=todayX+'px'; line.style.height=ry+'px';
    overlay.appendChild(line); rowsWrap.appendChild(overlay);
  }
}

/* ---------- Network tab (CPM) ---------- */
function computeCPM(proj){
  const nodes={};
  leafTasks(proj).forEach(x=>{ nodes[x.id]={...x, dur:x.milestone?0:(x.end-x.start), succ:[]}; });
  Object.values(nodes).forEach(n=>{ (n.preds||[]).forEach(pid=>{ if(nodes[pid]) nodes[pid].succ.push(n.id); }); });
  const indeg={}; Object.keys(nodes).forEach(id=>indeg[id]=(nodes[id].preds||[]).filter(p=>nodes[p]).length);
  const queue=Object.keys(nodes).filter(id=>indeg[id]===0); const order=[];
  while(queue.length){ const id=queue.shift(); order.push(id); nodes[id].succ.forEach(s=>{ indeg[s]--; if(indeg[s]===0) queue.push(s); }); }
  order.forEach(id=>{
    const n=nodes[id], preds=(n.preds||[]).filter(p=>nodes[p]);
    n.ES=preds.length?Math.max(...preds.map(p=>nodes[p].EF)):n.start; n.EF=n.ES+n.dur;
  });
  const finish=order.length?Math.max(...order.map(id=>nodes[id].EF)):0;
  [...order].reverse().forEach(id=>{
    const n=nodes[id];
    n.LF=n.succ.length?Math.min(...n.succ.map(s=>nodes[s].LS)):finish;
    n.LS=n.LF-n.dur; n.float=n.LS-n.ES;
  });
  order.forEach(id=>{
    const n=nodes[id], preds=(n.preds||[]).filter(p=>nodes[p]);
    n.layer=preds.length?Math.max(...preds.map(p=>nodes[p].layer))+1:0;
  });
  return {nodes};
}
function renderNetwork(){
  const proj=project(); const content=byId('netContent'); content.innerHTML=''; content.style.width=''; content.style.height='';
  if(!leafTasks(proj).length){
    content.innerHTML=`<div class="empty-state" style="height:300px"><div class="icon">◇</div><h3>No dependency network yet</h3><p>The network view builds itself from tasks and their dependency links once a schedule exists.</p></div>`;
    return;
  }
  const {nodes}=computeCPM(proj);
  const {detail:overDetail}=computeOverallocation(proj);
  const byLayer={};
  Object.values(nodes).forEach(n=>{ (byLayer[n.layer]=byLayer[n.layer]||[]).push(n); });
  const NODE_W=158, NODE_H=64, GAP_X=70, GAP_Y=26;
  const layers=Object.keys(byLayer).map(Number).sort((a,b)=>a-b);
  let maxY=0;
  layers.forEach(l=>{
    byLayer[l].sort((a,b)=>a.start-b.start);
    byLayer[l].forEach((n,i)=>{ n.x=l*(NODE_W+GAP_X)+20; n.y=i*(NODE_H+GAP_Y)+20; maxY=Math.max(maxY,n.y+NODE_H); });
  });
  const maxX=(Math.max(...layers)+1)*(NODE_W+GAP_X)+20;
  content.style.width=maxX+'px'; content.style.height=(maxY+20)+'px';

  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',maxX); svg.setAttribute('height',maxY+20);
  svg.style.position='absolute'; svg.style.top=0; svg.style.left=0; svg.style.pointerEvents='none';
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML=`<marker id="arrowN" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--line-strong)"/></marker>
    <marker id="arrowC" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--critical)"/></marker>`;
  svg.appendChild(defs);
  Object.values(nodes).forEach(n=>{
    (n.preds||[]).forEach(pid=>{
      const p=nodes[pid]; if(!p) return;
      const x1=p.x+NODE_W, y1=p.y+NODE_H/2, x2=n.x, y2=n.y+NODE_H/2;
      const crit=p.float===0 && n.float===0;
      const midX=x1+Math.max((x2-x1)/2,20);
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
      path.setAttribute('fill','none'); path.setAttribute('stroke',crit?'var(--critical)':'var(--line-strong)');
      path.setAttribute('stroke-width',crit?'2.2':'1.4'); path.setAttribute('marker-end',crit?'url(#arrowC)':'url(#arrowN)');
      svg.appendChild(path);
    });
  });
  content.appendChild(svg);

  Object.values(nodes).forEach(n=>{
    const phase=PHASES.find(p=>p.id===n.phase);
    const crit=n.float===0;
    const div=document.createElement('div'); div.className='net-node'+(crit?' critical':'');
    div.style.left=n.x+'px'; div.style.top=n.y+'px';
    const risk=(n.resources||[]).some(([rid])=>overDetail[rid] && overDetail[rid].some(([d])=>d>=n.start && d<n.end));
    div.innerHTML=`<div class="swatch" style="background:${phase.color}"></div>
      <div class="nname">${n.milestone?'◆ ':''}${n.name}</div>
      <div class="nmeta"><span>${n.milestone?'Milestone':n.dur+'d'}</span><span class="float-tag ${crit?'crit':''}">${crit?'Critical':'Float '+n.float+'d'}</span></div>
      ${risk?'<div class="risk-icon" title="Resource conflict overlaps this task">!</div>':''}`;
    div.onclick=()=>openDrawer(n.id);
    content.appendChild(div);
  });
}

/* ---------- Guide tab ---------- */
function renderGuide(){
  const content=byId('guideContent');
  const step=(n,t,d)=>`<div class="guide-step"><div class="n">${n}</div><div class="t">${t}</div><div class="d">${d}</div></div>`;
  const arrow=`<div class="guide-arrow">→</div>`;
  const ref=(ic,tt,dd)=>`<div class="guide-ref"><div class="ic">${ic}</div><div><div class="tt">${tt}</div><div class="dd">${dd}</div></div></div>`;
  content.innerHTML=`
    <h2>Setting up a project, in order</h2>
    <div class="guide-flow">
      ${step('1','Add resources','Resources tab → "+ Resource". Name, headcount, shift — before tasks, so there’s something to assign.')}
      ${arrow}
      ${step('2','Add tasks &amp; milestones','Gantt tab → "+ Task" / "+ Milestone", or the "+" on a phase header.')}
      ${arrow}
      ${step('3','Open a bar for detail','Click any bar or diamond: dates, status, resources, dependencies, notes, delete.')}
      ${arrow}
      ${step('4','Link &amp; check','Drag bar-to-bar to set order. Network tab shows the critical path; Resources tab flags overallocation and POB.')}
    </div>
    <h2>On the Gantt</h2>
    <div class="guide-ref-grid">
      ${ref('🖱️','Click a bar or diamond','Opens the detail panel — dates, status, % complete, resources, dependencies, notes, and Delete.')}
      ${ref('↔️','Drag the middle of a bar','Reschedules it, keeping the same duration. Written as a dated update, never a silent overwrite.')}
      ${ref('⇤⇥','Drag either edge of a bar','Trims or extends duration from that end only.')}
      ${ref('🔗','Drag the dot on a bar’s right edge onto another bar','Links them finish-to-start. Circular links are blocked automatically.')}
      ${ref('◆','Diamond marker','A milestone — zero duration, a single date.')}
      ${ref('✈ / ⛴','Top lane, always visible','Personnel transfers by helicopter or boat. "+" adds one; click a marker for its manifest.')}
      ${ref('⚠','Persons-on-board lane','Daily headcount against the vessel cap. Toggle with "POB tracking" in the toolbar.')}
      ${ref('▤','Phase header row','Click to collapse or expand; "+" adds a task straight into it. Also shows a rollup bar for everything in it, and is itself a valid group/move target — see below.')}
    </div>
    <h2>Grouping tasks into summaries</h2>
    <div class="guide-flow">
      ${step('1','Select','Check any tasks you want together — from any phase, in any order.')}
      ${arrow}
      ${step('2','Choose an action','"+ New group" names a fresh summary task. "Move to ▾" adds them to a group or phase that already exists.')}
      ${arrow}
      ${step('3','Done','The summary’s bar rolls up automatically to span its children’s start–finish.')}
    </div>
    <div class="guide-ref-grid">
      ${ref('▸ / ▾','Chevron on a summary task','Expands or collapses its children. Collapsed, the summary bar alone shows the group’s overall start–finish.')}
      ${ref('⠿','Grip on a task or milestone row','Drag it onto another task, a group, or a phase header to move it there — dropping on a plain task groups the two of them together.')}
      ${ref('⇥','Hover an ungrouped task','One click to join whatever task or group sits right above it in the same phase — the quickest way to add a couple of tasks under an existing header.')}
      ${ref('✕','Hover a grouped task','A quick one-click way to pull just that task out of its group — no need to select it first.')}
      ${ref('↳','Dependencies still apply','Links between tasks are unaffected by grouping. Collapse a group and an arrow into or out of it re-anchors to the summary bar’s edge instead of disappearing.')}
    </div>
    <h2>Import, export &amp; print</h2>
    <div class="guide-ref-grid">
      ${ref('📥','Import — three sources','A WorkFlow backup (.json) restores everything. Excel/CSV auto-matches columns (Name, Start, End…) into a reviewable, editable row list. Pasted text (from a PDF or anywhere) asks Claude to structure it the same way — always review dates before importing.')}
      ${ref('📐','A recognized MS Project/Primavera table also rebuilds groups','If the pasted text has WBS/Duration/Start/Finish columns, its own summary rows (e.g. WBS 3.2.1 sitting above 3.2.1.1, 3.2.1.2…) become real summary tasks here too, not just a phase guess — the schedule’s own outline reappears as groups, ready to expand/collapse.')}
      ${ref('📤','Export','Full workspace as .json (round-trips with Import), or the current project’s tasks as .csv for Excel/Sheets.')}
      ${ref('🖨️','Print / PDF','Uses your browser’s print dialog for scaling and page selection. If the toolbar button does nothing, your browser’s own Print command (Ctrl/Cmd+P) does the same job.')}
      ${ref('👥','Resources get matched, not just noted','A Resource column, a resource sheet in the same file, or a separate resource file (all three work) get name-matched against your roster — clear matches go straight through, anything ambiguous gets a one-time check before you confirm the import.')}
    </div>
    <h2>How the tool behaves</h2>
    <div class="guide-note">‎<b>Status</b> vs. <b>% complete</b> are two different fields on purpose. Status is where a task sits in the process (Upcoming, In progress, Weather hold, Flagged critical, Complete) and drives the bar's colour. % complete is a finer number, shown as a fill bar only while status is "In progress" — Complete and Upcoming set it automatically (100 / 0) so the two can't disagree.</div>
    <div class="guide-note" style="margin-top:10px;">Resource overallocation and the vessel-wide POB cap both flag when demand exceeds capacity — a chip, a badge, or a banner — but nothing here prevents you from saving anyway. The tool tells you about a conflict; it doesn't decide for you.</div>
    <div class="guide-note" style="margin-top:10px;">The ◐ button beside the WorkFlow logo cycles Light / Dark / System theme, remembered on this device.</div>
  `;
}

/* ---------- Task drawer (edit existing) ---------- */
function renderResPick(container, pendingArr){
  container.innerHTML='';
  Object.entries(RES).forEach(([rk,r])=>{
    const existing=pendingArr.find(p=>p[0]===rk);
    const wrap=document.createElement('label');
    wrap.innerHTML=`<input type="checkbox" ${existing?'checked':''}><span>${r.name}</span><input type="number" class="cnt" min="1" value="${existing?existing[1]:1}" ${existing?'':'style="display:none"'}>`;
    container.appendChild(wrap);
    const cb=wrap.querySelector('input[type=checkbox]'), cnt=wrap.querySelector('.cnt');
    cb.onchange=()=>{
      const idx=pendingArr.findIndex(p=>p[0]===rk);
      if(cb.checked){ if(idx===-1) pendingArr.push([rk, Math.max(1, Number(cnt.value)||1)]); cnt.style.display=''; }
      else { if(idx>-1) pendingArr.splice(idx,1); cnt.style.display='none'; }
    };
    cnt.oninput=()=>{ const idx=pendingArr.findIndex(p=>p[0]===rk); if(idx>-1) pendingArr[idx][1]=Math.max(1, Number(cnt.value)||1); };
  });
}
function renderPredChips(proj, it){
  const chipRow=byId('dPreds'); chipRow.innerHTML='';
  state.pendingPreds.forEach(pid=>{
    const p=proj.tasks.find(x=>x.id===pid); if(!p) return;
    const chip=document.createElement('span'); chip.className='res-chip';
    chip.innerHTML=`${p.name}<span class="x">✕</span>`;
    chip.querySelector('.x').onclick=()=>{ state.pendingPreds=state.pendingPreds.filter(x=>x!==pid); renderPredChips(proj,it); };
    chipRow.appendChild(chip);
  });
  if(!state.pendingPreds.length){ chipRow.innerHTML='<span class="dep-note">No predecessor — can start independently</span>'; }
  const input=byId('dAddPredSearch'), results=byId('dAddPredResults');
  input.value=''; results.classList.remove('open');
  function renderPredResults(){
    const q=input.value.trim().toLowerCase();
    let matches=leafTasks(proj)
      .filter(x=>x.id!==it.id && !state.pendingPreds.includes(x.id) && !isDescendant(proj, it.id, x.id));
    if(q) matches=matches.filter(x=>x.name.toLowerCase().includes(q));
    // Sorted by how close each candidate's own end date is to this task's start — the most
    // plausible real predecessors, not raw import order (which always put task #1 first
    // regardless of whether the open task is #5 or #450 in a long schedule).
    // No cap — the sort already puts the most plausible candidates first, and the results
    // list scrolls (max-height, see CSS); capping at a fixed count was hiding real matches
    // further down the schedule, which is the opposite of what a "full list" request wants.
    matches=matches.slice().sort((a,b)=>Math.abs(a.end-it.start)-Math.abs(b.end-it.start));
    results.innerHTML = matches.length
      ? matches.map(x=>`<div class="th-item" data-id="${x.id}"><span class="th-name">${x.name}</span><span class="th-date">${fmtShort(x.end-1)}</span></div>`).join('')
      : `<div class="th-empty">No matching tasks${q?` for "${q}"`:''}</div>`;
    results.querySelectorAll('.th-item').forEach(el=>{
      el.onclick=()=>{
        const pid=el.dataset.id;
        state.pendingPreds.push(pid);
        results.classList.remove('open');
        renderPredChips(proj,it);
        scrollGanttToTask(pid);
      };
    });
  }
  input.oninput=()=>{ renderPredResults(); results.classList.add('open'); };
  input.onfocus=()=>{ renderPredResults(); results.classList.add('open'); };
}
/* Bring a task's bar into view before opening its drawer — expands its phase group if
   collapsed (otherwise the row doesn't exist to scroll to) and pans/scrolls boardScroll
   only on whichever axis is actually out of view, so an already-visible task doesn't jump. */
function scrollGanttToTask(id){
  if(state.tab!=='gantt') return;
  const proj=project(), it=proj.tasks.find(x=>x.id===id); if(!it) return;
  if(state.collapsed.has(it.phase)){ state.collapsed.delete(it.phase); renderGantt(); }
  const layout=state.rowLayout, rangeStart=state.rowRangeStart, pxPerDay=state.rowPxPerDay;
  const scroller=byId('boardScroll');
  if(!scroller || !layout || !layout[id]) return;
  const LABEL_W=280, AXIS_H=44;
  const barLeft=(it.start-rangeStart)*pxPerDay, barWidth=Math.max((it.end-it.start)*pxPerDay,10);
  const barStartAbs=LABEL_W+barLeft, barEndAbs=LABEL_W+barLeft+barWidth;
  let targetLeft=scroller.scrollLeft;
  const viewLeft=scroller.scrollLeft+LABEL_W, viewRight=scroller.scrollLeft+scroller.clientWidth;
  if(barStartAbs<viewLeft || barEndAbs>viewRight){
    targetLeft=Math.max(0, barStartAbs-LABEL_W-(scroller.clientWidth-LABEL_W)/2+barWidth/2);
  }
  const rowTop=layout[id].y, rowBottom=rowTop+layout[id].h;
  let targetTop=scroller.scrollTop;
  const viewTop=scroller.scrollTop, viewBottom=scroller.scrollTop+scroller.clientHeight-AXIS_H;
  if(rowTop<viewTop || rowBottom>viewBottom){
    targetTop=Math.max(0, rowTop-40);
  }
  if(targetLeft!==scroller.scrollLeft || targetTop!==scroller.scrollTop){
    scroller.scrollTo({left:targetLeft, top:targetTop, behavior:'smooth'});
  }
}
/* ---------- Start/End/Days anchor: whichever field is pinned stays fixed while the other
   two are edited; editing the pinned field itself moves the whole span, duration-preserving
   (matches dragging the bar body). Persisted per task so it survives reopening the drawer. */
function updateAnchorUI(milestone){
  const map={Start:'start',End:'end',Dur:'duration'};
  Object.keys(map).forEach(k=>{
    const group=byId('d'+k+'Group'); if(!group) return;
    group.classList.toggle('anchored', !milestone && state.drawerAnchor===map[k]);
  });
  const labels={start:'Start',end:'End',duration:'Days'};
  byId('dAnchorNote').textContent = milestone ? '' : `📌 ${labels[state.drawerAnchor]} is pinned — it stays fixed while you edit the other two. Click a pin to change which one.`;
  byId('dPinStart').disabled=milestone; byId('dPinEnd').disabled=milestone; byId('dPinDur').disabled=milestone;
}
function recomputeDrawerDates(editedField){
  const anchor=state.drawerAnchor;
  let start=D(byId('dStart').value), end=D(byId('dEnd').value)+1;
  let dur=Math.max(1, Math.round(Number(byId('dDur').value))||1);
  if(editedField===anchor){ if(anchor==='end') start=end-dur; else end=start+dur; }
  else if(editedField==='start'){ if(anchor==='end') dur=Math.max(1,end-start); else end=start+dur; }
  else if(editedField==='end'){ if(anchor==='start') dur=Math.max(1,end-start); else start=end-dur; }
  else if(editedField==='duration'){ if(anchor==='end') start=end-dur; else end=start+dur; }
  if(end<=start) end=start+1;
  byId('dStart').value=iso(start); byId('dEnd').value=iso(end-1); byId('dDur').value=end-start;
}
byId('dStart').addEventListener('change', ()=>{ if(!byId('dEnd').disabled) recomputeDrawerDates('start'); });
byId('dEnd').addEventListener('change', ()=>recomputeDrawerDates('end'));
byId('dDur').addEventListener('change', ()=>{ if(!byId('dDur').disabled) recomputeDrawerDates('duration'); });
[['dPinStart','start'],['dPinEnd','end'],['dPinDur','duration']].forEach(([id,val])=>{
  byId(id).addEventListener('click', ()=>{ state.drawerAnchor=val; updateAnchorUI(byId('dEnd').disabled); });
});
function openDrawer(id){
  const proj=project(), it=proj.tasks.find(x=>x.id===id); if(!it) return;
  state.selectedId=id;
  scrollGanttToTask(id);
  if(state.tab==='gantt') renderGantt();
  state.drawerAnchor=it.anchor||'start';
  state.pendingResources=(it.resources||[]).map(r=>[r[0],r[1]]);
  state.pendingPreds=(it.preds||[]).slice();
  const phase=PHASES.find(p=>p.id===it.phase);
  byId('dTitle').textContent=it.name;
  const pp=byId('dPhasePill'); pp.textContent=phase.name; pp.className='pill'; pp.style.cssText='background:transparent;border:1px solid var(--line-strong);color:var(--ink-dim);';
  const milestone=!!it.milestone;
  byId('dEnd').disabled=milestone; byId('dDur').disabled=milestone; byId('dStatus').disabled=milestone; byId('dPct').disabled=milestone;
  byId('dStart').value=iso(it.start); byId('dEnd').value=milestone?iso(it.start):iso(it.end-1);
  byId('dDur').value=milestone?'':(it.end-it.start);
  updateAnchorUI(milestone);
  byId('dStatus').value=milestone?'upcoming':it.status;
  byId('dPct').value=milestone?0:it.pct; byId('dPctBar').style.width=(milestone?0:it.pct)+'%';
  byId('dStatusPill').textContent=milestone?'Milestone':statusLabel(it.status);
  byId('dStatusPill').className='pill '+(milestone?'p-progress':pillClass(it.status));
  byId('dResourcesGroup').style.display=milestone?'none':'flex';
  renderResPick(byId('dResources'), state.pendingResources);
  renderPredChips(proj, it);
  byId('dNotes').value=it.notes||'';
  const hist=it.history||[];
  byId('dHistory').innerHTML=hist.length? hist.map(h=>`<div class="history-item"><span class="date mono">${h.date}</span> — ${h.text}</div>`).join('') : '<div class="history-item">No changes recorded yet.</div>';
  resetDeleteBtn();
  byId('scrim').classList.add('open'); byId('drawer').classList.add('open');
}
function closeDrawer(){ byId('scrim').classList.remove('open'); byId('drawer').classList.remove('open'); state.selectedId=null; resetDeleteBtn(); if(state.tab==='gantt') renderGantt(); }
function saveDrawer(){
  const proj=project(), it=proj.tasks.find(x=>x.id===state.selectedId); if(!it) return;
  if(it.milestone){
    const newStart=D(byId('dStart').value);
    const changed=[];
    if(newStart!==it.start){ it.start=newStart; it.end=newStart; changed.push('date moved to '+fmtShort(newStart)); }
    if(JSON.stringify(it.preds||[])!==JSON.stringify(state.pendingPreds)){ it.preds=state.pendingPreds.slice(); changed.push('dependencies updated'); }
    if(changed.length) pushHistory(it, changed.join(', ')+'.');
  } else {
    const newStart=D(byId('dStart').value), newEnd=D(byId('dEnd').value)+1;
    const changed=[];
    if(newStart!==it.start||newEnd!==it.end) changed.push('dates moved');
    if(byId('dStatus').value!==it.status) changed.push('status → '+statusLabel(byId('dStatus').value));
    let newPct=Math.max(0,Math.min(100,Number(byId('dPct').value)||0));
    if(byId('dStatus').value==='done') newPct=100;
    if(byId('dStatus').value==='upcoming') newPct=0;
    if(newPct!==it.pct) changed.push('progress → '+newPct+'%');
    it.start=newStart; it.end=Math.max(newEnd,newStart+1); it.status=byId('dStatus').value; it.pct=newPct; it.anchor=state.drawerAnchor;
    if(JSON.stringify(it.resources||[])!==JSON.stringify(state.pendingResources)) changed.push('resources updated');
    it.resources=state.pendingResources.map(r=>[r[0],r[1]]);
    if(JSON.stringify(it.preds||[])!==JSON.stringify(state.pendingPreds)) changed.push('dependencies updated');
    it.preds=state.pendingPreds.slice();
    if(changed.length) pushHistory(it, changed.join(', ')+'.');
  }
  it.notes=byId('dNotes').value;
  persistProject(proj);
  closeDrawer(); renderAll();
  showToast('✓ Saved — recorded as a dated update, not an overwrite.');
}
let deleteArm=false;
function resetDeleteBtn(){ deleteArm=false; const b=byId('dDelete'); if(b) b.textContent='Delete'; }

/* ---------- New task/milestone modal ---------- */
function openTaskModal({milestone, phase}){
  byId('taskModalTitle').textContent=milestone?'New milestone':'New task';
  byId('ntName').value='';
  byId('ntIsMilestone').checked=!!milestone;
  const phaseSel=byId('ntPhase'); phaseSel.innerHTML=PHASES.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  if(phase) phaseSel.value=phase;
  byId('ntStart').value=iso(TODAY); byId('ntEnd').value=iso(TODAY+2);
  toggleMsFields();
  state.newTaskRes=[];
  renderResPick(byId('ntResources'), state.newTaskRes);
  byId('taskModalScrim').classList.add('open');
}
function toggleMsFields(){
  const ms=byId('ntIsMilestone').checked;
  byId('ntEndGroup').style.display=ms?'none':'flex';
  byId('ntResGroup').style.display=ms?'none':'flex';
}

/* ---------- New/edit resource modal ---------- */
let nrDeleteArm=false;
function openResModal(rk){
  state.editingResId=rk;
  byId('resModalTitle').textContent=rk?'Edit resource':'New resource';
  byId('nrName').value=rk?RES[rk].name:'';
  byId('nrCap').value=rk?RES[rk].cap:1;
  const seg=byId('nrShiftSeg'); seg.innerHTML='';
  SHIFTS.forEach(s=>{
    const b=document.createElement('button'); b.textContent=s.name.replace(' Shift',''); b.dataset.sid=s.id;
    b.className=(rk?RES[rk].shift:'day')===s.id?'active':'';
    b.onclick=()=>{ seg.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); };
    seg.appendChild(b);
  });
  byId('nrDelete').style.display=rk?'inline-flex':'none';
  nrDeleteArm=false; byId('nrDelete').textContent='Delete resource';
  byId('resModalScrim').classList.add('open');
}

/* ---------- New/edit project modal ---------- */
let editingProjId=null, pjDeleteArm=false;
function openProjModal(id){
  editingProjId=id;
  const p=id?PROJECTS.find(x=>x.id===id):null;
  byId('projModalTitle').textContent=p?'Edit project':'New project';
  byId('pjName').value=p?p.name:'';
  byId('pjStatus').value=p?p.status:'Active';
  byId('pjDelete').style.display=p?'inline-flex':'none';
  pjDeleteArm=false; byId('pjDelete').textContent='Delete project';
  byId('pjNote').textContent=p ? 'Deleting removes this project and everything scheduled in it — there is no undo.' : 'Starts empty — add resources and tasks once it’s created.';
  byId('projModalScrim').classList.add('open');
}
byId('newProjBtn').onclick=()=>openProjModal(null);
byId('projModalClose').onclick=()=>byId('projModalScrim').classList.remove('open');
byId('pjCancel').onclick=()=>byId('projModalScrim').classList.remove('open');
byId('projModalScrim').onclick=(e)=>{ if(e.target.id==='projModalScrim') byId('projModalScrim').classList.remove('open'); };
byId('pjSave').onclick=()=>{
  const name=byId('pjName').value.trim(); if(!name) return;
  const status=byId('pjStatus').value;
  if(editingProjId){
    const p=PROJECTS.find(x=>x.id===editingProjId);
    if(p){ p.name=name; p.status=status; p.statusClass=statusClassFor(status); persistProject(p); }
  } else {
    const np={id:uid('proj'), name, status, statusClass:statusClassFor(status), tasks:[], transfers:[]};
    PROJECTS.push(np);
    persistProject(np); persistProjectIndex();
    state.projectId=np.id; state.selectedId=null;
  }
  byId('projModalScrim').classList.remove('open');
  renderAll();
  showToast(editingProjId?'✓ Project updated.':'✓ Project created — switched to it.');
};
byId('pjDelete').onclick=()=>{
  if(!pjDeleteArm){ pjDeleteArm=true; byId('pjDelete').textContent='Confirm delete?'; setTimeout(()=>{pjDeleteArm=false; byId('pjDelete').textContent='Delete project';},3000); return; }
  if(PROJECTS.length<=1){ showToast('At least one project has to remain.'); return; }
  const id=editingProjId;
  if(DB) DB.doc('projects/'+id).delete().catch(()=>{});
  PROJECTS=PROJECTS.filter(p=>p.id!==id);
  persistProjectIndex();
  if(state.projectId===id){ state.projectId=PROJECTS[0].id; state.selectedId=null; }
  byId('projModalScrim').classList.remove('open');
  renderAll();
  showToast('✓ Project deleted.');
};

/* ---------- render dispatcher ---------- */
function renderAll(){
  renderSidebar();
  renderPobBanner();
  renderToolbar();
  if(state.tab==='gantt') renderGantt();
  else if(state.tab==='resources'){ renderShiftTable(); renderResourcesPanel(); }
  else if(state.tab==='network') renderNetwork();
  else if(state.tab==='guide') renderGuide();
}

/* ---------- wiring ---------- */
byId('tabbar').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b) switchTab(b.dataset.tab); });
byId('dClose').onclick=closeDrawer;
byId('dCancel').onclick=closeDrawer;
byId('dSave').onclick=saveDrawer;
byId('scrim').onclick=closeDrawer;
byId('dPct').addEventListener('input', ()=>{ byId('dPctBar').style.width=(Number(byId('dPct').value)||0)+'%'; });
byId('dStatus').addEventListener('change', ()=>{
  const v=byId('dStatus').value;
  if(v==='done'){ byId('dPct').value=100; }
  else if(v==='upcoming'){ byId('dPct').value=0; }
  byId('dPctBar').style.width=(Number(byId('dPct').value)||0)+'%';
});
byId('dDelete').onclick=()=>{
  if(!deleteArm){ deleteArm=true; byId('dDelete').textContent='Confirm delete?'; setTimeout(()=>{ if(deleteArm) resetDeleteBtn(); },3000); return; }
  const proj=project(), it=proj.tasks.find(x=>x.id===state.selectedId); if(!it) return;
  const parentId=it.parent;
  proj.tasks.forEach(x=>{ x.preds=(x.preds||[]).filter(p=>p!==it.id); });
  proj.tasks=proj.tasks.filter(x=>x.id!==it.id);
  cleanupEmptyGroup(proj, parentId);
  const idx=PROJECTS.findIndex(p=>p.id===proj.id); PROJECTS[idx]=proj;
  persistProject(proj);
  closeDrawer(); renderAll(); showToast('✓ Deleted.');
};

byId('ntIsMilestone').onchange=toggleMsFields;
byId('taskModalClose').onclick=()=>byId('taskModalScrim').classList.remove('open');
byId('ntCancel').onclick=()=>byId('taskModalScrim').classList.remove('open');
byId('taskModalScrim').onclick=(e)=>{ if(e.target.id==='taskModalScrim') byId('taskModalScrim').classList.remove('open'); };
byId('ntCreate').onclick=()=>{
  const proj=project();
  const name=byId('ntName').value.trim()||'Untitled task';
  const phase=byId('ntPhase').value;
  const isMs=byId('ntIsMilestone').checked;
  const start=D(byId('ntStart').value);
  const id=uid(isMs?'m':'t');
  let obj;
  if(isMs){ obj={id,phase,name,start,end:start,milestone:true,preds:[],history:[{date:iso(TODAY),text:'By You — Milestone created.'}]}; }
  else {
    let end=D(byId('ntEnd').value)+1; if(end<=start) end=start+1;
    obj={id,phase,name,start,end,resources:state.newTaskRes.map(r=>[r[0],r[1]]),preds:[],status:'upcoming',pct:0,notes:'',history:[{date:iso(TODAY),text:'By You — Task created.'}]};
  }
  proj.tasks.push(obj);
  persistProject(proj);
  byId('taskModalScrim').classList.remove('open');
  renderAll(); showToast('✓ Created.');
};

byId('resModalClose').onclick=()=>byId('resModalScrim').classList.remove('open');
byId('nrCancel').onclick=()=>byId('resModalScrim').classList.remove('open');
byId('resModalScrim').onclick=(e)=>{ if(e.target.id==='resModalScrim') byId('resModalScrim').classList.remove('open'); };
byId('nrSave').onclick=()=>{
  const name=byId('nrName').value.trim(); if(!name) return;
  const cap=Math.max(1, Number(byId('nrCap').value)||1);
  const activeBtn=byId('nrShiftSeg').querySelector('button.active');
  const shift=activeBtn?activeBtn.dataset.sid:'day';
  if(state.editingResId) Object.assign(RES[state.editingResId], {name,cap,shift});
  else RES[uid('res')]={name,cap,shift};
  persistConfig();
  byId('resModalScrim').classList.remove('open');
  renderAll(); showToast('✓ Resource saved.');
};
byId('nrDelete').onclick=()=>{
  if(!nrDeleteArm){ nrDeleteArm=true; byId('nrDelete').textContent='Confirm delete?'; setTimeout(()=>{nrDeleteArm=false; byId('nrDelete').textContent='Delete resource';},3000); return; }
  const rk=state.editingResId; if(!rk) return;
  PROJECTS.forEach(p=>p.tasks.forEach(t=>{ if(t.resources) t.resources=t.resources.filter(r=>r[0]!==rk); }));
  delete RES[rk];
  persistConfig(); PROJECTS.forEach(persistProject);
  byId('resModalScrim').classList.remove('open');
  renderAll(); showToast('✓ Resource deleted.');
};

byId('xfModeSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; xfMode=b.dataset.mode; byId('xfModeSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('active', x===b)); });
byId('xfAddLine').onclick=()=>{ const firstRk=Object.keys(RES)[0]; if(!firstRk){ showToast('Add a resource first (Resources tab).'); return; } state.xfManifest.push([firstRk,1,'in']); renderManifestRows(); };
byId('xferModalClose').onclick=()=>byId('xferModalScrim').classList.remove('open');
byId('xfCancel').onclick=()=>byId('xferModalScrim').classList.remove('open');
byId('xferModalScrim').onclick=(e)=>{ if(e.target.id==='xferModalScrim') byId('xferModalScrim').classList.remove('open'); };
byId('xfSave').onclick=()=>{
  const proj=project();
  const label=byId('xfLabel').value.trim()||'Transfer';
  const day=D(byId('xfDate').value);
  proj.transfers=proj.transfers||[];
  if(state.editingXferId){
    const x=proj.transfers.find(t=>t.id===state.editingXferId);
    if(x){ x.mode=xfMode; x.day=day; x.label=label; x.manifest=state.xfManifest.map(m=>[m[0],m[1],m[2]]); }
  } else {
    proj.transfers.push({id:uid('xf'), mode:xfMode, day, label, manifest:state.xfManifest.map(m=>[m[0],m[1],m[2]])});
  }
  persistProject(proj);
  byId('xferModalScrim').classList.remove('open');
  renderAll(); showToast('✓ Transfer saved.');
};
byId('xfDelete').onclick=()=>{
  if(!xfDeleteArm){ xfDeleteArm=true; byId('xfDelete').textContent='Confirm delete?'; setTimeout(()=>{xfDeleteArm=false; byId('xfDelete').textContent='Delete transfer';},3000); return; }
  const proj=project();
  proj.transfers=(proj.transfers||[]).filter(t=>t.id!==state.editingXferId);
  persistProject(proj);
  byId('xferModalScrim').classList.remove('open');
  renderAll(); showToast('✓ Transfer deleted.');
};

byId('exportModalClose').onclick=()=>byId('exportModalScrim').classList.remove('open');
byId('exportModalClose2').onclick=()=>byId('exportModalScrim').classList.remove('open');
byId('exportModalScrim').onclick=(e)=>{ if(e.target.id==='exportModalScrim') byId('exportModalScrim').classList.remove('open'); };
byId('expJson').onclick=()=>{ byId('exportModalScrim').classList.remove('open'); doExportJSON(); };
byId('expCsv').onclick=()=>{ byId('exportModalScrim').classList.remove('open'); doExportCSV(); };
byId('expPrint').onclick=()=>{ byId('exportModalScrim').classList.remove('open'); window.print(); };
byId('buildInfo').textContent=BUILD_INFO;

/* ---------- theme toggle: System → Light → Dark, remembered per-viewer ----------
   The CSS already defines all three states (bare :root, the dark media query, and
   :root[data-theme]) — this just drives which one applies. Runs before loadState()
   so the right theme is in place from first paint, not after an async round-trip. */
const THEME_ICONS={system:'◐', light:'☀', dark:'☾'};
const THEME_LABELS={system:'System', light:'Light', dark:'Dark'};
function getStoredTheme(){ try{ return localStorage.getItem('workflow_theme'); }catch(e){ return null; } }
function setStoredTheme(v){ try{ if(v) localStorage.setItem('workflow_theme', v); else localStorage.removeItem('workflow_theme'); }catch(e){} }
function applyTheme(mode){
  if(mode==='light'||mode==='dark') document.documentElement.setAttribute('data-theme',mode);
  else document.documentElement.removeAttribute('data-theme');
  const btn=byId('themeToggle');
  btn.textContent=THEME_ICONS[mode]||THEME_ICONS.system;
  btn.title='Theme: '+(THEME_LABELS[mode]||THEME_LABELS.system)+' — click to change';
}
let themeMode=getStoredTheme()||'system';
applyTheme(themeMode);
byId('themeToggle').onclick=()=>{
  themeMode = themeMode==='system' ? 'light' : themeMode==='light' ? 'dark' : 'system';
  setStoredTheme(themeMode==='system'?null:themeMode);
  applyTheme(themeMode);
};

loadState().then(renderAll);
