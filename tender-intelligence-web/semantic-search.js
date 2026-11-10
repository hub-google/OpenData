// S02/W07: genuine vector semantic search. Never label keyword matching as AI.
// The model key stays in Supabase Edge Functions; no model calls from the browser.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=String(text??'');if(cls)n.className=cls;return n;};
const err=e=>String(e?.message||e||'未知錯誤').slice(0,220);
async function callSemantic(client,body){
 const {data,error}=await client.functions.invoke('ti-semantic',{body});
 if(error){
  let reason=data?.error||'';
  if(!reason&&error.context&&typeof error.context.json==='function'){
   try{reason=(await error.context.clone().json())?.error||'';}catch{}
  }
  throw Error(reason||err(error));
 }
 if(data?.error)throw Error(data.error);
 return data;
}
async function getMember(){
 const db=await getClient(),{data,error}=await db.auth.getUser();
 if(error||!data?.user||data.user.is_anonymous)throw Error('請先以 Email 或 Google 正式登入後使用 AI 語意搜尋');
 return db;
}
function caseLink(id,title){
 const sep=String(id||'').indexOf('::');
 if(sep<1)return el('strong',title||'未提供案名');
 const a=el('a',title||'未提供案名');
 a.href='./?case_unit='+encodeURIComponent(id.slice(0,sep))+
  '&case_no='+encodeURIComponent(id.slice(sep+2));
 return a;
}
function budget(v){return v===null||v===undefined?'預算未公開':
 Number.isFinite(Number(v))?'預算 NT$'+Number(v).toLocaleString('zh-TW'):'預算待確認'}
function renderResults(box,data){
 box.replaceChildren();
 const total=(data.cases||[]).length+(data.documents||[]).length;
 const header=el('p','真實向量模型 '+(data.model||'')+'｜已建立向量索引的案件 '+(data.cases||[]).length+
  ' 件、私人文件引用 '+(data.documents||[]).length+' 段。未索引案件不在搜尋範圍內。','minor');
 box.append(header);
 if(!total)box.append(el('p','目前沒有相符的已索引資料；不會拿關鍵字搜尋冒充 AI 結果。','empty'));
 for(const result of data.cases||[]){
  const card=el('article','','ti-semantic-hit');
  const h=el('h3');h.append(caseLink(result.case_id,result.title));
  card.append(h,el('p',(result.agency||'機關未公開')+'｜'+(result.notice_type||'公告類型待確認')+
   '｜'+budget(result.budget),'minor'));
  const score=Number(result.similarity);
  card.append(el('p',Number.isFinite(score)?'語意相似度 '+(score*100).toFixed(1)+
   '%（不是公司適配或得標率）':'語意相似度未提供','minor'));
  if(result.source_url&&/^https:\/\/web\.pcc\.gov\.tw(?:\/|$)/.test(result.source_url)){
   const a=el('a','核對官方公告');a.href=result.source_url;a.target='_blank';a.rel='noopener noreferrer';
   card.append(a);
  }
  box.append(card);
 }
 for(const hit of data.documents||[]){
  const card=el('article','','ti-semantic-hit');
  card.append(el('h3',hit.filename||'我的私人文件'),
    el('p','來源：'+(hit.source_label||'原文段落'),'minor'),
    el('blockquote',hit.excerpt||''));
  const goto=el('button','到我的文件核對原文','ghost-btn');goto.type='button';
  goto.addEventListener('click',()=>document.querySelector('[data-view="documents"]')?.click());
  card.append(goto);box.append(card);
 }
 box.append(el('p','AI 僅負責向量相似度查詢。官方資格、尚未索引的全文、投標條件與所有引用均須人工核對。','minor'));
}
function init(){
 const form=$('semanticForm'),status=$('semanticStatus'),box=$('semanticResults');
 if(!form||!status||!box)return;
 let run=0;
 const ask=$('semanticAsk');
 ask?.addEventListener('click',async()=>{
  const question=$('semanticQuery').value.trim();
  if(question.length<3||question.length>150){
   status.textContent='請先輸入 3 至 150 個字的私人文件問題。';return;
  }
  if(!confirm('本次問題及最多 8 段從你私人文件索引擷取的原文，將傳送至 AI 模型進行問答。確定授權？'))return;
  ask.disabled=true;status.textContent='正在以本人授權的私人原文進行引用式問答…';
  box.replaceChildren();
  try{
   const db=await getMember(),data=await callSemantic(db,{
    action:'answer_private',query:question,confirm_private_query:true});
   status.textContent=data.mode==='grounded_private_rag'?
    '取得附來源的 AI 回答，仍須核對所有原文與資格。':'未產出可以核對的私人原文回答。';
   const article=el('article','','ti-semantic-hit');
   article.append(el('h3','AI 文件回答（需人工核對）'),
    el('p',data.answer||'沒有可核對的回答'));
   for(const ref of data.citations||[]){
    article.append(el('p','來源：'+(ref.filename||'私人文件')+'／'+(ref.source_label||'原文段落'),'minor'),
     el('blockquote',ref.quote||''));
   }
   for(const warning of data.warnings||[])article.append(el('p','注意：'+warning,'minor'));
   box.append(article);
  }catch(error){
   status.textContent='私人文件 AI 問答不可用：'+err(error)+
    '；未取得可核對回答，不會使用模擬結果。';
  }finally{ask.disabled=false;}
 });
 form.addEventListener('submit',async e=>{
  e.preventDefault();const seq=++run;
  const query=$('semanticQuery').value.trim(),scope=$('semanticScope').value,
   group=$('semanticGroup').value,onlyOpen=$('semanticOnlyOpen').checked;
  if(query.length<3||query.length>150){status.textContent='語意搜尋需輸入 3 至 150 個字。';return;}
  const button=form.querySelector('button[type="submit"]');button.disabled=true;
  box.replaceChildren();status.textContent='正在使用真正的向量模型比對已建立索引的資料…';
  try{
   const db=await getMember();
   const data=await callSemantic(db,{action:'search',query,scope,group,only_open:onlyOpen});
   if(seq!==run)return;
   status.textContent='查詢完成；只使用真實向量及已確認來源。';
   renderResults(box,data);
  }catch(error){
   if(seq!==run)return;
   status.textContent='語意搜尋不可用：'+err(error)+'。一般關鍵字搜尋仍可使用。';
   box.replaceChildren(el('p','沒有顯示虛構的 AI 搜尋結果。','minor'));
  }finally{if(seq===run)button.disabled=false;}
 });
}
export async function indexPrivateCase(caseId,status){
 const write=message=>{if(status)status.textContent=message;};
 if(!confirm('確定將「本案已儲存的私人文件原文」送到外部向量模型建立私人語意索引？只會處理已解析的部分頁段，且可能產生 API 費用。'))return;
 write('正在建立私人文件語意向量，請勿上傳未授權的資料…');
 try{
  const db=await getMember();
  const data=await callSemantic(db,{action:'index_private',case_id:caseId,
    confirm_private_upload:true});
  write('已建立 '+Number(data.indexed||0)+' 段本人的文件語意索引。'+String(data.warning||''));
 }catch(error){write('索引未完成：'+err(error)+'。原始文件不受影響。');}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
