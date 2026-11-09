// Public configuration only: publishable key is intended for browsers.
// Authorization is enforced by Supabase Auth + RLS, not by secrecy of this key.
export const DATABASE_PROJECT="unapiwajmgqqtdkixaab";
export const DATABASE_URL="https://unapiwajmgqqtdkixaab.supabase.co";
export const PUBLISHABLE_KEY="sb_publishable_L09XC4Tekm6cZaPTTczm3g_Aap-SOSy";
let pending=null;
export function getClient(){
  if(!pending)pending=import("https://esm.sh/@supabase/supabase-js@2.58.0").then(m=>
    m.createClient(DATABASE_URL,PUBLISHABLE_KEY,{
      auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
    })
  ).catch(e=>{pending=null;throw e});
  return pending;
}
export async function getSession(){
  const client=await getClient();
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  return data.session;
}
const CASE_PAGE_SIZE=30;
function taipeiDateNumber(value){
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value).map(p=>[p.type,p.value]));
 return Number(fields.year+fields.month+fields.day);
}
function caseFilters(query,filters={},scenario='all'){
 const status=String(filters.status||'全部'),group=String(filters.group||'全部');
 const min=filters.minBudget===''||filters.minBudget==null?null:Number(filters.minBudget);
 if(min!==null&&(!Number.isFinite(min)||min<0))throw Error('最低公開預算格式錯誤');
 if(group!=='全部'&&group)query=query.eq('group_name',group);
 if(min!==null)query=query.gte('budget_amount',min);
 if(status==='招標')query=query
   .or('latest_notice_type.ilike.%招標%,latest_notice_type.ilike.%取得報價單%,latest_notice_type.ilike.%取得企劃書%')
   .not('latest_notice_type','ilike','%公開閱覽%')
   .not('latest_notice_type','ilike','%決標%');
 else if(status==='決標')query=query.ilike('latest_notice_type','%決標%').not('latest_notice_type','ilike','%無法決標%');
 else if(status==='無法決標')query=query.or('latest_notice_type.ilike.%無法決標%,latest_notice_type.ilike.%流標%,latest_notice_type.ilike.%廢標%');
 else if(status==='更正')query=query.ilike('latest_notice_type','%更正%');
 else if(status==='公開閱覽')query=query.ilike('latest_notice_type','%公開閱覽%');
 else if(status==='公開徵求')query=query.ilike('latest_notice_type','%公開徵求廠商提供參考資料%');
 else if(status==='財物標售')query=query.or('latest_notice_type.ilike.%財物變賣%,latest_notice_type.ilike.%財物標售%,latest_notice_type.ilike.%財物出租%');
 if(scenario==='open'||scenario==='soon'){
   const now=new Date();
   query=query.gt('deadline_at',now.toISOString())
    .or('latest_notice_type.ilike.%招標%,latest_notice_type.ilike.%取得報價單%,latest_notice_type.ilike.%取得企劃書%')
    .not('latest_notice_type','ilike','%決標%').not('latest_notice_type','ilike','%公開閱覽%')
    .not('latest_notice_type','ilike','%更正%');
   if(scenario==='soon')query=query.lte('deadline_at',new Date(now.getTime()+3*86400000).toISOString());
 }else if(scenario==='failed')query=query.or('latest_notice_type.ilike.%無法決標%,latest_notice_type.ilike.%流標%,latest_notice_type.ilike.%廢標%');
 else if(scenario==='amended')query=query.ilike('latest_notice_type','%更正%')
   .gte('latest_notice_date',taipeiDateNumber(new Date(Date.now()-30*86400000)));
 else if(scenario==='awarded')query=query.ilike('latest_notice_type','%決標%').not('latest_notice_type','ilike','%無法決標%');
 return query;
}
// Every non-keyword feed applies filters and sorting BEFORE server pagination.
// One source page equals one user-visible page; no second in-memory pager.
export async function fetchArchive({page=1,search='',filters={},scenario='all'}={}){
 const client=await getClient(),current=Math.max(1,Math.trunc(Number(page)||1));
 const from=(current-1)*CASE_PAGE_SIZE;
 let q=client.from('ti_cases').select('id,unit_id,job_number,title,agency,category,group_name,latest_notice_type,latest_notice_date,latest_filename,budget_amount,award_amount,official_url,deadline_at,source_fetched_at',{count:'exact'});
 const term=String(search||'').trim();
 if(term)q=q.ilike('title','%'+term.replace(/[%_]/g,'\\$&').slice(0,80)+'%');
 q=caseFilters(q,filters,scenario);
 const sort=filters.sort||'date';
 if(sort==='budget')q=q.order('budget_amount',{ascending:false,nullsFirst:false});
 else if(sort==='title')q=q.order('title',{ascending:true});
 else q=q.order('latest_notice_date',{ascending:false});
 q=q.order('id',{ascending:true}).range(from,from+CASE_PAGE_SIZE-1);
 const {data,count,error}=await q;
 if(error)throw error;
 return {records:(data||[]).map(r=>({
  unit_id:r.unit_id,job_number:r.job_number,unit_name:r.agency,
  date:r.latest_notice_date,filename:r.latest_filename||'db-cached',
  budget_amount:r.budget_amount,award_amount:r.award_amount,
  deadline_at:r.deadline_at,source_fetched_at:r.source_fetched_at,
  brief:{title:r.title,type:r.latest_notice_type,category:r.category||r.group_name},
  detail:r.official_url?{url:r.official_url}:{}
 })),total_pages:Math.max(1,Math.ceil((count||0)/CASE_PAGE_SIZE)),total_records:count??null,source:'case_feed'};
}
// Match all search modes to verified case metadata, never infer a deadline
// from a title or a prior award notice.
export async function enrichCaseRecords(records){
 const source=Array.isArray(records)?records:[];
 const ids=[...new Set(source.filter(r=>r?.unit_id&&r?.job_number).map(r=>String(r.unit_id)+'::'+String(r.job_number)))].slice(0,100);
 if(!ids.length||source.every(r=>Object.hasOwn(r,'deadline_at')))return source;
 const client=await getClient();
 const {data,error}=await client.from('ti_cases').select('id,deadline_at,source_fetched_at,official_url,latest_notice_type,latest_notice_date,latest_filename').in('id',ids);
 if(error)throw error;
 const byId=new Map((data||[]).map(r=>[r.id,r]));
 return source.map(r=>{
  const m=byId.get(String(r.unit_id)+'::'+String(r.job_number));
  return m?{...r,deadline_at:m.deadline_at,source_fetched_at:m.source_fetched_at,
    date:m.latest_notice_date??r.date,filename:m.latest_filename||r.filename,
    brief:{...(r.brief||{}),...(m.latest_notice_type?{type:m.latest_notice_type}:{})},
    detail:{...(r.detail||{}),...(m.official_url?{url:m.official_url}:{})}}:r;
 });
}
// One canonical case search contract across homepage, title, archive, agency
// and vendor searches. All filters, counts, ordering and paging run in SQL.
export async function fetchCaseSearch({
 mode='latest',query='',page=1,filters={},scenario='all'
}={}){
 const client=await getClient();
 const amount=filters.minBudget===''||filters.minBudget==null?null:Number(filters.minBudget);
 if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw Error('最低公開預算格式不正確');
 const m=mode==='archive'&&!String(query||'').trim()?'latest':mode;
 const args={
  p_mode:m,p_term:String(query||'').trim(),
  p_kind:filters.status==='全部'?'':String(filters.status||''),
  p_group:filters.group==='全部'?'':String(filters.group||''),
  p_min_budget:amount,
  p_sort:['date','budget','title'].includes(filters.sort)?filters.sort:'date',
  p_scenario:mode==='latest'?scenario:'all',
  p_page:Math.max(1,Math.trunc(Number(page)||1)),p_limit:30
 };
 // Preserve exact criteria on retry. Do not quietly drop filters when the RPC fails.
 let data,error;
 for(let i=0;i<2;i++){
  const response=await client.rpc('ti_case_search_v2',args);
  data=response.data;error=response.error;
  if(!error||!/statement timeout|canceling statement|57014/i.test(String(error.message||error)))break;
 }
 if(error)throw error;
 if(!data||!Array.isArray(data.records))throw Error('資料庫搜尋結果格式不正確');
 return data;
}

// Exact-field backup searches when the upstream API blocks browser CORS.
// All rows come from the already-ingested public government announcements.
export async function fetchBasicArchiveSearch({mode,query,page=1}={}){
  const client=await getClient();
  const {data,error}=await client.rpc("ti_basic_archive_search",{
    p_mode:mode,p_query:String(query||''),p_page:page,p_limit:30
  });
  if(error)throw error;
  if(!data||!Array.isArray(data.records))throw Error('資料庫未提供有效的搜尋結果');
  return data;
}
// Cross-check latest OpenFun daily summaries with source-derived amounts already
// ingested into the public case index. Daily list summaries omit budget_amount.
export async function fetchLatestAmounts(yyyymmdd){
  const day=String(yyyymmdd||'');
  if(!/^\d{8}$/.test(day))throw Error('公告日期格式不正確');
  const client=await getClient();
  const amounts=new Map();
  const perPage=1000;
  for(let page=0;page<100;page++){
    const from=page*perPage;
    const {data,error}=await client.from("ti_cases")
      .select("unit_id,job_number,budget_amount,award_amount")
      .eq("latest_notice_date",Number(day))
      .order("id",{ascending:true})
      .range(from,from+perPage-1);
    if(error)throw error;
    for(const row of data||[]){
      amounts.set(String(row.unit_id)+"::"+String(row.job_number),{
        budget_amount:row.budget_amount,award_amount:row.award_amount
      });
    }
    if((data||[]).length<perPage)return amounts;
  }
  throw Error('單日案件數超過核對上限，請改由詳細查詢確認');
}
// When OpenFun rejects cross-origin fetches, read the latest successfully
// ingested official announcements instead of rendering an empty homepage.
// This is clearly labelled cached data, never claimed to be a live API response.
// Homepage: a procurement case appears once. ti_notices preserves its timeline.
export async function fetchLatestCachedNotices({page=1,date:requestedDate=null}={}){
 const client=await getClient(),perPage=100;
 const currentPage=Math.max(1,Math.trunc(Number(page)||1));
 let day=Number(requestedDate);
 async function readPage(){
  if(!/^\d{8}$/.test(String(day))){
   const {data,error}=await client.from('ti_cases')
    .select('latest_notice_date').not('latest_notice_date','is',null)
    .order('latest_notice_date',{ascending:false}).limit(1);
   if(error)throw error;
   day=Number(data?.[0]?.latest_notice_date);
  }
  if(!/^\d{8}$/.test(String(day)))throw Error('資料庫尚無有效標案日期');
  const start=(currentPage-1)*perPage;
  let response;
  for(let i=0;i<2;i++){
   response=await client.from('ti_cases')
    .select('id,unit_id,job_number,title,agency,category,latest_notice_type,latest_notice_date,latest_filename,budget_amount,award_amount,official_url',{count:'exact'})
    .eq('latest_notice_date',day).order('id',{ascending:true}).range(start,start+perPage-1);
   if(!response.error||i===1||!/statement timeout|canceling statement|500|server error/i.test(String(response.error.message||'')))break;
   await new Promise(resolve=>setTimeout(resolve,350));
  }
  if(response.error)throw response.error;
  const records=(response.data||[]).filter(r=>r.unit_id&&r.job_number).map(r=>({
   unit_id:r.unit_id,job_number:r.job_number,unit_name:r.agency,
   date:r.latest_notice_date,filename:r.latest_filename||'db-cached',
   budget_amount:r.budget_amount,award_amount:r.award_amount,
   brief:{title:r.title,type:r.latest_notice_type,category:r.category},
   detail:r.official_url?{url:r.official_url}:{}
  }));
  const known=response.count!==null&&response.count!==undefined&&Number.isFinite(Number(response.count));
  const total=known?Number(response.count):null;
  return {records,date:String(day),source:'database_cases',total_records:total,
   total_pages:known?Math.max(1,Math.ceil(total/perPage))
    :currentPage+((response.data||[]).length===perPage?1:0)};
 }
 try{return await readPage();}
 catch(error){
  try{
   const archive=await fetchArchive({page:currentPage});
   return {...archive,date:String(archive.records[0]?.date||''),
    source:'case_fallback',source_error:String(error?.message||error).slice(0,200)};
  }catch(backup){throw Error('最新標案與歷史備援都無法讀取：'+String(error?.message||error));}
 }
}
// Exact-case history fallback for browsers blocked by upstream CORS.
// Return only source-backed records already ingested in Supabase. Detail fields
// with no original evidence stay null, not fabricated or inferred.
export async function fetchArchivedCaseDetail(unitId,jobNumber){
  const unit=String(unitId||''),job=String(jobNumber||'');
  if(!unit||!job||unit.length>80||job.length>100)throw Error('機關代碼或案號格式不正確');
  const id=unit+'::'+job,client=await getClient();
  const [caseResult,noticesResult,detailResult]=await Promise.all([
    client.from('ti_cases').select('id,unit_id,job_number,title,agency,category,latest_notice_type,latest_notice_date,latest_filename,budget_amount,award_amount,official_url,deadline_at').eq('id',id).maybeSingle(),
    client.from('ti_notices').select('id,source_date,filename,notice_type,title,category,budget_amount,award_amount,official_url,raw_brief,company_names,company_ids,company_role_keys').eq('case_id',id).order('source_date',{ascending:false}).order('filename',{ascending:false}).limit(501),
    client.from('ti_case_details').select('latest_notice_id,details').eq('case_id',id).maybeSingle()
  ]);
  for(const response of [caseResult,noticesResult,detailResult])if(response.error)throw response.error;
  const item=caseResult.data;
  if(!item)throw Error('自有資料庫尚未收錄此機關代碼與案號，請以政府官方公告核對');
  const notices=noticesResult.data||[];
  const detail=detailResult.data?.details||{};
  const sourceFields={
    ...(detail.location?{'採購資料:履約地點':detail.location}:{}),
    ...(detail.period?{'採購資料:履約期限':detail.period}:{}),
    ...(detail.deposit?{'領投開標:押標金額度':detail.deposit}:{}),
    ...(detail.qualification?{'採購資料:廠商應附具之基本資格證明文件或物品':detail.qualification}:{}),
    ...(detail.tender_method?{'採購資料:招標方式':detail.tender_method}:{}),
    ...(detail.decision_method?{'採購資料:決標方式':detail.decision_method}:{})
  };
  const records=(notices.length?notices:[{
    source_date:item.latest_notice_date,filename:item.latest_filename,
    notice_type:item.latest_notice_type,title:item.title,category:item.category,
    budget_amount:item.budget_amount,award_amount:item.award_amount,
    official_url:item.official_url,raw_brief:null
  }]).slice(0,500).map(n=>({
    unit_id:unit,job_number:job,unit_name:item.agency,
    date:n.source_date,filename:n.filename,
    budget_amount:n.budget_amount,award_amount:n.award_amount,
    brief:n.raw_brief&&typeof n.raw_brief==='object'
      ?n.raw_brief:{title:n.title||item.title,type:n.notice_type,category:n.category||item.category},
    detail:{
      ...(n.official_url?{url:n.official_url}:{}),
      ...(n.id&&n.id===detailResult.data?.latest_notice_id?sourceFields:{})
    }
  }));
  return {unit_name:item.agency,records,source:'ingested_archive',
    partial_history:notices.length>500,
    summary_only:!notices.length};
}
export async function fetchAgencyConfirmedWinners(unitId){
  const id=String(unitId||'').trim();
  if(!id||id.length>80)throw Error('機關代碼無效');
  const client=await getClient();
  const {data,error}=await client.rpc('ti_agency_confirmed_winners',{p_unit_id:id,p_limit:20});
  if(error)throw error;
  return data;
}
export async function fetchAgencyArchivedAnnual(unitId){
  const id=String(unitId||'').trim();
  if(!id||id.length>80)throw Error('機關代碼無效');
  const client=await getClient();
  const {data,error}=await client.rpc('ti_agency_archived_annual',{p_unit_id:id});
  if(error)throw error;
  return data;
}
export async function fetchSourceStatus(){
 const client=await getClient();
 const [source,run,coverage,backfill,days,notices]=await Promise.all([
  client.from("ti_sources").select("id,provider,method,frequency_minutes,last_success_at,last_error,commercial_license_status").eq("id","openfun-pcc").maybeSingle(),
  client.from("ti_ingest_runs").select("id,source_date,status,fetched_count,new_notice_count,detail_count,finished_at,error_summary").order("id",{ascending:false}).limit(1).maybeSingle(),
  client.from("ti_cases").select("id",{head:true,count:"exact"}),
  client.from("ti_backfill_state").select("next_date,oldest_date,enabled,last_error,last_success_at,max_archive_bytes").eq("id","openfun-pcc").maybeSingle(),
  client.from("ti_backfill_days").select("source_date",{head:true,count:"exact"}),
  client.from("ti_notices").select("id",{head:true,count:"exact"})
 ]);
 for(const result of [source,run,coverage,backfill,days,notices])if(result.error)throw result.error;
 return {source:source.data,run:run.data,cases:coverage.count||0,
   notices:notices.count||0,backfill:backfill.data,backfillDays:days.count||0};
}
export async function readAccount(client){
  const {data:{user},error}=await client.auth.getUser();
  if(error)throw error;
  return user||null;
}
export async function cloudSaved(client,user){
  const {data,error}=await client.from("ti_saved_cases").select("*").eq("user_id",user.id).order("added_at",{ascending:false}).limit(1000);
  if(error)throw error;
  return data||[];
}
export async function cloudWatches(client,user){
  const {data,error}=await client.from("ti_watch_rules").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);
  if(error)throw error;
  return data||[];
}
export async function cloudNotifications(client,user){
  const {data,error}=await client.from("ti_notifications").select("id,created_at,case_id,notice_id,reason,seen_at,stale_at,stale_reason,match_rule_ids,ti_cases(title,agency,job_number,unit_id),ti_watch_rules(keywords)")
    .eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);
  if(error)throw error;
  return data||[];
}


// Same indexed official-case dataset as the advanced-search fast path.
// Return the total number of matching cases, not only one capped 100-row batch.
export async function fetchUnifiedTitleSearch(query,page=1,filters={}){
 const term=String(query||'').trim();
 if(term.length<2||term.length>60||/[%_\\]/.test(term))throw Error('跨日全文搜尋請輸入 2–60 字，且不要包含 %、_ 或反斜線');
 const client=await getClient();
 const status=String(filters.status||''),group=String(filters.group||'');
 const kind=status==='財物標售'?'財物變賣':status==='全部'?'':status;
 const min=filters.minBudget===''||filters.minBudget==null?null:Number(filters.minBudget);
 const sort=['date','budget','title'].includes(filters.sort)?filters.sort:'date';
 if(min!==null&&(!Number.isFinite(min)||min<0))throw Error('最低公開預算格式錯誤');
 const args={p_term:term,p_kind:kind,p_group:group==='全部'?'':group,
  p_min_budget:min,p_sort:sort,p_page:page,p_limit:30};
 let data,error;
 // SQL statement timeouts can happen while thousands of notices are ingested.
 // Retry the exact same source-backed query; never drop user filters or fabricate rows.
 for(let attempt=0;attempt<3;attempt++){
  const response=await client.rpc('ti_fast_archive_filtered',args);
  data=response.data;error=response.error;
  if(!error||!/statement timeout|canceling statement|code.*57014/i.test(String(error.message||error)))break;
  if(attempt<2)await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
 }
 if(error)throw error;
 const rows=Array.isArray(data?.rows)?data.rows:[];
 const total=Number(data?.total??0);
 return {
  records:rows.map(r=>({
   unit_id:r.unit_id,job_number:r.job_number,unit_name:r.agency,
   date:r.latest_notice_date,filename:r.latest_filename||'db-cached',
   budget_amount:r.budget_amount,award_amount:r.award_amount,
   match_field:r.match_field||null,
   brief:{title:r.title,type:r.latest_notice_type,category:r.category||r.group_name},
   detail:r.official_url?{url:r.official_url}:{}
  })),
  total_records:Number.isFinite(total)?total:0,
  total_pages:Math.max(1,Math.ceil((Number.isFinite(total)?total:0)/30))
 };
}
