// Scheduled API importer: OpenFun PCC (public API, no scraping).
// The cron token is stored in Supabase Vault; no browser or GitHub secret is required.
const SRC="https://pcc-api.openfun.app/api", URL=Deno.env.get("SUPABASE_URL")||"",
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
 const r=await fetch(URL+"/rest/v1/"+route,{method,headers:h,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(50000)});
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
 const detail=bid?.detail||{},link=official(latest.detail?.url)||official(detail.url);
 const fields={deadline_at:rocDate(pick(detail,"截止投標")),opening_at:rocDate(pick(detail,"開標時間")),
  location:text(pick(detail,"履約地點"))||null,period:text(pick(detail,"履約期限")).slice(0,4000)||null,
  deposit:text(pick(detail,"押標金額度")).slice(0,1000)||null,
  qualification:text(pick(detail,"廠商應附具之基本資格證明文件或物品")).slice(0,10000)||null,
  tender_method:text(pick(detail,"招標方式"))||null,decision_method:text(pick(detail,"決標方式"))||null,
  official_page:link,source_api:src};
 await db("ti_case_details?on_conflict=case_id","POST",[{case_id:c.id,latest_notice_id:c.id+"::"+latest.date+"::"+latest.filename,
  details:fields,records_count:records.length,fetched_at:new Date().toISOString()}],
  "resolution=merge-duplicates,return=minimal");
 if(link||fields.deadline_at)await db("ti_cases?id=eq."+encodeURIComponent(c.id),"PATCH",
  {official_url:link,deadline_at:fields.deadline_at},"return=minimal");
 return true;
}
async function ingest(mode){
 let run=null,day=null,found=0,added=0,details=0;
 try{
  const info=await json(SRC+"/getinfo");
  const iso=text(info["最新資料時間"]).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw Error("source latest date unavailable");
  let date=iso;
  if(mode==="previous"){const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-1);date=d.toISOString().slice(0,10)}
  day=Number(date.replaceAll("-",""));
  const runs=await db("ti_ingest_runs","POST",[{source_date:day,status:"running"}],"return=representation");
  run=runs?.[0]?.id;
  if(!run)throw Error("ingest run initialization failed");
  const list=await json(SRC+"/listbydate?date="+day,45000);
  if(!Array.isArray(list.records)||list.records.length===0)throw Error("source returned no announcements");
  const at=new Date().toISOString(),notices=new Map(),cases=new Map();
  for(const row of list.records){
   const x=norm(row,at);if(!x)continue;
   notices.set(x.n.id,x.n);const p=cases.get(x.c.id);
   if(!p||x.c.latest_notice_date>p.latest_notice_date||
     (x.c.latest_notice_date===p.latest_notice_date&&x.c.latest_filename>p.latest_filename))cases.set(x.c.id,x.c);
  }
  found=notices.size;if(found===0)throw Error("source had no valid notices");
  await batches("ti_cases",[...cases.values()]);
  added=await batches("ti_notices",[...notices.values()],true);
  for(const c of [...cases.values()].filter(x=>/招標|決標|更正/.test(x.latest_notice_type||"")).slice(0,12)){
   try{if(await enrich(c))details++}catch(e){console.warn("detail unavailable",c.id,text(e).slice(0,130))}
  }
  const finished=new Date().toISOString();
  await db("ti_ingest_runs?id=eq."+run,"PATCH",
   {finished_at:finished,status:"success",fetched_count:found,new_notice_count:added,detail_count:details},"return=minimal");
  await db("ti_sources?id=eq.openfun-pcc","PATCH",{last_success_at:finished,last_error:null,updated_at:finished},"return=minimal");
  return {ok:true,date:day,announcements:found,new_notices:added,details_enriched:details,finished_at:finished};
 }catch(e){
  const msg=text(e).slice(0,300),finished=new Date().toISOString();console.error("ingest failed",msg);
  if(run)try{await db("ti_ingest_runs?id=eq."+run,"PATCH",
   {finished_at:finished,status:"error",fetched_count:found,new_notice_count:added,detail_count:details,error_summary:msg},"return=minimal")}catch{}
  try{await db("ti_sources?id=eq.openfun-pcc","PATCH",{last_error_at:finished,last_error:msg},"return=minimal")}catch{}
  return {ok:false,date:day,error:msg};
 }
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return Response.json({error:"POST only"},{status:405});
 if(!URL||!KEY)return Response.json({error:"Server missing database environment"},{status:503});
 const token=req.headers.get("x-ti-cron")||"";
 if(token.length<32)return Response.json({error:"Unauthorized"},{status:401});
 try{const allowed=await db("rpc/ti_verify_ingest_token","POST",{candidate:token});
  if(allowed!==true)return Response.json({error:"Unauthorized"},{status:401});
 }catch{return Response.json({error:"Unauthorized"},{status:401})}
 let mode="latest";try{const b=await req.json();if(b.mode==="previous")mode="previous"}catch{}
 const result=await ingest(mode);
 return Response.json(result,{status:result.ok?200:502,headers:{"Cache-Control":"no-store"}});
});
