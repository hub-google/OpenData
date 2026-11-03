// @ts-nocheck -- Runtime Deno parser check; strict typing to be completed separately.
// Scheduled API importer: OpenFun PCC (public API, no scraping).
// The cron token is stored in Supabase Vault; no browser or GitHub secret is required.
const SRC="https://pcc-api.openfun.app/api", DB_URL=Deno.env.get("SUPABASE_URL")||"",
 KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const text=v=>v==null?"":String(v);
const num=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(text(v).replace(/[,元NT$新臺幣\s]/g,""));return Number.isFinite(n)&&n>=0?n:null};
async function json(url,ms=35000){
 const r=await fetch(url,{signal:AbortSignal.timeout(ms),headers:{Accept:"application/json"}});
 if(!r.ok)throw Error("upstream "+r.status+" "+new URL(url).pathname);
 const d=await r.json();if(!d||typeof d!=="object")throw Error("invalid upstream response");return d;
}
async function db(route,method="GET",body=null,prefer=""){
 const h={apikey:KEY,Authorization:"Bearer "+KEY,"Content-Type":"application/json"};
 if(prefer)h.Prefer=prefer;
 const r=await fetch(DB_URL+"/rest/v1/"+route,{method,headers:h,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(50000)});
 const s=await r.text();if(!r.ok)throw Error("database "+r.status+" "+route.split("?")[0]+" "+s.slice(0,220));
 try{return s?JSON.parse(s):null}catch{return s}
}
async function batches(table,rows,ignore=false){
 let inserted=0;
 for(let n=0;n<rows.length;n+=125){
  const r=await db(table+"?on_conflict=id"+(ignore?"&select=id":""),"POST",rows.slice(n,n+125),
   ignore?"resolution=ignore-duplicates,return=representation":"resolution=merge-duplicates,return=minimal");
  if(ignore&&Array.isArray(r))inserted+=r.length;
 }
 return inserted;
}
function norm(r,stamp){
 const unit=text(r?.unit_id),job=text(r?.job_number),fn=text(r?.filename),dt=Number(r?.date);
 if(!unit||!job||!fn||!Number.isInteger(dt)||dt<19990101||dt>20991231)return null;
 const b=r.brief||{},t=text(b.type),title=text(b.title)||"來源未提供案名",cat=text(b.category);
 const g=cat.startsWith("工程")?"工程":cat.startsWith("財物")?"財物":cat.startsWith("勞務")?"勞務":"未分類";
 const id=unit+"::"+job,companies=b.companies||{};
 return {c:{id,unit_id:unit,job_number:job,title:title.slice(0,800),agency:text(r.unit_name).slice(0,450)||null,
 category:cat.slice(0,700)||null,group_name:g,latest_notice_type:t||null,
 latest_notice_date:dt,budget_amount:num(r.budget_amount),award_amount:num(r.award_amount),
 official_url:null,latest_filename:fn,source_fetched_at:stamp},
 n:{id:id+"::"+dt+"::"+fn,case_id:id,source_date:dt,filename:fn,notice_type:t||null,
 title:title.slice(0,800),category:cat.slice(0,700)||null,
 budget_amount:num(r.budget_amount),award_amount:num(r.award_amount),official_url:null,
 company_ids:Array.isArray(companies.ids)?companies.ids.map(text).slice(0,100):[],
 company_names:Array.isArray(companies.names)?companies.names.map(text).slice(0,100):[],
 company_role_keys:companies.name_key&&typeof companies.name_key==="object"?companies.name_key:{},
 raw_brief:b,fetched_at:stamp}};
}
function rocDate(v){
 const m=text(v).match(/^(\d{3,4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
 if(!m)return null;
 const y=Number(m[1])<1911?Number(m[1])+1911:Number(m[1]);
 const iso=String(y)+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0")+"T"+String(m[4]||0).padStart(2,"0")+":"+String(m[5]||0).padStart(2,"0")+":00+08:00";
 const d=new Date(iso);return Number.isFinite(d.getTime())?d.toISOString():null;
}
const pick=(obj,label)=>{
 if(!obj||typeof obj!=="object")return null;
 const k=Object.keys(obj).find(k=>k===label||k.endsWith(":"+label));
 return k?obj[k]:null;
};
const official=u=>{try{const x=new URL(text(u));return x.protocol==="https:"&&x.hostname==="web.pcc.gov.tw"?x.href:null}catch{return null}};
async function enrich(c){
 const src=SRC+"/tender?"+new URLSearchParams({unit_id:c.unit_id,job_number:c.job_number});
 const result=await json(src,22000),records=Array.isArray(result.records)?result.records:[];
 if(!records.length)return false;
 records.sort((a,b)=>Number(b.date||0)-Number(a.date||0));
 const latest=records[0],bid=records.find(x=>/招標|徵求|閱覽/.test(text(x?.brief?.type)));
 // Source-derived amounts only. The daily list API commonly has no money fields.
 // Never infer budget from award or vice versa.
 const valueFrom=(record,labels)=>{
  if(!record)return null;
  for(const name of labels){
    const raw=pick(record.detail,name);
    if(raw===null||raw===undefined)continue;
    const amount=num(raw);
    if(amount!==null)return amount;
  }
  return null;
 };
 const budget=records.map(r=>valueFrom(r,["預算金額"])).find(v=>v!==null)??null;
 const award=records.filter(r=>/決標/.test(text(r?.brief?.type))&&!/無法決標/.test(text(r?.brief?.type)))
   .map(r=>valueFrom(r,["總決標金額","決標金額"])).find(v=>v!==null)??null;
 const detail=bid?.detail||{},link=official(latest.detail?.url)||official(detail.url);
 const fields={deadline_at:rocDate(pick(detail,"截止投標")),opening_at:rocDate(pick(detail,"開標時間")),
  location:text(pick(detail,"履約地點"))||null,period:text(pick(detail,"履約期限")).slice(0,4000)||null,
  deposit:text(pick(detail,"押標金額度")).slice(0,1000)||null,
  qualification:text(pick(detail,"廠商應附具之基本資格證明文件或物品")).slice(0,10000)||null,
  tender_method:text(pick(detail,"招標方式"))||null,decision_method:text(pick(detail,"決標方式"))||null,
  official_page:link,source_api:src,budget_amount:budget,award_amount:award};
 await db("ti_case_details?on_conflict=case_id","POST",[{case_id:c.id,latest_notice_id:c.id+"::"+latest.date+"::"+latest.filename,
  details:fields,records_count:records.length,fetched_at:new Date().toISOString()}],
  "resolution=merge-duplicates,return=minimal");
 const casePatch={};
 if(link)casePatch.official_url=link;
 if(fields.deadline_at)casePatch.deadline_at=fields.deadline_at;
 if(budget!==null)casePatch.budget_amount=budget;
 if(award!==null)casePatch.award_amount=award;
 if(Object.keys(casePatch).length)await db("ti_cases?id=eq."+encodeURIComponent(c.id),"PATCH",casePatch,"return=minimal");
 // The matching published notice keeps its own amount provenance.
 for(const notice of records){
   const partial={};
   const b=valueFrom(notice,["預算金額"]);
   const a=/決標/.test(text(notice?.brief?.type))&&!/無法決標/.test(text(notice?.brief?.type))
      ?valueFrom(notice,["總決標金額","決標金額"]):null;
   if(b!==null)partial.budget_amount=b;
   if(a!==null)partial.award_amount=a;
   const noticeLink=official(notice?.detail?.url);
   if(noticeLink)partial.official_url=noticeLink;
   if(Object.keys(partial).length){
     const nid=c.id+"::"+notice.date+"::"+notice.filename;
     await db("ti_notices?id=eq."+encodeURIComponent(nid),"PATCH",partial,"return=minimal");
   }
 }
 return true;
}
// Background completeness pass: fetch REAL details for archived cases without
// hallucinating budget, deadline, official link or contract terms.
async function enrichMissingDetails(){
 const candidates=await db("rpc/ti_pick_details_enrichment","POST",{p_limit:6});
 if(!Array.isArray(candidates))throw Error("detail enrichment queue unavailable");
 let success=0,failed=0;
 const problems=[];
 // Strict bounded concurrency: avoid unbounded requests to the public source.
 for(let offset=0;offset<candidates.length;offset+=2){
  await Promise.all(candidates.slice(offset,offset+2).map(async c=>{
   let reason="",ok=false;
   try{ok=await enrich({id:c.case_id,unit_id:c.unit_id,job_number:c.job_number});
      if(!ok)reason="source returned no official detail records";
   }catch(e){reason=text(e).slice(0,220)}
   const id=encodeURIComponent(c.case_id);
   try{
    const previous=await db("ti_detail_enrichment_attempts?select=attempts&case_id=eq."+id+"&limit=1");
    const attempts=Math.min(999,Number(previous?.[0]?.attempts||0)+1);
    const delayHours=ok?0:Math.min(72,Math.pow(2,Math.min(5,attempts)));
    await db("ti_detail_enrichment_attempts?on_conflict=case_id","POST",[{
      case_id:c.case_id,attempts,last_attempt_at:new Date().toISOString(),
      next_retry_at:new Date(Date.now()+delayHours*3600000).toISOString(),
      success_at:ok?new Date().toISOString():null,
      last_error:ok?null:reason||"detail enrichment incomplete"
    }],"resolution=merge-duplicates,return=minimal");
   }catch(e){console.error("detail queue save failed",text(e).slice(0,150));reason+="; queue-save error"}
   if(ok)success++;else {failed++;problems.push({case_id:c.case_id,error:reason})}
  }));
 }
 return {ok:true,mode:"details",attempted:candidates.length,succeeded:success,failed,
  result:candidates.length?"processed":"no eligible source records",errors:problems.slice(0,3)};
}
async function ingest(mode){
 let run=null,day=null,found=0,added=0,details=0,backfillDate=null;
 try{
  let date;
  if(mode==="retry"){
    const due=await db("ti_backfill_gaps?select=source_date&resolved_at=is.null&next_retry_at=lte."+
      encodeURIComponent(new Date().toISOString())+"&order=source_date.asc&limit=1");
    if(!due?.length)return {ok:true,mode:"retry",status:"paused",reason:"no source gaps currently eligible"};
    date=due[0].source_date;backfillDate=date;
  }else if(mode==="backfill"){
    const ready=await db("rpc/ti_backfill_ready","POST",{});
    if(!ready)return {ok:true,mode:"backfill",status:"paused",reason:"日期範圍已完成、暫停或達到自訂資料庫容量上限"};
    const state=await db("ti_backfill_state?select=next_date,oldest_date,enabled&id=eq.openfun-pcc&limit=1");
    if(!state?.length||!state[0].enabled)throw Error("history backfill control unavailable");
    date=state[0].next_date;
    backfillDate=date;
  }else{
    const info=await json(SRC+"/getinfo");
    const iso=text(info["最新資料時間"]).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw Error("source latest date unavailable");
    date=iso;
    if(mode==="previous"){const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-1);date=d.toISOString().slice(0,10)}
  }
  day=Number(date.replaceAll("-",""));
  const runs=await db("ti_ingest_runs","POST",[{source_date:day,status:"running"}],"return=representation");
  run=runs?.[0]?.id;
  if(!run)throw Error("ingest run initialization failed");
  const list=await json(SRC+"/listbydate?date="+day,45000);
  if(!Array.isArray(list.records))throw Error("source response is missing records");
  if(list.records.length===0 && !["backfill","retry"].includes(mode))throw Error("source returned no announcements");
  const at=new Date().toISOString(),notices=new Map(),cases=new Map();
  for(const row of list.records){
   const x=norm(row,at);if(!x)continue;
   notices.set(x.n.id,x.n);const p=cases.get(x.c.id);
   if(!p||x.c.latest_notice_date>p.latest_notice_date||
     (x.c.latest_notice_date===p.latest_notice_date&&x.c.latest_filename>p.latest_filename))cases.set(x.c.id,x.c);
  }
  found=notices.size;if(found===0 && list.records.length>0)throw Error("source had no valid notices");
  await batches("ti_cases",[...cases.values()]);
  added=await batches("ti_notices",[...notices.values()],true);
  // Backfill runs have a tighter detail quota to keep old-year imports cheap.
  const cached=await db("ti_case_details?select=case_id&limit=10000");
  const known=new Set((cached||[]).map(x=>x.case_id));
  const detailsQuota=["backfill","retry"].includes(mode)?2:15;
  for(const c of [...cases.values()].filter(x=>!known.has(x.id)&&/招標|決標|更正/.test(x.latest_notice_type||"")).slice(0,detailsQuota)){
   try{if(await enrich(c))details++}catch(e){console.warn("detail unavailable",c.id,text(e).slice(0,130))}
  }
  const finished=new Date().toISOString();
  await db("ti_ingest_runs?id=eq."+run,"PATCH",
   {finished_at:finished,status:"success",fetched_count:found,new_notice_count:added,detail_count:details},"return=minimal");
  if(mode==="backfill"||mode==="retry"){
    await db("ti_backfill_days?on_conflict=source_date","POST",[
      {source_date:backfillDate,fetched_count:found,inserted_count:added,finished_at:finished}
    ],"resolution=merge-duplicates,return=minimal");
    await db("ti_backfill_gaps?source_date=eq."+backfillDate,"PATCH",{
      resolved_at:finished,last_attempt_at:finished
    },"return=minimal");
    if(mode==="backfill"){
      const next=new Date(backfillDate+"T12:00:00Z");
      next.setUTCDate(next.getUTCDate()-1);
      await db("ti_backfill_state?id=eq.openfun-pcc","PATCH",{
        next_date:next.toISOString().slice(0,10),last_success_at:finished,
        last_attempt_at:finished,last_error:null
      },"return=minimal");
    }
  }else{
    await db("ti_sources?id=eq.openfun-pcc","PATCH",{last_success_at:finished,last_error:null,updated_at:finished},"return=minimal");
  }
  return {ok:true,mode,date:day,announcements:found,new_notices:added,details_enriched:details,finished_at:finished};
 }catch(e){
  const msg=text(e).slice(0,300),finished=new Date().toISOString();console.error("ingest failed",msg);
  if(run)try{await db("ti_ingest_runs?id=eq."+run,"PATCH",
   {finished_at:finished,status:"error",fetched_count:found,new_notice_count:added,detail_count:details,error_summary:msg},"return=minimal")}catch{}
  if(mode==="backfill"||mode==="retry")try{
    if(backfillDate){
      const existing=await db("ti_backfill_gaps?select=attempts&source_date=eq."+backfillDate+"&limit=1");
      await db("ti_backfill_gaps?on_conflict=source_date","POST",[{
        source_date:backfillDate,error_summary:msg,
        attempts:Number(existing?.[0]?.attempts||0)+1,
        last_attempt_at:finished,next_retry_at:new Date(Date.now()+4*3600000).toISOString(),
        resolved_at:null
      }],"resolution=merge-duplicates,return=minimal");
    }
    if(mode==="backfill"&&backfillDate){
      const next=new Date(backfillDate+"T12:00:00Z");
      next.setUTCDate(next.getUTCDate()-1);
      await db("ti_backfill_state?id=eq.openfun-pcc","PATCH",{
        next_date:next.toISOString().slice(0,10),last_attempt_at:finished,
        last_error:msg+"（已留存缺漏並排程重試）"
      },"return=minimal");
    }
  }catch(err){console.error("error recording gap",String(err).slice(0,180))}
  else try{await db("ti_sources?id=eq.openfun-pcc","PATCH",{last_error_at:finished,last_error:msg},"return=minimal")}catch{}
  return {ok:false,date:day,error:msg};
 }
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return Response.json({error:"POST only"},{status:405});
 if(!DB_URL||!KEY)return Response.json({error:"Server missing database environment"},{status:503});
 const token=req.headers.get("x-ti-cron")||"";
 if(token.length<32)return Response.json({error:"Unauthorized"},{status:401});
 try{const allowed=await db("rpc/ti_verify_ingest_token","POST",{candidate:token});
  if(allowed!==true)return Response.json({error:"Unauthorized"},{status:401});
 }catch{return Response.json({error:"Unauthorized"},{status:401})}
 let mode="latest";try{const b=await req.json();if(["previous","backfill","retry","details"].includes(b.mode))mode=b.mode}catch{}
 const result=mode==="details"?await enrichMissingDetails():await ingest(mode);
 return Response.json(result,{status:result.ok?200:502,headers:{"Cache-Control":"no-store"}});
});
