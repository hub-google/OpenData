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
export async function fetchArchive({page=1,search=""}={}){
  const client=await getClient();
  const from=(page-1)*100,to=from+99;
  let q=client.from("ti_cases").select("id,unit_id,job_number,title,agency,category,latest_notice_type,latest_notice_date,latest_filename,budget_amount,award_amount,official_url,source_fetched_at",{count:"exact"}).order("latest_notice_date",{ascending:false}).range(from,to);
  if(search)q=q.ilike("title","%"+search.replace(/[%_]/g,"\\$&").slice(0,80)+"%");
  const {data,count,error}=await q;
  if(error)throw error;
  return {records:(data||[]).map(r=>({
    unit_id:r.unit_id,job_number:r.job_number,unit_name:r.agency,
    date:r.latest_notice_date,filename:r.latest_filename||"db-cached",
    budget_amount:r.budget_amount,award_amount:r.award_amount,
    brief:{title:r.title,type:r.latest_notice_type,category:r.category}
  })),total_pages:Math.max(1,Math.ceil((count||0)/100)),total_records:count||0};
}
// Exact-field backup searches when the upstream API blocks browser CORS.
// All rows come from the already-ingested public government announcements.
export async function fetchBasicArchiveSearch({mode,query,page=1}={}){
  const client=await getClient();
  const {data,error}=await client.rpc("ti_basic_archive_search",{
    p_mode:mode,p_query:String(query||''),p_page:page,p_limit:100
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
export async function fetchLatestCachedNotices(){
  const client=await getClient();
  // The last publication day comes from the NOTICE ledger, not the case index.
  // Cases only retain their most recent version and would drop genuine announcements.
  const {data:head,error:headError}=await client.from("ti_notices")
    .select("source_date").order("source_date",{ascending:false}).limit(1);
  if(headError)throw headError;
  const date=Number(head?.[0]?.source_date);
  if(!/^\d{8}$/.test(String(date)))throw Error('資料庫尚無有效公告日期');
  const records=[],perPage=1000;
  for(let page=0;page<100;page++){
    const from=page*perPage;
    const {data,error}=await client.from("ti_notices")
      .select("case_id,source_date,filename,notice_type,title,category,budget_amount,award_amount,raw_brief,ti_cases!inner(unit_id,job_number,agency,title,category,budget_amount,award_amount)")
      .eq("source_date",date)
      .order("id",{ascending:true})
      .range(from,from+perPage-1);
    if(error)throw error;
    for(const n of data||[]){
      const info=n.ti_cases;
      if(!info?.unit_id||!info?.job_number)continue;
      const brief=n.raw_brief&&typeof n.raw_brief==='object'&&!Array.isArray(n.raw_brief)
        ?{...n.raw_brief,title:n.title||n.raw_brief.title||info.title,
            type:n.notice_type||n.raw_brief.type,
            category:n.category||n.raw_brief.category||info.category}
        :{title:n.title||info.title,type:n.notice_type,category:n.category||info.category};
      records.push({
        unit_id:info.unit_id,job_number:info.job_number,unit_name:info.agency,
        date:n.source_date,filename:n.filename||'db-cached',
        budget_amount:n.budget_amount??info.budget_amount,
        award_amount:n.award_amount??info.award_amount,
        brief
      });
    }
    if((data||[]).length<perPage)
      return {records,date:String(date),source:'database_notices'};
  }
  throw Error('最近一日公告超過已設定的讀取上限，請透過跨日期進階搜尋');
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
