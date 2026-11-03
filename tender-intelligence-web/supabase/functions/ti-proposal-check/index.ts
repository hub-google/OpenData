// @ts-nocheck -- Deno runtime source validation; provider behavior requires live-secret verification.
// PRD V7. Actual two-document proposal/requirements comparison.
// Strictly uses supplied text and evidence citations. No AI key -> explicit 503.
const SUPA=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PUBLIC_KEY=Deno.env.get("SUPABASE_ANON_KEY")||
 Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"sb_publishable_L09XC4Tekm6cZaPTTczm3g_Aap-SOSy";
const allowedOrigin=o=>["https://hub-google.github.io","http://localhost:8000","http://127.0.0.1:8000"].includes(o)?o:"https://hub-google.github.io";
const response=(body,status,origin)=>Response.json(body,{status,headers:{
 "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store","Vary":"Origin"}});
const h={apikey:SERVICE,Authorization:"Bearer "+SERVICE,"Content-Type":"application/json"};
async function db(url,method="GET",body=null,prefer=""){
 const headers={...h};if(prefer)headers.Prefer=prefer;
 const r=await fetch(SUPA+"/rest/v1/"+url,{
  method,headers,body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(17000)
 });
 if(!r.ok)throw Error("Database "+r.status);
 const s=await r.text();return s?JSON.parse(s):null;
}
const schema={
 type:"object",additionalProperties:false,properties:{
  summary:{type:"string"},
  caveats:{type:"array",items:{type:"string"}},
  checks:{type:"array",items:{type:"object",additionalProperties:false,properties:{
   requirement:{type:"string"},
   tender_page:{type:"string"},tender_quote:{type:"string"},
   status:{type:"string",enum:["已回應","部分回應","未找到","需人工確認"]},
   proposal_page:{type:"string"},proposal_quote:{type:"string"},
   gaps:{type:"string"},suggested_action:{type:"string"}
  },required:["requirement","tender_page","tender_quote","status",
    "proposal_page","proposal_quote","gaps","suggested_action"]}}
 },required:["summary","caveats","checks"]
};
function cleanPages(raw){
 if(!Array.isArray(raw)||raw.length>140)return null;
 return raw.map(x=>({page:String(x.source||"未標頁碼").slice(0,65),
  text:String(x.text||"").slice(0,5000)})).filter(x=>x.text.trim());
}
const compact=s=>String(s||"").replace(/\s+/g,"");
Deno.serve(async req=>{
 const origin=allowedOrigin(req.headers.get("Origin")||"");
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"}});
 if(req.method!=="POST")return response({error:"POST only"},405,origin);
 const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
 if(jwt.length<30)return response({error:"請先登入"},401,origin);
 const who=await fetch(SUPA+"/auth/v1/user",{
  headers:{apikey:PUBLIC_KEY,Authorization:"Bearer "+jwt},signal:AbortSignal.timeout(12000)
 }).catch(()=>null);
 if(!who||!who.ok)return response({error:"驗證已失效"},401,origin);
 const user=await who.json();
 if(!user?.id)return response({error:"無法取得使用者身份"},401,origin);
 let data;try{data=await req.json()}catch{return response({error:"請提供 JSON"},400,origin)}
 const tender=cleanPages(data?.tender_pages),proposal=cleanPages(data?.proposal_pages);
 if(!tender?.length||!proposal?.length)return response({error:"必須提供標單和投標書兩份有文字的真實文件"},400,origin);
 const docs=[["招標要求",tender],["公司投標書",proposal]];
 const formatted=docs.map(([name,pages])=>name+"\n"+pages.map(p=>"["+p.page+"]\n"+p.text).join("\n\n")).join("\n\n========\n\n");
 if(compact(formatted).length<300||formatted.length>130000)return response({error:"文件無法取得足夠文字或內容超過本次分析上限"},400,origin);
 const key=Deno.env.get("OPENAI_API_KEY");
 if(!key)return response({error:"標案專案尚未在 Supabase Secrets 設定 OPENAI_API_KEY，未執行 AI，也不會提供模擬健檢"},503,origin);
 const previous=await db("ti_ai_jobs?select=id&user_id=eq."+user.id+
    "&created_at=gte."+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+"&limit=21");
 if(previous.length>=20)return response({error:"每帳戶 24 小時最多執行 20 次 AI 文件分析"},429,origin);
 const task=await db("ti_ai_jobs","POST",[{
  user_id:user.id,case_id:data.case_id||null,
  document_name:String(data.proposal_name||"投標書").slice(0,240),
  task_type:"proposal_check",state:"pending"
 }],"return=representation");
 const job=task?.[0]?.id;if(!job)return response({error:"無法建立文件分析記錄"},502,origin);
 try{
  const model=Deno.env.get("TI_AI_MODEL")||"gpt-4.1-mini";
  const prompt="你是台灣政府採購文件的比對輔助工具。這兩份資料均由用戶合法取得。"+
   "逐項找出招標文件中的資格、評選、附件、時程、履約與交付要求，及公司投標書有無對應內容。"+
   "只能引用原文文字片段，並逐一給出原文件頁碼。不得推測證照、實績、公司資格，"+
   "不得把未找到的文件或不存在的公司經驗說成已具備。"+
   "如果投標書找不到直接原文對應，status=未找到，proposal_quote與proposal_page填空字串。"+
   "不得做得標率預測或法律判定。最多整理 25 項。"+
   "\n\n"+formatted;
  const r=await fetch("https://api.openai.com/v1/responses",{
   method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
   body:JSON.stringify({
    model,input:prompt,max_output_tokens:4400,store:false,
    text:{format:{type:"json_schema",name:"tender_proposal_compliance",strict:true,schema}}
   }),signal:AbortSignal.timeout(105000)
  });
  const raw=await r.json();
  if(!r.ok)throw Error("AI HTTP "+r.status+": "+String(raw.error?.message||"未知錯誤").slice(0,160));
  const text=(raw.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("");
  if(!text)throw Error("AI 未返回有效結構化資料");
  const result=JSON.parse(text);
  if(!Array.isArray(result.checks))throw Error("AI 結構不符合健檢清單");
  const match=(pages,page,quote)=>quote&&pages.some(x=>x.page===page&&compact(x.text).includes(compact(quote)));
  const checks=result.checks.slice(0,25).filter(x=>match(tender,x.tender_page,x.tender_quote)).map(x=>{
   const backed=match(proposal,x.proposal_page,x.proposal_quote);
   return {...x,
     status:backed?x.status:(x.status==="未找到"?"未找到":"需人工確認"),
     proposal_page:backed?x.proposal_page:"",
     proposal_quote:backed?x.proposal_quote:""
   };
  });
  const resultChecked={summary:result.summary,caveats:result.caveats||[],checks,
   tender_page_count:tender.length,proposal_page_count:proposal.length};
  await db("ti_ai_jobs?id=eq."+job,"PATCH",{
   state:"success",provider_model:model,output:resultChecked,finished_at:new Date().toISOString()
  },"return=minimal");
  return response({job_id:job,model,result:resultChecked},200,origin);
 }catch(e){
  const msg=String(e).slice(0,300);
  try{await db("ti_ai_jobs?id=eq."+job,"PATCH",{
   state:"error",error_summary:msg,finished_at:new Date().toISOString()
  },"return=minimal")}catch{}
  return response({error:"AI 標書健檢失敗："+msg},502,origin);
 }
});
