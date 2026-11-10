// True S02/W07 vector search. All model calls happen server-side.
// Missing model key is a clear inactive status; no keyword search is mislabeled AI.
const DB=Deno.env.get('SUPABASE_URL')||'';
const PUB=Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const MODEL_KEY=Deno.env.get('OPENAI_API_KEY')||'';
const MODEL='text-embedding-3-small';
function origin(req){const o=req.headers.get('Origin')||'';
 return ['https://hub-google.github.io','http://localhost:8000','http://127.0.0.1:8000'].includes(o)?o:'https://hub-google.github.io';
}
function reply(req,body,status=200){return Response.json(body,{status,headers:{
 'Access-Control-Allow-Origin':origin(req),'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-ti-cron',
 'Vary':'Origin','Cache-Control':'no-store'}})}
async function api(path,method='GET',body=null,token=SERVICE){
 const resp=await fetch(DB+'/rest/v1/'+path,{method,headers:{
  apikey:token===SERVICE?SERVICE:PUB,Authorization:'Bearer '+token,
  'Content-Type':'application/json',...(method==='POST'?{Prefer:'return=representation'}:{})
 },body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 if(!resp.ok)throw Error('資料查詢或寫入失敗（HTTP '+resp.status+'）：'+(await resp.text()).slice(0,160));
 const text=await resp.text();return text?JSON.parse(text):null;
}
async function embed(inputs){
 if(!MODEL_KEY)throw Error('未設定 OPENAI_API_KEY：真正語意向量模型尚未啟用');
 const data=await fetch('https://api.openai.com/v1/embeddings',{
 method:'POST',headers:{Authorization:'Bearer '+MODEL_KEY,'Content-Type':'application/json'},
 body:JSON.stringify({model:MODEL,dimensions:1536,input:inputs}),
 signal:AbortSignal.timeout(45000)});
 const json=await data.json();
 if(!data.ok)throw Error('向量模型錯誤（HTTP '+data.status+'）：'+String(json?.error?.message||'').slice(0,140));
 const vectors=(json?.data||[]).sort((a,b)=>a.index-b.index).map(x=>x.embedding);
 if(vectors.length!==inputs.length||vectors.some(x=>!Array.isArray(x)||x.length!==1536||
   x.some(n=>typeof n!=='number'||!Number.isFinite(n))))throw Error('模型向量維度或數值不正確');
 return vectors;
}
async function sha(s){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');}
async function member(req){
 const bearer=req.headers.get('Authorization')||'';
 if(!bearer.startsWith('Bearer '))throw Error('請先登入正式會員再使用語意功能');
 const jwt=bearer.slice(7);
 const auth=await fetch(DB+'/auth/v1/user',{headers:{apikey:PUB,Authorization:'Bearer '+jwt},
  signal:AbortSignal.timeout(12000)});
 if(!auth.ok)throw Error('會員授權失效，請重新登入');
 const user=await auth.json();
 if(!user?.id||user.is_anonymous)throw Error('語意搜尋僅開放正式登入會員');
 return {jwt,user};
}
async function quota(user){
 const result=await api('rpc/ti_take_semantic_quota','POST',{p_user:user.id,p_limit:30});
 if(result!==true)throw Error('今日語意查詢與索引已達 30 次，請明日再使用');
}
const vectorLiteral=arr=>'['+arr.join(',')+']';
function normalizeQuery(input){const q=String(input||'').trim();
 if(q.length<3||q.length>150)throw Error('請輸入 3 至 150 個字的語意搜尋內容');
 return q;
}
function parseDocPages(doc){
 const pages=Array.isArray(doc?.extracted?.pages)?doc.extracted.pages:[];
 const rows=[];
 for(const p of pages){
  const text=String(p.text||'').trim();
  if(text.length<30)continue;
  for(let start=0;start<text.length;start+=850){
   const excerpt=text.slice(start,start+1000).trim();
   if(excerpt.length<30)continue;
   rows.push({document_id:doc.id,case_id:doc.case_id||null,
    filename:doc.filename,source_label:String(p.source||'原文段落').slice(0,160),excerpt});
   if(rows.length>=20)return rows;
  }
 }
 return rows;
}
async function indexCases(req){
 const token=req.headers.get('x-ti-cron')||'';
 if(token.length<32)return reply(req,{error:'拒絕未授權的索引工作'},401);
 const verified=await api('rpc/ti_verify_ingest_token','POST',{candidate:token});
 if(verified!==true)return reply(req,{error:'無效的索引工作授權'},401);
 if(!MODEL_KEY)return reply(req,{state:'not_configured',indexed:0,reason:'OPENAI_API_KEY 未配置'});
 const rows=await api('rpc/ti_semantic_case_index_candidates','POST',{p_limit:24});
 if(!rows?.length)return reply(req,{state:'up_to_date',indexed:0,scope:'最近 45 日'});
 const inputs=rows.map(r=>['台灣政府採購案件',r.title,r.agency,r.group_name,r.latest_notice_type]
  .filter(Boolean).join('；').slice(0,1300));
 const vectors=await embed(inputs);
 const write=await Promise.all(rows.map(async(r,i)=>({
  case_id:r.case_id,embedding:vectorLiteral(vectors[i]),notice_date:r.notice_date,
  model:MODEL,source_sha256:await sha(inputs[i]),indexed_at:new Date().toISOString()
 })));
 const response=await fetch(DB+'/rest/v1/ti_case_vectors?on_conflict=case_id',{
  method:'POST',headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,
   'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
  body:JSON.stringify(write),signal:AbortSignal.timeout(28000)});
 if(!response.ok)throw Error('索引儲存失敗（HTTP '+response.status+'）：'+(await response.text()).slice(0,120));
 return reply(req,{state:'indexed',indexed:write.length,model:MODEL,coverage:'最近 45 日逐批建立中'});
}
async function indexPrivate(req,actor,body){
 if(body?.confirm_private_upload!==true)
   throw Error('須先明確同意將私人文件中可辨識文字送往向量模型');
 const id=String(body?.case_id||'');
 if(!id.includes('::')||id.length>190)throw Error('請指定有效的本案案件識別');
 const encoded=encodeURIComponent;
 const docs=await api('ti_documents?select=id,filename,extracted,case_id&user_id=eq.'+
  encoded(actor.user.id)+'&case_id=eq.'+encoded(id)+'&order=created_at.desc&limit=10',
  'GET',null,actor.jwt);
 const chunks=docs.flatMap(parseDocPages).slice(0,20);
 if(!chunks.length)throw Error('本案沒有已完成 OCR／原文解析的私人文件，無法產生語意索引');
 await quota(actor.user);
 const texts=chunks.map(r=>r.excerpt.slice(0,1000));
 const vectors=await embed(texts);
 const rows=await Promise.all(chunks.map(async(row,i)=>({
  document_id:row.document_id,user_id:actor.user.id,case_id:row.case_id,
  source_label:row.source_label,excerpt:row.excerpt,
  source_sha256:await sha(row.source_label+'|'+row.excerpt),
  embedding:vectorLiteral(vectors[i]),model:MODEL,indexed_at:new Date().toISOString()
 })));
 const res=await fetch(DB+'/rest/v1/ti_document_vectors?on_conflict=document_id,source_sha256',{
  method:'POST',headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,
   'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
  body:JSON.stringify(rows),signal:AbortSignal.timeout(28000)});
 if(!res.ok)throw Error('私人向量索引儲存失敗（HTTP '+res.status+'）：'+(await res.text()).slice(0,120));
 return reply(req,{state:'indexed',indexed:rows.length,documents:docs.length,model:MODEL,
  warning:'僅代表已解析的前 20 段，不等於完整標書條款或資格審查'});
}
async function search(req,actor,body){
 const q=normalizeQuery(body?.query);
 const group=['','工程','財物','勞務','未分類'].includes(body?.group)?body.group:'';
 const scope=['cases','documents','both'].includes(body?.scope)?body.scope:'cases';
 const caseId=String(body?.case_id||'').slice(0,190)||null;
 await quota(actor.user);
 const vector=vectorLiteral((await embed([q]))[0]);
 const input=[];
 if(scope==='cases'||scope==='both')input.push(api('rpc/ti_search_semantic_cases','POST',{
   p_embedding:vector,p_limit:20,p_group:group,p_only_open:body?.only_open===true
 },actor.jwt));
 if(scope==='documents'||scope==='both')input.push(api('rpc/ti_search_semantic_documents','POST',{
  p_embedding:vector,p_case_id:caseId,p_limit:12
 },actor.jwt));
 const output=await Promise.all(input);
 let i=0;const cases=scope==='cases'||scope==='both'?output[i++]:[];
 const docs=scope==='documents'||scope==='both'?output[i++]:[];
 return reply(req,{mode:'real_vector_semantic',model:MODEL,query:q,cases,documents:docs,
  indexed_cases_only:true,ranking:'cosine similarity, not eligibility or award probability',
  warning:'只比對已建立向量索引的資料，未收錄或尚未索引的案件不會出現在本清單'});
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{
 'Access-Control-Allow-Origin':origin(req),
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-ti-cron',
 'Access-Control-Allow-Methods':'POST,OPTIONS'}});
 if(req.method!=='POST')return reply(req,{error:'僅接受 POST'},405);
 if(!DB||!SERVICE||!PUB)return reply(req,{error:'語意搜尋的資料庫憑證尚未配置'},503);
 let body;
 try{body=await req.json()}catch{return reply(req,{error:'無效 JSON'},400)}
 try{
  if(body?.action==='index_cases')return await indexCases(req);
  if(!MODEL_KEY)return reply(req,{error:'向量模型 OPENAI_API_KEY 尚未配置，語意搜尋目前未啟用。請使用既有免費關鍵字搜尋。',fallback:'keyword'},503);
  const actor=await member(req);
  if(body?.action==='index_private')return await indexPrivate(req,actor,body);
  if(body?.action==='search')return await search(req,actor,body);
  return reply(req,{error:'不支援的語意操作'},400);
 }catch(e){
  const error=String(e?.message||e).slice(0,260);
  const status=/授權|登入|會員/.test(error)?401:/今日.*已達/.test(error)?429:/索引|模型|資料庫|timeout|fetch|HTTP/.test(error)?502:400;
  return reply(req,{error},status);
 }
});
