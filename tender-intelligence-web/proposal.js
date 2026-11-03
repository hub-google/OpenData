// PRD V5/V7: deterministic document-version diff, and real AI compliance checks.
// The comparison is local. AI only runs through an authenticated backend.
import {parseDocument} from './app.js';
import {DATABASE_URL,PUBLISHABLE_KEY,getClient} from './backend.js';
import {csvEscape} from './core.mjs';
const $=id=>document.getElementById(id);
const el=(tag,cls='',text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node};
const text=e=>String(e?.message||e||'未知錯誤').slice(0,260);
let diffRows=[],aiRows=[];
function paragraphs(pages){
 const out=[];
 for(const page of pages){
  const lines=String(page.text||'').replace(/\r/g,'\n').split(/[\n。；;]+/)
    .map(s=>s.trim().replace(/\s+/g,' ')).filter(s=>s.length>=10);
  for(const x of lines.slice(0,2000))out.push({source:page.source,content:x.slice(0,1400)});
 }
 return out.slice(0,5000);
}
const normal=x=>x.replace(/\s+/g,'').toLocaleLowerCase('zh-TW');
async function readFile(id){
 const file=$(id).files?.[0];
 if(!file)throw Error('請先選擇兩份文件');
 if(file.size>15*1024*1024)throw Error(file.name+' 超過 15 MB 上限');
 const pages=await parseDocument(file);
 if(!pages?.length||pages.every(x=>!String(x.text||'').trim()))throw Error(file.name+' 沒有可讀文字層（掃描 PDF 目前不支援 OCR）');
 return {name:file.name,pages};
}
function results(container,items,heading){
 container.append(el('h3','',heading+'（'+items.length+' 段）'));
 const rows=el('div','watch-list');
 if(!items.length)rows.append(el('p','minor','沒有找到與舊版不同的逐段原文。'));
 for(const r of items.slice(0,50)){
  const div=el('div','timeline-item');
  div.append(el('p','',r.content),el('p','minor','來源：'+r.source));
  rows.append(div);
 }
 if(items.length>50)rows.append(el('p','minor','畫面只顯示前 50 段；完整差異可匯出 CSV。'));
 container.append(rows);
}
function csvDownload(rows,name){
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(csvEscape).join(',')).join('\r\n')],
   {type:'text/csv;charset=utf-8'});
 const u=URL.createObjectURL(blob),a=el('a');a.download=name;a.href=u;a.click();URL.revokeObjectURL(u);
}
async function runDiff(){
 const box=$('versionDiffOutput'),btn=$('runVersionDiff');btn.disabled=true;
 box.replaceChildren(el('p','minor','正在使用本機文字解析比對；不會上傳文件。'));
 try{
  const [before,after]=await Promise.all([readFile('versionBefore'),readFile('versionAfter')]);
  const a=paragraphs(before.pages),b=paragraphs(after.pages);
  if(!a.length||!b.length)throw Error('文件沒有足夠的可比對文字');
  const old=new Set(a.map(r=>normal(r.content))),next=new Set(b.map(r=>normal(r.content)));
  const added=b.filter(r=>!old.has(normal(r.content)));
  const removed=a.filter(r=>!next.has(normal(r.content)));
  diffRows=[
   ...added.map(r=>({...r,kind:'新增（僅代表逐段文字不同）'})),
   ...removed.map(r=>({...r,kind:'移除（僅代表逐段文字不同）'}))
  ];
  box.replaceChildren(el('h2','','真實原文逐段差異'),el('p','minor','舊版：'+before.name+'｜新版：'+after.name+
   '。按實際文字逐段比較，換行、斷詞或頁面重新排版可能造成誤報；這不是 AI 語意判讀。'));
  results(box,added,'新版新增段落');
  results(box,removed,'舊版不再出現的段落');
  const exportBtn=el('button','ghost-btn','匯出完整差異 CSV');
  exportBtn.type='button';exportBtn.addEventListener('click',()=>csvDownload([
   ['差異類別','來源','原文內容'],...diffRows.map(x=>[x.kind,x.source,x.content])
  ],'標單原文版本差異.csv'));
  box.append(exportBtn);
 }catch(e){box.replaceChildren(el('p','notice danger','文件差異比較失敗：'+text(e)));}
 finally{btn.disabled=false;}
}
function renderChecks(result,job,model){
 const box=$('proposalAiOutput');box.replaceChildren(el('h2','','實際 AI 文件健檢'),
  el('p','minor','模型：'+model+'｜分析紀錄：'+job+'｜標書頁面／段落 '+result.tender_page_count+
   '、投標書頁面／段落 '+result.proposal_page_count),
  el('p','',result.summary||'未提供摘要'));
 if(result.caveats?.length){
  const note=el('div','notice warning');note.append(el('strong','','需要人工核對：'));
  for(const x of result.caveats)note.append(el('p','',x));
  box.append(note);
 }
 aiRows=result.checks||[];
 if(!aiRows.length)box.append(el('p','notice warning','AI 沒有產生可由原文核對的條款，請直接人工檢查。'));
 for(const row of aiRows){
  const item=el('div','timeline-item');
  item.append(el('strong','',row.requirement),el('span','case-tag',row.status),
   el('p','minor','招標文件 '+row.tender_page+'：'+row.tender_quote),
   el('p','minor','公司投標書：'+(row.proposal_quote?(row.proposal_page+'：'+row.proposal_quote):'未找到可核對的原文證據')),
   el('p','','缺漏：'+row.gaps),
   el('p','','人工建議：'+row.suggested_action));
  box.append(item);
 }
 if(aiRows.length){
  const exportBtn=el('button','ghost-btn','匯出 AI 健檢清單 CSV');
  exportBtn.type='button';exportBtn.addEventListener('click',()=>csvDownload([
   ['要求','招標頁碼','招標原文','回覆狀態','投標書頁碼','投標書原文','缺漏','待辦'],
   ...aiRows.map(x=>[x.requirement,x.tender_page,x.tender_quote,
    x.status,x.proposal_page,x.proposal_quote,x.gaps,x.suggested_action])
  ],'AI標書健檢清單.csv'));
  box.append(exportBtn);
 }
}
async function runAI(){
 const box=$('proposalAiOutput'),btn=$('runProposalAI');btn.disabled=true;
 box.replaceChildren(el('p','minor','正在讀取兩份原始文件，只有 AI 服務金鑰啟用時才會送出文字內容。'));
 try{
  const client=await getClient();
  const {data:{session},error:sessionError}=await client.auth.getSession();
  if(sessionError)throw sessionError;
  if(!session?.access_token)throw Error('需要先登入本平台帳戶，才能使用真實 AI 服務。');
  const ready=await fetch(DATABASE_URL+'/functions/v1/ti-service-status',{cache:'no-store'});
  if(!ready.ok)throw Error('無法確認 AI 服務狀態');
  const readiness=await ready.json();
  if(!readiness.ai_ready)throw Error('此專案尚未配置 OPENAI_API_KEY，未執行任何 AI，且不會生成模擬結果。');
  const [tender,proposal]=await Promise.all([readFile('proposalTender'),readFile('proposalResponse')]);
  const body={tender_pages:tender.pages,proposal_pages:proposal.pages,
   proposal_name:proposal.name,tender_name:tender.name};
  box.replaceChildren(el('p','minor','正在傳送兩份文件的可讀原文進行真實 AI 比對，結果會附原文引用。'));
  const r=await fetch(DATABASE_URL+'/functions/v1/ti-proposal-check',{
   method:'POST',headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY,
    Authorization:'Bearer '+session.access_token},
   body:JSON.stringify(body),signal:AbortSignal.timeout(125000)
  });
  const data=await r.json().catch(()=>({error:'AI 服務回應格式錯誤'}));
  if(!r.ok)throw Error(data.error||('AI 服務 HTTP '+r.status));
  if(!Array.isArray(data.result?.checks))throw Error('AI 沒有返回正式的檢核結果');
  renderChecks(data.result,data.job_id,data.model);
 }catch(e){box.replaceChildren(el('h2','','AI 標書健檢尚未完成'),
  el('p','notice warning',text(e)+' 不會以本機字串比對冒充 AI 結果。'));}
 finally{btn.disabled=false;}
}
function init(){
 $('runVersionDiff').addEventListener('click',()=>void runDiff());
 $('runProposalAI').addEventListener('click',()=>void runAI());
 const p=new URLSearchParams(window.location.search);
 if(p.get('view')==='proposal')document.querySelector('[data-view="proposal"]')?.click();
}
init();
