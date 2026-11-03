// @ts-nocheck -- Runtime Deno source check, official upstream schema handled defensively.
// PCC official Open Data dataset 5988; once daily, not third-party tender API.
// https://data.gov.tw/dataset/5988 : government OGL v1, nominal update daily.
// Only source-verifiable public fields are retained. No accusations or implied current debarment.
const BASE=Deno.env.get("SUPABASE_URL")||"";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const SRC="https://web.pcc.gov.tw/vms/rvlm/rvlmPublicSearch/queryRVFile/json";
const SOURCE="https://data.gov.tw/dataset/5988";
const headers={apikey:KEY,Authorization:"Bearer "+KEY,"Content-Type":"application/json"};
const clean=x=>String(x??"").trim().slice(0,900);
const normalized=k=>String(k).replace(/[\s　()（）_\-:/]+/g,"").toLowerCase();
function val(row,fields){
 const obj=Object.fromEntries(Object.entries(row).map(([k,v])=>[normalized(k),v]));
 for(const key of fields){
  const v=obj[normalized(key)];
  if(v!==null&&v!==undefined&&String(v).trim())return clean(v);
 }
 return "";
}
function records(payload){
 const found=[];
 const walk=(x,depth)=>{
  if(depth>4)return;
  if(Array.isArray(x)){
   const items=x.filter(y=>y&&typeof y==="object"&&!Array.isArray(y));
   if(items.length)found.push(items);
   for(const v of x.slice(0,5))walk(v,depth+1);
  }else if(x&&typeof x==="object"){
   for(const v of Object.values(x))walk(v,depth+1);
  }
 };
 walk(payload,0);
 return found.sort((a,b)=>b.length-a.length)[0]||[];
}
async function db(route,method="GET",body=null,prefer=""){
 const h={...headers};if(prefer)h.Prefer=prefer;
 const r=await fetch(BASE+"/rest/v1/"+route,{
  method,headers:h,body:body===null?undefined:JSON.stringify(body),
  signal:AbortSignal.timeout(35000)
 });
 const s=await r.text();
 if(!r.ok)throw Error("database "+r.status+" "+route.split("?")[0]+" "+s.slice(0,110));
 return s?JSON.parse(s):null;
}
async function hash(s){
 const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
 return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async req=>{
 if(req.method!=="POST")return Response.json({error:"POST only"},{status:405});
 const token=req.headers.get("x-ti-cron")||"";
 if(!BASE||!KEY||token.length<32)return Response.json({error:"unauthorized"},{status:401});
 try{const valid=await db("rpc/ti_verify_ingest_token","POST",{candidate:token});
  if(valid!==true)return Response.json({error:"unauthorized"},{status:401});
 }catch{return Response.json({error:"unauthorized"},{status:401})}
 let run=null,fetched=0,stored=0;
 try{
  const start=await db("ti_external_source_runs","POST",[
   {source_id:"official-pcc-debarred-5988",status:"running"}
  ],"return=representation");
  run=start[0]?.id;
  const r=await fetch(SRC,{headers:{Accept:"application/json","User-Agent":"OpenData-Tender/1.0"},signal:AbortSignal.timeout(65000)});
  if(!r.ok)throw Error("official upstream HTTP "+r.status);
  const raw=await r.text();if(raw.length>16000000)throw Error("official response too large");
  let obj;try{obj=JSON.parse(raw)}catch{throw Error("official source did not return JSON")}
  const rows=records(obj);
  fetched=rows.length;
  if(fetched===0)throw Error("official data returned no records; old data kept");
  const known=[];
  const timestamp=new Date().toISOString();
  for(const row of rows){
   const company_name=val(row,["Corporation_Name","廠商名稱"]);
   const company_number=val(row,["Corporation_Number","廠商代碼"]);
   const case_number=val(row,["Case_no","CaseNo","標案案號"]);
   const announcement_date=val(row,["Announce_Date","公告日"]);
   const agency_name=val(row,["Announce_Agency_Name","機關名稱"]);
   if(!company_name)continue;
   const case_name=val(row,["Case_Name","標案名稱"]);
   const legal_clause=val(row,["GPA101_Caluse","GPA101_Clause","第101條款次"]);
   const effective_date=val(row,["Effective_Date","生效日"]);
   const expiration_date=val(row,["Expire_Date","拒絕往來截止日"]);
   const appeal_result=val(row,["Appeal_Result","異議或申訴結果"]);
   const id=await hash([company_name,company_number,case_number,announcement_date,agency_name,legal_clause].join("\u001f"));
   known.push({id,company_name,company_number:company_number||null,case_number:case_number||null,
    case_name:case_name||null,agency_name:agency_name||null,
    legal_clause:legal_clause||null,effective_date:effective_date||null,
    expiration_date:expiration_date||null,announcement_date:announcement_date||null,
    appeal_result:appeal_result||null,source_url:SOURCE,fetched_at:timestamp});
  }
  if(known.length<10)throw Error("too few source records after field validation");
  for(let i=0;i<known.length;i+=75){
   await db("ti_debarred_vendor_notices?on_conflict=id","POST",known.slice(i,i+75),
      "resolution=merge-duplicates,return=minimal");
   stored+=Math.min(75,known.length-i);
  }
  if(run)await db("ti_external_source_runs?id=eq."+run,"PATCH",{
   status:"success",fetched_count:fetched,stored_count:stored,finished_at:new Date().toISOString()
  },"return=minimal");
  return Response.json({ok:true,source:SOURCE,source_date:timestamp.slice(0,10),
    fetched,stored,note:"Only official source fields, appeal outcome retained; active status not inferred."});
 }catch(e){
  const summary=String(e).slice(0,240);
  if(run)try{await db("ti_external_source_runs?id=eq."+run,"PATCH",{
   status:"error",fetched_count:fetched,stored_count:stored,error_summary:summary,
   finished_at:new Date().toISOString()
  },"return=minimal")}catch{}
  return Response.json({ok:false,error:summary,source:SOURCE},{status:502});
 }
});
