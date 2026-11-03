// Real AI document extraction from user-supplied text with source page references.
// API key is an Edge Function secret (OPENAI_API_KEY), never sent to browser/GitHub.
// If no key is configured, return 503; do NOT fabricate a model answer.
const SUPA=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PUBLIC_KEY=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"sb_publishable_L09XC4Tekm6cZaPTTczm3g_Aap-SOSy";
const corsOrigin=o=>o==="https://hub-google.github.io"||o==="http://localhost:8000"||o==="http://127.0.0.1:8000"?o:"https://hub-google.github.io";
function output(data,status,origin){return Response.json(data,{status,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type","Vary":"Origin","Cache-Control":"no-store"}})}
const schema={type:"object",additionalProperties:false,properties:{
 summary:{type:"string"},
 warnings:{type:"array",items:{type:"string"}},
 requirements:{type:"array",items:{type:"object",additionalProperties:false,properties:{
  category:{type:"string",enum:["資格","時間","押標金與費用","評選","履約與驗收","交件附件"]},
  requirement:{type:"string"},evidence:{type:"string"},
  source_page:{type:"string"},action:{type:"string"},needs_human_check:{type:"boolean"}
 },required:["category","requirement","evidence","source_page","action","needs_human_check"]}}
},required:["summary","warnings","requirements"]};
const keyHeaders={apikey:SERVICE,Authorization:"Bearer "+SERVICE,"Content-Type":"application/json"};
async function db(path,method="GET",body=null,prefer=""){
 const h={...keyHeaders};if(prefer)h.Prefer=prefer;
 const r=await fetch(SUPA+"/rest/v1/"+path,{method,headers:h,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(17000)});
 if(!r.ok)throw Error("Database "+r.status);
 const t=await r.text();return t?JSON.parse(t):null;
}
Deno.serve(async req=>{
 const origin=corsOrigin(req.headers.get("Origin")||"");
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"}});
 if(req.method!=="POST")return output({error:"POST only"},405,origin);
 const auth=req.headers.get("Authorization")||"";
 if(!auth.startsWith("Bearer "))return output({error:"請先登入"},401,origin);
 const jwt=auth.slice(7);
 const who=await fetch(SUPA+"/auth/v1/user",{headers:{apikey:PUBLIC_KEY,Authorization:"Bearer "+jwt},signal:AbortSignal.timeout(12000)}).catch(()=>null);
 if(!who||!who.ok)return output({error:"登入已失效，請重新登入"},401,origin);
 const user=await who.json();
 if(!user?.id)return output({error:"無法驗證使用者"},401,origin);
 let b;try{b=await req.json()}catch{return output({error:"請提供 JSON"},400,origin)}
 const pages=Array.isArray(b?.pages)?b.pages:[];
 if(!pages.length||pages.length>150)return output({error:"請提供 1-150 頁可讀的文字"},400,origin);
 const compact=pages.map(p=>({page:String(p.source||"未標頁碼").slice(0,50),text:String(p.text||"").slice(0,5500)})).filter(x=>x.text.trim());
 const input=compact.map(p=>"["+p.page+"]\n"+p.text).join("\n\n");
 if(input.length<80||input.length>100000)return output({error:"文件文字長度須在 80–100,000 字元之間；掃描檔請先取得文字層"},400,origin);
 const name=String(b?.document_name||"document").slice(0,250);
 const key=Deno.env.get("OPENAI_API_KEY");
 if(!key)return output({error:"此專案尚未在 Supabase Edge Function Secrets 設定 OPENAI_API_KEY；未呼叫任何 AI，也沒有產生模擬結果"},503,origin);
 const {data:previous}=await db("ti_ai_jobs?select=id&user_id=eq."+user.id+"&created_at=gte."+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+"&limit=21");
 if((previous||[]).length>=20)return output({error:"今天已達每帳戶 20 次的 AI 防濫用額度"},429,origin);
 const created=await db("ti_ai_jobs","POST",[{user_id:user.id,document_name:name,case_id:b.case_id||null,state:"pending"}],"return=representation");
 const jobId=created?.[0]?.id;
 if(!jobId)return output({error:"無法建立分析紀錄"},503,origin);
 try{
  const model="gpt-4.1-mini";
  const prompt="你是臺灣政府採購文件整理助手。只整理使用者貼出的真實原文；不得推測未出現的法規、數字、底價、得標率、投標資格與日期。每一項 requirement 必須提供原文短引 evidence 和來源頁碼 source_page；缺乏來源即不要列出。僅提供人工核對清單，不作法律判定。文件：\n\n"+input;
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({
   model,input:prompt,max_output_tokens:2400,store:false,
   text:{format:{type:"json_schema",name:"tender_requirements",strict:true,schema}}
  }),signal:AbortSignal.timeout(90000)});
  const data=await response.json();
  if(!response.ok)throw Error("AI 服務回應 "+response.status+": "+String(data?.error?.message||"失敗").slice(0,180));
  const plain=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("");
  if(!plain)throw Error("AI 沒有返回可用的文字報告");
  const result=JSON.parse(plain);
  if(!Array.isArray(result.requirements))throw Error("AI 回傳結構不符合規格");
  // Defense-in-depth: drop citations that do not point to an actual supplied source label.
  const sources=new Set(compact.map(p=>p.page));
  result.requirements=result.requirements.filter(x=>sources.has(x.source_page)&&
     compact.some(p=>p.page===x.source_page&&p.text.includes(String(x.evidence||"").trim())));
  await db("ti_ai_jobs?id=eq."+jobId,"PATCH",{
   state:"success",provider_model:model,output:result,finished_at:new Date().toISOString()
  },"return=minimal");
  return output({job_id:jobId,result,model,source_pages:compact.length},200,origin);
 }catch(e){
  const error=String(e).slice(0,280);
  try{await db("ti_ai_jobs?id=eq."+jobId,"PATCH",{state:"error",error_summary:error,finished_at:new Date().toISOString()},"return=minimal")}catch{}
  return output({error:"AI 解析失敗："+error},502,origin);
 }
});
