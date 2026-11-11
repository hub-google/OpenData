// @ts-nocheck -- Deno runtime JS; strict provider type definitions tracked separately.
// W06 real source-backed AI proposal drafting. No key => explicit 503.
// Only user-initiated requests. Never send private text before explicit consent.
const SUPA=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const PUB=Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||'';
const MODEL='gpt-4.1-mini';
const cors=origin=>origin==='https://hub-google.github.io'||origin==='http://localhost:8000'||
 origin==='http://127.0.0.1:8000'?origin:'https://hub-google.github.io';
function reply(payload,status,origin){
 return Response.json(payload,{status,headers:{'Access-Control-Allow-Origin':origin,
 'Access-Control-Allow-Headers':'authorization,apikey,content-type','Vary':'Origin',
 'Cache-Control':'no-store'}});
}
async function fromApi(path,jwt){
 const res=await fetch(SUPA+'/rest/v1/'+path,{
  method:'GET',headers:{apikey:PUB,Authorization:'Bearer '+jwt,Accept:'application/json'},
  signal:AbortSignal.timeout(18000)});
 if(!res.ok)throw Error('資料庫讀取 '+res.status);
 return await res.json();
}
async function privileged(path,method,body){
 if(!SERVICE)throw Error('後端服務金鑰未配置');
 const res=await fetch(SUPA+'/rest/v1/'+path,{method,
  headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json',
   ...(method==='PATCH'?{Prefer:'return=minimal'}:{})},
  body:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
 if(!res.ok)throw Error('任務紀錄 '+res.status);
 const raw=await res.text();return raw?JSON.parse(raw):null;
}
const val=(s,n=450)=>String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const schema={
 type:'object',additionalProperties:false,properties:{
  title:{type:'string'},summary:{type:'string'},
  sections:{type:'array',items:{type:'object',additionalProperties:false,properties:{
   heading:{type:'string'},body:{type:'string'},
   source_quotes:{type:'array',items:{type:'object',additionalProperties:false,properties:{
    source_id:{type:'string'},excerpt:{type:'string'}
   },required:['source_id','excerpt']}}
  },required:['heading','body','source_quotes']}},
  warnings:{type:'array',items:{type:'string'}}
 },required:['title','summary','sections','warnings']
};
const officialLink=url=>typeof url==='string'&&url.startsWith('https://web.pcc.gov.tw/')?url:'待核對';
Deno.serve(async req=>{
 const origin=cors(req.headers.get('Origin')||'');
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{
   'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type',
   'Access-Control-Allow-Methods':'POST,OPTIONS'}});
 if(req.method!=='POST')return reply({error:'僅接受 POST'},405,origin);
 const bearer=req.headers.get('Authorization')||'';
 if(!bearer.startsWith('Bearer '))return reply({error:'請先登入'},401,origin);
 if(!SUPA||!PUB||!SERVICE)return reply({error:'AI 服務的資料庫驗證環境尚未設定'},503,origin);
 const jwt=bearer.slice(7);
 let member;
 try{
  const auth=await fetch(SUPA+'/auth/v1/user',{headers:{apikey:PUB,Authorization:'Bearer '+jwt},
   signal:AbortSignal.timeout(12000)});
  if(!auth.ok)return reply({error:'登入已失效'},401,origin);
  member=await auth.json();
  if(!member?.id)return reply({error:'訪客登入授權無效，請重新整理網頁'},401,origin);
 }catch{return reply({error:'無法驗證登入，請再試'},503,origin)}
 let body;
 try{body=await req.json()}catch{return reply({error:'請提供合法 JSON'},400,origin)}
 const caseId=String(body?.case_id||'');
 if(!caseId.includes('::')||caseId.length>190||caseId.length<3)return reply({error:'案件識別碼無效'},400,origin);
 const key=Deno.env.get('OPENAI_API_KEY');
 if(!key)return reply({error:'尚未在 Supabase Edge Function Secrets 配置 OPENAI_API_KEY；沒有呼叫模型或生成模擬草稿'},503,origin);
 const enc=encodeURIComponent,lookup=(table,params)=>table+'?'+params;
 let tender,company,assets,docs;
 try{
  const all=await Promise.all([
   fromApi(lookup('ti_cases','select=id,job_number,title,agency,budget_amount,deadline_at,latest_notice_type,official_url&id=eq.'+enc(caseId)+'&limit=1'),jwt),
   fromApi(lookup('ti_company_profiles','select=company_name,services,company_intro&user_id=eq.'+enc(member.id)+'&limit=1'),jwt),
   fromApi(lookup('ti_company_assets','select=title,asset_type,issuer,reference_number,expires_on&user_id=eq.'+enc(member.id)+'&limit=25'),jwt),
   fromApi(lookup('ti_documents','select=id,filename,extracted,indexed_at&user_id=eq.'+enc(member.id)+
      '&case_id=eq.'+enc(caseId)+'&order=created_at.desc&limit=15'),jwt)
  ]);
  tender=all[0]?.[0];company=all[1]?.[0]||{};assets=all[2]||[];docs=all[3]||[];
  if(!tender)return reply({error:'無法讀取本案官方主表'},404,origin);
 }catch(e){return reply({error:'來源讀取失敗：'+val(e,170)},502,origin)}
 const refs=new Map();let inputText='',seq=0;
 for(const doc of docs){
  for(const p of Array.isArray(doc?.extracted?.pages)?doc.extracted.pages:[]){
   if(seq>=60||inputText.length>=47000)break;
   const text=String(p.text||'').slice(0,2200).trim();
   if(!text)continue;
   const sid='D'+(++seq),label=val(doc.filename,120)+'／'+val(p.source,65);
   refs.set(sid,{document_id:String(doc.id||''),filename:val(doc.filename,120),
    source:val(p.source,65),text});
   inputText+='['+sid+'] '+label+'\n'+text+'\n\n';
  }
 }
 if(inputText.length<100)return reply({error:'尚無足夠且可引用的本案標書原文（至少 100 字）；請先保存／索引合法取得的標書'},422,origin);
 const facts='案件：'+val(tender.title,200)+'；案號：'+val(tender.job_number,90)+
  '；機關：'+val(tender.agency,160)+'；官方類型：'+val(tender.latest_notice_type,70)+
  '；公開預算：'+(tender.budget_amount??'未公開')+'；官方截止：'+(tender.deadline_at??'未取得')+
  '；官方網址：'+officialLink(tender.official_url);
 const companyFacts='公司本人填寫資料（未核實）：'+JSON.stringify({
  company_name:val(company.company_name,200),services:val(company.services,800),
  intro:val(company.company_intro,1600),
  assets:assets.map(x=>({type:val(x.asset_type,40),name:val(x.title,150),
    issuer:val(x.issuer,120),number:val(x.reference_number,100),
    expires:x.expires_on||null}))
 });
 const fingerprintInput=caseId+'|'+MODEL+'|'+facts+'|'+companyFacts+'|'+inputText;
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprintInput)));
 const hash=Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');
 let reservation;
 try{
  reservation=await privileged('rpc/ti_reserve_ai_job','POST',{
   p_user:member.id,p_task_type:'proposal_draft',p_case_id:caseId,
   p_document_name:val(tender.title,230),p_request_hash:hash});
 }catch(e){return reply({error:'AI 額度與去重檢查失敗：'+val(e,150)},502,origin)}
 if(reservation?.state==='cached')return reply({...reservation.output,cached:true},200,origin);
 if(reservation?.state==='processing')return reply({error:'同一份來源資料的 AI 草稿正在生成，沒有重複扣次'},409,origin);
 if(reservation?.state==='quota_exhausted')return reply({error:'24 小時內成功 AI 任務已達 20 次上限'},429,origin);
 if(reservation?.state==='retry_limit')return reply({error:'相同資料失敗已達重試上限，請檢查來源'},429,origin);
 if(reservation?.state!=='claimed'||!reservation.job_id)return reply({error:'AI 任務尚未保留成功'},503,origin);
 const jobId=reservation.job_id;
 try{
  const instructions='你正在協助臺灣政府採購的服務建議書草稿。只能依照實際來源標書與公司自述整理；不准虛構投標資格、實績、公司證照、標價、法令、配分、交付期程或得標可能性。每一節與標書需求相關的實質陳述必須附上一筆以上 source_quotes，source_id 必須是提供的 D 編號，excerpt 必須從同一 D 原文精確複製一小段。公司資料僅能標示「公司自行提供、需驗證」。沒有來源的段落寫「【待人工補證據】」，不可以補編內容。以繁體中文撰寫內容可編輯的服務建議書「草稿」，不宣稱 AI 已確認資格。';
  const prompt=instructions+'\n\n官方案件資料：'+facts+'\n\n'+companyFacts+
   '\n\n真實標書原文（每段 D 標籤為引用代碼）：\n'+inputText;
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',
   headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({model:MODEL,input:prompt,store:false,max_output_tokens:4500,
    text:{format:{type:'json_schema',name:'proposal_draft',strict:true,schema}}}),
   signal:AbortSignal.timeout(100000)});
  const data=await response.json();
  if(!response.ok)throw Error('AI '+response.status+'：'+val(data?.error?.message||'模型呼叫失敗',180));
  const plain=(data.output||[]).flatMap(x=>x.content||[])
    .filter(x=>x.type==='output_text').map(x=>x.text).join('');
  if(!plain)throw Error('模型未產生可驗證的文字');
  const result=JSON.parse(plain);
  if(!Array.isArray(result.sections))throw Error('模型輸出結構不符');
  const source_refs=[],sections=[];
  for(const s of result.sections.slice(0,18)){
   const quotes=[];
   for(const q of Array.isArray(s.source_quotes)?s.source_quotes:[]){
    const source=refs.get(String(q.source_id));
    const excerpt=String(q.excerpt||'').trim();
    if(!source||excerpt.length<5||!source.text.includes(excerpt))continue;
    const entry={document_id:source.document_id,filename:source.filename,
      source:source.source,excerpt:excerpt.slice(0,280)};
    source_refs.push(entry);
    quotes.push(entry);
   }
   // Do not publish model assertions from sections without verified quotes.
   if(!quotes.length)continue;
   sections.push('## '+val(s.heading,120)+'（AI 草稿，待人工核對）\n'+
     String(s.body||'').slice(0,1400)+'\n'+quotes.map(x=>
      '> 來源：'+x.filename+'／'+x.source+'；原文：「'+x.excerpt+'」').join('\n'));
  }
  if(!sections.length)throw Error('AI 內容找不到任何真正的標書原文引用，已捨棄未驗證結果');
  const markdown=[
   '# '+val(tender.title,160)+'｜AI 輔助服務建議書草稿（未審核）',
   '> 本文件由真實 AI 模型輔助撰寫，引用段落已核對出自使用者提供的原文；整體內容與資格仍須人工審核。不得直接視為合格標書。',
   '## 案件資料\n'+facts,
   '## 公司資料（使用者自述）\n'+val(company.company_name,150)+'\n'+val(company.services,700),
   ...sections,
   '## 附件與送件前核對\n- [ ] 核對全部正式標書與最新更正\n- [ ] 核對公司證照／實績原本\n- [ ] 審核評選回應、報價、投標格式與截止時間\n- [ ] 由有權人員在官方管道自行提交',
   ...((result.warnings||[]).slice(0,10).map(x=>'待確認：'+val(x,300))),
   '> 警示：未引述原始文件的模型段落已排除。引用真實不代表內文全部正確。',
  ].join('\n\n').slice(0,95000);
  const output={title:val(tender.title,150)+'｜AI 輔助服務建議書',
   markdown,source_refs:source_refs.slice(0,40),mode:'ai_assisted',
   model:MODEL,source_pages:refs.size};
  await privileged('ti_ai_jobs?id=eq.'+encodeURIComponent(jobId),'PATCH',
   {state:'success',provider_model:MODEL,output,finished_at:new Date().toISOString()});
  return reply(output,200,origin);
 }catch(e){
  try{await privileged('ti_ai_jobs?id=eq.'+encodeURIComponent(jobId),'PATCH',
    {state:'error',error_summary:val(e,250),finished_at:new Date().toISOString()})}catch{}
  return reply({error:'AI 草稿未完成：'+val(e,250)},502,origin);
 }
});
