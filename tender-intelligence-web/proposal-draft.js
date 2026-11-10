// W06: one editable owner-scoped draft per official case, with original
// source quotations. Manual source template always works without an AI key.
import {getClient} from './backend.js';
import {buildProposalDraft} from './proposal-draft-core.mjs';

const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=String(text);if(cls)n.className=cls;return n;};
const add=(label,input)=>{const box=el('label',label);box.append(input);return box;};
const fail=e=>String(e?.message||e||'未知錯誤').slice(0,240);
async function session(){
 const db=await getClient();
 const {data,error}=await db.auth.getUser();
 return {db,user:error||data?.user?.is_anonymous?null:data?.user||null};
}
async function loadSources(db,userId,caseId){
 const [caseRes,companyRes,assetsRes,docRes,decisionRes]=await Promise.all([
  db.from('ti_cases').select('id,unit_id,job_number,title,agency,budget_amount,deadline_at,latest_notice_type,official_url').eq('id',caseId).maybeSingle(),
  db.from('ti_company_profiles').select('company_name,services,company_intro').eq('user_id',userId).maybeSingle(),
  db.from('ti_company_assets').select('id,title,asset_type,issuer,reference_number,issued_on,expires_on,document_id')
    .eq('user_id',userId).order('created_at',{ascending:false}).limit(35),
  db.from('ti_documents').select('id,filename,extracted,indexed_at').eq('user_id',userId).eq('case_id',caseId)
    .order('created_at',{ascending:false}).limit(30),
  db.from('ti_bid_decisions').select('decision,evidence_notes').eq('user_id',userId).eq('case_id',caseId).maybeSingle()
 ]);
 for(const res of [caseRes,companyRes,assetsRes,docRes,decisionRes])if(res.error)throw res.error;
 if(!caseRes.data)throw Error('案件不存在，或未成功取得官方案件主表');
 return {caseInfo:caseRes.data,company:companyRes.data||{},
  assets:assetsRes.data||[],documents:docRes.data||[],decision:decisionRes.data};
}
export function mountProposalDraft(panel,caseId){
 const heading=el('h3','服務建議書草稿｜有來源的文件初稿');
 const explain=el('p','可先用原始標書和本人公司資料建立草稿，或主動選擇送出原文到正式 AI 服務協助撰稿。所有草稿都需人工核對，不會自動投標。','minor');
 const status=el('p','正在載入自己的草稿…','minor');
 status.setAttribute('role','status');
 const controlBar=el('div','','ti-proposal-actions');
 const create=el('button','依原文建立初稿','ghost-btn');
 const ai=el('button','AI 輔助撰稿（需有效模型）','ghost-btn');
 const save=el('button','儲存我的草稿','primary-btn');
 const review=el('button','人工核對完成','ghost-btn');
 const download=el('button','匯出 Markdown','ghost-btn');
 const field=el('input'),editor=el('textarea');
 field.maxLength=250;field.placeholder='服務建議書標題';field.className='ti-proposal-title';
 editor.maxLength=100000;editor.rows=22;editor.spellcheck=false;editor.className='ti-proposal-editor';
 for(const b of [create,ai,save,review,download]){b.type='button';controlBar.append(b);}
 const indicators=el('p','尚未產生引用來源。','minor');
 panel.append(heading,explain,controlBar,add('草稿標題',field),add('可編輯的建議書 Markdown 內容',editor),indicators,status);
 let loaded=false,savedContent='',lastMode='manual',references=[],reviewStatus='unreviewed',busy=false;
 function warnReplacing(){
  return editor.value===savedContent||!editor.value.trim()||
   confirm('目前有未儲存的修改，重新生成會覆蓋編輯器內容。確定繼續？');
 }
 function updateIndicators(){
  indicators.textContent='產生方式：'+(lastMode==='ai_assisted'?'真實 AI 輔助':'原文套版／手動編輯')+
   '｜可核對來源：'+references.length+' 段｜人工審閱：'+
   (reviewStatus==='reviewed'?'已由本人標記核對':'尚未完成')+
   '。所有內容仍須依正式招標書審查。';
 }
 field.addEventListener('input',()=>{
  if(reviewStatus==='reviewed'){reviewStatus='needs_review';updateIndicators();}
 });
 editor.addEventListener('input',()=>{
  if(reviewStatus==='reviewed'){reviewStatus='needs_review';updateIndicators();}
 });
 function setBusy(v){busy=v;for(const b of [create,ai,save,review])b.disabled=v;}
 async function showExisting(){
  const {db,user}=await session();
  if(!panel.isConnected)return;
  if(!user){status.textContent='請先登入正式會員帳號，才能保存只屬於你的服務建議書。';setBusy(false);return;}
  const {data,error}=await db.from('ti_proposal_drafts')
   .select('title,content_md,source_refs,generation_mode,review_status,updated_at')
   .eq('user_id',user.id).eq('case_id',caseId).maybeSingle();
  if(error){status.textContent='讀取草稿失敗：'+fail(error);setBusy(false);return;}
  if(!panel.isConnected)return;
  if(data){
   field.value=data.title||'';editor.value=data.content_md||'';
   references=Array.isArray(data.source_refs)?data.source_refs:[];
   lastMode=data.generation_mode||'manual';reviewStatus=data.review_status||'unreviewed';
   savedContent=editor.value;
   status.textContent='已讀取你之前保存的服務建議書（最後修改：'+String(data.updated_at||'未提供')+'）。';
  }else status.textContent='這件案件尚無私人草稿。可先建立有來源的初稿。';
  loaded=true;updateIndicators();setBusy(false);
 }
 create.addEventListener('click',async()=>{
  if(busy||!warnReplacing())return;
  setBusy(true);status.textContent='正在讀取已入庫的本案資料與私人公司原文…';
  try{
   const {db,user}=await session();if(!user)throw Error('請先登入正式會員');
   const input=await loadSources(db,user.id,caseId);
   if(!panel.isConnected)throw Error('頁面已關閉，停止填入草稿');
   const draft=buildProposalDraft(input);
   field.value=draft.title;editor.value=draft.content;
   references=draft.sourceRefs;lastMode='evidence_template';reviewStatus='needs_review';
   status.textContent='已從 '+draft.documentCount+' 份私人文件整理 '+draft.sourceCount+
    ' 段可核對的原文；這是有來源套版，不是 AI 生成。請人工修改後按「儲存」。';
   updateIndicators();
  }catch(error){status.textContent='建立草稿失敗：'+fail(error);}
  finally{setBusy(false);}
 });
 ai.addEventListener('click',async()=>{
  if(busy||!warnReplacing())return;
  if(!confirm('即將把你本人保存於此案件的標書文字與公司摘要傳給 AI 服務協助撰稿。確定授權本次傳送？'))return;
  setBusy(true);status.textContent='正在由具身分驗證的 AI 後端讀取本案原文與私人公司資料…';
  try{
   const {db,user}=await session();if(!user)throw Error('請先登入正式會員');
   const {data,error}=await db.functions.invoke('ti-proposal-draft',{body:{case_id:caseId}});
   if(error){
    let detail=data?.error||'';
    if(!detail&&error.context&&typeof error.context.json==='function'){
      try{detail=(await error.context.clone().json())?.error||'';}catch{}
    }
    throw Error(detail||error.message||'AI 服務不可用');
   }
   if(data?.error)throw Error(data.error);
   if(!data?.markdown||!Array.isArray(data?.source_refs)||data?.mode!=='ai_assisted')
    throw Error('AI 回傳資料未通過原文引用格式驗證，沒有修改你的草稿');
   if(!panel.isConnected)throw Error('案件頁已關閉');
   editor.value=String(data.markdown).slice(0,100000);
   field.value=String(data.title||'服務建議書 AI 草稿').slice(0,250);
   references=data.source_refs;lastMode='ai_assisted';reviewStatus='needs_review';
   status.textContent='已收到真實 AI 模型的可編輯草稿；已檢查引用並排除無來源段落。請人工核對後再儲存。';
   updateIndicators();
  }catch(error){status.textContent='AI 輔助撰稿未完成：'+fail(error)+'。原本編輯內容不會被清除。';}
  finally{setBusy(false);}
 });
 save.addEventListener('click',async()=>{
  if(busy)return;
  if(!editor.value.trim()||!field.value.trim()){status.textContent='請先填寫標題與正文。';return;}
  setBusy(true);
  try{
   const {db,user}=await session();if(!user)throw Error('請先登入正式會員');
   const record={user_id:user.id,case_id:caseId,title:field.value.slice(0,250),
    content_md:editor.value.slice(0,100000),source_refs:references,
    generation_mode:lastMode,review_status:reviewStatus,updated_at:new Date().toISOString()};
   const {data,error}=await db.from('ti_proposal_drafts').upsert(record,{onConflict:'user_id,case_id'}).select('id').maybeSingle();
   if(error||!data?.id)throw error||Error('資料庫未確認保存');
   savedContent=editor.value;
   status.textContent='已儲存至你本人專用的案件服務建議書，其他帳號不能讀取。';
  }catch(error){status.textContent='儲存失敗：'+fail(error);}
  finally{setBusy(false);}
 });
 review.addEventListener('click',()=>{
  if(!editor.value.trim()){status.textContent='尚無可核對的草稿。';return;}
  if(!confirm('你是否已自行逐項核對官方公告、更正、所有標書原文及公司證明？此動作只記錄你的審閱，不代表政府認可。'))return;
  reviewStatus='reviewed';status.textContent='已由你標記人工核對；請再按「儲存」同步到私人資料庫。';
  updateIndicators();
 });
 download.addEventListener('click',()=>{
  if(!editor.value.trim()){status.textContent='沒有可以匯出的草稿。';return;}
  const filename=String(field.value||'服務建議書').replace(/[\\/:*?"<>|]/g,'_').slice(0,60)+'.md';
  const blob=new Blob(['\uFEFF'+editor.value],{type:'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  status.textContent='已匯出目前編輯器的 Markdown 草稿，未替你提交官方投標。';
 });
 setBusy(true);
 void showExisting();
}
