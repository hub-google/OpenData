import {loadAgencyEvidence} from './agency-deep.js';
import {
  API_ROOT,asText,keyOf,safeNumber,formatMoney,parseDate,dateLabel,typeOf,
  normalize,dedupe,mergeCaseAmounts,filtered,fieldsOf,summaryOf,ratioStats,scoreCase,
  compareDeadline,csvEscape,safeOfficial
} from './core.mjs';
import {getClient,fetchArchive,fetchLatestAmounts,fetchSourceStatus,cloudSaved,cloudWatches,cloudNotifications,DATABASE_URL,PUBLISHABLE_KEY} from './backend.js';

const $ = id => document.getElementById(id);
const STORE='opendata-tender-v2';
const listModes={latest:'最新公告',archive:'自有資料庫已收錄案件',title:'標案名稱',vendor:'廠商名稱',companyId:'廠商統編',agency:'機關名稱'};
const viewNames={debarred:'拒絕往來公告',proposal:'標書差異與健檢',decisions:'投標決策評估',contracts:'合約與保證金',directory:'供應商名錄',developer:'我的 API／MCP',guide:'採購新手指南',advanced:'進階搜尋',search:'標案搜尋',radar:'我的商機雷達',agencies:'機關情報',vendors:'廠商與競品',issues:'無法決標與快截止',analytics:'決標行情',tracking:'投標工作台',team:'團隊協作',alerts:'監控與提醒',documents:'標書條款整理',billing:'方案與帳務',about:'資料說明'};
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
  if(name==='billing')void renderBilling();
  if(name==='team')void refreshWorkspaces();
  if(name==='alerts')renderWatches();
  if(name==='analytics')renderAnalytics();
  if(name==='documents')void renderAiUsage();
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
      // listbyunit only accepts an actual unit_id, never a free-text unit_name.
      const response=await api('/unit',{},35000);
      const units=response.units&&typeof response.units==='object'?response.units:response;
      const matches=Object.entries(units).filter(([id,name])=>typeof name==='string'
        && (id===query||name.includes(query)));
      if(!matches.length)throw Error('找不到相符的機關代碼。請改用機關正式名稱或代碼。');
      matches.sort((a,b)=>Number(b[1]===query)-Number(a[1]===query)||a[1].length-b[1].length);
      const [unitId,unitName]=matches[0];
      data=await api('/listbyunit',{unit_id:unitId,page:sourcePage},35000);
      state.totalPages=Math.max(1,Number(data.total_pages||data.total_page||1));
      state.lastSearch='機關：'+unitName+'（'+unitId+'）'+
        (matches.length>1?'，共 '+matches.length+' 個名稱符合；目前顯示最接近的機關':'');
    }else{
      const route=mode==='title'?'/searchbytitle':mode==='vendor'?'/searchbycompanyname':'/searchbycompanyid';
      data=await api(route,{query,page:sourcePage},35000);
      state.totalPages=Math.max(1,Number(data.total_pages||1));
      state.lastSearch=(listModes[mode]||'搜尋')+'：'+query;
    }
    if(token!==state.running)return;
    let records=Array.isArray(data.records)?data.records:[];
    if(mode==='latest'){
      try{
        const amounts=await fetchLatestAmounts(state.date);
        if(token!==state.running)return;
        records=mergeCaseAmounts(records,amounts);
        state.lastSearch+='｜預算已交叉核對已入庫的官方公告';
      }catch(err){
        if(token!==state.running)return;
        state.lastSearch+='｜部分預算未能核對，請查閱個案公告';
      }
    }
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
  child(amount,E('small','','公開預算'),E('strong','',row.budget===null?'尚無可確認資料':formatMoney(row.budget)));
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
    budget:row.budget,stage:'評估中',notes:'',due:'',read_at:null,added_at:new Date().toISOString()
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
    renderDetail(row,data);renderAnalytics();void loadRelatedCases(row);if(store.saved[row.id])void setSavedRead(row.id,true,true);
  }catch(err){
    $('detailContent').replaceChildren(E('div','empty','案件詳情載入失敗：'+readableError(err)));
  }
}
// F10: exact-case share links, never a broad title-search substitution.
async function openCaseFromUrl(){
 const q=new URLSearchParams(window.location.search);
 const unit=q.get('case_unit'),job=q.get('case_no');
 if(!unit||!job)return;
 if(unit.length>80||job.length>100||/[<>]/.test(unit+job))return;
 try{
  const data=await api('/tender',{unit_id:unit,job_number:job},35000);
  const rows=Array.isArray(data.records)?dedupe(data.records):[];
  const chosen=rows.find(r=>r.unit_id===unit&&r.job_number===job);
  if(!chosen)throw Error('來源未回傳這個機關與案號');
  state.details.set(chosen.id,data);
  await openDetail(chosen);
 }catch(err){toast('專屬案件連結暫時無法載入：'+readableError(err));}
}
// Only the project database can supply the authoritative homepage counts.
async function loadVerifiedHomepageKpis(){
 const note=$('verifiedMetricsNote');
 if(!note)return;
 try{
  const client=await getClient();
  const {data,error}=await client.rpc('ti_home_kpis');
  if(error)throw error;
  if(!data||typeof data!=='object')throw Error('資料庫未提供統計');
  const numeral=v=>Number(v||0).toLocaleString('zh-TW');
  const d=String(data.latest_publication_day||'');
  $('verifiedLatest').textContent=numeral(data.latest_notice_count);
  $('verifiedLatestDate').textContent=/^\d{8}$/.test(d)?d.slice(0,4)+'/'+d.slice(4,6)+'/'+d.slice(6,8)+' 已入庫':'尚未確認公告日期';
  $('verifiedOpen').textContent=numeral(data.verified_open);
  $('verifiedSoon').textContent=numeral(data.due_soon);
  $('verifiedFailed').textContent=numeral(data.failed);
  $('verifiedUnknown').textContent=numeral(data.active_unknown_deadline);
  const total=Number(data.total_cases||0),known=Number(data.deadline_known||0);
  const checked=total?((known/total)*100).toFixed(1)+'%':'尚無資料';
  const synced=data.last_success_at?new Date(data.last_success_at):null;
  const syncText=synced&&!Number.isNaN(synced.getTime())?
   synced.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚無成功紀錄';
  const overdue=synced&&Date.now()-synced.getTime()>2*3600000;
  note.textContent='自有資料庫 '+numeral(total)+' 案；目前有明確截止時間 '+numeral(known)+
   ' 案（'+checked+'）。「確認尚未截標」與「三日內截止」只計入有原文證據者，不能據此推斷其餘案件已截止。'+
   '最後成功同步（台灣時間）：'+syncText+'。'+
   (data.unresolved_source_dates?'另有 '+numeral(data.unresolved_source_dates)+' 個來源缺漏日期追蹤中。':'')+
   (overdue?'注意：最近同步已超過兩小時，請核對資料說明。':'');
  note.classList.toggle('warning',!!overdue);
 }catch(e){
  note.textContent='資料庫概況無法驗證：'+readableError(e)+'。請依「資料說明」及官方公告確認，不能把空值當零。';
  note.classList.add('warning');
 }
}
async function loadRelatedCases(row){
 const box=$('relatedCases');
 if(!box)return;
 try{
  const client=await getClient();
  const {data,error}=await client.rpc('ti_related_cases',{p_case_id:row.id});
  if(error)throw error;
  if(state.selected!==row)return;
  const related=Array.isArray(data)?data:[];
  box.replaceChildren();
  if(!related.length){box.append(E('p','minor','目前已收錄資料中無同機關且同採購大類的其他案件。'));return;}
  for(const item of related){
   const rec=normalize({
    unit_id:item.unit_id,job_number:item.job_number,date:item.latest_notice_date,
    unit_name:item.agency,budget_amount:item.budget_amount,award_amount:item.award_amount,
    brief:{title:item.title,type:item.latest_notice_type,category:item.group_name}
   });
   if(!rec)continue;
   const line=E('div','timeline-item');
   child(line,btn(item.title,'case-title',()=>openDetail(rec)),
    E('div','minor',dateLabel(item.latest_notice_date)+'｜案號 '+item.job_number+
    '｜'+(item.latest_notice_type||'公告類型未提供')));
   box.append(line);
  }
 }catch(e){
  if(state.selected===row)box.replaceChildren(E('p','minor','關聯案查詢失敗：'+readableError(e)));
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
  child(actions,btn('複製此案專屬連結','ghost-btn',async()=>{
    const url=new URL(window.location.href);url.search='';
    url.searchParams.set('case_unit',row.unit_id);url.searchParams.set('case_no',row.job_number);
    try{await navigator.clipboard.writeText(url.toString());toast('已複製此案專屬網址');}
    catch{toast('無法存取剪貼簿，請使用瀏覽器的分享功能。');}
  }));
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
  child(page,E('h3','','同機關、同採購大類的歷史案件（不是契約續標判定）'));
  const related=E('div','detail-timeline','');related.id='relatedCases';
  related.append(E('div','minor','正在查詢已成功收錄的相同機關與採購類別…'));
  page.append(related);
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
// PRD V1: cross-date matching from the actual RLS-protected archive, not just visible API rows.
let radarFullPage=1,radarFullTotal=0,radarFullRequest=0;
async function saveRadarFeedback(row,verdict){
 if(!cloud.user||!cloud.client){toast('請先登入會員才能保存跨裝置商機反饋。');return;}
 const reason=prompt('請輸入這件標案符合／不符合你業務的原因（選填，600 字內）：','');
 if(reason===null)return;
 try{
  const {error}=await cloud.client.from('ti_match_feedback').upsert({
   user_id:cloud.user.id,case_id:row.id,verdict,reason:reason.trim().slice(0,600),
   updated_at:new Date().toISOString()
  },{onConflict:'user_id,case_id'});
  if(error)throw error;
  toast('已保存商機判斷及原因。');
 }catch(e){toast('反饋儲存失敗：'+readableError(e));}
}
async function searchFullRadar(p=1){
 const status=$('radarFullStatus'),results=$('radarFullResults');
 const keywords=asText(store.profile.keywords).split(/[,，、\n]+/).map(x=>x.trim()).filter(Boolean);
 const excludes=asText(store.profile.excludes).split(/[,，、\n]+/).map(x=>x.trim()).filter(Boolean);
 if(!keywords.length){status.textContent='請先儲存產品或服務關鍵字。';return;}
 if(keywords.length>12||excludes.length>12||[...keywords,...excludes].some(x=>x.length>60)){
  status.textContent='包含與排除詞各最多 12 個，單詞最多 60 字，請調整並重新儲存。';return;
 }
 const token=++radarFullRequest,button=$('radarFullSearch');
 button.disabled=true;status.textContent='正在自有資料庫跨日搜尋實際已入庫招標公告（不包含更正或決標），並排序關鍵字關聯性…';
 try{
  const client=await getClient();
  const min=store.profile.min===''||store.profile.min==null?null:safeNumber(store.profile.min);
  const max=store.profile.max===''||store.profile.max==null?null:safeNumber(store.profile.max);
  const location=asText(store.profile.area).trim().slice(0,80);
  if(min!==null&&max!==null&&min>max)throw Error('最低預算不能大於最高預算');
  const {data,error}=await client.rpc('ti_archive_search_v3',{
   p_terms:keywords,p_exclude:excludes,p_any:true,p_kind:'招標',
   p_min_budget:min,p_max_budget:max,p_location:location,
   p_sort:'relevance',p_page:p,p_limit:30
  });
  if(error)throw error;
  if(token!==radarFullRequest)return;
  if(!data||!Array.isArray(data.rows))throw Error('資料庫回傳無效');
  radarFullTotal=Number(data.total||0);radarFullPage=p;
  results.replaceChildren();
  let kept=0;
  for(const item of data.rows){
   const rec=normalize({
    unit_id:item.unit_id,job_number:item.job_number,unit_name:item.agency,
    date:item.latest_notice_date,filename:item.latest_filename,budget_amount:item.budget_amount,
    award_amount:item.award_amount,
    brief:{title:item.title,type:item.latest_notice_type,category:item.category||item.group_name}
   });
   if(!rec)continue;
   const score=scoreCase(rec,store.profile);
   // A source term can match agency/vendor names without proving product applicability.
   const wrapper=E('div','');
   wrapper.append(caseCard(rec,{radarScore:score.matched}));
   const note=E('div','minor');
   const explanations=score.reasons.length?score.reasons:['命中公告其他來源欄位，是否屬於你的業務仍待確認'];
   const warnings=score.warnings.filter(w=>!item.verified_location||!w.includes('尚無完整履約地欄位'));
   if(!item.deadline_at)warnings.push('未取得原公告截止時間，不能確認是否還能投標');
   else{
    const d=new Date(item.deadline_at);
    warnings.push(Number.isNaN(d.getTime())?'官方截止時間無法解析':
     d<=new Date()?'已過已入庫截止時間，請核對是否有更正':
     '已入庫截止時間：'+d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}));
   }
   if(item.verified_location)explanations.push('公告履約地：'+item.verified_location);
   if(store.profile.area&&!item.verified_location)warnings.push('履約地未公開，未使用機關地址代替');
   note.textContent='符合：'+explanations.join('；')+'｜待核對：'+warnings.join('；');
   note.style.padding='0 16px 9px';wrapper.append(note);
   const feedbackActions=E('div','detail-actions');
   child(feedbackActions,btn('符合我的業務','ghost-btn',()=>void saveRadarFeedback(rec,'relevant')),
     btn('不符合我的業務','ghost-btn',()=>void saveRadarFeedback(rec,'irrelevant')));
   wrapper.append(feedbackActions);results.append(wrapper);kept++;
  }
  if(!kept)results.append(E('div','empty','已入庫資料中無符合的招標公告，請調整關鍵字。'));
  const maxPage=Math.max(1,Math.min(1000,Math.ceil(radarFullTotal/30)));
  $('radarFullPage').textContent='第 '+p+'／'+maxPage+' 頁（每頁 30 件）';
  $('radarFullPrev').disabled=p<=1;$('radarFullNext').disabled=p>=maxPage;
  status.textContent='已入庫招標類公告共 '+radarFullTotal.toLocaleString('zh-TW')+
   ' 案命中包含詞，按相關詞命中數及公告日排列；本頁 '+kept+
   ' 案。'+(store.profile.area?'履約地只接受原文已取得的 '+store.profile.area+'；缺漏者排除。':'')+
   ((store.profile.min!==''||store.profile.max!=='')?'金額只納入原始公告有公開預算者。':'')+
   '不同公告類型、未完成歷史回填、資格與截止時間皆可能影響實際可投標性，這不是得標率。';
 }catch(err){if(token===radarFullRequest)status.textContent='跨日商機查詢失敗：'+readableError(err);}
 finally{if(token===radarFullRequest)button.disabled=false;}
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
  void loadAgencyEvidence(id);
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
async function setSavedRead(caseId,isRead,automatic=false){
 const entry=store.saved[caseId];if(!entry)return;
 if(isRead&&entry.read_at&&automatic)return;
 const previous=entry.read_at??null;
 entry.read_at=isRead?new Date().toISOString():null;
 persist();renderTracking();
 if(cloud.user&&cloud.client){
  try{
   const account=cloud.user.id;
   const {error}=await cloud.client.from('ti_saved_cases').update({
    read_at:entry.read_at,updated_at:new Date().toISOString()
   }).eq('user_id',account).eq('case_id',caseId);
   if(error)throw error;
  }catch(err){
   if(store.saved[caseId]===entry){entry.read_at=previous;persist();renderTracking();}
   toast('閱讀狀態雲端同步失敗：'+readableError(err));
   return;
  }
 }
 if(!automatic)toast(isRead?'已標記已讀':'已標記未讀');
}
function renderTracking(){
  const out=$('trackingOutput');out.replaceChildren();
  const items=Object.values(store.saved);
  $('trackingCount').textContent=items.length;$('metricSaved').textContent=items.length;renderTaskSelector();
  if(!items.length){out.append(E('div','empty','目前沒有追蹤案件。到「標案搜尋」點星號，即可加入工作台。'));return;}
  for(const item of items.sort((a,b)=>asText(b.added_at).localeCompare(asText(a.added_at)))){
    const card=E('section','track-card');
    child(card,btn(item.title,'case-title',()=>openDetail(item)),E('div','minor',item.agency||'機關未公開'));
    const stateTag=E('div','minor',item.read_at?'已讀：'+new Date(item.read_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未閱讀');
    card.append(stateTag);
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
    child(acts,btn(item.read_at?'標記未讀':'標記已讀','ghost-btn',()=>void setSavedRead(item.id,!item.read_at)),btn('打開公告詳情','ghost-btn',()=>openDetail(item)),btn('移除','ghost-btn',()=>{
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
async function trackingExcel(){
 const items=Object.values(store.saved);
 if(!items.length){toast('目前沒有追蹤案件可以匯出。');return;}
 const button=$('trackingXlsx');button.disabled=true;
 try{
  const XLSX=await loadLibrary('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js','XLSX');
  const fields=['標案','機關','機關代碼','案號','階段','內部截止','備註'];
  const rows=[fields,...items.map(x=>[x.title,x.agency,x.unit_id,x.job_number,x.stage,x.due,x.notes])];
  const sheet=XLSX.utils.aoa_to_sheet(rows);
  // Treat all exported user-provided text as strings, never as Excel formula cells.
  for(const [address,cell] of Object.entries(sheet)){
   if(address.startsWith('!')||!cell||typeof cell!=='object')continue;
   delete cell.f;cell.t='s';cell.v=String(cell.v??'');
  }
  sheet['!cols']=[{wch:50},{wch:32},{wch:18},{wch:26},{wch:15},{wch:18},{wch:65}];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'投標工作台');
  XLSX.writeFile(book,'投標工作台.xlsx',{compression:true});
  toast('已匯出實際追蹤案件的 Excel 檔案。');
 }catch(e){toast('Excel 匯出失敗：'+readableError(e));}
 finally{button.disabled=false;}
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
      store.saved[id]={id,unit_id:asText(x.unit_id).slice(0,100),job_number:asText(x.job_number).slice(0,100),title:asText(x.title).slice(0,500),agency:asText(x.agency).slice(0,300),date:x.date,stage:states.includes(x.stage)?x.stage:'評估中',notes:asText(x.notes).slice(0,4000),due:/^\d{4}-\d{2}-\d{2}$/.test(asText(x.due))?x.due:'',read_at:null,added_at:asText(x.added_at)};
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
export async function parseDocument(file){
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
  }else if(name.endsWith('.xlsx')){
    const XLSX=await loadLibrary('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js','XLSX');
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellText:true,cellDates:false});
    for(const sheetName of wb.SheetNames.slice(0,20)){
      const text=XLSX.utils.sheet_to_csv(wb.Sheets[sheetName],{blankrows:false});
      output.push({source:'工作表「'+sheetName+'」（非 PDF 頁碼）',text});
    }
    if(wb.SheetNames.length>20)toast('活頁簿只處理前 20 張工作表；其餘請另行檢查。');
  }else if(name.endsWith('.txt')||name.endsWith('.md')){
    output.push({source:'文字檔（無頁碼）',text:await file.text()});
  }else throw Error('請使用 TXT、MD、PDF、DOCX 或 XLSX');
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
  $('radarFullSearch').addEventListener('click',()=>void searchFullRadar(1));
  $('radarFullPrev').addEventListener('click',()=>{if(radarFullPage>1)void searchFullRadar(radarFullPage-1);});
  $('radarFullNext').addEventListener('click',()=>{if(radarFullPage<Math.ceil(radarFullTotal/30))void searchFullRadar(radarFullPage+1);});
  $('agencyForm').addEventListener('submit',e=>{e.preventDefault();const id=$('agencyId').value.trim();if(id)loadAgency(id);});
  $('vendorForm').addEventListener('submit',e=>{e.preventDefault();const q=$('vendorQuery').value.trim();const mode=$('vendorMode').value;if(q)loadVendors(mode,q);});
  $('trackingCsv').addEventListener('click',trackingCSV);
  $('trackingXlsx').addEventListener('click',()=>void trackingExcel());
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
const urlState=new URLSearchParams(window.location.search);
if(Object.hasOwn(listModes,urlState.get('mode')||'') && (urlState.get('q')||'').length<121)
  search(urlState.get('mode'),urlState.get('q')||'',1);
else search('latest','',1);
void initCloud();
void loadVerifiedHomepageKpis();
void openCaseFromUrl();
setInterval(()=>{if(document.visibilityState==='visible'&&store.watches.length)checkWatches();},20*60*1000);


// === PRD: authenticated personal workspace on the actual Supabase database ===
// No paid gates; RLS enforces that only the account owner accesses personal records.
async function renderAiUsage(){
 const status=$('aiUsageStatus'),list=$('aiUsageHistory');
 if(!status||!list)return;
 if(!cloud.user||!cloud.client){
  status.textContent='登入會員後可查看自己的 AI 使用紀錄。';list.replaceChildren();return;
 }
 const identity=cloud.user.id;
 status.textContent='正在查詢已完成 AI 工作與額度…';
 try{
  const past=new Date(Date.now()-86400000).toISOString();
  const [total,history]=await Promise.all([
   cloud.client.from('ti_ai_jobs').select('id',{count:'exact',head:true})
    .eq('user_id',identity).eq('state','success').gte('finished_at',past),
   cloud.client.from('ti_ai_jobs')
    .select('id,task_type,document_name,state,provider_model,error_summary,created_at,finished_at')
    .eq('user_id',identity).order('created_at',{ascending:false}).limit(20)
  ]);
  if(total.error)throw total.error;if(history.error)throw history.error;
  if(cloud.user?.id!==identity)return;
  const used=Number(total.count||0);
  status.textContent='最近 24 小時成功分析 '+used+'／20 次；尚可成功分析 '+
   Math.max(0,20-used)+' 次。重複輸入且已有成功紀錄時優先取回原結果；失敗不計入成功配額。';
  list.replaceChildren();
  if(!history.data?.length){list.append(E('p','minor','尚無 AI 分析紀錄。'));return;}
  for(const item of history.data){
   const box=E('div','timeline-item'),label=item.task_type==='proposal_check'?'投標書健檢':'標書條款分析';
   const symbol={success:'成功',pending:'處理中',error:'失敗'}[item.state]||item.state;
   child(box,E('strong','',label+'｜'+item.document_name+'｜'+symbol),
    E('p','minor',(item.finished_at?new Date(item.finished_at):new Date(item.created_at))
     .toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+
      (item.provider_model?'｜'+item.provider_model:'')+
      (item.error_summary?'｜'+item.error_summary.slice(0,160):'')));
   list.append(box);
  }
 }catch(e){
  if(cloud.user?.id===identity)status.textContent='讀取 AI 額度失敗：'+readableError(e);
 }
}
function initCloudUI(){
  $('accountButton').addEventListener('click',()=>{$('accountPanel').hidden=false;$('accountPanel').scrollIntoView({behavior:'smooth'});});
  $('closeAccount').addEventListener('click',()=>$('accountPanel').hidden=true);
  async function demoLogin(){
    const quick=$('accountDemoQuick'),panel=$('accountDemoLogin');
    quick.disabled=true;panel.disabled=true;
    const previous=quick.textContent;quick.textContent='登入中…';panel.textContent='正在建立測試帳號…';
    try{
      const sb=cloud.client||await getClient();
      const {data:{session}}=await sb.auth.getSession();
      if(session?.user&&!session.user.is_anonymous){
        throw Error('目前已登入正式會員，請先登出再使用測試帳號。');
      }
      if(!session?.user?.is_anonymous){
        const {data,error}=await sb.auth.signInAnonymously();
        if(error)throw error;
        if(!data?.user?.is_anonymous)throw Error('測試登入未成功，請稍後重試。');
      }
      const {data:{user},error:verifyError}=await sb.auth.getUser();
      if(verifyError||!user?.is_anonymous)throw Error('測試帳號驗證失敗，請稍後重試。');
      cloud.client=sb;cloud.user=user;renderAccount();
      $('accountInfo').textContent='測試帳號已登入。右下角客服中心可測試 AI、表單、客服管理與站內回覆；測試資料彼此隔離。';
      $('accountPanel').hidden=true;
      toast('測試帳號登入成功！請點右下角「客服中心」進行測試。');
      window.dispatchEvent(new CustomEvent('ti-demo-account-ready'));
    }catch(err){
      $('accountPanel').hidden=false;
      $('accountInfo').textContent='測試登入失敗：'+readableError(err);
    }finally{quick.disabled=false;panel.disabled=false;quick.textContent=previous;panel.textContent='一鍵登入測試帳號';}
  }
  $('accountDemoQuick').addEventListener('click',()=>void demoLogin());
  $('accountDemoLogin').addEventListener('click',()=>void demoLogin());
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
  $('accountGoogle').addEventListener('click',async()=>{
    const button=$('accountGoogle');button.disabled=true;
    try{
      const sb=cloud.client||await getClient();
      const {data,error}=await sb.auth.signInWithOAuth({
        provider:'google',options:{redirectTo:window.location.origin+window.location.pathname}
      });
      if(error)throw error;
      if(data?.url)window.location.assign(data.url);
      else throw Error('Google 服務未返回授權網址，請確認 Supabase 已啟用 Google 登入。');
    }catch(err){$('accountInfo').textContent='Google 登入未啟用或失敗：'+readableError(err);}
    finally{button.disabled=false;}
  });
  $('accountChangeEmail').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!cloud.user)return toast('請先登入帳戶。');
    const email=$('accountNewEmail').value.trim();
    if(!email||email===cloud.user.email)return toast('請輸入不同的有效 Email。');
    const button=e.target.querySelector('button');button.disabled=true;
    try{
      const {error}=await cloud.client.auth.updateUser({email});
      if(error)throw error;
      $('accountInfo').textContent='已提交 Email 變更要求；是否完成須依 Supabase 寄送的實際驗證信確認。';
      $('accountNewEmail').value='';
    }catch(err){$('accountInfo').textContent='更換 Email 失敗：'+readableError(err);}
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
  $('aiUsageRefresh').addEventListener('click',()=>void renderAiUsage());
  $('knowledgeSearchForm').addEventListener('submit',e=>void searchPrivateKnowledge(e));
  initTeamUI();
}
function clearUserState(){
  for(const k of Object.keys(store.saved))delete store.saved[k];
  store.watches=[];store.profile={};
  cloud.taskRows=[];persist();renderSearch();renderTracking();renderWatches();renderRadar();
  $('cloudInbox').replaceChildren(E('div','empty','請登入查看通知。'));
  $('taskList').replaceChildren(E('div','empty','請登入查看雲端待辦。'));
  $('cloudDocuments').replaceChildren(E('div','empty','請登入查看私有文件。'));
  $('knowledgeResults').replaceChildren();
  $('aiUsageHistory').replaceChildren();$('aiUsageStatus').textContent='登入後查看 AI 使用紀錄。';
  $('knowledgeStatus').textContent='請登入後使用私有文件知識庫。';
  radarFullRequest++;radarFullPage=1;radarFullTotal=0;
  $('radarFullResults').replaceChildren();$('radarFullPage').textContent='尚未查詢';
  $('radarFullStatus').textContent='請儲存關鍵字後重新查詢資料庫跨日商機。';
}
function renderAccount(){
  if(state.view==='billing')void renderBilling();
  const demo=cloud.user?.is_anonymous===true;
  $('accountButton').textContent=demo?'測試帳號已登入':cloud.user?'帳戶：'+(cloud.user.email||'已登入'):'登入／跨裝置同步';
  $('accountDemoQuick').hidden=!!cloud.user;
  $('accountDemoLogin').hidden=!!cloud.user;
  $('accountLogout').hidden=!cloud.user;
  $('accountSync').hidden=!cloud.user;
  $('accountLoginForm').hidden=!!cloud.user;
  $('accountGoogle').hidden=!!cloud.user;
  $('accountChangeEmail').hidden=!cloud.user||demo;
  if(demo)$('accountInfo').textContent='目前使用獨立測試帳號；客服管理介面只顯示你的示範工單，不會存取正式客戶資料。';
  else if(cloud.user)$('accountInfo').textContent='已驗證帳戶：'+cloud.user.email+'。追蹤、商機條件、監控與待辦由 Supabase 的 RLS 保護。';
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
  const history=st.backfill||{};
  const historyText='｜歷史回填：已完成 '+(st.backfillDays||0)+' 天，下一天 '+
    (history.next_date||'未開始')+'，目標最早 '+(history.oldest_date||'未設定')+
    (history.last_error?'，最近錯誤：'+history.last_error:'');
  $('sourceStatus').textContent=
    '資料取得方式：GET API（不是自行爬取 HTML）｜來源：'+(source.provider||'OpenFun PCC')+
    '｜自有資料庫：Supabase unapiwajmgqqtdkixaab｜公告：'+(st.notices||0).toLocaleString('zh-TW')+
    ' 筆、案件：'+(st.cases||0).toLocaleString('zh-TW')+
    '｜預定同步：每 '+(source.frequency_minutes||'?')+' 分鐘｜上次成功：'+done+
    '｜最新工作：'+(run.status||'無紀錄')+'，取得 '+(run.fetched_count||0)+' 筆公告'+historyText+
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
        stage:s.stage,notes:s.notes||'',due:s.internal_deadline||'',read_at:s.read_at||null,added_at:s.added_at
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
        notes:item.notes||'',internal_deadline:item.due||null,read_at:item.read_at||null,updated_at:new Date().toISOString()
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
  const [data,teamResponse]=await Promise.all([
   cloudNotifications(cloud.client,cloud.user),
   cloud.client.from('ti_workspace_watch_rules').select('id,keywords').limit(500)
  ]);
  const sharedTerms=new Map((teamResponse.data||[]).map(r=>[r.id,r.keywords]));
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
    }),E('span','case-tag',note.stale_at?'截止時間已更新／舊提醒失效':note.seen_at?'已讀':'未讀'));
    const ids=Array.isArray(note.match_rule_ids)?note.match_rule_ids:[];
    const related=ids.map(id=>store.watches.find(w=>w.serverId===id)?.term||
      (sharedTerms.has(id)?'團隊：'+sharedTerms.get(id):null)).filter(Boolean);
    const summary=related.length?related.join('、'):
      note.ti_watch_rules?.keywords|| (ids.length?'先前符合 '+ids.length+' 條監控規則（部分已刪除）':'來源規則待查');
    child(wrap,top,E('p','',note.reason+'｜符合 '+Math.max(1,ids.length)+' 條監控：'+summary+
      '｜'+new Date(note.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+
      (note.stale_at?'｜此提醒已因來源截止日變更而失效，請查看最新公告':'')));
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


// V7: private, RLS-protected cross-document retrieval. No AI and no external text index.
async function searchPrivateKnowledge(e){
 e.preventDefault();
 const btn=$('knowledgeSearchButton'),status=$('knowledgeStatus'),box=$('knowledgeResults');
 if(!cloud.user||!cloud.client){
  status.textContent='請登入後使用私有文件知識庫。';return;
 }
 const needle=$('knowledgeQuery').value.trim();
 if(needle.length<2){status.textContent='請輸入至少兩個字。';return;}
 const normalized=needle.normalize('NFKC').toLocaleLowerCase('zh-TW').replaceAll('臺','台');
 const userId=cloud.user.id;
 btn.disabled=true;
 box.replaceChildren();
 status.textContent='正在從你自己的私有雲端下載文件並於瀏覽器搜尋；不傳送內容給 AI…';
 try{
  const {data:docs,error}=await cloud.client.from('ti_documents')
   .select('id,filename,storage_path,bytes,mime_type')
   .eq('user_id',userId).order('created_at',{ascending:false}).limit(8);
  if(error)throw error;
  if(!docs?.length){status.textContent='尚無已保存的私有文件。';return;}
  let scanned=0,skipped=0;const failures=[],matches=[];
  for(const doc of docs){
   if(cloud.user?.id!==userId)throw Error('登入帳戶已變更；停止本次搜尋。');
   if(Number(doc.bytes||0)>15*1024*1024 || !/\.(pdf|docx|txt|md)$/i.test(doc.filename)){
    skipped++;continue;
   }
   try{
    const {data:blob,error:loadError}=await cloud.client.storage.from('ti-private-documents').download(doc.storage_path);
    if(loadError)throw loadError;
    if(blob.size>15*1024*1024)throw Error('檔案太大');
    const file=new File([blob],doc.filename,{type:doc.mime_type||blob.type});
    const pages=await parseDocument(file);
    scanned++;
    for(const page of pages){
     const text=String(page.text||'');
     // Preserve original snippets and page labels; do not generate a synthetic answer.
     const paragraphs=text.replace(/\r/g,'\n').split(/[\n。；;]+/).map(t=>t.trim().replace(/\s+/g,' ')).filter(t=>t.length>=2);
     for(const paragraph of paragraphs){
      const hay=paragraph.normalize('NFKC').toLocaleLowerCase('zh-TW').replaceAll('臺','台');
      let offset=hay.indexOf(normalized);
      if(offset===-1)continue;
      const begin=Math.max(0,offset-85),end=Math.min(paragraph.length,offset+normalized.length+150);
      matches.push({filename:doc.filename,source:page.source,
       excerpt:(begin?'…':'')+paragraph.slice(begin,end)+(end<paragraph.length?'…':'')});
      if(matches.length>=60)break;
     }
     if(matches.length>=60)break;
    }
    if(matches.length>=60)break;
   }catch(err){failures.push(doc.filename+'：'+readableError(err));}
  }
  if(cloud.user?.id!==userId)throw Error('登入帳戶已變更；搜尋結果已取消。');
  status.textContent='已檢查 '+scanned+' 份私有文件，原文命中 '+matches.length+' 段'+
   (matches.length>=60?'（最多顯示 60 段）':'')+
   (skipped?'；略過 '+skipped+' 份不支援格式／超過限制文件':'')+
   (failures.length?'；'+failures.length+' 份讀取失敗':'')+'。未把未知條款推測成結論。';
  if(!matches.length)box.append(E('div','empty','目前讀取成功的文件沒有此關鍵字；掃描型 PDF 或未解析頁面需人工核對。'));
  for(const hit of matches){
   const item=E('div','timeline-item');
   child(item,E('strong','',hit.filename+'｜'+hit.source),E('div','',hit.excerpt));box.append(item);
  }
  if(failures.length)box.append(E('p','notice warning','部分文件無法搜尋：'+failures.slice(0,3).join('；')));
 }catch(err){status.textContent='知識庫搜尋失敗：'+readableError(err);}
 finally{btn.disabled=false;}
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
  const [members,cases,tasks,comments,activity,watches,documents]=await Promise.all([
   cloud.client.from('ti_workspace_members').select('user_id,role,joined_at').eq('workspace_id',id),
   cloud.client.from('ti_workspace_cases').select('*').eq('workspace_id',id).order('updated_at',{ascending:false}),
   cloud.client.from('ti_workspace_tasks').select('*').eq('workspace_id',id).order('updated_at',{ascending:false}),
   cloud.client.from('ti_workspace_task_comments').select('id,task_id,author_id,body,created_at').eq('workspace_id',id).order('created_at',{ascending:false}).limit(200),
   cloud.client.from('ti_workspace_activity').select('id,actor_id,entity_kind,entity_id,action,summary,changed_at').eq('workspace_id',id).order('changed_at',{ascending:false}).limit(40),
   cloud.client.from('ti_workspace_watch_rules').select('*').eq('workspace_id',id).order('updated_at',{ascending:false}).limit(100),
   cloud.client.from('ti_workspace_documents').select('id,case_id,task_id,uploader_id,storage_path,filename,bytes,created_at').eq('workspace_id',id).order('created_at',{ascending:false}).limit(100)
  ]);
  for(const result of [members,cases,tasks,comments,activity,watches,documents])if(result.error)throw result.error;
  const me=members.data.find(m=>m.user_id===cloud.user.id);
  const canEdit=!!me&&me.role!=='viewer';
  const canReview=!!me&&['owner','admin'].includes(me.role);
  const memberSelect=(current='',includeEmpty=true)=>{
   const choose=E('select','');
   if(includeEmpty){const opt=E('option','','未指派');opt.value='';choose.append(opt);}
   for(const m of members.data||[]){
    const opt=E('option','',m.user_id===cloud.user.id?'我本人（'+m.role+'）':m.user_id.slice(0,8)+'…（'+m.role+'）');
    opt.value=m.user_id;choose.append(opt);
   }
   choose.value=current||'';return choose;
  };
  box.replaceChildren();
  child(box,E('h2','','團隊案件 '+(cases.data?.length||0)+' 件 · 成員 '+(members.data?.length||0)+' 人'),
    E('p','minor','你的權限：'+(me?.role||'未知')+'。跨裝置案件會存到 ti_workspace_cases；角色由 RLS 驗證。'));
  if(me?.role==='owner'){
   const ownerTools=E('div','panel');ownerTools.style.marginTop='18px';
   ownerTools.append(E('h3','','工作區擁有者管理'));
   const ownerRow=E('div','inline-form'),choose=E('select','');
   for(const member of members.data.filter(x=>x.user_id!==cloud.user.id)){
    const o=E('option','',member.user_id.slice(0,8)+'…（'+member.role+'）');
    o.value=member.user_id;choose.append(o);
   }
   const transfer=btn('轉移擁有者','ghost-btn',async()=>{
    if(!choose.value)return toast('沒有其他成員可以接管工作區。');
    if(!confirm('確定把整個工作區的擁有者權限轉移給此團隊成員？完成後你會降為管理員。'))return;
    const {error}=await cloud.client.rpc('ti_transfer_workspace_owner',{
      p_workspace:id,p_new_owner:choose.value
    });
    if(error)return toast('轉移失敗：'+readableError(error));
    toast('所有權已轉移。');void refreshWorkspaces();
   });
   transfer.disabled=!choose.value;
   child(ownerRow,choose,transfer);
   const deleteButton=btn('永久刪除整個工作區','ghost-btn',async()=>{
    const selected=$('workspaceSelect').selectedOptions?.[0]?.textContent||'';
    const typed=prompt('此操作會永久刪除所有成員共享的案件、任務及邀請。請輸入完整工作區名稱「'+selected+'」確認：');
    if(typed!==selected)return toast('工作區名稱未吻合，未刪除。');
    // Storage bytes must be deleted before metadata is cascaded, so no orphaned private files remain.
    try{
     for(let offset=0;;offset+=100){
      const {data:files,error:scan}=await cloud.client.from('ti_workspace_documents')
       .select('storage_path').eq('workspace_id',id).order('created_at').range(offset,offset+99);
      if(scan)throw scan;
      if(!files?.length)break;
      const paths=files.map(x=>x.storage_path);
      const {error:clean}=await cloud.client.storage.from('ti-workspace-documents').remove(paths);
      if(clean)throw clean;
      if(files.length<100)break;
     }
    }catch(e){return toast('無法完整清理團隊附件，已停止刪除工作區：'+readableError(e));}
    const {error}=await cloud.client.from('ti_workspaces').delete().eq('id',id).eq('owner_id',cloud.user.id);
    if(error)return toast('刪除失敗：'+readableError(error));
    selectedWorkspace='';toast('工作區及其共享內容已刪除。');void refreshWorkspaces();
   });
   child(ownerTools,ownerRow,E('p','minor','轉移所有權需對方已是成員；刪除整個工作區會影響所有成員。'),deleteButton);
   box.append(ownerTools);
  }else if(me){
   const leave=btn('退出此工作區','ghost-btn',async()=>{
    if(!confirm('確定退出此工作區？你將不再看到其共享標案與任務。'))return;
    const {error}=await cloud.client.from('ti_workspace_members').delete()
      .eq('workspace_id',id).eq('user_id',cloud.user.id);
    if(error)return toast('退出失敗：'+readableError(error));
    selectedWorkspace='';toast('已退出工作區。');void refreshWorkspaces();
   });
   box.append(leave);
  }
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
   const r=normalize({unit_id:parts[0],job_number:parts.slice(1).join('::'),unit_name:item.agency,date:null,brief:{title:item.title,type:'',category:''}});
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
   const owner=memberSelect(item.owner_id);
   owner.disabled=!canEdit;owner.title='案件負責人（只允許團隊成員）';
   owner.addEventListener('change',async()=>{
    const {error}=await cloud.client.from('ti_workspace_cases')
     .update({owner_id:owner.value||null,updated_at:new Date().toISOString()})
     .eq('workspace_id',id).eq('case_id',item.case_id);
    if(error){toast('案件指派失敗：'+readableError(error));void renderWorkspace();}
    else toast('已更新案件負責人，並保留操作紀錄。');
   });
   child(line,stage,notes,owner);wrap.append(line);box.append(wrap);
  }
  child(box,E('h3','','共用待辦'));
  if(canEdit){
   const form=E('form','inline-form');form.style.marginBottom='16px';
   const name=E('input','');name.required=true;name.maxLength=300;name.placeholder='例如：準備報價附件';
   const due=E('input','');due.type='date';
   const assignee=memberSelect();assignee.title='指定任務負責人';
   const caseRef=E('select','');caseRef.title='關聯團隊案件';
   const defaultCase=E('option','','不關聯案件');defaultCase.value='';caseRef.append(defaultCase);
   for(const record of cases.data||[]){const opt=E('option','',record.title);opt.value=record.case_id;caseRef.append(opt);}
   const submit=E('button','primary-btn','建立團隊待辦');submit.type='submit';
   form.addEventListener('submit',async e=>{
    e.preventDefault();
    const {error}=await cloud.client.from('ti_workspace_tasks').insert({
     workspace_id:id,title:name.value.trim(),due_at:due.value?due.value+'T23:59:00+08:00':null,
     assigned_to:assignee.value||null,case_id:caseRef.value||null,created_by:cloud.user.id
    });
    if(error)toast('新增待辦失敗：'+readableError(error));
    else void renderWorkspace();
   });
   child(form,name,due,assignee,caseRef,submit);box.append(form);
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
   wrap.append(head);
   const controls=E('div','inline-form');
   const responsible=memberSelect(task.assigned_to);
   responsible.disabled=!canEdit;responsible.title='任務負責人';
   responsible.addEventListener('change',async()=>{
    const {error}=await cloud.client.from('ti_workspace_tasks')
     .update({assigned_to:responsible.value||null,updated_at:new Date().toISOString()})
     .eq('id',task.id).eq('workspace_id',id);
    if(error){toast('任務指派失敗：'+readableError(error));void renderWorkspace();}
    else toast('已更新任務負責人。');
   });
   controls.append(responsible);
   const review=E('select','');
   const currentReview=task.review_status||'未送審';
   const allowedReviewOptions=currentReview==='待審核'?['待審核','通過','退回','未送審']:
    currentReview==='通過'?['通過','未送審']:
    currentReview==='退回'?['退回','待審核','未送審']:['未送審','待審核'];
   for(const s of allowedReviewOptions){
    const opt=E('option','',s);opt.value=s;review.append(opt);
   }
   review.value=currentReview;
   review.disabled=!canReview||!task.done;
   review.title='已完成任務：Owner/Admin 可核准或退回，其他編輯者只能送審';
   review.addEventListener('change',async()=>{
    const {error}=await cloud.client.from('ti_workspace_tasks')
     .update({review_status:review.value,updated_at:new Date().toISOString()})
     .eq('id',task.id).eq('workspace_id',id);
    if(error)toast('審核失敗：'+readableError(error));
    void renderWorkspace();
   });
   controls.append(review);
   if(canEdit&&task.done&&['未送審','退回'].includes(currentReview)){
    const submitReview=btn('送交審核','ghost-btn',async()=>{
     submitReview.disabled=true;
     const {error}=await cloud.client.from('ti_workspace_tasks')
      .update({review_status:'待審核',updated_at:new Date().toISOString()})
      .eq('id',task.id).eq('workspace_id',id);
     if(error){toast('送審失敗：'+readableError(error));submitReview.disabled=false;}
     else{toast('已送交團隊管理員審核。');void renderWorkspace();}
    });
    controls.append(submitReview);
   }
   wrap.append(controls);
   const discussions=E('div','detail-timeline');
   const related=(comments.data||[]).filter(m=>m.task_id===task.id).reverse().slice(-15);
   for(const comment of related){
    const when=new Date(comment.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
    discussions.append(E('p','minor',when+'｜'+(comment.author_id===cloud.user.id?'我本人':comment.author_id.slice(0,8)+'…')+'：'+comment.body));
   }
   wrap.append(discussions);
   if(canEdit){
    const form=E('form','inline-form'),input=E('input',''),send=E('button','ghost-btn','留言');
    input.maxLength=2000;input.required=true;input.placeholder='任務討論、完成證據說明';
    send.type='submit';
    form.addEventListener('submit',async e=>{
     e.preventDefault();if(!input.value.trim())return;
     const {error}=await cloud.client.from('ti_workspace_task_comments').insert({
      workspace_id:id,task_id:task.id,author_id:cloud.user.id,body:input.value.trim()
     });
     if(error)toast('留言失敗：'+readableError(error));else void renderWorkspace();
    });
    child(form,input,send);wrap.append(form);
   }
   box.append(wrap);
  }
  child(box,E('h3','','團隊共用附件'));
  box.append(E('p','minor','使用獨立私有儲存區，只有本工作區成員可查看；編輯者可上傳，只有上傳者或管理員可刪除。單檔上限 15 MB。'));
  if(canEdit){
   const form=E('form','inline-form'),file=E('input','');
   file.type='file';file.required=true;file.accept='.pdf,.docx,.txt,.md';
   file.setAttribute('aria-label','選擇團隊附件');
   const casePick=E('select','');casePick.title='附件關聯的共用案件';
   const caseDefault=E('option','','不關聯案件');caseDefault.value='';casePick.append(caseDefault);
   for(const item of cases.data||[]){
    const opt=E('option','',item.title||item.case_id);opt.value=item.case_id;casePick.append(opt);
   }
   const taskPick=E('select','');taskPick.title='附件關聯的團隊任務';
   const taskDefault=E('option','','不關聯任務');taskDefault.value='';taskPick.append(taskDefault);
   for(const item of tasks.data||[]){
    const opt=E('option','',item.title||item.id);opt.value=item.id;taskPick.append(opt);
   }
   const send=E('button','primary-btn','上傳團隊附件');send.type='submit';
   form.addEventListener('submit',async e=>{
    e.preventDefault();
    const f=file.files?.[0];if(!f)return toast('請選擇真實附件。');
    if(f.size<=0||f.size>15728640)return toast('附件容量必須介於 1 B 至 15 MB。');
    const extension=f.name.split('.').pop()?.toLowerCase()||'';
    const formats={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',md:'text/markdown'};
    const mime=formats[extension];
    if(!mime)return toast('團隊附件只支援 PDF、DOCX、TXT、MD。');
    const name=f.name.replace(/[\\/\x00-\x1f]/g,'_').slice(0,160);
    const path=id+'/'+crypto.randomUUID()+'-'+name;
    send.disabled=true;
    try{
     const {error:uploaded}=await cloud.client.storage.from('ti-workspace-documents')
      .upload(path,f,{contentType:mime,upsert:false});
     if(uploaded)throw uploaded;
     const {error:inserted}=await cloud.client.from('ti_workspace_documents').insert({
      workspace_id:id,case_id:casePick.value||null,task_id:taskPick.value||null,
      uploader_id:cloud.user.id,storage_path:path,filename:name,mime_type:mime,bytes:f.size
     });
     if(inserted){
      await cloud.client.storage.from('ti-workspace-documents').remove([path]);
      throw inserted;
     }
     toast('團隊附件已存入私有工作區。');void renderWorkspace();
    }catch(ex){toast('上傳團隊附件失敗：'+readableError(ex));}
    finally{send.disabled=false;}
   });
   child(form,file,casePick,taskPick,send);box.append(form);
  }
  if(!documents.data?.length)box.append(E('p','minor','目前尚無共用附件。'));
  for(const doc of documents.data||[]){
   const card=E('div','watch-item'),head=E('header','');
   head.append(E('strong','',doc.filename+'（'+Math.ceil(Number(doc.bytes)/1024).toLocaleString('zh-TW')+' KB）'));
   const open=btn('下載附件','ghost-btn',async()=>{
    const {data,error}=await cloud.client.storage.from('ti-workspace-documents')
     .createSignedUrl(doc.storage_path,60);
    if(error||!data?.signedUrl)return toast('無法取得團隊附件授權連結：'+readableError(error));
    window.open(data.signedUrl,'_blank','noopener,noreferrer');
   });
   head.append(open);
   if(doc.uploader_id===cloud.user.id||canReview){
    const remove=btn('刪除','ghost-btn',async()=>{
     if(!confirm('確定刪除團隊附件「'+doc.filename+'」？'))return;
     const {error:storageError}=await cloud.client.storage.from('ti-workspace-documents')
      .remove([doc.storage_path]);
     if(storageError)return toast('檔案刪除失敗：'+readableError(storageError));
     const {error}=await cloud.client.from('ti_workspace_documents')
      .delete().eq('id',doc.id).eq('workspace_id',id);
     if(error)return toast('檔案已刪除，但資料紀錄尚未清除：'+readableError(error));
     toast('團隊附件已刪除。');void renderWorkspace();
    });
    head.append(remove);
   }
   card.append(head);
   const linked=[
    doc.case_id?(cases.data||[]).find(x=>x.case_id===doc.case_id)?.title||doc.case_id:null,
    doc.task_id?(tasks.data||[]).find(x=>x.id===doc.task_id)?.title||doc.task_id:null
   ].filter(Boolean).join('｜');
   card.append(E('p','minor',(linked||'未關聯案件／任務')+'｜'+new Date(doc.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})));
   box.append(card);
  }
  child(box,E('h3','','團隊共用監控規則'));
  box.append(E('p','minor','所有成員共用關鍵字監控；只由團隊 Owner／Admin 建立或修改。命中公告時每位成員都只會收到一則同版本通知。'));
  if(canReview){
   const form=E('form','inline-form');
   const keywords=E('input','');keywords.required=true;keywords.maxLength=120;keywords.placeholder='監控關鍵字（2–120 字）';
   const excludes=E('input','');excludes.maxLength=250;excludes.placeholder='排除詞（選填，逗號分隔）';
   const agency=E('input','');agency.maxLength=80;agency.placeholder='機關代碼（選填）';
   const group=E('select','');
   for(const [value,caption] of [['','全部採購類型'],['工程','工程'],['財物','財物'],['勞務','勞務'],['未分類','未分類']]){
    const option=E('option','',caption);option.value=value;group.append(option);
   }
   const min=E('input','');min.type='number';min.min='0';min.placeholder='最低預算（選填）';
   const max=E('input','');max.type='number';max.min='0';max.placeholder='最高預算（選填）';
   const submit=E('button','primary-btn','新增共用監控');submit.type='submit';
   form.addEventListener('submit',async ev=>{
    ev.preventDefault();const lower=min.value===''?null:Number(min.value),upper=max.value===''?null:Number(max.value);
    if(keywords.value.trim().length<2||lower!==null&&lower<0||upper!==null&&upper<0||
      lower!==null&&upper!==null&&lower>upper)return toast('請確認監控關鍵字及預算區間。');
    submit.disabled=true;
    const {error}=await cloud.client.from('ti_workspace_watch_rules').insert({
     workspace_id:id,created_by:cloud.user.id,
     keywords:keywords.value.trim(),excludes:excludes.value.trim(),
     agency_id:agency.value.trim()||null,group_name:group.value||null,
     min_budget:lower,max_budget:upper
    });
    submit.disabled=false;
    if(error)toast('建立團隊規則失敗：'+readableError(error));
    else{toast('團隊共用監控已保存。');void renderWorkspace();}
   });
   child(form,keywords,excludes,agency,group,min,max,submit);box.append(form);
  }
  if(!watches.data?.length)box.append(E('p','minor','目前沒有團隊共用監控。'));
  for(const rule of watches.data||[]){
   const item=E('div','watch-item'),heading=E('header','');
   heading.append(E('strong','',rule.keywords+'｜'+(rule.enabled?'監控中':'已暫停')));
   if(canReview){
    const active=btn(rule.enabled?'暫停':'啟用','ghost-btn',async()=>{
     const {error}=await cloud.client.from('ti_workspace_watch_rules')
      .update({enabled:!rule.enabled,updated_at:new Date().toISOString()})
      .eq('id',rule.id).eq('workspace_id',id);
     if(error)toast('調整失敗：'+readableError(error));else void renderWorkspace();
    });
    const del=btn('刪除','ghost-btn',async()=>{
     if(!confirm('確定刪除這條團隊共用監控？'))return;
     const {error}=await cloud.client.from('ti_workspace_watch_rules')
      .delete().eq('id',rule.id).eq('workspace_id',id);
     if(error)toast('刪除失敗：'+readableError(error));else void renderWorkspace();
    });
    child(heading,active,del);
   }
   const desc=[
    rule.excludes?'排除 '+rule.excludes:'',
    rule.agency_id?'機關代碼 '+rule.agency_id:'',
    rule.group_name?'採購類別 '+rule.group_name:'',
    rule.min_budget!=null?'預算至少 '+Number(rule.min_budget).toLocaleString('zh-TW'):'',
    rule.max_budget!=null?'預算至多 '+Number(rule.max_budget).toLocaleString('zh-TW'):''
   ].filter(Boolean).join('｜');
   item.append(heading,E('p','minor',desc||'不限制其他條件'));box.append(item);
  }
  child(box,E('h3','','團隊成員'));
  const tb=E('table','analysis-list');
  for(const member of members.data||[]){
   const tr=E('tr','');child(tr,E('td','',member.user_id===cloud.user.id?'你本人':member.user_id.slice(0,8)+'…'),
     E('td','',member.role),E('td','',new Date(member.joined_at).toLocaleDateString('zh-TW')));tb.append(tr);
  }
  box.append(tb);
  child(box,E('h3','','最近操作紀錄'));
  if(!activity.data?.length)box.append(E('p','minor','尚無團隊操作紀錄。'));
  else for(const event of activity.data){
   const actor=event.actor_id===cloud.user.id?'我本人':event.actor_id?event.actor_id.slice(0,8)+'…':'系統';
   const when=new Date(event.changed_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
   box.append(E('p','minor',when+'｜'+actor+'｜'+event.entity_kind+' '+event.action+'｜'+event.summary));
  }
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


// ECPay subscriptions: server is the sole authority for prices, order totals and payment success.
let billingRenderSequence=0;
async function billingApi(mode,action=null){
 const url=DATABASE_URL+'/functions/v1/ti-billing'+(mode?'?mode='+encodeURIComponent(mode):'');
 const headers={'Content-Type':'application/json',apikey:PUBLISHABLE_KEY};
 if(action||mode==='status'){
  const sb=cloud.client||await getClient();
  const {data:{session},error}=await sb.auth.getSession();
  if(error||!session?.access_token)throw Error('請先登入，才能處理付款或查看帳務。');
  headers.Authorization='Bearer '+session.access_token;
 }
 const res=await fetch(url,{method:action?'POST':'GET',headers,
  ...(action?{body:JSON.stringify(action)}:{})});
 const obj=await res.json().catch(()=>({error:'金流後端回傳格式錯誤'}));
 if(!res.ok)throw Error(obj.error||'帳務服務 HTTP '+res.status);
 return obj;
}
function billingDate(iso){
 if(!iso)return '—';
 const dt=new Date(iso);
 return Number.isNaN(dt.getTime())?'—':dt.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
async function renderBilling(){
 const seq=++billingRenderSequence;
 const alertBox=$('billingAvailability');
 const current=$('billingCurrent'),orders=$('billingOrders'),cancel=$('billingCancel');
 document.querySelectorAll('[data-billing-plan]').forEach(button=>{button.disabled=true;button.textContent='查詢收款設定中…';});
 alertBox.className='notice warning';alertBox.textContent='正在檢查金流開通狀態…';
 cancel.disabled=true;
 try{
  const plans=await billingApi('plans');
  if(seq!==billingRenderSequence)return;
  for(const plan of plans.plans||[]){
   const x=document.querySelector('[data-plan-price="'+plan.code+'"]');
   if(x)x.textContent='NT$'+Number(plan.amount_twd).toLocaleString('zh-TW');
  }
  // The production checkout remains deliberately disabled until real merchant credentials are installed.
  const canPay=plans.ready===true && plans.environment==='production';
  const canRenew=canPay && plans.supports_recurring===true;
  const recurring=document.querySelector('input[name="billingMethod"][value="recurring"]');
  const oneTime=document.querySelector('input[name="billingMethod"][value="one_time"]');
  recurring.disabled=!canRenew;
  if(!canRenew)oneTime.checked=true;
  alertBox.textContent=!plans.ready
   ?'金流尚未開通：已建置綠界後端，但必須完成商家審核、部署正式 MerchantID／HashKey／HashIV，並核可收費服務後才能付款。'
   :plans.environment!=='production'
     ?'金流目前為測試模式，禁止真實收款。'
     :'綠界收款服務已開通。付款將前往綠界網站，完成後請回本站查看交易結果。';
  alertBox.className='notice '+(canPay?'':'warning');
  document.querySelectorAll('[data-billing-plan]').forEach(button=>{
   button.disabled=!canPay;button.textContent=canPay?'選擇並前往付款':'尚未開放付款';
  });
  if(!cloud.user){
   current.textContent='目前尚未登入。需先 Email 驗證登入，才能購買並保存訂閱。';
   orders.replaceChildren(E('div','minor','請先登入後查看帳務。'));
   return;
  }
  const data=await billingApi('status');
  if(seq!==billingRenderSequence)return;
  const sub=data.subscription;
  current.textContent=!sub?'目前沒有已付款方案。':
   '方案：'+({personal:'個人版',professional:'專業版',team:'團隊版'}[sub.plan_code]||sub.plan_code)+
   '｜'+(new Date(sub.current_period_end)>new Date()?'有效':'已到期')+
   '至 '+billingDate(sub.current_period_end)+
   '｜'+(sub.auto_renew?'每月自動續費':'不自動續費')+
   (sub.status==='cancelled'?'（已取消後續扣款）':'');
  cancel.disabled=!(sub?.auto_renew&&new Date(sub.current_period_end)>new Date()&&canPay);
  orders.replaceChildren();
  const rows=data.orders||[];
  if(!rows.length){orders.append(E('div','minor','目前沒有付款紀錄。'));return;}
  for(const order of rows){
   const item=E('div','watch-item');
   const method=order.payment_kind==='recurring'?'信用卡定期定額':'單次付款';
   const status={pending:'待付款',paid:'已付款',failed:'付款失敗',cancelled:'已取消'}[order.status]||order.status;
   child(item,E('strong','',({personal:'個人版',professional:'專業版',team:'團隊版'}[order.plan_code]||order.plan_code)+
     ' · NT$'+Number(order.amount_twd).toLocaleString('zh-TW')),
     E('p','minor',status+'｜'+method+'｜建立 '+billingDate(order.created_at)+(order.paid_at?'｜入帳 '+billingDate(order.paid_at):'')));
   orders.append(item);
  }
 }catch(err){
  if(seq!==billingRenderSequence)return;
  alertBox.className='notice warning';
  alertBox.textContent='目前無法確認金流是否已開通；為避免錯誤扣款，付款按鈕暫停使用。'+readableError(err);
  current.textContent='暫時無法讀取帳務資料。';
  orders.replaceChildren(E('div','minor','請稍後重新整理。'));
 }
}
function initBillingUI(){
 $('billingRefresh').addEventListener('click',()=>void renderBilling());
 document.querySelectorAll('[data-billing-plan]').forEach(button=>button.addEventListener('click',async()=>{
  if(!cloud.user){$('accountPanel').hidden=false;$('accountPanel').scrollIntoView({behavior:'smooth'});toast('請先登入再購買方案。');return;}
  const kind=document.querySelector('input[name="billingMethod"]:checked')?.value||'one_time';
  if(kind==='recurring'&&!$('billingConsent').checked){
   toast('請先確認每月自動續費條款。');$('billingConsent').focus();return;
  }
  button.disabled=true;button.textContent='正在建立安全付款訂單…';
  try{
   const data=await billingApi('',{action:'checkout',plan:button.dataset.billingPlan,kind});
   if(!data.checkout_url?.startsWith('https://payment.ecpay.com.tw/')||
      !data.fields?.CheckMacValue)throw Error('正式金流資訊不完整，已停止轉址。');
   const form=document.createElement('form');
   form.method='POST';form.action=data.checkout_url;form.hidden=true;
   for(const [key,value] of Object.entries(data.fields)){
    const field=document.createElement('input');field.type='hidden';field.name=key;field.value=String(value);form.append(field);
   }
   document.body.append(form);form.submit();
  }catch(err){
   toast('無法前往付款：'+readableError(err));
   void renderBilling();
  }
 }));
 $('billingCancel').addEventListener('click',async()=>{
  if(!confirm('確定取消未來每月自動扣款？已支付的當期仍可使用至到期日。'))return;
  const button=$('billingCancel');button.disabled=true;button.textContent='正在向金流商取消…';
  try{await billingApi('',{action:'cancel'});toast('綠界已確認取消後續自動扣款。');}
  catch(err){toast('取消未成功：'+readableError(err));}
  finally{button.textContent='取消未來自動續費';void renderBilling();}
 });
}
