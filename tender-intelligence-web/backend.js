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
  const {data,error}=await client.from("ti_notifications").select("id,created_at,case_id,notice_id,reason,seen_at,ti_cases(title,agency,job_number,unit_id),ti_watch_rules(keywords)")
    .eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);
  if(error)throw error;
  return data||[];
}
