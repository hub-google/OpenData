/**
 * Public tender records from Hugging Face Repositories, without Supabase, CF,
 * Workers, billing, or a private data store. Supports exact record-level search,
 * filtering, sorting, pagination, and case-detail timelines.
 *
 * Snapshot-backed, NOT live database-backed. Only publicly sourced rows live here.
 */
const ROOT='https://huggingface.co/datasets/hub-google/TenderIntelligence/resolve/main/browser/v1/';
const SNAPSHOT_DATE='2026-11-17';
const packPromises=new Map();
const now=()=>Date.now();
function norm(v){return String(v??'').toLowerCase().replaceAll('臺','台').trim();}
function dateNum(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?Number(s.replaceAll('-','')):null;}
function itemStage(t){
 const v=String(t||'');
 if(/無法決標|流標|廢標/.test(v))return '無法決標';
 if(/決標/.test(v))return '決標';
 if(/公開閱覽/.test(v))return '公開閱覽';
 if(/公開徵求廠商提供參考資料/.test(v))return '公開徵求';
 if(/更正/.test(v))return '更正';
 if(/財物變賣|標售|標租|財物出租/.test(v))return '財物標售';
 if(/招標|取得報價單|取得企劃書/.test(v))return '招標';
 if(/徵求/.test(v))return '公開徵求';
 return '其他';
}
function bucket(key){
 // SHA256 for deterministic bucket assignment; non-secret public key.
 return crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))
  .then(buf=>Array.from(new Uint8Array(buf))[0]%64)
  .then(n=>n.toString(16).padStart(2,'0'));
}
async function unpack(resp){
 const buf=await resp.arrayBuffer();
 if(new Uint8Array(buf)[0]===0x1f&&new Uint8Array(buf)[1]===0x8b){
  if(typeof DecompressionStream!=='function')
   throw Error('此瀏覽器不支援瀏覽 HF 公開壓縮索引');
  const str=await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(str);
 }
 return JSON.parse(new TextDecoder().decode(buf));
}
function pack(name){
 if(!packPromises.has(name)){
  packPromises.set(name,(async()=>{
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);
   try{
    const r=await fetch(ROOT+name,{redirect:'follow',signal:controller.signal});
    if(!r.ok)throw Error('HF 公開資料 '+name+' HTTP '+r.status);
    return unpack(r);
   }finally{clearTimeout(timeout);}
  })().catch(error=>{packPromises.delete(name);throw error}));
 }
 return packPromises.get(name);
}
export function getHFPublicSnapshotDate(){return SNAPSHOT_DATE;}
export function hfReady(){return pack('manifest.json');}
export async function hfAllCases(){return pack('ti_cases.json.gz');}
let caseMapPromise;
async function caseMap(){
 if(!caseMapPromise)caseMapPromise=hfAllCases().then(rows=>new Map(rows.map(x=>[x.id,x])));
 return caseMapPromise;
}
let searchMapPromise;
async function searchable(){
 if(!searchMapPromise)searchMapPromise=pack('ti_case_search_index.json.gz').then(rows=>new Map(rows.map(x=>[x.case_id,norm(x.searchable)])));
 return searchMapPromise;
}
let vendorMapPromise;
async function vendors(){
 if(!vendorMapPromise)vendorMapPromise=pack('ti_case_vendor_search.json.gz').then(rows=>new Map(rows.map(x=>[x.case_id,norm(x.vendor_text)])));
 return vendorMapPromise;
}
async function fullDetails(){
 const batches=Array.from({length:64},(_,n)=>n.toString(16).padStart(2,'0'));
 const all=[];
 for(let i=0;i<batches.length;i+=6){
  const chunks=await Promise.all(batches.slice(i,i+6).map(b=>pack('ti_case_details/'+b+'.json.gz')));
  for(const rows of chunks)all.push(...rows);
 }
 return new Map(all.map(x=>[x.case_id,typeof x.details==='string'?JSON.parse(x.details):x.details]));
}
let detailsMapPromise;
async function details(){return detailsMapPromise ||= fullDetails();}
function convertRecord(row,extra={}){
 return {
  unit_id:row.unit_id,job_number:row.job_number,unit_name:row.agency,
  date:row.latest_notice_date,filename:row.latest_filename||'hf-public',
  budget_amount:row.budget_amount,award_amount:row.award_amount,
  deadline_at:row.deadline_at,source_fetched_at:row.source_fetched_at,
  official_url:row.official_url,
  brief:{title:row.title,type:row.latest_notice_type,category:row.category||row.group_name},
  detail:row.official_url?{url:row.official_url}:{},
  ...(row.notice_count!==undefined?{notice_count:row.notice_count}:{}),
  ...extra
 };
}
function normalizeFilters(filters={}){
 const min=filters.minBudget===''||filters.minBudget==null?null:Number(filters.minBudget);
 const max=filters.maxBudget===''||filters.maxBudget==null?null:Number(filters.maxBudget);
 if(min!==null&&(!Number.isFinite(min)||min<0))throw Error('最低預算格式錯誤');
 if(max!==null&&(!Number.isFinite(max)||max<0))throw Error('最高預算格式錯誤');
 if(min!==null&&max!==null&&max<min)throw Error('最高預算不得低於最低預算');
 return {min,max};
}
function sortBy(mode,a,b){
 const d=(a.latest_notice_date||0),e=(b.latest_notice_date||0);
 if(mode==='title'){
  const x=a.title||'',y=b.title||'';
  const v=x.localeCompare(y,'zh-Hant');
  return v||e-d||a.id.localeCompare(b.id);
 }
 if(mode==='budget'){
  const x=a.budget_amount,y=b.budget_amount;
  if(x==null&&y!=null)return 1;
  if(y==null&&x!=null)return -1;
  return (Number(y||0)-Number(x||0))||e-d||a.id.localeCompare(b.id);
 }
 if(mode==='deadline'){
  if(!a.deadline_at&&b.deadline_at)return 1;
  if(!b.deadline_at&&a.deadline_at)return -1;
  const v=String(a.deadline_at||'').localeCompare(String(b.deadline_at||''));
  return v||e-d||a.id.localeCompare(b.id);
 }
 return e-d||a.id.localeCompare(b.id);
}
function scenarioMatches(row,scenario){
 const stage=itemStage(row.latest_notice_type);
 const deadline=Date.parse(row.deadline_at||'');
 const stillOpen=deadline>now()&&stage==='招標';
 const min=Number(row.budget_amount);
 switch(scenario){
  case 'ready':return stillOpen&&row.budget_amount!=null;
  case 'verify':return stage==='招標'&&(row.deadline_at==null||row.budget_amount==null);
  case 'early':return stage==='公開徵求'||stage==='公開閱覽';
  case 'open':return stillOpen;
  case 'soon':return stillOpen&&deadline<=now()+3*86400000;
  case 'small':return stillOpen&&row.budget_amount!=null&&min>=0&&min<=1000000;
  case 'failed':return stage==='無法決標';
  case 'amended':return /更正/.test(row.latest_notice_type||'')&&row.latest_notice_date>=taipeiTodayMinus30();
  case 'awarded':return stage==='決標';
  default:return true;
 }
}
function taipeiTodayMinus30(){
 const d=new Date(now()-30*86400000);
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Taipei'}).formatToParts(d).map(x=>[x.type,x.value]));
 return Number(fields.year+fields.month+fields.day);
}
export async function hfCaseSearch({mode='latest',query='',page=1,filters={},scenario='all'}={}){
 const term=norm(query),filter=normalizeFilters(filters);
 let modeResolved=mode==='archive'&&!term?'latest':mode;
 if(!['latest','title','archive','agency','vendor','companyId'].includes(modeResolved))
  throw Error('未支援的標案搜尋方式');
 if(modeResolved!=='latest'&&!term)throw Error('請輸入搜尋詞');
 if(term.length>120)throw Error('搜尋詞過長');
 const [all,idx,vs,det]=await Promise.all([
  hfAllCases(),
  term&&modeResolved==='title'?searchable():Promise.resolve(null),
  term&&['vendor','companyId'].includes(modeResolved)?vendors():Promise.resolve(null),
  filters.location||filters.method?details():Promise.resolve(null)
 ]);
 const from=dateNum(filters.dateStart),to=dateNum(filters.dateEnd);
 const deadlineStart=filters.deadlineStart?Date.parse(filters.deadlineStart+'T00:00:00+08:00'):null;
 const deadlineEnd=filters.deadlineEnd?Date.parse(filters.deadlineEnd+'T23:59:59+08:00'):null;
 const kind=String(filters.status||''),group=String(filters.group||'');
 const location=norm(filters.location),method=norm(filters.method);
 const matches=all.filter(row=>{
  if(term){
   if(modeResolved==='title'&&!(idx.get(row.id)||'').includes(term))return false;
   if(modeResolved==='archive'&&!norm(row.title).includes(term))return false;
   if(modeResolved==='agency'&&!(norm(row.agency+' '+row.unit_id)).includes(term))return false;
   if(['vendor','companyId'].includes(modeResolved)&&!(vs.get(row.id)||'').includes(term))return false;
   if(modeResolved==='latest'&&!(norm(row.title+' '+row.agency+' '+row.job_number)).includes(term))return false;
  }
  if(group&&group!=='全部'&&row.group_name!==group)return false;
  if(kind&&kind!=='全部'&&itemStage(row.latest_notice_type)!==kind)return false;
  if(filter.min!==null&&(row.budget_amount==null||Number(row.budget_amount)<filter.min))return false;
  if(filter.max!==null&&(row.budget_amount==null||Number(row.budget_amount)>filter.max))return false;
  if(from!==null&&Number(row.latest_notice_date)<from)return false;
  if(to!==null&&Number(row.latest_notice_date)>to)return false;
  if(deadlineStart!==null&&!(Date.parse(row.deadline_at||'')>=deadlineStart))return false;
  if(deadlineEnd!==null&&!(Date.parse(row.deadline_at||'')<=deadlineEnd))return false;
  if((location||method)&&det){
   const d=det.get(row.id);if(!d)return false;
   if(location&&!norm(d.location).includes(location))return false;
   if(method&&!norm(d.tender_method).includes(method))return false;
  }
  if(modeResolved==='latest'&&!scenarioMatches(row,scenario))return false;
  return true;
 });
 const sorter=['date','budget','title','deadline'].includes(filters.sort)?filters.sort:'date';
 matches.sort((a,b)=>sortBy(sorter,a,b));
 const limit=30,num=Math.max(1,Math.floor(Number(page)||1)),start=(num-1)*limit;
 return {
  records:matches.slice(start,start+limit).map(row=>convertRecord(row,{
    match_field:modeResolved==='title'
      ? (norm(row.title).includes(term)?'標案名稱':'公告其他索引欄位'):null
  })),
  total_records:matches.length,
  total_pages:Math.max(1,Math.ceil(matches.length/limit)),
  source:'hf-public-repository',
  snapshot_date:SNAPSHOT_DATE
 };
}
export async function hfEnrichCaseRecords(records){
 const byId=await caseMap();
 return (records||[]).map(r=>{
  const c=byId.get(String(r.unit_id)+'::'+String(r.job_number));
  if(!c)return r;
  return {...r,deadline_at:c.deadline_at,source_fetched_at:c.source_fetched_at,
   date:c.latest_notice_date??r.date,filename:c.latest_filename||r.filename,
   brief:{...(r.brief||{}),...(c.latest_notice_type?{type:c.latest_notice_type}:{})},
   detail:{...(r.detail||{}),...(c.official_url?{url:c.official_url}:{})}};
 });
}
export async function hfLatestAmounts(yyyymmdd){
 const day=Number(yyyymmdd);
 if(!/^\d{8}$/.test(String(day)))throw Error('公告日期格式不正確');
 const rows=await hfAllCases(),out=new Map();
 for(const c of rows)if(c.latest_notice_date===day)
  out.set(c.id,{budget_amount:c.budget_amount,award_amount:c.award_amount});
 return out;
}
export async function hfLatestCachedNotices({page=1,date=null}={}){
 const all=await hfAllCases();
 const dates=all.map(r=>r.latest_notice_date).filter(x=>x);
 const day=date||dates.reduce((max,x)=>Math.max(max,x),0);
 const matching=all.filter(r=>r.latest_notice_date===Number(day));
 const n=Math.max(1,Math.floor(Number(page)||1)),limit=100;
 return {records:matching.slice((n-1)*limit,n*limit).map(convertRecord),
  date:String(day),source:'hf-public-repository',total_records:matching.length,
  total_pages:Math.max(1,Math.ceil(matching.length/limit))};
}
export async function hfArchivedCaseDetail(unitId,jobNumber){
 const id=String(unitId||'')+'::'+String(jobNumber||'');
 if(!unitId||!jobNumber)throw Error('機關代碼與案號為必填');
 const byId=await caseMap(),c=byId.get(id);
 if(!c)throw Error('HF 公開快照查無此案件；請至官方資料來源核對');
 const b=await bucket(id);
 const [notices,detailRows]=await Promise.all([
  pack('ti_notices/'+b+'.json.gz'),pack('ti_case_details/'+b+'.json.gz')
 ]);
 const timeline=notices.filter(x=>x.case_id===id)
  .sort((a,b)=>(b.source_date||0)-(a.source_date||0)||String(b.filename).localeCompare(String(a.filename)));
 const d=detailRows.find(x=>x.case_id===id),details=d?.details||{},info=typeof details==='string'?JSON.parse(details):details;
 const detailFields={
  ...(info.location?{'採購資料:履約地點':info.location}:{}),
  ...(info.period?{'採購資料:履約期限':info.period}:{}),
  ...(info.tender_method?{'採購資料:招標方式':info.tender_method}:{}),
  ...(info.contact?{'標案內容:聯絡人':info.contact}:{}),
  ...(info.phone?{'標案內容:聯絡電話':info.phone}:{})
 };
 const records=(timeline.length?timeline:[{
  source_date:c.latest_notice_date,filename:c.latest_filename,
  notice_type:c.latest_notice_type,title:c.title,category:c.category,
  budget_amount:c.budget_amount,award_amount:c.award_amount,official_url:c.official_url
 }]).slice(0,500).map(n=>({
  unit_id:c.unit_id,job_number:c.job_number,unit_name:c.agency,
  date:n.source_date,filename:n.filename,budget_amount:n.budget_amount,
  award_amount:n.award_amount,
  brief:n.raw_brief&&typeof n.raw_brief==='object'?n.raw_brief:
    {title:n.title||c.title,type:n.notice_type,category:n.category||c.category},
  detail:{...(n.official_url?{url:n.official_url}:{}),
    ...(n.id&&n.id===d?.latest_notice_id?detailFields:{})}
 }));
 return {unit_name:c.agency,records,source:'hf-public-repository',
  partial_history:timeline.length>500,summary_only:!timeline.length};
}
export async function hfSourceStatus(){
 const meta=await hfReady();
 const db=meta?.files||{};
 const cases=db['ti_cases.json.gz']?.records||0;
 const notices=Object.entries(db).filter(([k])=>k.startsWith('ti_notices/'))
  .reduce((acc,[,item])=>acc+Number(item.records||0),0);
 return {
  source:{id:'openfun-pcc',provider:'OpenFun PCC',method:'HF public repository',frequency_minutes:720,
    last_success_at:meta.created_at,commercial_license_status:'商用再利用授權待確認'},
  run:{id:null,source_date:Number(SNAPSHOT_DATE.replaceAll('-','')),status:'success',
    finished_at:meta.created_at,fetched_count:cases,new_notice_count:notices},
  cases,notices,
  backfill:{next_date:null,oldest_date:null,enabled:false,last_error:null,
    last_success_at:meta.created_at,max_archive_bytes:null},
  backfillDays:0
 };
}


export async function hfHomeKpis(){
 const cases=await hfAllCases();
 const meta=await hfReady();
 const nowMs=Date.now();
 const countBy=pred=>cases.reduce((sum,c)=>sum+(pred(c)?1:0),0);
 const stage=c=>itemStage(c.latest_notice_type);
 const active=c=>stage(c)==='招標';
 const deadline=c=>Date.parse(c.deadline_at||'');
 const latest=cases.reduce((max,c)=>Math.max(max,Number(c.latest_notice_date)||0),0);
 let count=countBy(c=>c.latest_notice_date===latest),published=meta.created_at;
 try{
  const response=await fetch('https://huggingface.co/datasets/hub-google/TenderIntelligence/resolve/main/Daily/latest.json');
  if(response.ok){
   const ptr=await response.json();
   const days=Array.isArray(ptr.snapshots)?ptr.snapshots:[];
   const newest=days.reduce((best,d)=>!best||String(d.date)>String(best.date)?d:best,null);
   if(newest){
    const day=Number(String(newest.date).replaceAll('-',''));
    if(day>=latest){count=Number(newest.records);published=ptr.published_at||published;}
   }
  }
 }catch{/* The source-backed archived snapshot remains valid if daily metadata is unavailable. */}
 return {
  latest_publication_day:latest,
  latest_notice_count:count,
  total_cases:cases.length,
  verified_open:countBy(c=>active(c)&&deadline(c)>nowMs),
  due_soon:countBy(c=>active(c)&&deadline(c)>nowMs&&deadline(c)<=nowMs+3*86400000),
  failed:countBy(c=>stage(c)==='無法決標'),
  deadline_known:countBy(c=>!!c.deadline_at),
  active_unknown_deadline:countBy(c=>active(c)&&!c.deadline_at),
  budget_known:countBy(c=>c.budget_amount!=null),
  last_success_at:published
 };
}


function evaluateBooleanTree(ast, haystack,depth=0){
 if(!ast||typeof ast!=='object'||depth>12)throw Error('無效的布林搜尋條件');
 if(ast.op==='term')return haystack.includes(norm(ast.value));
 if(ast.op==='not')return !evaluateBooleanTree(ast.child,haystack,depth+1);
 if(ast.op==='and'&&Array.isArray(ast.children))return ast.children.every(x=>evaluateBooleanTree(x,haystack,depth+1));
 if(ast.op==='or'&&Array.isArray(ast.children))return ast.children.some(x=>evaluateBooleanTree(x,haystack,depth+1));
 throw Error('不支援的布林搜尋語法');
}
export async function hfAdvancedSearch(args={}){
 const terms=(args.p_terms||[]).map(norm).filter(Boolean),excluded=(args.p_exclude||[]).map(norm).filter(Boolean);
 if(terms.length>12||excluded.length>12)throw Error('查詢關鍵字超過 12 個限制');
 const needsIndex=terms.length>0||excluded.length>0||args.p_expression;
 const needsDetail=!!(args.p_location||args.p_method||args.p_decision_method);
 const [cases,idx,detailMap]=await Promise.all([
  hfAllCases(),needsIndex?searchable():Promise.resolve(null),
  needsDetail?details():Promise.resolve(null)
 ]);
 const group=String(args.p_group||''),kind=String(args.p_kind||'');
 const min=args.p_min_budget==null?null:Number(args.p_min_budget);
 const max=args.p_max_budget==null?null:Number(args.p_max_budget);
 const dateFrom=args.p_date_from==null?null:Number(args.p_date_from);
 const dateTo=args.p_date_to==null?null:Number(args.p_date_to);
 const start=args.p_deadline_start?Date.parse(args.p_deadline_start+'T00:00:00+08:00'):null;
 const end=args.p_deadline_end?Date.parse(args.p_deadline_end+'T23:59:59+08:00'):null;
 const loc=norm(args.p_location),method=norm(args.p_method),decision=norm(args.p_decision_method),agency=norm(args.p_agency);
 const matches=cases.filter(c=>{
  const hay=idx?.get(c.id)||norm(c.title+' '+c.agency+' '+c.job_number);
  if(args.p_expression&&!evaluateBooleanTree(args.p_expression,hay))return false;
  if(!args.p_expression&&terms.length&&!(args.p_any?terms.some(t=>hay.includes(t)):terms.every(t=>hay.includes(t))))return false;
  if(excluded.some(t=>hay.includes(t)))return false;
  if(agency&&!norm(c.agency+' '+c.unit_id).includes(agency))return false;
  if(kind&&kind!=='全部'&&itemStage(c.latest_notice_type)!==kind)return false;
  if(group&&group!=='全部'&&c.group_name!==group)return false;
  if(min!==null&&(c.budget_amount==null||Number(c.budget_amount)<min))return false;
  if(max!==null&&(c.budget_amount==null||Number(c.budget_amount)>max))return false;
  if(dateFrom!==null&&Number(c.latest_notice_date)<dateFrom)return false;
  if(dateTo!==null&&Number(c.latest_notice_date)>dateTo)return false;
  const deadline=Date.parse(c.deadline_at||'');
  if(start!==null&&!(deadline>=start))return false;
  if(end!==null&&!(deadline<=end))return false;
  if(args.p_deadline_only&&!(deadline>now()))return false;
  if(needsDetail){
   const d=detailMap.get(c.id);
   if(!d)return false;
   if(loc&&!norm(d.location).includes(loc))return false;
   if(method&&!norm(d.tender_method).includes(method))return false;
   if(decision&&!norm(d.decision_method).includes(decision))return false;
  }
  return true;
 });
 const sort=['date','budget','title','deadline'].includes(args.p_sort)?args.p_sort:'date';
 matches.sort((a,b)=>sortBy(sort,a,b));
 const limit=Math.max(1,Math.min(50,Number(args.p_limit)||30));
 const page=Math.max(1,Number(args.p_page)||1);
 const selected=matches.slice((page-1)*limit,page*limit);
 return {
  rows:selected.map(r=>{
   const d=detailMap?.get(r.id)||{};
   return {...r,
    verified_location:d.location||null,
    verified_tender_method:d.tender_method||null,
    verified_decision_method:d.decision_method||null
   };
  }),
  total:matches.length,source:'hf-public-repository',
  snapshot_date:SNAPSHOT_DATE
 };
}
