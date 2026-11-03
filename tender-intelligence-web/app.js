import {
  API_ROOT,asText,keyOf,safeNumber,formatMoney,parseDate,dateLabel,typeOf,
  normalize,dedupe,filtered,fieldsOf,summaryOf,ratioStats,scoreCase,
  compareDeadline,csvEscape,safeOfficial
} from './core.mjs';
import {getClient,fetchArchive,fetchSourceStatus,cloudSaved,cloudWatches,cloudNotifications,DATABASE_URL,PUBLISHABLE_KEY} from './backend.js';

const $ = id => document.getElementById(id);
const STORE='opendata-tender-v2';
const listModes={latest:'最新公告',archive:'自有資料庫已收錄案件',title:'標案名稱',vendor:'廠商名稱',companyId:'廠商統編',agency:'機關名稱'};
const viewNames={search:'標案搜尋',radar:'我的商機雷達',agencies:'機關情報',vendors:'廠商與競品',analytics:'決標行情',tracking:'投標工作台',team:'團隊協作',alerts:'監控與提醒',documents:'標書條款整理',about:'資料說明'};
const states=['評估中','準備投標','已投標','待決標','已得標','未得標','不投'];
const readableError = err => {
  const s=asText(err?.message||err);
  if(/Failed to fetch|NetworkError|Load failed/i.test(s))return '連線公開資料 API 失敗，可能是服務暫時不可用或瀏覽器網路限制。';
  if(/429/.test(s))return '公開 API 已達匿名流量限制（429），請稍後再試；本站不會使用假資料代替。';
  if(/401|403/.test(s))return '公開 API 拒絕了這次請求（權限或流量限制）。';
  if(/AbortError|逾時/.test(s))return '查詢逾時，請縮小關鍵字或稍後重試。';
  return s.slice(0,240);
};
function loadStore() {
  try {
    const s=JSON.parse(localStorage.getItem(STORE)||'{}');
    return {saved:typeof s.saved==='object'&&s.saved&&!Array.isArray(s.saved)?s.saved:{},
      profile:s.profile&&typeof s.profile==='object'?s.profile:{},
      watches:Array.isArray(s.watches)?s.watches:[]};
  }catch{return {saved:{},profile:{},watches:[]};}
}
const store=loadStore();
const cloud={client:null,user:null,taskRows:[]};
const state={docPages:[],rows:[],searchRows:[],sourcePage:1,clientPage:1,totalPages:1,mode:'latest',query:'',date:null,
  running:0,view:'search',selected:null,details:new Map(),vendorRows:[],docRows:[],watchRunning:false,lastSearch:'最新公告'};
let toastTimer=null;
const E=(tag,cls,text)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=asText(text);
  return n;
};
function child(parent,...nodes){for(const x of nodes)if(x)parent.append(x);return parent;}
function btn(text,cls,cb){const x=E('button',cls,text);x.type='button';if(cb)x.addEventListener('click',cb);return x;}
function link(text,href){
  if(!href)return E('span','minor','來源未提供網址');
  const a=E('a','',text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;
}
function persist(){try{localStorage.setItem(STORE,JSON.stringify(store));}catch{toast('本機儲存空間不足，操作未成功保存。');}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4300);}
function setStatus(message,type=''){$('apiStatus').textContent=message;$('apiStatus').className='connection-tag '+type;}
function showView(name){
  if(!viewNames[name])return;
  state.view=name;
  for(const v of Object.keys(viewNames))$('view-'+v).hidden=v!==name;
  document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===name));
  $('currentViewLabel').textContent=viewNames[name];
  document.querySelector('.sidebar').classList.remove('mobile-open');
  window.scrollTo({top:0,behavior:'instant'});
  if(name==='radar')renderRadar();
  if(name==='tracking')renderTracking();
  if(name==='team')void refreshWorkspaces();
  if(name==='alerts')renderWatches();
  if(name==='analytics')renderAnalytics();
  if(name==='vendors' && state.vendorRows.length)renderVendorRows();
}
async function api(path,params={},timeout=22000) {
  const url=new URL(API_ROOT+path);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,asText(v));});
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
  try{
    const response=await fetch(url.toString(),{method:'GET',headers:{Accept:'application/json'},signal:ctrl.signal});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    if(!data||typeof data!=='object')throw new Error('來源回傳格式無效');
    return data;
  }finally{clearTimeout(timer);}
}
function makeQuery(){
  const q=$('searchQuery').value.trim();
  const mode=$('searchMode').value;
  if(mode!=='latest'&&mode!=='archive'&&!q){$('searchQuery').focus();toast('請輸入關鍵字、公司或機關名稱。');return null;}
  if(mode==='companyId'&&!/^\d{8}$/.test(q)){toast('統編搜尋請輸入 8 碼數字。');return null;}
  return {mode,query:q};
}
async function search(mode,query='',sourcePage=1){
  const token=++state.running;
  state.mode=mode;state.query=query;state.sourcePage=sourcePage;state.clientPage=1;
  $('searchMode').value=mode;$('searchQuery').value=query;
  $('resultList').replaceChildren(E('div','empty','正在讀取公開標案…'));
  $('dataError').hidden=true;
  $('resultsHeading').textContent=listModes[mode]||'搜尋結果';
  $('resultInfo').textContent='從 OpenFun API 讀取中；不使用模擬案件';
  setStatus('正在連線公開 API');
  try{
    let data;
    if(mode==='archive'){
      data=await fetchArchive({page:sourcePage,search:query});
      state.totalPages=Math.max(1,Number(data.total_pages||1));
      state.lastSearch='Supabase 已收錄資料庫'+(query?'：'+query:'');
    }else if(mode==='latest'){
      if(!state.date) {
        const info=await api('/getinfo');
        const raw=asText(info['最新資料時間']);
        if(!/^\d{4}-\d{2}-\d{2}/.test(raw))throw new Error('來源未提供最新公告日期');
        state.date=raw.slice(0,10).replaceAll('-','');
      }
      data=await api('/listbydate',{date:state.date},35000);
      state.totalPages=1;
      state.lastSearch='最新公告 '+dateLabel(state.date);
    }else if(mode==='agency'){
      data=await api('/listbyunit',{unit_name:query,limit:100,page:sourcePage},35000);
      state.totalPages=Math.max(1,Number(data.total_page||1));
      state.lastSearch='機關名稱 '+query;
    }else{
      const route=mode==='title'?'/searchbytitle':mode==='vendor'?'/searchbycompanyname':'/searchbycompanyid';
      data=await api(route,{query,page:sourcePage},35000);
      state.totalPages=Math.max(1,Number(data.total_pages||1));
      state.lastSearch=(listModes[mode]||'搜尋')+'：'+query;
    }
    if(token!==state.running)return;
    const records=Array.isArray(data.records)?data.records:[];
    state.rows=records.map(normalize).filter(Boolean);
    renderSearch();
    setStatus('來源連線正常 · '+new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()),'success');
  }catch(err){
    if(token!==state.running)return;
    state.rows=[];state.searchRows=[];state.totalPages=1;
    renderSearch();
    const box=$('dataError');
    box.textContent='真實資料讀取失敗：'+readableError(err)+' 可稍後重新查詢。';
    box.hidden=false;setStatus('資料來源連線失敗','failure');
  }
}
function searchLocally(){
  state.searchRows=filtered(dedupe(state.rows),{
    group:$('groupFilter').value,status:$('statusFilter').value,
    minBudget:$('budgetFilter').value,sort:$('sortFilter').value
  });
}
function renderSearch(){
  searchLocally();
  const rows=state.searchRows;
  $('metricLoaded').textContent=state.rows.length.toLocaleString('zh-TW');
  $('metricCases').textContent=dedupe(state.rows).length.toLocaleString('zh-TW');
  $('metricOpen').textContent=state.rows.filter(r=>r.status==='招標').length.toLocaleString('zh-TW');
  $('metricSaved').textContent=Object.keys(store.saved).length.toLocaleString('zh-TW');
  $('trackingCount').textContent=Object.keys(store.saved).length;
  const localPages=Math.max(1,Math.ceil(rows.length/20));
  state.clientPage=Math.min(state.clientPage,localPages);
  $('resultInfo').textContent=state.lastSearch+'｜本次 API '+state.rows.length+' 筆公告，去重並篩選後 '+rows.length+' 件（頁內篩選，不代表全國總數）';
  const subset=rows.slice((state.clientPage-1)*20,state.clientPage*20);
  $('resultList').replaceChildren(...(subset.length?subset.map(r=>caseCard(r)): [E('div','empty',state.rows.length?'沒有符合本頁篩選條件的案件，請放寬篩選。':'此查詢無資料，或資料來源暫時無法回傳。')]));
  $('pageInfo').textContent='來源第 '+state.sourcePage+'/'+state.totalPages+' 頁 · 這批第 '+state.clientPage+'/'+localPages+' 頁';
  $('prevPage').disabled=state.sourcePage===1&&state.clientPage===1;
  $('nextPage').disabled=state.sourcePage>=state.totalPages&&state.clientPage>=localPages;
}
function nextPage(direction){
  const localPages=Math.max(1,Math.ceil(state.searchRows.length/20));
  if(direction>0){
    if(state.clientPage<localPages){state.clientPage++;renderSearch();return;}
    if(state.mode==='latest'||state.sourcePage>=state.totalPages)return;
    search(state.mode,state.query,state.sourcePage+1);
  }else{
    if(state.clientPage>1){state.clientPage--;renderSearch();return;}
    if(state.mode!=='latest'&&state.sourcePage>1)search(state.mode,state.query,state.sourcePage-1).then(()=>{state.clientPage=Math.max(1,Math.ceil(state.searchRows.length/20));renderSearch();});
  }
}
function caseCard(row,{radarScore=null}={}){
  const card=E('article','case-card');
  const left=E('div','case-left'),right=E('div','case-right');
  child(left,btn(row.title,'case-title',()=>openDetail(row)));
  const m=E('div','case-meta');
  const tag=E('span','case-tag'+(row.status==='決標'?' awarded':row.status==='無法決標'?' failed':row.status==='更正'?' amended':''),row.status);
  child(m,tag,E('span','',row.agency||'機關未公開'),E('span','','·'),E('span','',row.group));
  if(row.job_number)child(m,E('span','', '· 案號 '+row.job_number));
  const second=E('div','case-meta');
  child(second,E('span','','公告 '+dateLabel(row.date)),E('span','','· '+(row.noticeType||'類型未公開')));
  if(radarScore!==null)child(second,E('span','case-tag','關鍵字匹配 '+radarScore+' 項'));
  child(left,m,second);
  const amount=E('div','');
  child(amount,E('small','','公開預算'),E('strong','',formatMoney(row.budget)));
  const favorite=btn(store.saved[row.id]?'★':'☆','favorite-btn'+(store.saved[row.id]?' saved':''),()=>toggleSaved(row));
  favorite.setAttribute('aria-label',store.saved[row.id]?'移除追蹤':'加入追蹤');
  child(right,amount,favorite);child(card,left,right);
  return card;
}
function toggleSaved(row){
  if(store.saved[row.id])delete store.saved[row.id];
  else store.saved[row.id]={
    id:row.id,unit_id:row.unit_id,job_number:row.job_number,
    title:row.title,agency:row.agency,date:row.date,
    budget:row.budget,stage:'評估中',notes:'',due:'',added_at:new Date().toISOString()
  };
  persist();if(cloud.user)void cloudSaveSingle(row,!!store.saved[row.id]);renderSearch();renderTracking();renderRadar();toast(store.saved[row.id]?'已加入投標工作台':'已從投標工作台移除');
}
function buildDetailCell(label,value){
  const box=E('div','');child(box,E('small','',label),E('strong','',value===null||value===undefined||value===''?'未公開':value));return box;
}
async function openDetail(row){
  state.selected=row;$('backdrop').hidden=false;$('detailDrawer').hidden=false;
  document.body.style.overflow='hidden';$('detailContent').replaceChildren(E('div','empty','正在讀取此案全部公告歷史及官方來源…'));
  try{
    const data=state.details.has(row.id)?state.details.get(row.id):await api('/tender',{unit_id:row.unit_id,job_number:row.job_number},35000);
    if(state.selected!==row)return;
    if(!Array.isArray(data.records))throw new Error('此案未回傳公告紀錄');
    state.details.set(row.id,data);
    renderDetail(row,data);renderAnalytics();
  }catch(err){
    $('detailContent').replaceChildren(E('div','empty','案件詳情載入失敗：'+readableError(err)));
  }
}
function renderDetail(row,data){
  const sum=summaryOf(data.records);const info=sum.fields;
  const page=$('detailContent');page.replaceChildren();
  child(page,E('div','eyebrow','政府公開採購案件 · '+row.job_number),E('h2','',row.title),E('p','drawer-subtitle',data.unit_name||row.agency||'機關未公開'));
  const tags=E('div','detail-pills');
  child(tags,E('span','case-tag',sum.status),E('span','case-tag','公告共 '+sum.notices.length+' 次'),E('span','case-tag',row.group));
  if(sum.hasDeadline){
    const remaining=compareDeadline(sum.deadlineRaw);
    child(tags,E('span','case-tag'+(remaining!==null&&remaining<0?' failed':''),remaining!==null&&remaining>=0?'距截止約 '+remaining+' 天':'已過公告截止時間'));
  }
  page.append(tags);
  const actions=E('div','detail-actions');
  child(actions,btn(store.saved[row.id]?'移除追蹤':'加入投標追蹤','primary-btn',()=>{
    toggleSaved(row);const b=actions.firstChild;b.textContent=store.saved[row.id]?'移除追蹤':'加入投標追蹤';
  }),btn('機關統計','ghost-btn',()=>{
    closeDetail();$('agencyId').value=row.unit_id;showView('agencies');loadAgency(row.unit_id);
  }));
  const apiLink='https://pcc-api.openfun.app/api/tender?'+new URLSearchParams({unit_id:row.unit_id,job_number:row.job_number}).toString();
  child(actions,link('資料 API ↗',apiLink));if(sum.latestFields.url||info.url)child(actions,link('官方原始公告 ↗',sum.latestFields.url||info.url));
  page.append(actions);
  const grid=E('div','detail-grid');
  const latest=sum.latest||row,latestInfo=fieldsOf(latest.detail);
  const awardRecord=sum.notices.find(r=>r.award_amount!==null&&r.award_amount!==undefined);
  const budgetRecord=sum.notices.find(r=>r.budget_amount!==null&&r.budget_amount!==undefined);
  const budget=safeNumber(budgetRecord?.budget_amount ?? row.budget);
  const award=safeNumber(awardRecord?.award_amount ?? row.award);
  const items=[
    ['機關代碼',row.unit_id],['採購案號',row.job_number],
    ['預算',formatMoney(budget)],['決標金額',formatMoney(award)],
    ['公告截止投標',sum.hasDeadline?dateLabel(sum.deadlineRaw):'未公開'],
    ['開標時間',info.opening?dateLabel(info.opening):'未公開'],
    ['履約地點',info.location],['履約期限',info.period],
    ['招標方式',info.tenderMethod],['決標方式',info.decisionMethod||latestInfo.decisionMethod],
    ['押標金',info.deposit],['機關聯絡人',info.contact],['機關電話',info.phone]
  ];
  for(const [k,v] of items)grid.append(buildDetailCell(k,v));
  page.append(grid);
  if(sum.hasDeadline && award===null && sum.isOpen){
    page.append(E('p','notice','此案最新可辨識招標公告的截止日尚未到，請再到官方原始公告確認是否有後續更正。'));
  }
  if(info.qualification){
    child(page,E('h3','','公告資格要求（原文摘錄）'),E('p','',asText(info.qualification).slice(0,1400)));
  }
  child(page,E('h3','','公告歷程與官方來源'));
  const timeline=E('div','detail-timeline');
  for(const rec of sum.notices){
    const item=E('div','timeline-item');
    child(item,E('strong','',dateLabel(rec.date)+' · '+typeOf(rec)),E('span','minor',asText(rec.filename||'')));
    const url=safeOfficial(rec.detail?.url);
    if(url)child(item,E('div','', ''),link('開啟官方公告 ↗',url));
    timeline.append(item);
  }
  page.append(timeline);
  const companyMap=new Map();
  for(const rec of sum.notices){
    const companies=rec.brief?.companies;
    for(const name of companies?.names||[]){
      const roles=companies?.name_key?.[name]||[];
      const key=name+'|'+asText(rec.date);
      if(!companyMap.has(key))companyMap.set(key,{name,roles,date:rec.date});
    }
  }
  if(companyMap.size){
    child(page,E('h3','','公告出現的廠商（僅已公開資料）'));
    const supplierList=E('div','detail-timeline');
    for(const company of [...companyMap.values()].slice(0,45)){
      const wrap=E('div','timeline-item');
      child(wrap,btn(company.name,'case-title',()=>{
        closeDetail();$('vendorMode').value='name';$('vendorQuery').value=company.name;showView('vendors');loadVendors('name',company.name);
      }),E('div','minor',dateLabel(company.date)+'｜'+(company.roles.join('、')||'公告相關廠商')));
      supplierList.append(wrap);
    }
    page.append(supplierList);
  }
  child(page,E('h3','','最新公告原始欄位'));
  const table=E('table','raw-fields');
  const latestDetail=latest?.detail&&typeof latest.detail==='object'?latest.detail:{};
  for(const [k,v] of Object.entries(latestDetail)){
    if(k==='url'||k==='pkPmsMain'||k.endsWith(':remind'))continue;
    if(v===null||v===undefined||typeof v==='object')continue;
    const tr=E('tr','');child(tr,E('td','',k),E('td','',asText(v).slice(0,1200)));table.append(tr);
  }
  page.append(table);
  page.append(E('p','detail-source','資料來源：OpenFun 政府採購公告 API；官方公告網址以每一筆公告的 detail.url 為準。缺漏欄位不做推測。'));
}
function closeDetail(){
  state.selected=null;$('detailDrawer').hidden=true;$('backdrop').hidden=true;document.body.style.overflow='';
}
function renderRadar(){
  const p=store.profile;
  $('profileKeywords').value=p.keywords||'';
  $('profileExcludes').value=p.excludes||'';
  $('profileMin').value=p.min||'';
  $('profileMax').value=p.max||'';
  $('profileArea').value=p.area||'';
  const output=$('radarResults');output.replaceChildren();
  if(!asText(p.keywords).trim()){output.append(E('div','empty','先設定你的主要業務關鍵字，再查詢真實標案即可顯示符合的案件。'));return;}
  const scored=dedupe(state.rows).map(row=>({row,score:scoreCase(row,p)})).filter(x=>x.score.qualifies).sort((a,b)=>b.score.matched-a.score.matched||Number(b.row.date||0)-Number(a.row.date||0));
  if(!scored.length){output.append(E('div','empty','這一批已載入標案沒有命中設定的關鍵字。換個關鍵字再搜尋，或放寬排除條件。'));return;}
  for(const x of scored.slice(0,50)){
    const shell=E('div','');
    shell.append(caseCard(x.row,{radarScore:x.score.matched}));
    const reason=E('div','minor','符合：'+x.score.reasons.join('；')+(x.score.warnings.length?'｜待確認：'+x.score.warnings.join('；'):''));
    reason.style.padding='0 16px 7px';
    child(shell,reason);output.append(shell);
  }
}
async function loadAgency(id){
  $('agencyId').value=id;
  const out=$('agencyOutput');out.replaceChildren(E('div','empty','正在讀取機關年度統計…'));
  try{
    const d=await api('/unitstat',{unit_id:id,top:20},35000);
    out.replaceChildren(E('h2','',d.unit_name||id));
    const years=Array.isArray(d.years)?d.years:[];
    if(!years.length){out.append(E('div','empty','此機關無可公開的年度統計。'));return;}
    const metrics=E('div','stat-row');
    const totalAwards=years.reduce((a,r)=>a+Number(r.awards||0),0),total=years.reduce((a,r)=>a+Number(r.award_amount||0),0);
    for(const [key,val] of [['統計年度',years.length+' 年'],['決標筆數',totalAwards.toLocaleString('zh-TW')],['公開決標金額',formatMoney(total)]]){
      const b=E('div','stat-compact');child(b,E('span','',key),E('b','',val));metrics.append(b);
    }
    out.append(metrics);
    const table=E('table','analysis-list'),head=E('tr','');
    for(const x of ['年度','採購案件','公告筆數','決標件數','決標總額','金額未知件數'])head.append(E('th','',x));
    table.append(head);
    for(const y of [...years].sort((a,b)=>b.year-a.year)){
      const tr=E('tr','');
      for(const val of [y.year,y.tenders,y.announcements,y.awards,formatMoney(y.award_amount),y.award_amount_unknown])tr.append(E('td','',val));
      table.append(tr);
    }
    child(out,E('h3','','年度統計'),table,E('h3','','主要得標廠商'));
    const winnerTable=E('table','analysis-list');
    for(const w of d.winners||[]){
      const tr=E('tr','');
      const cell=E('td','');cell.append(btn(w.company_name||'未提供名稱','case-title',()=>{
        $('vendorMode').value=w.company_id?'id':'name';
        $('vendorQuery').value=w.company_id||w.company_name;
        showView('vendors');loadVendors(w.company_id?'id':'name',$('vendorQuery').value);
      }));
      child(tr,cell,E('td','',String(w.awards||0)+' 件'),E('td','',formatMoney(w.amount)));winnerTable.append(tr);
    }
    out.append(winnerTable);
    out.append(E('p','minor','官方公告數和採購案件數口徑不同。統計計算時間：'+asText(d.computed_at||'未提供')+'。資料為 OpenFun API 返回的公開統計。'));
  }catch(err){out.replaceChildren(E('div','empty','機關統計失敗：'+readableError(err)));}
}
async function loadVendors(mode,q){
  const out=$('vendorOutput');out.replaceChildren(E('div','empty','正在查詢與此廠商有關的公告…'));
  $('vendorSummary').textContent='載入中';
  try{
    const data=await api(mode==='id'?'/searchbycompanyid':'/searchbycompanyname',{query:q,page:1},35000);
    state.vendorRows=dedupe(data.records||[]);
    $('vendorSummary').textContent='來源返回 '+asText(data.total_records??state.vendorRows.length)+' 筆公告；本次載入去重 '+state.vendorRows.length+' 件（第一頁）';
    renderVendorRows();
  }catch(err){state.vendorRows=[];out.replaceChildren(E('div','empty','廠商資料查詢失敗：'+readableError(err)));$('vendorSummary').textContent='查詢失敗';}
}
function renderVendorRows(){
  const out=$('vendorOutput');
  out.replaceChildren(...(state.vendorRows.length?state.vendorRows.slice(0,80).map(r=>caseCard(r)):[E('div','empty','找不到此廠商的公開相關公告。')]));
}
function renderAnalytics(){
  const rows=dedupe(state.rows);
  const sampleMap=new Map();
  function mergeSample(r){
    if(!r?.unit_id||!r?.job_number)return;
    const key=keyOf(r),old=sampleMap.get(key)||{title:'',budget:null,award:null};
    const b=safeNumber(r.budget_amount??r.budget),a=safeNumber(r.award_amount??r.award);
    if(b!==null)old.budget=b;
    if(a!==null)old.award=a;
    old.title=r.brief?.title||r.title||old.title;
    sampleMap.set(key,old);
  }
  for(const r of rows)mergeSample(r);
  for(const d of state.details.values())for(const r of d.records||[])mergeSample(r);
  const records=[...sampleMap.values()];
  const stats=ratioStats(records);
  const el=$('analyticsOutput');el.replaceChildren(E('h2','','決標／預算比'));
  const box=E('div','stat-row');
  for(const [label,val] of [['有效可比樣本',stats.count+' 筆'],['中位數',stats.median===null?'資料不足':(stats.median*100).toFixed(1)+'%'],['中間 50% 區間',stats.q1===null?'資料不足':(stats.q1*100).toFixed(1)+'% – '+(stats.q3*100).toFixed(1)+'%']]){
    const c=E('div','stat-compact');child(c,E('span','',label),E('b','',val));box.append(c);
  }
  el.append(box);
  if(stats.count<5){
    el.append(E('p','notice warning','目前有效樣本不足 5 筆，請打開幾筆決標公告詳情，或搜尋特定機關及廠商。部分 API 搜尋摘要不含金額，不能用空值推算行情。'));
  }
  const dist=records.map(r=>{const a=safeNumber(r.award),b=safeNumber(r.budget);return a===null||b===null||b===0?null:{ratio:a/b,name:r.title||'',a,b};}).filter(Boolean).slice(0,30);
  if(dist.length){
    child(el,E('h3','','可計算樣本（最多展示 30 筆）'));
    const tb=E('table','analysis-list'),h=E('tr','');
    for(const v of ['標案名稱','決標金額','預算','決標比'])h.append(E('th','',v));
    tb.append(h);
    for(const s of dist){
      const tr=E('tr','');child(tr,E('td','',s.name),E('td','',formatMoney(s.a)),E('td','',formatMoney(s.b)),E('td','',(s.ratio*100).toFixed(1)+'%'));tb.append(tr);
    }
    el.append(tb);
  }
  el.append(E('p','minor','資料範圍：當前查詢結果 + 本次已打開的案件詳情。已依機關代碼與案號去重，但不同決標方式與合約口徑仍需人工確認；僅適合初步探索，不能直接作全國平均或報價建議。'));
}
function renderTracking(){
  const out=$('trackingOutput');out.replaceChildren();
  const items=Object.values(store.saved);
  $('trackingCount').textContent=items.length;$('metricSaved').textContent=items.length;renderTaskSelector();
  if(!items.length){out.append(E('div','empty','目前沒有追蹤案件。到「標案搜尋」點星號，即可加入工作台。'));return;}
  for(const item of items.sort((a,b)=>asText(b.added_at).localeCompare(asText(a.added_at)))){
    const card=E('section','track-card');
    child(card,btn(item.title,'case-title',()=>openDetail(item)),E('div','minor',item.agency||'機關未公開'));
    const f=E('div','track-fields');
    const stageL=E('label','','投標階段'),select=E('select','');
    for(const stage of states){const opt=E('option','',stage);opt.value=stage;select.append(opt);}
    select.value=item.stage||'評估中';
    select.addEventListener('change',()=>{item.stage=select.value;persist();if(cloud.user)void cloudSaveSingle(item,true);toast('已保存投標階段');});
    stageL.append(select);
    const dateL=E('label','','我的內部截止日'),input=E('input','');input.type='date';input.value=item.due||'';
    input.addEventListener('change',()=>{item.due=input.value;persist();if(cloud.user)void cloudSaveSingle(item,true);});
    dateL.append(input);
    const notesL=E('label','','備註／待辦'),area=E('textarea','');
    area.value=item.notes||'';area.placeholder='例如：聯絡產品部提供設備規格、準備公司證照';
    area.addEventListener('change',()=>{item.notes=area.value.slice(0,4000);persist();if(cloud.user)void cloudSaveSingle(item,true);});
    notesL.append(area);child(f,stageL,dateL,notesL);
    const acts=E('div','track-actions');
    child(acts,btn('打開公告詳情','ghost-btn',()=>openDetail(item)),btn('移除','ghost-btn',()=>{
      delete store.saved[item.id];persist();if(cloud.user)void cloudSaveSingle(item,false);renderTracking();renderSearch();toast('已移除追蹤');
    }));
    child(card,f,acts);out.append(card);
  }
}
function download(content,name,type){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),6000);
}
function exportRows(rows,name){
  const header=['公告日','類型','標案名稱','機關','機關代碼','案號','採購類別','預算金額（元）','決標金額（元）','公告資料 API'];
  const csv=[header,...rows.map(r=>[dateLabel(r.date),r.noticeType,r.title,r.agency,r.unit_id,r.job_number,r.category,r.budget??'',r.award??'',API_ROOT+'/tender?'+new URLSearchParams({unit_id:r.unit_id,job_number:r.job_number}).toString()])].map(r=>r.map(csvEscape).join(',')).join('\r\n');
  download('\uFEFF'+csv,name,'text/csv;charset=utf-8');
}
function exportSearchCsv(){
  if(!state.searchRows.length){toast('目前沒有可匯出的標案。');return;}
  exportRows(state.searchRows,'標案查詢-'+new Date().toISOString().slice(0,10)+'.csv');
}
function exportRSS(){
  if(!state.searchRows.length){toast('目前沒有可以匯出的結果。');return;}
  const esc=s=>asText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const items=state.searchRows.slice(0,150).map(r=>'<item><title>'+esc(r.title)+'</title><description>'+esc(r.agency+' / '+r.noticeType)+'</description><guid isPermaLink="false">'+esc(r.id+'-'+r.date)+'</guid><link>'+esc(API_ROOT+'/tender?'+new URLSearchParams({unit_id:r.unit_id,job_number:r.job_number}).toString())+'</link></item>').join('');
  download('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>標案情報中心：本次查詢匯出</title><description>靜態查詢結果，非持續更新訂閱</description><link>https://pcc-api.openfun.app/</link>'+items+'</channel></rss>','標案查詢快照.rss','application/rss+xml;charset=utf-8');
  toast('已下載這批結果的 RSS 靜態檔；這不是即時 RSS 訂閱網址。');
}
function trackingCSV(){
  const items=Object.values(store.saved);
  if(!items.length){toast('沒有已追蹤標案');return;}
  const arr=[['標案','機關','機關代碼','案號','階段','內部截止','備註'],...items.map(x=>[x.title,x.agency,x.unit_id,x.job_number,x.stage,x.due,x.notes])];
  download('\uFEFF'+arr.map(r=>r.map(csvEscape).join(',')).join('\r\n'),'投標工作台.csv','text/csv;charset=utf-8');
}
function trackingICS(){
  const selected=Object.values(store.saved).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.due||''));
  if(!selected.length){toast('請先在工作台填寫至少一筆內部截止日。');return;}
  const safe=s=>asText(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OpenData Tender Lab//ZH-TW','CALSCALE:GREGORIAN'];
  for(const item of selected){
    const ymd=item.due.replaceAll('-','');
    const next=new Date(item.due+'T12:00:00+08:00');next.setUTCDate(next.getUTCDate()+1);
    const iso=next.toISOString().slice(0,10).replaceAll('-','');
    lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(item.id)+'@opendata-tender','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),'DTSTART;VALUE=DATE:'+ymd,'DTEND;VALUE=DATE:'+iso,'SUMMARY:'+safe('內部投標截止：'+item.title),'DESCRIPTION:'+safe(item.notes||item.stage||''),'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download(lines.filter(Boolean).join('\r\n')+'\r\n','投標內部日曆.ics','text/calendar;charset=utf-8');
}
function trackingBackup(){
  const value={schema:2,exported_at:new Date().toISOString(),saved:store.saved,profile:store.profile,watches:store.watches};
  download(JSON.stringify(value,null,2),'標案工作台備份.json','application/json;charset=utf-8');
}
async function trackingImport(file){
  if(!file)return;
  try{
    if(file.size>3000000)throw Error('備份檔超過 3MB');
    const d=JSON.parse(await file.text());
    if(!d||typeof d.saved!=='object'||Array.isArray(d.saved))throw Error('備份格式不正確');
    let count=0;
    for(const x of Object.values(d.saved)){
      if(!x||!asText(x.unit_id)||!asText(x.job_number)||!asText(x.title))continue;
      const id=asText(x.unit_id)+'::'+asText(x.job_number);
      store.saved[id]={id,unit_id:asText(x.unit_id).slice(0,100),job_number:asText(x.job_number).slice(0,100),title:asText(x.title).slice(0,500),agency:asText(x.agency).slice(0,300),date:x.date,stage:states.includes(x.stage)?x.stage:'評估中',notes:asText(x.notes).slice(0,4000),due:/^\d{4}-\d{2}-\d{2}$/.test(asText(x.due))?x.due:'',added_at:asText(x.added_at)};
      count++;
      if(count>=1000)break;
    }
    persist();renderTracking();toast('匯入 '+count+' 筆追蹤紀錄。');
  }catch(err){toast('備份匯入失敗：'+readableError(err));}
}
function renderWatches(){
  const out=$('watchOutput');out.replaceChildren();
  if(!store.watches.length){out.append(E('div','empty','尚未新增監控條件。先新增關鍵字，再手動檢查。'));return;}
  for(const rule of store.watches){
    const block=E('section','watch-item'),head=E('header','');
    child(head,E('h3','','關鍵字：'+rule.term),btn('刪除','ghost-btn',()=>{
      store.watches=store.watches.filter(x=>x.id!==rule.id);persist();renderWatches();if(cloud.user&&rule.serverId)void cloudDeleteWatch(rule.serverId);
    }));block.append(head);
    block.append(E('p','','上次檢查：'+(rule.checkedAt?new Date(rule.checkedAt).toLocaleString('zh-TW'):'尚未檢查')+'｜'+(rule.initialized?'已建立比對基準':'第一次檢查會建立基準，不把舊公告當作新通知')));
    const arr=Array.isArray(rule.newHits)?rule.newHits:[];
    if(arr.length){
      const ul=E('ul','');
      for(const r of arr.slice(0,8)){
        const li=E('li','');
        li.append(btn(r.title,'case-title',()=>openDetail(r)));ul.append(li);
      }
      block.append(ul);
    }else block.append(E('div','minor',rule.initialized?'沒有新的命中公告':'尚無監控結果'));
    out.append(block);
  }
}
async function checkWatches(){
  if(state.watchRunning || !store.watches.length){if(!store.watches.length)toast('請先新增至少一條監控規則。');return;}
  state.watchRunning=true;$('checkWatch').disabled=true;let totalNew=0,failed=0;
  try{
    for(const rule of store.watches){
      try{
        const d=await api('/searchbytitle',{query:rule.term,page:1},25000);
        const items=Array.isArray(d.records)?d.records.map(normalize).filter(Boolean):[];
        const keys=items.map(r=>r.id+':'+r.date+':'+r.filename);
        const old=new Set(Array.isArray(rule.seen)?rule.seen:[]);
        const fresh=rule.initialized?items.filter(r=>!old.has(r.id+':'+r.date+':'+r.filename)):[];
        rule.newHits=fresh.slice(0,10).map(r=>({id:r.id,unit_id:r.unit_id,job_number:r.job_number,title:r.title,agency:r.agency,date:r.date,filename:r.filename}));
        rule.seen=[...new Set([...keys,...old])].slice(0,900);
        rule.initialized=true;rule.checkedAt=new Date().toISOString();totalNew+=fresh.length;
        if(fresh.length && typeof Notification!=='undefined' && Notification.permission==='granted'){
          new Notification('標案監控：'+rule.term,{body:'找到 '+fresh.length+' 筆新公告／新版本。請開啟監控頁查看。'});
        }
      }catch{failed++;}
    }
    $('watchCheckedAt').textContent='最近檢查：'+new Date().toLocaleString('zh-TW');
    persist();renderWatches();toast(failed?'檢查完成；'+failed+' 條因資料來源錯誤未能更新。':'檢查完成，新增 '+totalNew+' 筆命中公告／版本。');
  }finally{state.watchRunning=false;$('checkWatch').disabled=false;}
}
function showDocumentRows(){
  const out=$('documentOutput');out.replaceChildren();
  if(!state.docRows.length){out.append(E('div','empty','無法找到符合預設關鍵字的明確條款。請人工閱讀完整標書。'));return;}
  const groups=['資格／證明','日期／截止','金額／保證金','評選／審查','履約／驗收','附件／文件'];
  for(const group of groups){
    const rows=state.docRows.filter(x=>x.group===group);
    if(!rows.length)continue;
    child(out,E('h3','',group+'（'+rows.length+'）'));
    for(const r of rows){
      const box=E('div','timeline-item');
      child(box,E('strong','',r.source),E('div','',r.text));out.append(box);
    }
  }
  out.append(E('p','minor','此結果僅為全文關鍵字規則選取，未執行法律或資格判定；請以正式文件和公告為準。'));
}
function loadLibrary(url,globalName){
  return new Promise((resolve,reject)=>{
    if(window[globalName])return resolve(window[globalName]);
    const script=document.createElement('script');
    script.src=url;script.async=true;
    script.onload=()=>window[globalName]?resolve(window[globalName]):reject(Error('元件載入但找不到解析器'));
    script.onerror=()=>reject(Error('外部文件解析元件下載失敗'));
    document.head.append(script);
  });
}
async function parseDocument(file){
  const name=file.name.toLocaleLowerCase('zh-TW'),output=[];
  if(name.endsWith('.pdf')){
    const pdfjs=await loadLibrary('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    const limit=Math.min(pdf.numPages,150);
    for(let i=1;i<=limit;i++){
      const page=await pdf.getPage(i),txt=await page.getTextContent();
      output.push({source:'第 '+i+' 頁',text:txt.items.map(x=>asText(x.str)).join(' ')});
    }
    if(pdf.numPages>limit)toast('PDF 僅處理前 '+limit+' 頁；長文件請另行核對。');
  }else if(name.endsWith('.docx')){
    const mammoth=await loadLibrary('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js','mammoth');
    const r=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
    output.push({source:'DOCX 段落（無精確頁碼）',text:r.value||''});
  }else if(name.endsWith('.txt')||name.endsWith('.md')){
    output.push({source:'文字檔（無頁碼）',text:await file.text()});
  }else throw Error('請使用 TXT、MD、PDF 或 DOCX');
  return output;
}
const terms=[
  ['資格／證明',/資格|證明文件|公司登記|登記證|實績|證照|營業項目/],
  ['日期／截止',/截止|開標|領標|投標時間|投標期限|收件時間/],
  ['金額／保證金',/押標金|履約保證金|付款|違約金|預算|費用|總價/],
  ['評選／審查',/評選|配分|評分|最有利標|評審|審查標準/],
  ['履約／驗收',/履約|交貨|驗收|保固|交付|維護期間/],
  ['附件／文件',/附件|文件|份數|格式|計畫書|服務建議書|規格書/]
];
async function analyzeDocument(){
  const file=$('documentFile').files?.[0];if(!file){toast('請先選擇文件。');return;}
  if(file.size>15*1024*1024){toast('檔案上限 15 MB。');return;}
  const trigger=$('documentAnalyze');trigger.disabled=true;
  $('documentOutput').replaceChildren(E('div','empty','正在本機擷取文件文字並分類條款…'));
  try{
    const pages=await parseDocument(file);
    state.docPages=pages;
    const hits=[];
    for(const page of pages){
      const paragraphs=page.text.replace(/\r/g,'\n').split(/[\n。；;]+/).map(s=>s.trim().replace(/\s+/g,' ')).filter(s=>s.length>=8);
      for(const line of paragraphs){
        for(const [group,regex] of terms){
          if(regex.test(line)&&hits.filter(x=>x.group===group).length<12){
            hits.push({group,source:page.source,text:line.slice(0,650)});
          }
        }
      }
    }
    state.docRows=hits;
    showDocumentRows();
    toast(hits.length?'完成：從 '+pages.length+' 個文字區段擷取 '+hits.length+' 段候選條款。':'未找到關鍵條款；可能是掃描影像或格式無法解析。');
  }catch(err){state.docRows=[];$('documentOutput').replaceChildren(E('div','empty','解析失敗：'+readableError(err)));}
  finally{trigger.disabled=false;}
}
function exportDoc(){
  if(!state.docRows.length){toast('尚無可匯出的條款。');return;}
  const rows=[['類型','來源','原文片段','已確認（人工填寫）'],...state.docRows.map(r=>[r.group,r.source,r.text,''])];
  download('\uFEFF'+rows.map(r=>r.map(csvEscape).join(',')).join('\r\n'),'標單條款檢核清單.csv','text/csv;charset=utf-8');
}
function hook(){
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('mobileMenu').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('mobile-open'));
  $('searchForm').addEventListener('submit',e=>{e.preventDefault();const s=makeQuery();if(s)search(s.mode,s.query,1);});
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{
    const x=b.dataset.preset;
    if(x==='latest'){$('searchMode').value='latest';$('searchQuery').value='';search('latest');}
    else{$('searchMode').value='title';$('searchQuery').value=x;search('title',x);}
    showView('search');
  }));
  for(const id of ['statusFilter','groupFilter','budgetFilter','sortFilter']){
    $(id).addEventListener(id==='budgetFilter'?'input':'change',()=>{state.clientPage=1;renderSearch();});
  }
  $('prevPage').addEventListener('click',()=>nextPage(-1));
  $('nextPage').addEventListener('click',()=>nextPage(1));
  $('exportCsv').addEventListener('click',exportSearchCsv);
  $('exportRss').addEventListener('click',exportRSS);
  $('reloadBtn').addEventListener('click',()=>search(state.mode,state.query,state.sourcePage));
  $('backdrop').addEventListener('click',closeDetail);$('closeDetail').addEventListener('click',closeDetail);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('detailDrawer').hidden)closeDetail();});
  $('profileForm').addEventListener('submit',e=>{
    e.preventDefault();store.profile={keywords:$('profileKeywords').value.trim().slice(0,500),excludes:$('profileExcludes').value.trim().slice(0,500),min:$('profileMin').value,max:$('profileMax').value,area:$('profileArea').value.trim().slice(0,100)};
    persist();if(cloud.user)void cloudSaveProfile();renderRadar();toast('已儲存商機條件'+(cloud.user?'並送出雲端同步':'（本機）')+'。');
  });
  $('radarGoSearch').addEventListener('click',()=>showView('search'));
  $('agencyForm').addEventListener('submit',e=>{e.preventDefault();const id=$('agencyId').value.trim();if(id)loadAgency(id);});
  $('vendorForm').addEventListener('submit',e=>{e.preventDefault();const q=$('vendorQuery').value.trim();const mode=$('vendorMode').value;if(q)loadVendors(mode,q);});
  $('trackingCsv').addEventListener('click',trackingCSV);
  $('trackingIcs').addEventListener('click',trackingICS);
  $('trackingBackup').addEventListener('click',trackingBackup);
  $('trackingImport').addEventListener('click',()=>$('trackingImportFile').click());
  $('trackingImportFile').addEventListener('change',e=>{trackingImport(e.target.files?.[0]);e.target.value='';});
  $('watchForm').addEventListener('submit',e=>{
    e.preventDefault();const term=$('watchTerm').value.trim();
    if(term.length<2){toast('監控關鍵字至少兩個字。');return;}
    if(store.watches.some(x=>x.term===term)){toast('這條規則已存在。');return;}
    store.watches.push({id:String(Date.now())+'-'+store.watches.length,term,seen:[],newHits:[],initialized:false,checkedAt:''});
    $('watchTerm').value='';persist();renderWatches();if(cloud.user)void cloudCreateWatch(term);
  });
  $('checkWatch').addEventListener('click',checkWatches);
  $('enableDesktop').addEventListener('click',async()=>{
    if(!('Notification' in window)){toast('此瀏覽器不支援系統通知。');return;}
    const result=await Notification.requestPermission();
    toast(result==='granted'?'已取得裝置通知權限。網頁開啟期間才能執行檢查。':'尚未允許裝置通知。');
  });
  $('documentAnalyze').addEventListener('click',analyzeDocument);
  $('documentAI').addEventListener('click',()=>void analyzeDocumentAI());
  $('documentCsv').addEventListener('click',exportDoc);
  $('documentFile').addEventListener('change',()=>{$('documentFileName').textContent=$('documentFile').files?.[0]?.name||'';});
}
hook();
initCloudUI();
renderTracking();
renderWatches();
renderRadar();
renderAnalytics();
search('latest','',1);
void initCloud();
setInterval(()=>{if(document.visibilityState==='visible'&&store.watches.length)checkWatches();},20*60*1000);


// === PRD: authenticated personal workspace on the actual Supabase database ===
// No paid gates; RLS enforces that only the account owner accesses personal records.
function initCloudUI(){
  $('accountButton').addEventListener('click',()=>{$('accountPanel').hidden=false;$('accountPanel').scrollIntoView({behavior:'smooth'});});
  $('closeAccount').addEventListener('click',()=>$('accountPanel').hidden=true);
  $('accountLoginForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const email=$('accountEmail').value.trim();
    if(!email)return;
    const button=e.target.querySelector('button');
    button.disabled=true;
    try{
      const sb=cloud.client||await getClient();
      const target=window.location.origin+window.location.pathname;
      const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:target,shouldCreateUser:true}});
      if(error)throw error;
      $('accountInfo').textContent='已向 '+email+' 寄送登入連結（實際送達取決於 Supabase Email 設定）。請從信箱打開連結。';
    }catch(err){$('accountInfo').textContent='寄送失敗：'+readableError(err);}
    finally{button.disabled=false;}
  });
  $('accountLogout').addEventListener('click',async()=>{
    try{const {error}=await cloud.client.auth.signOut();if(error)throw error;
      cloud.user=null;clearUserState();renderAccount();toast('已登出，本機不保留上一個帳戶的私有資料。');
    }catch(err){toast('登出失敗：'+readableError(err));}
  });
  $('accountSync').addEventListener('click',()=>void cloudHydrate());
  $('refreshInbox').addEventListener('click',()=>void renderCloudInbox());
  $('taskForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!cloud.user)return toast('請先登入才能建立跨裝置待辦。');
    const caseId=$('taskCase').value,title=$('taskTitle').value.trim(),due=$('taskDue').value;
    if(!caseId||!title)return;
    try{
      const {error}=await cloud.client.from('ti_tasks').insert({
        user_id:cloud.user.id,case_id:caseId,title,due_at:due?due+'T23:59:00+08:00':null
      });
      if(error)throw error;
      $('taskTitle').value='';$('taskDue').value='';
      await renderCloudTasks();toast('待辦已保存至雲端。');
    }catch(err){toast('建立待辦失敗：'+readableError(err));}
  });
  $('documentCloudSave').addEventListener('click',()=>void saveCloudDocument());
  initTeamUI();
}
function clearUserState(){
  for(const k of Object.keys(store.saved))delete store.saved[k];
  store.watches=[];store.profile={};
  cloud.taskRows=[];persist();renderSearch();renderTracking();renderWatches();renderRadar();
  $('cloudInbox').replaceChildren(E('div','empty','請登入查看通知。'));
  $('taskList').replaceChildren(E('div','empty','請登入查看雲端待辦。'));
  $('cloudDocuments').replaceChildren(E('div','empty','請登入查看私有文件。'));
}
function renderAccount(){
  $('accountButton').textContent=cloud.user?'帳戶：'+(cloud.user.email||'已登入'):'登入／跨裝置同步';
  $('accountLogout').hidden=!cloud.user;
  $('accountSync').hidden=!cloud.user;
  $('accountLoginForm').hidden=!!cloud.user;
  if(cloud.user)$('accountInfo').textContent='已驗證帳戶：'+cloud.user.email+'。追蹤、商機條件、監控與待辦由 Supabase 的 RLS 保護。';
}
async function initCloud(){
  try{
    cloud.client=await getClient();
    const {data,error}=await cloud.client.auth.getSession();
    if(error)throw error;
    cloud.user=data.session?.user||null;
    cloud.client.auth.onAuthStateChange((_event,session)=>{
      const next=session?.user||null;
      if(next?.id===cloud.user?.id)return;
      cloud.user=next;
      renderAccount();
      if(next)setTimeout(()=>void cloudHydrate(),0);
      else{clearUserState();}
    });
    renderAccount();
    if(cloud.user)await cloudHydrate();
    const st=await fetchSourceStatus();
    showSourceStatus(st);
  }catch(err){
    $('sourceStatus').textContent='自有資料庫狀態暫時讀取失敗：'+readableError(err)+'。公開標案搜尋仍可直接使用 OpenFun API。';
    $('accountInfo').textContent='目前無法連線登入服務：'+readableError(err);
  }
}
function showSourceStatus(st){
  const source=st.source||{},run=st.run||{};
  const done=source.last_success_at?new Date(source.last_success_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未完成';
  $('sourceStatus').textContent=
    '資料取得方式：GET API（不是自行爬取 HTML）｜來源：'+(source.provider||'OpenFun PCC')+
    '｜自有資料庫：Supabase unapiwajmgqqtdkixaab｜已收錄案件：'+(st.cases||0).toLocaleString('zh-TW')+
    '｜預定同步：每 '+(source.frequency_minutes||'?')+' 分鐘｜上次成功：'+done+
    '｜最新工作：'+(run.status||'無紀錄')+'，取得 '+(run.fetched_count||0)+' 筆公告'+
    (source.last_error?'｜最近錯誤：'+source.last_error:'')+
    '｜資料商用再利用授權：'+(source.commercial_license_status||'待查');
}
async function cloudHydrate(){
  if(!cloud.user||!cloud.client)return;
  const user=cloud.user,client=cloud.client;
  $('accountInfo').textContent='正在從 Supabase 讀取自己的追蹤／監控資料…';
  try{
    const [saved,rules,profile]=await Promise.all([
      cloudSaved(client,user),
      cloudWatches(client,user),
      client.from('ti_profiles').select('*').eq('user_id',user.id).maybeSingle()
    ]);
    if(profile.error)throw profile.error;
    if(user.id!==cloud.user?.id)return;
    const ids=new Set(saved.map(x=>x.case_id));
    const localPending=Object.values(store.saved).filter(x=>!ids.has(x.id));
    // First login migration: only missing local favorites are uploaded.
    for(const item of localPending.slice(0,100)){
      await cloudSaveSingle(item,true,true);
    }
    const fresh=localPending.reduce((acc,x)=>(acc[x.id]=x,acc),{});
    for(const s of saved){
      fresh[s.case_id]={
        id:s.case_id,unit_id:s.unit_id||s.case_id.split('::')[0],
        job_number:s.job_number||s.case_id.split('::').slice(1).join('::'),
        title:s.title||s.case_id,agency:s.agency||'',budget:s.budget_amount,
        stage:s.stage,notes:s.notes||'',due:s.internal_deadline||'',added_at:s.added_at
      };
    }
    for(const k of Object.keys(store.saved))delete store.saved[k];
    Object.assign(store.saved,fresh);
    const localRules=store.watches.filter(w=>!w.serverId && !rules.some(r=>r.keywords===w.term));
    for(const w of localRules.slice(0,20))await cloudCreateWatch(w.term,true);
    const remoteRules=await cloudWatches(client,user);
    store.watches=remoteRules.map(r=>({
      id:r.id,serverId:r.id,term:r.keywords,excludes:r.excludes,seen:[],newHits:[],initialized:true,
      checkedAt:r.last_checked_at||''
    }));
    if(profile.data){
      store.profile={
        keywords:profile.data.keywords||'',excludes:profile.data.excludes||'',
        min:profile.data.min_budget??'',max:profile.data.max_budget??'',area:profile.data.preferred_area||''
      };
    }
    persist();renderSearch();renderTracking();renderWatches();renderRadar();renderAccount();
    await Promise.all([renderCloudTasks(),renderCloudInbox(),renderCloudDocuments(),refreshWorkspaces()]);
    const pending=sessionStorage.getItem('ti_pending_invite');
    if(pending)await acceptWorkspaceInvitation(pending);
    $('accountInfo').textContent='同步完成：'+Object.keys(store.saved).length+' 筆追蹤、'+store.watches.length+' 條監控，所有資料在 Supabase 帳戶中可跨裝置存取。';
  }catch(err){
    $('accountInfo').textContent='帳戶已登入，但資料同步失敗：'+readableError(err);
    toast('雲端同步失敗：'+readableError(err));
  }
}
async function cloudSaveSingle(item,exists,silent=false){
  if(!cloud.user||!cloud.client)return;
  try{
    const user=cloud.user.id;
    if(exists){
      const payload={
        user_id:user,case_id:item.id,title:item.title||item.brief?.title||'來源未提供案名',
        agency:item.agency||item.unit_name||'',unit_id:item.unit_id,job_number:item.job_number,
        budget_amount:item.budget??item.budget_amount??null,
        stage:states.includes(item.stage)?item.stage:'評估中',
        notes:item.notes||'',internal_deadline:item.due||null,updated_at:new Date().toISOString()
      };
      const {error}=await cloud.client.from('ti_saved_cases').upsert(payload,{onConflict:'user_id,case_id'});
      if(error)throw error;
    }else{
      const {error}=await cloud.client.from('ti_saved_cases').delete().eq('user_id',user).eq('case_id',item.id);
      if(error)throw error;
    }
    if(!silent)toast('已同步到 Supabase。');
  }catch(err){toast('本機已保存，但雲端同步失敗：'+readableError(err));}
}
async function cloudSaveProfile(){
 if(!cloud.user)return;
 try{
  const p=store.profile;
  const {error}=await cloud.client.from('ti_profiles').upsert({
    user_id:cloud.user.id,keywords:p.keywords||'',excludes:p.excludes||'',
    min_budget:p.min===''?null:safeNumber(p.min),
    max_budget:p.max===''?null:safeNumber(p.max),
    preferred_area:p.area||null,updated_at:new Date().toISOString()
  },{onConflict:'user_id'});
  if(error)throw error;
 }catch(err){toast('個人商機條件雲端同步失敗：'+readableError(err));}
}
async function cloudCreateWatch(term,silent=false){
 if(!cloud.user)return;
 try{
  const {data,error}=await cloud.client.from('ti_watch_rules')
   .insert({user_id:cloud.user.id,keywords:term}).select('id').single();
  if(error)throw error;
  const w=store.watches.find(x=>x.term===term&&!x.serverId);
  if(w)w.serverId=data.id;
  persist();renderWatches();
  if(!silent)toast('監控已存到資料庫。新公告將由排程自動比對。');
 }catch(err){toast('監控雲端建立失敗：'+readableError(err));}
}
async function cloudDeleteWatch(serverId){
 if(!cloud.user)return;
 try{
  const {error}=await cloud.client.from('ti_watch_rules').delete().eq('user_id',cloud.user.id).eq('id',serverId);
  if(error)throw error;
 }catch(err){toast('監控雲端刪除失敗：'+readableError(err));}
}
async function renderCloudInbox(){
 const box=$('cloudInbox');
 if(!cloud.user){box.replaceChildren(E('div','empty','登入後可查看雲端自動比對的新公告。'));return;}
 box.replaceChildren(E('div','empty','正在讀取通知…'));
 try{
  const data=await cloudNotifications(cloud.client,cloud.user);
  box.replaceChildren();
  if(!data.length){box.append(E('div','empty','尚無新公告通知；監控建立後，下一次成功匯入的新公告才會進行比對。'));return;}
  for(const note of data){
    const wrap=E('div','watch-item'),top=E('header','');
    const textTitle=note.ti_cases?.title||note.case_id;
    const row=normalize({
      unit_id:note.ti_cases?.unit_id||note.case_id.split('::')[0],
      job_number:note.ti_cases?.job_number||note.case_id.split('::').slice(1).join('::'),
      unit_name:note.ti_cases?.agency||'',
      date:Number(note.notice_id.split('::')[2])||20260101,
      brief:{title:textTitle,type:note.reason,category:''}
    });
    child(top,btn(textTitle,'case-title',async()=>{
      if(row)await openDetail(row);
      const {error}=await cloud.client.from('ti_notifications').update({seen_at:new Date().toISOString()}).eq('id',note.id);
      if(!error)void renderCloudInbox();
    }),E('span','case-tag',note.seen_at?'已讀':'未讀'));
    child(wrap,top,E('p','',note.reason+'｜監控關鍵字：'+(note.ti_watch_rules?.keywords||'')+'｜'+new Date(note.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})));
    box.append(wrap);
  }
 }catch(err){box.replaceChildren(E('div','empty','雲端通知載入失敗：'+readableError(err)));}
}
function renderTaskSelector(){
 const select=$('taskCase');if(!select)return;
 const selected=select.value;
 select.replaceChildren(E('option','','選擇已追蹤標案'));
 select.firstChild.value='';
 for(const item of Object.values(store.saved)){
  const o=E('option','',item.title?.slice(0,65)||item.id);o.value=item.id;select.append(o);
 }
 select.value=selected||'';
}
async function renderCloudTasks(){
 const box=$('taskList');
 if(!cloud.user){box.replaceChildren(E('div','empty','登入後即可建立雲端投標待辦。'));return;}
 try{
  const {data,error}=await cloud.client.from('ti_tasks').select('*').eq('user_id',cloud.user.id).order('created_at',{ascending:false}).limit(200);
  if(error)throw error;
  box.replaceChildren();
  if(!data?.length){box.append(E('div','empty','尚無待辦任務。'));return;}
  for(const task of data){
    const wrap=E('div','watch-item'),head=E('header','');
    const toggle=E('input','');toggle.type='checkbox';toggle.checked=task.done;
    toggle.setAttribute('aria-label','完成任務：'+task.title);
    toggle.addEventListener('change',async()=>{
      const {error}=await cloud.client.from('ti_tasks').update({done:toggle.checked,updated_at:new Date().toISOString()}).eq('id',task.id);
      if(error){toggle.checked=!toggle.checked;toast('更新任務失敗：'+readableError(error));}
      else void renderCloudTasks();
    });
    child(head,toggle,E('h3','',task.title),btn('刪除','ghost-btn',async()=>{
      const {error}=await cloud.client.from('ti_tasks').delete().eq('id',task.id);
      if(error)toast('刪除失敗：'+readableError(error));else void renderCloudTasks();
    }));
    child(wrap,head,E('p','',(store.saved[task.case_id]?.title||task.case_id)+'｜期限：'+(task.due_at?new Date(task.due_at).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'}):'未設定')));
    box.append(wrap);
  }
 }catch(err){box.replaceChildren(E('div','empty','讀取待辦失敗：'+readableError(err)));}
}
async function saveCloudDocument(){
 if(!cloud.user)return toast('請先登入才能儲存私有雲端文件。');
 const file=$('documentFile').files?.[0];
 if(!file)return toast('請先選擇文件。');
 if(file.size>15*1024*1024)return toast('超過 15 MB 限制。');
 const allowed=['.pdf','.docx','.txt','.md'];
 if(!allowed.some(x=>file.name.toLowerCase().endsWith(x)))return toast('只能上傳 PDF、DOCX、TXT、MD。');
 const button=$('documentCloudSave');button.disabled=true;
 let path='';
 try{
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-90);
  path=cloud.user.id+'/'+crypto.randomUUID()+'-'+safeName;
  const {error:uploadError}=await cloud.client.storage.from('ti-private-documents').upload(path,file,{
    upsert:false,contentType:file.type||'application/octet-stream'
  });
  if(uploadError)throw uploadError;
  const {error:dbError}=await cloud.client.from('ti_documents').insert({
    user_id:cloud.user.id,filename:file.name,storage_path:path,mime_type:file.type||null,bytes:file.size
  });
  if(dbError){
    await cloud.client.storage.from('ti-private-documents').remove([path]);
    throw dbError;
  }
  toast('已保存私有文件至 Supabase Storage。');
  await renderCloudDocuments();
 }catch(err){toast('文件儲存失敗：'+readableError(err));}
 finally{button.disabled=false;}
}
async function renderCloudDocuments(){
 const box=$('cloudDocuments');
 if(!cloud.user){box.replaceChildren(E('div','empty','登入後查看私有雲端文件。'));return;}
 try{
  const {data,error}=await cloud.client.from('ti_documents').select('*')
   .eq('user_id',cloud.user.id).order('created_at',{ascending:false}).limit(100);
  if(error)throw error;
  box.replaceChildren();
  if(!data?.length){box.append(E('div','empty','尚未上傳任何雲端文件。'));return;}
  for(const file of data){
    const wrap=E('div','watch-item'),head=E('header','');
    child(head,E('h3','',file.filename),btn('下載','ghost-btn',async()=>{
      const {data:link,error:e}=await cloud.client.storage.from('ti-private-documents').createSignedUrl(file.storage_path,60);
      if(e||!link?.signedUrl)return toast('無法開啟檔案：'+readableError(e));
      window.open(link.signedUrl,'_blank','noopener,noreferrer');
    }),btn('刪除','ghost-btn',async()=>{
      const {error:e}=await cloud.client.storage.from('ti-private-documents').remove([file.storage_path]);
      if(e)return toast('刪除檔案失敗：'+readableError(e));
      const {error:r}=await cloud.client.from('ti_documents').delete().eq('id',file.id);
      if(r)return toast('清理文件紀錄失敗：'+readableError(r));
      void renderCloudDocuments();
    }));
    child(wrap,head,E('p','',new Date(file.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'｜'+(file.bytes||0).toLocaleString('zh-TW')+' bytes'));
    box.append(wrap);
  }
 }catch(err){box.replaceChildren(E('div','empty','私有文件讀取失敗：'+readableError(err)));}
}


// PRD: secure multi-member workspace / invitation / shared cases and tasks.
let selectedWorkspace='';
async function refreshWorkspaces(){
 const panel=$('workspaceOutput'),choose=$('workspaceSelect');
 if(!cloud.user){panel.replaceChildren(E('div','empty','請先登入，才能讀取團隊工作區。'));return;}
 try{
  const {data,error}=await cloud.client.from('ti_workspaces').select('id,name,owner_id,created_at').order('created_at',{ascending:false});
  if(error)throw error;
  const old=selectedWorkspace||choose.value;choose.replaceChildren();
  if(!data?.length){
   const o=E('option','','尚無工作區');o.value='';choose.append(o);
   selectedWorkspace='';panel.replaceChildren(E('div','empty','尚未建立或加入團隊。'));
   return;
  }
  for(const w of data){const o=E('option','',w.name);o.value=w.id;choose.append(o);}
  selectedWorkspace=data.some(w=>w.id===old)?old:data[0].id;
  choose.value=selectedWorkspace;
  await renderWorkspace();
 }catch(err){panel.replaceChildren(E('div','empty','團隊資料無法讀取：'+readableError(err)));}
}
async function renderWorkspace(){
 const id=selectedWorkspace,box=$('workspaceOutput');
 if(!cloud.user||!id){box.replaceChildren(E('div','empty','請先選擇工作區。'));return;}
 box.replaceChildren(E('div','empty','正在讀取團隊案件及任務…'));
 try{
  const [members,cases,tasks]=await Promise.all([
   cloud.client.from('ti_workspace_members').select('user_id,role,joined_at').eq('workspace_id',id),
   cloud.client.from('ti_workspace_cases').select('*').eq('workspace_id',id).order('updated_at',{ascending:false}),
   cloud.client.from('ti_workspace_tasks').select('*').eq('workspace_id',id).order('updated_at',{ascending:false})
  ]);
  if(members.error)throw members.error;if(cases.error)throw cases.error;if(tasks.error)throw tasks.error;
  const me=members.data.find(m=>m.user_id===cloud.user.id);
  const canEdit=!!me&&me.role!=='viewer';
  box.replaceChildren();
  child(box,E('h2','','團隊案件 '+(cases.data?.length||0)+' 件 · 成員 '+(members.data?.length||0)+' 人'),
    E('p','minor','你的權限：'+(me?.role||'未知')+'。跨裝置案件會存到 ti_workspace_cases；角色由 RLS 驗證。'));
  if(canEdit){
   const add=E('div','inline-form');add.style.marginTop='15px';
   const select=E('select','');const placeholder=E('option','','選擇要分享的個人追蹤案');placeholder.value='';select.append(placeholder);
   for(const item of Object.values(store.saved)){const o=E('option','',item.title);o.value=item.id;select.append(o);}
   const submit=btn('分享至團隊','primary-btn',async()=>{
    const item=store.saved[select.value];if(!item)return toast('請先在標案搜尋收藏案件。');
    const {error}=await cloud.client.from('ti_workspace_cases').upsert({
     workspace_id:id,case_id:item.id,title:item.title,agency:item.agency||null,stage:item.stage||'評估中',
     updated_at:new Date().toISOString()
    },{onConflict:'workspace_id,case_id'});
    if(error)return toast('分享失敗：'+readableError(error));
    toast('案件已加入團隊工作區。');void renderWorkspace();
   });
   child(add,select,submit);box.append(add);
  }
  child(box,E('h3','','共用投標案件'));
  if(!cases.data?.length)box.append(E('p','minor','目前沒有共用案件。'));
  for(const item of cases.data||[]){
   const wrap=E('section','watch-item'),head=E('header','');
   const parts=item.case_id.split('::');
   const r=normalize({unit_id:parts[0],job_number:parts.slice(1).join('::'),unit_name:item.agency,date:20261103,brief:{title:item.title,type:'',category:''}});
   child(head,btn(item.title,'case-title',()=>r&&openDetail(r)));
   if(canEdit)child(head,btn('移除','ghost-btn',async()=>{
    const {error}=await cloud.client.from('ti_workspace_cases').delete()
     .eq('workspace_id',id).eq('case_id',item.case_id);
    if(error)toast('移除失敗：'+readableError(error));else void renderWorkspace();
   }));
   wrap.append(head);
   const line=E('div','inline-form');
   const stage=E('select','');for(const s of states){const o=E('option','',s);o.value=s;stage.append(o);}
   stage.value=item.stage;
   stage.disabled=!canEdit;
   stage.addEventListener('change',async()=>{
    const {error}=await cloud.client.from('ti_workspace_cases').update({stage:stage.value,updated_at:new Date().toISOString()})
     .eq('workspace_id',id).eq('case_id',item.case_id);
    if(error)toast('狀態更新失敗：'+readableError(error));
   });
   const notes=E('input','');notes.placeholder='團隊備註';notes.value=item.notes||'';notes.disabled=!canEdit;
   notes.addEventListener('change',async()=>{
    const {error}=await cloud.client.from('ti_workspace_cases').update({notes:notes.value,updated_at:new Date().toISOString()})
     .eq('workspace_id',id).eq('case_id',item.case_id);
    if(error)toast('備註更新失敗：'+readableError(error));
   });
   child(line,stage,notes);wrap.append(line);box.append(wrap);
  }
  child(box,E('h3','','共用待辦'));
  if(canEdit){
   const form=E('form','inline-form');form.style.marginBottom='16px';
   const name=E('input','');name.required=true;name.maxLength=300;name.placeholder='例如：準備報價附件';
   const due=E('input','');due.type='date';
   const submit=E('button','primary-btn','建立團隊待辦');submit.type='submit';
   form.addEventListener('submit',async e=>{
    e.preventDefault();
    const {error}=await cloud.client.from('ti_workspace_tasks').insert({
     workspace_id:id,title:name.value.trim(),due_at:due.value?due.value+'T23:59:00+08:00':null,created_by:cloud.user.id
    });
    if(error)toast('新增待辦失敗：'+readableError(error));
    else void renderWorkspace();
   });
   child(form,name,due,submit);box.append(form);
  }
  if(!tasks.data?.length)box.append(E('p','minor','尚未建立團隊待辦。'));
  for(const task of tasks.data||[]){
   const wrap=E('div','watch-item'),head=E('header',''),check=E('input','');
   check.type='checkbox';check.checked=task.done;check.disabled=!canEdit;
   check.addEventListener('change',async()=>{
    const {error}=await cloud.client.from('ti_workspace_tasks').update({done:check.checked,updated_at:new Date().toISOString()}).eq('id',task.id);
    if(error)toast('更新任務失敗：'+readableError(error));else void renderWorkspace();
   });
   child(head,check,E('h3','',task.title),E('span','minor',task.due_at?new Date(task.due_at).toLocaleDateString('zh-TW'):'無期限'));
   wrap.append(head);box.append(wrap);
  }
  child(box,E('h3','','團隊成員'));
  const tb=E('table','analysis-list');
  for(const member of members.data||[]){
   const tr=E('tr','');child(tr,E('td','',member.user_id===cloud.user.id?'你本人':member.user_id.slice(0,8)+'…'),
     E('td','',member.role),E('td','',new Date(member.joined_at).toLocaleDateString('zh-TW')));tb.append(tr);
  }
  box.append(tb);
 }catch(err){box.replaceChildren(E('div','empty','團隊讀取失敗：'+readableError(err)));}
}
async function acceptWorkspaceInvitation(token){
 if(!cloud.user)return toast('請先登入，再使用邀請連結。');
 try{
  const {data,error}=await cloud.client.rpc('ti_accept_workspace_invite',{token:token.trim()});
  if(error)throw error;
  selectedWorkspace=data;
  $('workspaceJoinCode').value='';
  sessionStorage.removeItem('ti_pending_invite');
  const url=new URL(window.location.href);url.searchParams.delete('invite');
  window.history.replaceState(null,'',url.pathname+url.search);
  await refreshWorkspaces();showView('team');toast('已成功加入團隊工作區。');
 }catch(err){toast('加入團隊失敗：'+readableError(err));}
}
function initTeamUI(){
 $('workspaceCreateForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!cloud.user)return toast('請先登入。');
  const name=$('workspaceName').value.trim();if(!name)return;
  const {data,error}=await cloud.client.from('ti_workspaces')
    .insert({name,owner_id:cloud.user.id}).select('id').single();
  if(error)return toast('建立工作區失敗：'+readableError(error));
  selectedWorkspace=data.id;$('workspaceName').value='';await refreshWorkspaces();
  toast('已建立團隊工作區。');
 });
 $('workspaceSelect').addEventListener('change',()=>{
  selectedWorkspace=$('workspaceSelect').value;void renderWorkspace();
 });
 $('workspaceRefresh').addEventListener('click',()=>void refreshWorkspaces());
 $('workspaceInvite').addEventListener('click',async()=>{
  if(!cloud.user||!selectedWorkspace)return toast('請先登入並選擇工作區。');
  try{
   const {data,error}=await cloud.client.rpc('ti_create_workspace_invite',{w:selectedWorkspace});
   if(error)throw error;
   const url=window.location.origin+window.location.pathname+'?invite='+encodeURIComponent(data);
   $('workspaceInviteLink').replaceChildren(E('span','','一次性邀請連結（七天內有效）：'+url+' '),
     btn('複製連結','ghost-btn',async()=>{await navigator.clipboard.writeText(url);toast('邀請連結已複製。')}));
  }catch(err){toast('產生邀請失敗（須為工作區擁有者）：'+readableError(err));}
 });
 $('workspaceJoinForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const token=$('workspaceJoinCode').value.trim();
  if(token)await acceptWorkspaceInvitation(token);
 });
 const invite=new URL(window.location.href).searchParams.get('invite');
 if(invite)sessionStorage.setItem('ti_pending_invite',invite);
}


async function analyzeDocumentAI(){
  const file=$('documentFile').files?.[0];
  const target=$('documentAiOutput');
  if(!file){toast('請先選擇合法取得的標書文件。');return;}
  if(!cloud.user||!cloud.client){toast('使用 AI 需要先登入；本機規則整理不用登入。');$('accountPanel').hidden=false;return;}
  if(file.size>15*1024*1024){toast('文件上限 15MB。');return;}
  const button=$('documentAI');button.disabled=true;
  target.replaceChildren(E('h2','','AI 標單分析'),E('p','minor','正在擷取文件文字；AI 不會補填原文未揭露的數字或資格。'));
  try{
    // OCR is deliberately not simulated. Human-review is required for image-only scans.
    const pages=await parseDocument(file);
    const actual=pages.filter(p=>asText(p.text).trim());
    if(!actual.length)throw Error('這份文件沒有可讀文字層；掃描型 PDF 需要 OCR，本站不會虛構資格。');
    const {data:{session},error:sessionError}=await cloud.client.auth.getSession();
    if(sessionError)throw sessionError;
    if(!session?.access_token)throw Error('驗證已失效，請重新登入。');
    const response=await fetch(DATABASE_URL+'/functions/v1/ti-document-ai',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+session.access_token,
        apikey:PUBLISHABLE_KEY
      },
      body:JSON.stringify({document_name:file.name,pages:actual}),
      signal:AbortSignal.timeout(118000)
    });
    const data=await response.json().catch(()=>({error:'AI 服務回傳格式不正確'}));
    if(!response.ok)throw Error(data.error||'AI 服務錯誤 '+response.status);
    if(!data?.result||!Array.isArray(data.result.requirements))throw Error('AI 回傳資料結構不完整');
    const result=data.result;
    const header=E('div','');
    child(header,E('h2','','AI 標單分析（實際執行）'),
      E('p','minor','模型：'+asText(data.model)+'｜分析頁數：'+asText(data.source_pages)+'｜紀錄 ID：'+asText(data.job_id)));
    target.replaceChildren(header,E('p','',result.summary||'模型未提供摘要'));
    const warnings=Array.isArray(result.warnings)?result.warnings:[];
    if(warnings.length){
      const wrap=E('div','notice warning');
      child(wrap,E('strong','','需要人工確認：'));
      for(const line of warnings.slice(0,15))child(wrap,E('p','',line));
      target.append(wrap);
    }
    const groups=new Map();
    for(const req of result.requirements){
      const arr=groups.get(req.category)||[];arr.push(req);groups.set(req.category,arr);
    }
    for(const [category,rows] of groups){
      target.append(E('h3','',category+'（'+rows.length+'）'));
      for(const req of rows){
        const block=E('div','timeline-item');
        child(block,E('strong','',req.requirement),
          E('p','minor','來源：'+req.source_page+'｜原文：「'+req.evidence+'」'),
          E('p','',req.action||'請核對文件原文'));
        if(req.needs_human_check)block.append(E('span','case-tag failed','需要人工核對'));
        target.append(block);
      }
    }
    if(!groups.size)target.append(E('p','notice warning','沒有符合原文證據檢核的 AI 條款。請人工核對完整標書。'));
    toast('AI 服務已回傳可核對原文的分析。');
  }catch(err){
    target.replaceChildren(E('h2','','AI 標單分析'),E('div','notice danger',
      '本次沒有取得可用的 AI 分析：'+readableError(err)+'。不會以關鍵字檢索結果冒充 AI 報告。'));
  }finally{button.disabled=false;}
}
