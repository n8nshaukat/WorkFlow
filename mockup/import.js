/* ---------- Import wizard: WorkFlow backup / Excel-CSV / paste-and-interpret ---------- */
let stagedRows = [];
let pendingJsonObj = null;

/* ---------- optional extra fields (generic across import paths, not specific to any one
   source format) — a row can carry data beyond Name/Start/End/Phase (a WBS code, a source
   duration string, an unmapped spreadsheet column…); those are opt-in, appended to Notes,
   never silently dropped and never silently included either. ---------- */
let extraFieldDefs=[]; // [{key,label}]
let extraFieldChecked=new Set();
function setExtraFieldDefs(defs){
  extraFieldDefs=defs; extraFieldChecked=new Set();
  renderExtraFieldsUI();
  applyExtraFieldsToNotes();
}
function renderExtraFieldsUI(){
  const wrap=byId('importExtraFields');
  if(!extraFieldDefs.length){ wrap.style.display='none'; wrap.innerHTML=''; return; }
  wrap.style.display='flex';
  wrap.innerHTML=`<span class="hint" style="flex:0 0 100%;">Also found in the source — include in each task's Notes?</span>`;
  extraFieldDefs.forEach(def=>{
    const lbl=document.createElement('label'); lbl.className='extra-field-chk';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=extraFieldChecked.has(def.key);
    cb.onchange=()=>{ if(cb.checked) extraFieldChecked.add(def.key); else extraFieldChecked.delete(def.key); applyExtraFieldsToNotes(); };
    lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' '+def.label));
    wrap.appendChild(lbl);
  });
}
function applyExtraFieldsToNotes(){
  // row._baseNotes (e.g. an Excel Resource/Notes column) is always included; extras are opt-in on top of it.
  stagedRows.forEach(row=>{
    const base=row._baseNotes||'';
    if(!row._extra){ row.notes=base; return; }
    const parts=extraFieldDefs.filter(d=>extraFieldChecked.has(d.key) && row._extra[d.key]).map(d=>`${d.label}: ${row._extra[d.key]}`);
    row.notes=[base, ...parts].filter(Boolean).join(' — ');
  });
}

function currentImportSrc(){ const b=byId('importSourceSeg').querySelector('button.active'); return b?b.dataset.src:'excel'; }
function resetJsonPreview(){
  pendingJsonObj=null;
  byId('importJsonSummary').style.display='none';
  byId('importJsonFile').value='';
}

async function getSample(){
  if(!window.claude || !window.claude.use) return null;
  try{ return await window.claude.use('sample'); } catch(e){ return null; }
}

function openImportModal(){
  stagedRows = [];
  resetJsonPreview();
  setExtraFieldDefs([]);
  resetResourceMatching(); renderResMatchTable();
  byId('importResFile').value='';
  byId('importSourceSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.src==='excel'));
  byId('importJsonPane').style.display='none';
  byId('importExcelPane').style.display='block';
  byId('importPastePane').style.display='none';
  byId('importResFilePane').style.display='block';
  byId('importExcelStatus').textContent = `Adds tasks to "${project().name}". The first sheet's header row is auto-matched to Name / Start / End / Duration / Phase / Status / Resource / Notes — review and edit everything before importing.`;
  byId('importPasteText').value='';
  byId('importPdfFile').value='';
  byId('importPasteStatus').textContent='Upload a PDF directly, or paste text copied from one. A recognized MS Project / Primavera schedule table (WBS, Duration, Start, Finish columns) is parsed directly — no AI, no size limit, works on the full document. Anything else is sent to Claude (this artifact’s own "ask Claude" capability, billed to your account, asks permission the first time) to interpret. Scanned/image-only PDFs have no selectable text — you\'ll be told if that happens; run one through OCR or a PDF-to-Excel tool first, then use the Excel tab instead.';
  renderReviewTable();
  byId('importModalScrim').classList.add('open');
}
function closeImportModal(){ byId('importModalScrim').classList.remove('open'); }

byId('importSourceSeg').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  byId('importSourceSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('active', x===b));
  const src=b.dataset.src;
  byId('importJsonPane').style.display = src==='json' ? 'block' : 'none';
  byId('importExcelPane').style.display = src==='excel' ? 'block' : 'none';
  byId('importPastePane').style.display = src==='paste' ? 'block' : 'none';
  byId('importResFilePane').style.display = src==='json' ? 'none' : 'block';
  byId('importPdfFile').value='';
  stagedRows=[]; resetJsonPreview(); setExtraFieldDefs([]); resetResourceMatching(); byId('importResFile').value=''; renderResMatchTable(); renderReviewTable();
});
byId('importModalClose').onclick=closeImportModal;
byId('importCancel').onclick=closeImportModal;
byId('importModalScrim').onclick=(e)=>{ if(e.target.id==='importModalScrim') closeImportModal(); };

/* ---------- review table (shared by Excel + paste paths) ---------- */
function renderReviewTable(){
  const wrap=byId('importReviewTable'); wrap.innerHTML='';
  stagedRows.forEach((row)=>{
    const el=document.createElement('div'); el.className='import-row';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=row.include;
    cb.onchange=()=>{ row.include=cb.checked; updateImportCount(); };
    const nameInp=document.createElement('input'); nameInp.type='text'; nameInp.className='iname'; nameInp.value=row.name;
    nameInp.oninput=()=>{ row.name=nameInp.value; };
    const startInp=document.createElement('input'); startInp.type='date'; startInp.className='istart'; startInp.value=iso(row.start);
    startInp.onchange=()=>{ row.start=D(startInp.value); if(row.end<=row.start) row.end=row.start+1; };
    const endInp=document.createElement('input'); endInp.type='date'; endInp.className='iend'; endInp.value=iso(row.end-1);
    endInp.onchange=()=>{ row.end=D(endInp.value)+1; if(row.end<=row.start) row.end=row.start+1; };
    const phaseSel=document.createElement('select'); phaseSel.className='iphase';
    phaseSel.innerHTML=PHASES.map(p=>`<option value="${p.id}"${p.id===row.phaseId?' selected':''}>${p.name}</option>`).join('');
    phaseSel.onchange=()=>{ row.phaseId=phaseSel.value; };
    const warn=document.createElement('span'); warn.className='row-warn';
    if(row.flags && row.flags.length){ warn.textContent='⚠'; warn.title=row.flags.join('\n'); el.classList.add('flagged'); }
    el.appendChild(cb); el.appendChild(warn); el.appendChild(nameInp); el.appendChild(startInp); el.appendChild(endInp); el.appendChild(phaseSel);
    wrap.appendChild(el);
  });
  byId('importReviewWrap').style.display = stagedRows.length ? 'block' : 'none';
  updateImportCount();
}
function updateImportCount(){
  const n=stagedRows.filter(r=>r.include).length;
  byId('importCountHint').textContent = n ? `${n} task${n===1?'':'s'} ready to import` : '';
  byId('importConfirm').disabled = (n===0);
}
byId('importConfirm').onclick=()=>{
  if(currentImportSrc()==='json'){
    if(!pendingJsonObj) return;
    const obj=pendingJsonObj;
    importSnapshot(obj);
    resetJsonPreview();
    closeImportModal();
    renderAll();
    showToast('✓ Imported — overwrote the reviewed items, added anything new.');
    return;
  }
  const proj=project();
  const toAdd=stagedRows.filter(r=>r.include);
  // Every resource name across the batch was already resolved (automatically, or by the
  // user in the matching panel) into resourceResolutions — create any brand-new resources
  // once here, then every row just looks up the key it needs.
  const newResKeys={};
  let newResCount=0;
  Object.entries(resourceResolutions).forEach(([lower,res])=>{
    if(res.action!=='new') return;
    const existingKey=Object.keys(RES).find(k=>RES[k].name.toLowerCase()===lower);
    if(existingKey){ newResKeys[lower]=existingKey; return; } // created by an earlier row's resolution this same commit, or matches something added since
    const key=uid('res');
    RES[key]={name:res.name, cap:res.cap||1, shift:res.shift||'day'};
    newResKeys[lower]=key; newResCount++;
  });
  if(newResCount) persistConfig();
  function resolveTaskResources(namesRaw){
    return (namesRaw||[]).map(name=>{
      const lower=name.toLowerCase(), res=resourceResolutions[lower];
      const key = res && res.action==='existing' ? res.key : newResKeys[lower];
      return key ? [key,1] : null;
    }).filter(Boolean);
  }
  // Rows carrying a subGroupWbs came from the PDF/WBS-table parser, which now keeps the
  // source's own intermediate summary rows instead of discarding them — one new group task
  // per unique (phase, source WBS parent) pair, shared by every row under it.
  const groupIds={};
  toAdd.forEach(r=>{
    let parentId;
    if(r.subGroupWbs){
      const key=r.phaseId+'|'+r.subGroupWbs;
      if(!groupIds[key]){
        const gid=uid('g');
        proj.tasks.push({id:gid, phase:r.phaseId, name:r.subGroupName||'Imported group', group:true, parent:null, collapsed:false,
          history:[{date:iso(TODAY), text:'By You — Group created from the imported schedule’s own WBS structure.'}]});
        groupIds[key]=gid;
      }
      parentId=groupIds[key];
    }
    proj.tasks.push({
      id: uid('t'), phase: r.phaseId, name: (r.name||'').trim()||'Untitled task',
      start: r.start, end: Math.max(r.end, r.start+1), resources: resolveTaskResources(r._resourceNamesRaw), preds: [],
      status: r.status||'upcoming', pct: 0, notes: r.notes||'', parent: parentId,
      wbsRef: (r._extra && r._extra['WBS code']) || undefined,
      sourceDuration: (r._extra && r._extra['Source duration text']) || undefined,
      history: [{date: iso(TODAY), text: 'By You — Imported.'}]
    });
  });
  persistProject(proj);
  closeImportModal();
  renderAll();
  const groupCount=Object.keys(groupIds).length;
  showToast(`✓ Imported ${toAdd.length} task${toAdd.length===1?'':'s'} into ${proj.name}.`
    +(groupCount?` Grouped into ${groupCount} summary task${groupCount===1?'':'s'} from the source WBS.`:'')
    +(newResCount?` Added ${newResCount} new resource${newResCount===1?'':'s'} to the roster.`:''));
};

/* ---------- JSON backup pane — preview the overwrite before committing ---------- */
function summarizeJsonImport(obj){
  const lines=[];
  if(obj.resources && Object.keys(obj.resources).length) lines.push(`Resource roster replaced — ${Object.keys(RES).length} role(s) → ${Object.keys(obj.resources).length} role(s)`);
  if(Array.isArray(obj.shifts) && obj.shifts.length) lines.push(`Shift patterns replaced — ${SHIFTS.length} → ${obj.shifts.length}`);
  if(typeof obj.pobCap==='number' && obj.pobCap!==POB_CAP) lines.push(`POB cap changed — ${POB_CAP} → ${obj.pobCap}`);
  (obj.projects||[]).forEach(op=>{
    const existing=PROJECTS.find(p=>p.id===op.id);
    const n=(op.tasks||[]).length;
    lines.push(existing
      ? `"${existing.name}" — tasks replaced, ${existing.tasks.length} → ${n}`
      : `"${op.name||op.id}" — new project added, ${n} task(s)`);
  });
  return lines;
}
byId('importJsonFile').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const obj=JSON.parse(reader.result);
      if(!obj || !Array.isArray(obj.projects)) throw new Error('not a WorkFlow export');
      pendingJsonObj=obj;
      byId('importJsonSummaryList').innerHTML=summarizeJsonImport(obj).map(l=>`<div class="dep-note">${l}</div>`).join('');
      byId('importJsonSummary').style.display='block';
      byId('importConfirm').disabled=false;
      byId('importCountHint').textContent='Review the changes above, then click Import to confirm.';
    } catch(err){
      pendingJsonObj=null;
      byId('importJsonSummary').style.display='none';
      byId('importConfirm').disabled=true;
      showToast('✗ Could not read that file — expecting a WorkFlow JSON export.');
    }
  };
  reader.onerror=()=>showToast('✗ Could not read that file.');
  reader.readAsText(f);
});

/* ---------- Excel / CSV pane ---------- */
function findCol(headers, patterns){
  const lower=headers.map(h=>h.toLowerCase());
  for(const pat of patterns){ const idx=lower.findIndex(h=>h.includes(pat)); if(idx>-1) return headers[idx]; }
  return null;
}
function parseExcelDate(v){
  if(v===null || v===undefined || v==='') return null;
  if(typeof v==='number' && isFinite(v)){ return Math.floor(v-25569); }
  const s=String(v).trim();
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return D(`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`);
  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){ let [,mo,da,yr]=m; if(yr.length===2) yr=(Number(yr)<70?'20':'19')+yr; return D(`${yr}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`); }
  return null;
}
function guessPhase(v){
  if(!v) return null;
  const s=String(v).toLowerCase();
  const hit=PHASES.find(p=>{ const pn=p.name.toLowerCase(); return pn.includes(s)||s.includes(pn.split(' ')[0]); });
  return hit?hit.id:null;
}
function guessStatus(v){
  const s=String(v||'').toLowerCase();
  if(/done|complete|finish/.test(s)) return 'done';
  if(/hold|weather|wow/.test(s)) return 'hold';
  if(/critical|risk|flag/.test(s)) return 'critical';
  if(/progress|ongoing|active/.test(s)) return 'progress';
  return 'upcoming';
}
function parseSheetToRows(ws){
  const aoa=XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''});
  if(!aoa.length) return [];
  const headers=aoa[0].map(h=>String(h||'').trim());
  return aoa.slice(1).filter(r=>r.some(c=>String(c).trim()!=='')).map(r=>{
    const obj={}; headers.forEach((h,i)=>{ obj[h]=r[i]; }); return obj;
  });
}

/* ---------- resource matching (shared by Excel + paste/PDF import) ----------
   A task's Resource column (or a separate resource sheet/file) names people by
   free text, which never lines up 1:1 with the app's own resource roster. Rather
   than guess a fuzzy match silently or dump the text into Notes as dead weight,
   every name is resolved to either an existing resource (exact, case-insensitive
   match — the "obvious" case, no prompt needed) or flagged for a one-time human
   decision before import: match to an existing resource, or create a new one. */
let resourceCandidates={}; // lowercased name -> {name, cap, shift} — found in a resource sheet/file, not yet in RES
let resourceResolutions={}; // lowercased name -> {action:'existing'|'new', key?, name, cap, shift}
function splitResourceNames(v){
  return String(v||'').split(/[,;/]+|\band\b/i).map(s=>s.trim()).filter(Boolean);
}
function resetResourceMatching(){ resourceCandidates={}; resourceResolutions={}; }
/* headers that read like a resource roster: a name-ish column plus either a
   capacity-ish column or a sheet name that says "resource" outright. */
function looksLikeResourceSheet(sheetName, headers){
  const nameCol=findCol(headers,['resource','name','role','crew','discipline']);
  const capCol=findCol(headers,['capacity','cap','headcount','qty','quantity','count']);
  return !!(nameCol && (capCol || /resource/i.test(sheetName)));
}
function rowsToResourceCandidates(rows){
  if(!rows.length) return [];
  const headers=Object.keys(rows[0]);
  const nameCol=findCol(headers,['resource','name','role','crew','discipline']);
  const capCol=findCol(headers,['capacity','cap','headcount','qty','quantity','count']);
  const shiftCol=findCol(headers,['shift']);
  if(!nameCol) return [];
  return rows.map(r=>{
    const name=String(r[nameCol]||'').trim(); if(!name) return null;
    const cap=capCol?Math.max(1,Math.round(Number(r[capCol]))||1):1;
    const shiftRaw=shiftCol?String(r[shiftCol]||'').toLowerCase():'';
    const shift=/night/.test(shiftRaw)?'night':'day';
    return {name, cap, shift};
  }).filter(Boolean);
}
function mergeResourceCandidates(list){
  list.forEach(c=>{ resourceCandidates[c.name.toLowerCase()]=c; });
}
/* Scans every sheet in a workbook except the one already used for tasks, and merges
   in the first one that looks like a resource roster — covers "a separate sheet in
   the same file", one of the two supply modes asked for (the other, a wholly separate
   file, is handled by the dedicated Resource file input). */
function findResourceSheetInWorkbook(wb, excludeSheetName){
  for(const name of wb.SheetNames){
    if(name===excludeSheetName) continue;
    const rows=parseSheetToRows(wb.Sheets[name]);
    if(!rows.length) continue;
    if(looksLikeResourceSheet(name, Object.keys(rows[0]))){
      mergeResourceCandidates(rowsToResourceCandidates(rows));
      return name;
    }
  }
  return null;
}
/* Re-derives resourceResolutions from the current stagedRows + resourceCandidates +
   the live RES roster — safe to call repeatedly (e.g. after the optional resource
   file loads) since it only overwrites entries, never accumulates stale ones. */
function resolveResources(){
  const names=new Set();
  stagedRows.forEach(r=>(r._resourceNamesRaw||[]).forEach(n=>names.add(n)));
  const prev=resourceResolutions; resourceResolutions={};
  names.forEach(name=>{
    const lower=name.toLowerCase();
    const existingKey=Object.keys(RES).find(k=>RES[k].name.toLowerCase()===lower);
    if(existingKey){ resourceResolutions[lower]={action:'existing', key:existingKey, name}; return; }
    const cand=resourceCandidates[lower];
    if(cand){ resourceResolutions[lower]={action:'new', name:cand.name, cap:cand.cap, shift:cand.shift, confident:true}; return; }
    // No confident match — keep the user's own prior choice if they already resolved
    // this one (e.g. re-parsing after adding a resource file shouldn't discard it).
    resourceResolutions[lower]=prev[lower] && !prev[lower].confident ? prev[lower] : {action:'new', name, cap:1, shift:'day'};
  });
}
function renderResMatchTable(){
  const wrap=byId('importResMatchWrap'), table=byId('importResMatchTable');
  const entries=Object.entries(resourceResolutions);
  if(!entries.length){ wrap.hidden=true; table.innerHTML=''; return; }
  const needsReview=entries.filter(([,r])=>!r.confident && r.action==='new' && !r._reviewed);
  const auto=entries.length-needsReview.length;
  table.innerHTML='';
  const summary=document.createElement('div'); summary.className='dep-note';
  summary.textContent = auto ? `${auto} resource${auto===1?'':'s'} matched automatically.${needsReview.length?` ${needsReview.length} need a quick check below.`:''}` : `${needsReview.length} resource${needsReview.length===1?'':'s'} need a quick check before import.`;
  table.appendChild(summary);
  needsReview.forEach(([lower,res])=>{
    const row=document.createElement('div'); row.className='res-match-row';
    const label=document.createElement('span'); label.className='res-match-name'; label.textContent=res.name;
    const sel=document.createElement('select');
    sel.innerHTML='<option value="new">+ Create new resource</option>'
      + Object.entries(RES).map(([k,r])=>`<option value="${k}">Match to "${r.name}"</option>`).join('');
    sel.value = res.action==='existing' ? res.key : 'new';
    sel.onchange=()=>{
      res._reviewed=true;
      if(sel.value==='new'){ resourceResolutions[lower]={action:'new', name:res.name, cap:1, shift:'day', _reviewed:true}; }
      else { resourceResolutions[lower]={action:'existing', key:sel.value, name:res.name, _reviewed:true}; }
    };
    row.appendChild(label); row.appendChild(sel);
    table.appendChild(row);
  });
  wrap.hidden=false;
}
async function parseResourceFile(file){
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(new Uint8Array(buf), {type:'array'});
  const rows=parseSheetToRows(wb.Sheets[wb.SheetNames[0]]);
  return rowsToResourceCandidates(rows);
}
byId('importResFile').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const list=await parseResourceFile(f);
    mergeResourceCandidates(list);
    resolveResources(); renderResMatchTable();
    showToast(`✓ Found ${list.length} resource${list.length===1?'':'s'} in "${f.name}".`);
  } catch(err){
    showToast('✗ Could not read that file as a spreadsheet.');
  }
});
function buildStagedFromExcelRows(rows){
  if(!rows.length) return {staged:[], extraHeaders:[]};
  const headers=Object.keys(rows[0]);
  const nameCol=findCol(headers,['task name','activity','name','description']);
  const startCol=findCol(headers,['start date','start']);
  const endCol=findCol(headers,['end date','finish','end']);
  const durCol=findCol(headers,['duration','days','hours']);
  const phaseCol=findCol(headers,['phase','group','campaign','category']);
  const statusCol=findCol(headers,['status']);
  const resCol=findCol(headers,['resource','crew','discipline','role']);
  const notesCol=findCol(headers,['notes','comment','remark']);
  const usedCols=new Set([nameCol,startCol,endCol,durCol,phaseCol,statusCol,resCol,notesCol].filter(Boolean));
  const extraHeaders=headers.filter(h=>!usedCols.has(h));
  const staged=[];
  rows.forEach(r=>{
    const name=nameCol?String(r[nameCol]||'').trim():'';
    if(!name) return;
    const start=startCol?parseExcelDate(r[startCol]):null;
    if(start===null) return;
    const flags=[];
    let end=endCol?parseExcelDate(r[endCol]):null;
    if(end===null){ const dur=durCol?(Number(r[durCol])||1):1; end=start+Math.max(Math.round(dur)||1,1); }
    else {
      if(end<start){ flags.push('End was before Start in the source — swapped back automatically, please verify'); [start,end]=[end,start]; }
      end=end+1; if(end<=start) end=start+1;
      if(durCol && r[durCol]!==undefined && r[durCol]!==''){
        const statedDays=Number(r[durCol]), spanDays=end-start;
        if(isFinite(statedDays) && statedDays>1 && (statedDays>spanDays*3 || statedDays<spanDays/3)){
          flags.push(`Stated duration (${r[durCol]}) doesn't roughly match the Start–End span (${spanDays}d)`);
        }
      }
    }
    const notesParts=[];
    if(notesCol && r[notesCol]) notesParts.push(String(r[notesCol]));
    const extra={}; extraHeaders.forEach(h=>{ if(r[h]!==undefined && r[h]!=='') extra[h]=String(r[h]); });
    const baseNotes=notesParts.join(' — ');
    const resourceNamesRaw=resCol && r[resCol] ? splitResourceNames(r[resCol]) : [];
    staged.push({include:true, name, start, end, phaseId: guessPhase(phaseCol?r[phaseCol]:null)||PHASES[0].id, status: statusCol?guessStatus(r[statusCol]):'upcoming', notes: baseNotes, _baseNotes: baseNotes, flags, _extra:extra, _resourceNamesRaw:resourceNamesRaw});
  });
  return {staged, extraHeaders};
}
byId('importExcelFile').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  if(typeof XLSX==='undefined'){ byId('importExcelStatus').textContent='Spreadsheet reader failed to load — check your connection and reload the page.'; return; }
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const wb=XLSX.read(new Uint8Array(reader.result), {type:'array'});
      const taskSheetName=wb.SheetNames[0];
      const ws=wb.Sheets[taskSheetName];
      const rows=parseSheetToRows(ws);
      const {staged, extraHeaders}=buildStagedFromExcelRows(rows);
      stagedRows=staged;
      setExtraFieldDefs(extraHeaders.map(h=>({key:h, label:h})));
      const resSheet = wb.SheetNames.length>1 ? findResourceSheetInWorkbook(wb, taskSheetName) : null;
      resolveResources(); renderResMatchTable();
      const flagged=staged.filter(r=>r.flags && r.flags.length).length;
      byId('importExcelStatus').textContent = stagedRows.length
        ? `Matched ${stagedRows.length} row(s) from "${taskSheetName}". Review below — edit dates/names, set each row's phase, or uncheck rows you don't want.`
          + (flagged?` ⚠ ${flagged} row${flagged===1?'':'s'} flagged for a possible date/duration issue.`:'')
          + (resSheet?` Also found a resource list in "${resSheet}".`:'')
        : 'Could not find both a Name and a Start Date column automatically. Try a header row that includes words like "Task"/"Name" and "Start".';
      renderReviewTable();
    } catch(err){ byId('importExcelStatus').textContent='Could not read that file as a spreadsheet.'; }
  };
  reader.readAsArrayBuffer(f);
  e.target.value='';
});

/* ---------- paste pane: deterministic WBS/schedule-table parser, AI interpreter as fallback ---------- */
/* Handles MS Project / Primavera P6 style schedule exports pasted from a PDF: ID, WBS, Task Name,
   Duration, Start, Finish columns, day-first (DD/MM/YY) dates, a dotted WBS hierarchy, and a lot of
   incidental duplicate text (Gantt bar labels, repeated month/quarter/page headers) that this parser
   simply never matches, so it's filtered out for free rather than needing to be stripped up front. */
function looksLikeWbsTable(text){
  const head=text.slice(0,600).toLowerCase();
  return /\bwbs\b/.test(head) && /duration/.test(head) && /\bstart\b/.test(head) && /\bfinish\b/.test(head);
}
function parseWbsDate(s, warn){
  const m=String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(!m) return null;
  let [,d,mo,y]=m; d=Number(d); mo=Number(mo);
  if(y.length===2) y=(Number(y)<70?'20':'19')+y;
  if(mo>12 && d<=12){ [d,mo]=[mo,d]; if(warn) warn.swapped=true; } // source row was actually month-first — swap
  if(mo<1||mo>12||d<1||d>31) return null;
  return D(`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
}
/* Converts a source row's own stated Duration text to a day-count, used only for a coarse
   sanity check against the parsed Start–Finish span — never for the task's actual length
   (Start/Finish always win). "days"/"day" is deliberately treated the same as "edays"/"eday"
   even though in these exports plain "days" more often means *working* days: a stricter
   calendar-accurate conversion would false-flag most ordinary rows that just span a weekend. */
function wbsDurationToDays(numText, unit){
  const n=Number(numText); if(!isFinite(n)) return null;
  const u=String(unit||'').toLowerCase();
  if(/^ewks?$/.test(u)) return n*7;
  if(/^e?hrs?$/.test(u)) return n/24;
  return n;
}
/* No trailing `$` anchor: a PDF's own text-extraction order can interleave an unrelated
   Gantt-bar label after a row's real Duration/Start/Finish fields (same line, different
   x-position in the source layout) — greedy backtracking still lands on the true fields
   and anything appended after the Finish date is simply left uncaptured. */
const WBS_ROW_WITH_ID = /^(\d+)\s+([\d.]+)\s+(.+)\s+([\d.]+)\s+(\w+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/;
const WBS_ROW_NO_ID = /^([\d.]+)\s+(.+)\s+([\d.]+)\s+(\w+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/;
function parseWbsTable(text){
  const rows=[];
  text.split('\n').forEach(lineRaw=>{
    const line=lineRaw.trim(); if(!line) return;
    let m=line.match(WBS_ROW_WITH_ID), wbs,name,durNum,durUnit,startStr,endStr;
    if(m){ wbs=m[2]; name=m[3].trim(); durNum=m[4]; durUnit=m[5]; startStr=m[6]; endStr=m[7]; }
    else {
      m=line.match(WBS_ROW_NO_ID); if(!m) return;
      wbs=m[1]; name=m[2].trim(); durNum=m[3]; durUnit=m[4]; startStr=m[5]; endStr=m[6];
    }
    if(!name || !/^[\d.]+$/.test(wbs)) return;
    const startWarn={}, endWarn={};
    const rawStart=parseWbsDate(startStr,startWarn), rawEnd=parseWbsDate(endStr,endWarn);
    if(rawStart===null || rawEnd===null) return;

    // Soft-flag data-quality issues rather than blocking — matches this app's own "soft
    // warnings, never hard blocks" rule (see CLAUDE.md). Values are still recovered on a
    // best-effort basis (swapped/clamped) so the row is still usable, just marked for review.
    const flags=[];
    if(startWarn.swapped||endWarn.swapped) flags.push('Day/month order was ambiguous in the source and had to be guessed');
    if(rawEnd<rawStart) flags.push('Finish was before Start in the source — swapped back automatically, please verify');
    const start=Math.min(rawStart,rawEnd), realEnd=Math.max(rawStart,rawEnd);
    const spanDays=Math.max(realEnd-start,0)+1;
    const statedDays=wbsDurationToDays(durNum,durUnit);
    if(statedDays!==null && statedDays>1 && (statedDays>spanDays*3 || statedDays<spanDays/3)){
      flags.push(`Stated duration (${durNum} ${durUnit}) doesn't roughly match the Start–Finish span (${spanDays}d) — may be a working-day count, or an extraction error`);
    }
    rows.push({wbs, name, start, end: realEnd+1, durationText: `${durNum} ${durUnit}`, flags});
  });
  if(!rows.length) return {leaves:[], skipped:0};
  const byWbs={}; rows.forEach(r=>{ byWbs[r.wbs]=r; });
  const isParent=code=>rows.some(r=>r.wbs!==code && r.wbs.startsWith(code+'.'));
  const leaves=rows.filter(r=>!isParent(r.wbs));
  leaves.forEach(r=>{
    // Prefer the shallowest ancestor whose own name reads like a phase header (common in these exports —
    // e.g. WBS 3.2 "PHASE A: FPSO Preparations…" nested under the broader WBS 3 "PROJECT ENGINEERING")
    // over the bare top-level WBS ancestor, which is often too coarse to be a useful grouping.
    const segs=r.wbs.split('.'); let groupName=null, phaseDepth=0;
    for(let i=1;i<=segs.length && !groupName;i++){
      const ancestor=byWbs[segs.slice(0,i).join('.')];
      if(ancestor && /phase/i.test(ancestor.name)){ groupName=ancestor.name; phaseDepth=i; }
    }
    if(!groupName){ const topRow=byWbs[segs[0]]; groupName=topRow?topRow.name:r.name; phaseDepth=1; }
    r.groupName=groupName;
    // Below the phase match, the source's own summary rows are real WBS grouping, not just
    // phase-guessing input — surface the immediate parent as a group instead of discarding it,
    // so an imported schedule keeps the source's outline structure (single level, matching
    // this app's own one-level-of-nesting design — a deeper chain collapses onto its nearest
    // real ancestor, not onto every intermediate level).
    if(segs.length-1>phaseDepth){
      const parentCode=segs.slice(0,-1).join('.'), parentRow=byWbs[parentCode];
      if(parentRow){ r.subGroupWbs=parentCode; r.subGroupName=parentRow.name; }
    }
  });
  return {leaves, skipped: rows.length-leaves.length};
}

/* ---------- AI interpreter fallback, for genuinely unstructured paste text ---------- */
function safeDateOrNull(s){
  if(!s) return null;
  const m=String(s).slice(0,10).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(!m) return null;
  return D(`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`);
}
async function interpretPastedText(text){
  const sample=await getSample();
  if(!sample){ byId('importPasteStatus').textContent='Claude access isn’t available in this view.'; return null; }
  const prompt = 'Extract a project task list from this messy pasted schedule text (likely copied from a PDF or a printed spreadsheet). '
    + 'Reply with ONLY a JSON array, each item shaped {"name": string, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "notes": string}. '
    + '"end" is the inclusive last day (same as "start" for a single day or an unclear duration). "notes" is optional — use it for any crew/resource mentioned. '
    + 'Infer one consistent, plausible year if the text never states one outright. Dates in the source may be written day-first (DD/MM/YY) rather than month-first — infer the true order from context (a value over 12 can only be a day) and apply that same order to every date in the document. '
    + 'Skip anything that is not an actual task, activity or milestone — headers, page numbers, totals, blank rows. '
    + 'Example: [{"name":"Rig up cement spread","start":"2027-03-18","end":"2027-03-20","notes":"Cementing Crew"}]\n\nText:\n"""\n' + text.slice(0,6000) + '\n"""';
  try{
    const data=await sample.json(prompt, {modelTier:'default'});
    const arr=Array.isArray(data) ? data : (data && Array.isArray(data.tasks) ? data.tasks : null);
    if(!arr) throw {code:'invalid_json'};
    return arr.map(x=>{
      const s=safeDateOrNull(x.start) ?? TODAY;
      let e=safeDateOrNull(x.end); e=(e===null?s:e)+1; if(e<=s) e=s+1;
      return {include:true, name:String(x.name||'Untitled').slice(0,140), start:s, end:e, phaseId:PHASES[0].id, status:'upcoming', notes:String(x.notes||'')};
    });
  } catch(e){
    if(e && e.code==='not_granted'){ byId('importPasteStatus').textContent='Claude access was declined for this view.'; return null; }
    if(e && e.code==='invalid_json'){ byId('importPasteStatus').textContent='Claude’s reply wasn’t valid JSON — try trimming the pasted text and try again.'; return null; }
    if(e && e.code==='rate_limited'){ byId('importPasteStatus').textContent='Too many requests right now — wait a moment and try again.'; return null; }
    byId('importPasteStatus').textContent='Could not interpret that text — try again with a smaller excerpt.';
    return null;
  }
}
async function runPasteParse(){
  const text=byId('importPasteText').value.trim();
  if(!text){ byId('importPasteStatus').textContent='Paste some text first, or upload a PDF above.'; return; }
  // The deterministic parser has no resource column of its own — a Resource file, if the
  // user already attached one, is left as-is (not reset) so re-parsing the pasted text
  // doesn't throw away resources they already supplied separately.

  if(looksLikeWbsTable(text)){
    const {leaves, skipped}=parseWbsTable(text);
    if(leaves.length){
      const flagged=leaves.filter(r=>r.flags.length).length;
      const groupedCount=leaves.filter(r=>r.subGroupWbs).length;
      stagedRows=leaves.map(r=>({
        include:true, name:r.name.slice(0,140), start:r.start, end:r.end,
        phaseId: guessPhase(r.groupName)||PHASES[0].id, status:'upcoming', notes:'',
        flags:r.flags, subGroupWbs:r.subGroupWbs, subGroupName:r.subGroupName,
        _extra:{'WBS code':r.wbs, 'Source duration text':r.durationText, 'Group':r.subGroupName||''}
      }));
      setExtraFieldDefs([{key:'WBS code', label:'WBS code'}, {key:'Source duration text', label:'Source duration text'}, {key:'Group', label:'Group (from source WBS)'}]);
      resolveResources(); renderResMatchTable();
      byId('importPasteStatus').textContent=`Recognized a project-schedule table (WBS/Duration/Start/Finish columns) — parsed ${leaves.length} task${leaves.length===1?'':'s'} directly, no AI and no size limit (skipped ${skipped} summary/rollup row${skipped===1?'':'s'} that only span their own children's dates).`
        + (groupedCount?` ${groupedCount} of them will be grouped into summary tasks matching the source's own WBS structure.`:'')
        + (flagged?` ⚠ ${flagged} row${flagged===1?'':'s'} flagged for a possible date/duration issue — hover the ⚠ on that row.`:'')
        + ' Phase guesses are rough — review each row below.'
        + (Object.keys(resourceCandidates).length?' A resource file is attached — matched against the names it found.':'');
      renderReviewTable();
      return;
    }
  }

  setExtraFieldDefs([]);
  byId('importInterpretBtn').disabled=true;
  byId('importPasteStatus').textContent='Thinking…';
  const rows=await interpretPastedText(text);
  byId('importInterpretBtn').disabled=false;
  if(rows && rows.length){
    stagedRows=rows;
    resolveResources(); renderResMatchTable();
    byId('importPasteStatus').textContent=`Proposed ${rows.length} task(s) — review below before importing. Dates are Claude’s best inference from the text — check them.`;
    renderReviewTable();
  } else if(rows){
    byId('importPasteStatus').textContent='No tasks found in that text.';
  }
}
byId('importInterpretBtn').addEventListener('click', runPasteParse);

/* ---------- direct PDF upload: extract text client-side (pdf.js), then run the same parse path ---------- */
const PDFJS_VERSION='6.3.289';
let pdfjsModPromise=null;
function loadPdfJs(){
  if(!pdfjsModPromise){
    pdfjsModPromise=import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`).then(mod=>{
      mod.GlobalWorkerOptions.workerSrc=`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
      return mod;
    });
  }
  return pdfjsModPromise;
}
async function extractPdfText(file){
  const pdfjsLib=await loadPdfJs();
  const buf=await file.arrayBuffer();
  const doc=await pdfjsLib.getDocument({data:buf}).promise;
  const pageTexts=[];
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i);
    const content=await page.getTextContent();
    let line=''; const lines=[];
    content.items.forEach(item=>{
      line+=item.str;
      if(item.hasEOL){ lines.push(line); line=''; }
      else { line+=' '; }
    });
    if(line.trim()) lines.push(line);
    pageTexts.push(lines.join('\n'));
  }
  return pageTexts.join('\n');
}
byId('importPdfFile').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  byId('importPdfFile').disabled=true;
  byId('importPasteStatus').textContent='Reading PDF…';
  try{
    const text=await extractPdfText(f);
    if(!text.trim()){
      byId('importPasteStatus').textContent='No selectable text found in that PDF — it may be scanned/image-only. Run it through OCR or a PDF-to-Excel tool first, then use the Excel tab instead.';
    } else {
      byId('importPasteText').value=text;
      await runPasteParse();
    }
  } catch(err){
    byId('importPasteStatus').textContent='Could not read that PDF in this browser. Open it yourself, select and copy the task table, then paste it into the box below instead.';
  } finally {
    byId('importPdfFile').disabled=false;
    e.target.value='';
  }
});
