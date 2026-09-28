const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function D(s){const [y,mo,d]=s.split('-').map(Number); return Math.floor(Date.UTC(y,mo-1,d)/86400000);}
function dayToDate(n){return new Date(n*86400000);}
function fmt(n){const dt=dayToDate(n); return MONTHS[dt.getUTCMonth()]+' '+dt.getUTCDate()+', '+dt.getUTCFullYear();}
function fmtShort(n){const dt=dayToDate(n); return MONTHS[dt.getUTCMonth()]+' '+dt.getUTCDate();}
function iso(n){return dayToDate(n).toISOString().slice(0,10);}
function uid(prefix){return prefix+'_'+Math.random().toString(36).slice(2,8);}

const SEED_SHIFTS = [
  {id:'day', name:'Day Shift', start:'06:00', end:'18:00', locked:true},
  {id:'night', name:'Night Shift', start:'18:00', end:'06:00', locked:true},
];

const SEED_RES = {
  core:{name:'Core Crew', cap:33, shift:'day'},
  abs:{name:'ABS Surveyor', cap:1, shift:'day'},
  cm:{name:'Construction Manager (ICON)', cap:1, shift:'day'},
  process:{name:'Process Team', cap:4, shift:'night'},
  maint:{name:'Maintenance', cap:2, shift:'day'},
  deltac:{name:'Delta Construction', cap:3, shift:'day'},
  deltas:{name:'Delta Scaffolder', cap:2, shift:'day'},
  npg:{name:'NPG Rep', cap:1, shift:'day'},
  marine:{name:'Marine', cap:3, shift:'night'},
  offtake:{name:'Offtake Team', cap:3, shift:'day'},
  steward:{name:'Additional Steward', cap:1, shift:'night'},
  tow:{name:'Tow Master', cap:1, shift:'day'},
  tmt:{name:'TMT Crew', cap:4, shift:'day'},
  cement:{name:'Cementing Crew (Halliburton)', cap:6, shift:'day'},
};

const SEED_POB_CAP = 48;

const PHASES = [
  {id:'p1', name:'Preparation for Shutdown', color:'var(--p1)'},
  {id:'p2', name:'P&A Campaign — Well Kill', color:'var(--p2)'},
  {id:'p3', name:'Process Plant Deactivation', color:'var(--p3)'},
  {id:'p4', name:'Final Offtake & Cargo Prep', color:'var(--p4)'},
  {id:'p5', name:'Riser & Umbilical Cutting', color:'var(--p5)'},
  {id:'p6', name:'Chain Cutting & Tow-Away', color:'var(--p6)'},
];

function normPreds(p){ if(!p) return []; return Array.isArray(p)?p.slice():[p]; }
function t(id,phase,name,start,end,resources,preds,status,pct,notes,history){
  return {id,phase,name,start:D(start),end:D(end),resources:resources||[],preds:normPreds(preds),status,pct:pct||0,notes:notes||'',history:history||[]};
}
function m(id,phase,name,date,preds){
  return {id,phase,name,start:D(date),end:D(date),milestone:true,preds:normPreds(preds),history:[]};
}

const galocTasks = [
  t('t1','p1','Mobilize decommissioning crew','2027-03-07','2027-03-09',[['core',33],['abs',1],['cm',1],['npg',1]],null,'done',100,'Standard mob — flight manifest confirmed for the 13th crew change.'),
  t('t2','p1','Overflow the separators','2027-03-15','2027-03-15',[['process',4]],'t1','done',100),
  m('m1','p1','CoP — End of Production','2027-03-16','t2'),
  t('t4','p1','Well isolation — water flood risers (Ph1 & Ph2)','2027-03-16','2027-03-17',[['marine',2],['process',2]],'m1','done',100),
  t('t5','p1','Install cement spool — Phase 1 & 2','2027-03-17','2027-03-19',[['deltac',3]],'t4','done',100,'',[{date:'2027-03-18',text:'End date moved +1 day by M. Santos — weather delay on Phase 2 hub connection.'}]),

  t('t6','p2','Mob cementing package — Labuan → Galoc transit','2027-03-07','2027-03-16',[['cement',6]],null,'done',100),
  t('t7','p2','Rig up cement & pumping spread','2027-03-18','2027-03-20',[['cement',6]],'t6','done',100),
  t('t9','p2','Well kill — Phase 2 wells','2027-03-22','2027-03-23',[['marine',2],['process',2]],'t7','done',100),
  t('t8','p2','Wait on Weather (WOW)','2027-03-24','2027-03-25',[['marine',1]],'t9','hold',0,'25kt gusts forecast — Marine standby only, no P&A work.',[{date:'2027-03-23',text:'Created from 48h forecast — Halliburton pumping spread stood down pending clearance.'}]),
  t('t10','p2','P&A Galoc-5','2027-03-25','2027-03-26',[['cement',6]],'t8','upcoming',0),
  t('t11','p2','P&A Galoc-6B','2027-03-26','2027-03-27',[['cement',6]],'t10','upcoming',0),
  t('t12','p2','Well kill — Phase 1 wells','2027-03-27','2027-03-28',[['marine',2],['process',2]],'t11','upcoming',0),
  t('t13','p2','P&A Galoc-3ST1','2027-03-28','2027-03-29',[['cement',6]],'t12','upcoming',0),
  t('t14','p2','P&A Galoc-4','2027-03-29','2027-03-30',[['cement',6]],'t13','upcoming',0),
  m('m2','p2','DSV Departs','2027-03-31','t14'),

  t('t15','p3','Process plant draining, import line & flushing','2027-03-17','2027-03-18',[['process',4]],'t4','done',100),
  t('t16','p3','Process plant demucking (1st & 2nd stage)','2027-03-19','2027-03-20',[['process',4],['maint',2]],'t15','done',100),
  t('t17','p3','COT settling and decanting','2027-03-18','2027-03-23',[['marine',2]],'t15','done',100),

  t('t18','p4','Final Offtake','2027-03-30','2027-04-01',[['offtake',3],['steward',1]],['t14','t17'],'upcoming',0),
  m('m3','p4','Final Offtake Complete','2027-04-01','t18'),
  t('t19','p4','Offtake hose — flush & disconnect','2027-04-01','2027-04-03',[['offtake',3]],'t18','upcoming',0),
  t('t20','p4','Cargo tank seawater wash (3 COTs)','2027-04-04','2027-04-05',[['marine',2],['steward',1]],'t19','upcoming',0),
  t('t21','p4','Cargo tank purging & gas freeing','2027-04-05','2027-04-09',[['maint',2]],'t20','upcoming',0),
  t('t22','p4','Cargo tank demucking & bagging sludge','2027-04-09','2027-04-13',[['deltac',2],['maint',2]],'t21','upcoming',0),

  t('t23','p5','Prep for riser cutting / de-ballast turret table','2027-04-13','2027-04-15',[['tmt',4],['marine',1]],'t22','upcoming',0),
  t('t24','p5','Cut risers & umbilicals','2027-04-15','2027-04-17',[['tmt',4]],'t23','critical',0,'Marine growth survey shows heavier fouling than the base case — sequence is weather-sensitive.',[{date:'2027-03-10',text:'Flagged critical by Ops — added contingency day before Harbour Tugs arrival.'}]),
  t('t25','p5','Cap I-tube (welding) & clean marine growth','2027-04-17','2027-04-19',[['deltac',2],['deltas',2]],'t24','upcoming',0),

  t('t26','p6','Harbour tugs arrive & deploy lines','2027-04-19','2027-04-20',[['tow',1]],'t25','upcoming',0),
  t('t27','p6','Cut chains — first two sets of three','2027-04-20','2027-04-22',[['deltac',3]],'t26','upcoming',0),
  t('t28','p6','Wait on Weather (WOW) — chain cutting','2027-04-22','2027-04-23',[['marine',1]],'t27','hold',0),
  t('t29','p6','Towing tug arrives — deploy wire, cut last 3 chains','2027-04-23','2027-04-24',[['tow',1],['deltac',1]],'t28','upcoming',0),
  t('t30','p6','Ballast to towing draft, pre-tow checks, demob','2027-04-24','2027-04-28',[['core',30]],'t29','upcoming',0),
  m('m4','p6','Tow Commences','2027-05-05','t30'),
];

const TRANSFERS = [
  {id:'x1', date:'2027-03-07', mode:'heli', label:'Initial crew mobilization', manifest:[['core',33,'in'],['abs',1,'in'],['cm',1,'in'],['npg',1,'in']]},
  {id:'x2', date:'2027-03-16', mode:'boat', label:'Cementing crew arrives (PSV alongside)', manifest:[['cement',6,'in']]},
  {id:'x3', date:'2027-03-31', mode:'heli', label:'P&A campaign demob — cementing crew departs', manifest:[['cement',6,'out']]},
  {id:'x4', date:'2027-04-13', mode:'boat', label:'Steward rotation off', manifest:[['steward',1,'out']]},
  {id:'x5', date:'2027-04-19', mode:'heli', label:'Tow phase mobilization — TMT & Tow Master', manifest:[['tmt',4,'in'],['tow',1,'in']]},
  {id:'x6', date:'2027-04-28', mode:'heli', label:'Final crew demobilization ahead of tow', manifest:[['core',30,'out']]},
].map(x=>({...x, day:D(x.date)}));

const SEED_PROJECTS = [
  {id:'galoc', name:'Galoc FPSO Decommissioning', status:'Active', statusClass:'active-status', tasks:galocTasks, transfers:TRANSFERS},
  {id:'nido', name:'Nido Platform Refit', status:'Planning', statusClass:'planning-status', tasks:[], transfers:[]},
  {id:'tanjung', name:'Tanjung Riser Replacement', status:'On Hold', statusClass:'hold-status', tasks:[], transfers:[]},
];

/* The real default: a genuinely empty starting point, not the demo above.
   SEED_* stays around purely as what "Load demo data" (sidebar) restores on
   request — this is the pre-launch to-do that flips which one loadState()
   reaches for by default; see LIVING_PROJECT_STATE.md. */
const BLANK_PROJECTS = [
  {id:'p1', name:'My Project', status:'Planning', statusClass:'planning-status', tasks:[], transfers:[]},
];
const BLANK_RES = {};
const BLANK_POB_CAP = 50;

/* Live, mutable bindings — populated at boot by loadState() in app.js,
   either from the artifact's own bundled db (persists standalone) or,
   when that capability isn't available in this view, from BLANK_* above. */
let PROJECTS, RES, SHIFTS, POB_CAP;
