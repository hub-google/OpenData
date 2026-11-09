// Single case workspace: all panels keep the same official case id and reuse existing ti_* tables.
import {getClient} from './backend.js';
import {saveCloudDocument} from './app.js';
const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
const control=(tag,attrs={})=>{const node=document.createElement(tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node;};
const field=(name,node)=>{const label=el('label',name);label.append(node);return label;};
const $=id=>document.getElementById(id);
const err=e=>String(e?.message||e||'未知錯誤').slice(0,180);
async function owner(){
 const db=await getClient(),{data,error}=await db.auth.getUser();
 return error||!data?.user?{db,user:null}:{db,user:data.user};
}
function status(p,text){let n=p.querySelector('.ti-case-status');if(!n){n=el('p','','minor ti-case-status');p.prepend(n);}n.textContent=text;}
function openOldView(view){
 const caseId=window.__tiActiveCaseId;
 $('closeDetail')?.click();const button=document.querySelector('[data-view="'+view+'"]');button?.click();
 if(view==='documents' && caseId && $('documentCaseId')){
   const chooser=$('documentCaseId');
   if(![...chooser.options].some(o=>o.value===caseId))chooser.append(new Option(window.__tiActiveCaseTitle||caseId,caseId));
   chooser.value=caseId;
 }
 const field=view==='documents'?'documentCaseId':view==='decisions'?'decisionCase':view==='contracts'?'contractCase':null;
 if(field&&caseId&&$(field)&&[...$(field).options].some(o=>o.value===caseId))$(field).value=caseId;
}
function makeDecision(panel,caseId){
 panel.append(el('h3','案件投標決策'));
 const form=el('form','','ti-case-editor');
 const decision=control('select',{required:''});
 for(const v of ['評估中','建議追蹤','準備投標','不投']){const option=el('option',v);option.value=v;decision.append(option);}
 const notes=control('textarea',{rows:'4',maxlength:'5000',placeholder:'填入確認過的資格、證照、實績與決策理由；未知處請註明待確認'});
 const save=el('button','儲存案件決策','primary-btn');save.type='submit';
 const advanced=el('button','完整六項證據評估','ghost-btn');advanced.type='button';
 advanced.onclick=()=>openOldView('decisions');
 form.append(field('決策狀態',decision),field('決策依據／待確認事項',notes),save,advanced);panel.append(form);
 let criteria={};
 async function read(){
  const {db,user}=await owner();if(!user){status(panel,'請先登入才能同步案件決策。');return;}
  const {data,error}=await db.from('ti_bid_decisions').select('decision,evidence_notes,criteria').eq('user_id',user.id).eq('case_id',caseId).maybeSingle();
  if(error){status(panel,'讀取決策失敗：'+err(error));return;}
  if(!panel.isConnected)return;
  decision.value=data?.decision||'評估中';notes.value=data?.evidence_notes||'';criteria=data?.criteria||{};
  status(panel,'這裡與原本的「投標決策評估」共用同一筆紀錄，不會清除六項評估證據。');
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();save.disabled=true;
  try{
   const {db,user}=await owner();if(!user)throw Error('請先登入');
   const {error}=await db.from('ti_bid_decisions').upsert({
    user_id:user.id,case_id:caseId,decision:decision.value,criteria,
    evidence_notes:notes.value.trim().slice(0,5000),updated_at:new Date().toISOString()
   },{onConflict:'user_id,case_id'});if(error)throw error;
   status(panel,'決策已保存到此案件，其他頁面可繼續編輯。');
  }catch(x){status(panel,'儲存失敗：'+err(x));}finally{save.disabled=false;}
 });
 void read();
}
function makeTasks(panel,caseId){
 panel.append(el('h3','案件待辦與任務'));
 const list=el('div','','ti-case-list'),form=el('form','','ti-case-editor');
 const title=control('input',{required:'',maxlength:'300',placeholder:'例如：準備公司合格證照'}),date=control('input',{type:'date'});
 const add=el('button','新增任務','primary-btn');add.type='submit';
 form.append(field('任務名稱',title),field('截止日期',date),add);panel.append(form,list);
 async function reload(){
  const {db,user}=await owner();if(!user){status(panel,'登入後可儲存任務，並與投標工作台同步。');return;}
  const {data,error}=await db.from('ti_tasks').select('id,title,done,due_at').eq('user_id',user.id).eq('case_id',caseId).order('created_at',{ascending:false}).limit(100);
  if(error){status(panel,'讀取任務失敗：'+err(error));return;}
  if(!panel.isConnected)return;
  list.replaceChildren();if(!data?.length)list.append(el('p','這個案件還沒有待辦。','minor'));
  for(const t of data||[]){
   const row=el('div','','ti-case-listrow'),label=el('label',''),check=control('input',{type:'checkbox'});
   check.checked=Boolean(t.done);label.append(check,document.createTextNode(t.title));
   row.append(label,el('span',t.due_at?t.due_at.slice(0,10):'未設定期限','minor'));
   check.addEventListener('change',async()=>{check.disabled=true;const {error:e}=await db.from('ti_tasks').update({done:check.checked}).eq('id',t.id).eq('user_id',user.id);if(e)status(panel,err(e));await reload();});
   list.append(row);
  }
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();add.disabled=true;
  try{const {db,user}=await owner();if(!user)throw Error('請先登入');
   const {error}=await db.from('ti_tasks').insert({user_id:user.id,case_id:caseId,title:title.value.trim(),due_at:date.value?date.value+'T23:59:00+08:00':null});if(error)throw error;
   title.value='';date.value='';await reload();
  }catch(x){status(panel,'任務新增失敗：'+err(x));}finally{add.disabled=false;}
 });
 void reload();
}
function makeDocuments(panel,caseId){
 panel.append(el('h3','此案的私有標書與 AI 文件'));
 const explain=el('p','可繼續使用原本的標書解析與兩版原文比較；已有雲端文件會依案件編號顯示。AI 需要正式可用的模型服務。','minor');
 const buttons=el('div','','detail-actions');
 for(const [label,view] of [['標書差異與 AI 健檢','proposal'],['標書條款解析／私人文件庫','documents']]){
  const b=el('button',label,'ghost-btn');b.type='button';b.onclick=()=>openOldView(view);buttons.append(b);
 }
 const uploadRow=el('div','','ti-case-editor');
 const input=control('input',{type:'file',accept:'.pdf,.docx,.txt,.md','aria-label':'上傳此案的私人標書'});
 const upload=el('button','上傳至此案文件庫','primary-btn');upload.type='button';
 uploadRow.append(field('選擇本案文件（PDF、DOCX、TXT、MD，15MB 以內）',input),upload);
 const list=el('div','','ti-case-list');panel.append(explain,buttons,uploadRow,list);
 upload.addEventListener('click',async()=>{
  const file=input.files?.[0];if(!file)return status(panel,'請先選擇要儲存到此案的文件。');
  upload.disabled=true;
  try{
   const success=await saveCloudDocument(file,caseId);
   if(success){input.value='';await refreshFiles();}
   else status(panel,'文件尚未儲存成功，請確認登入狀態與格式。');
  }finally{upload.disabled=false;}
 });
 async function refreshFiles(){
  const {db,user}=await owner();if(!user){status(panel,'登入後才能查看自己的私有文件。');return;}
  const {data,error}=await db.from('ti_documents').select('id,filename,storage_path,extraction_status,created_at').eq('user_id',user.id).eq('case_id',caseId).order('created_at',{ascending:false}).limit(30);
  if(error){status(panel,'讀取文件失敗：'+err(error));return;}
  if(!panel.isConnected)return;list.replaceChildren();
  if(!data?.length)list.append(el('p','尚無關聯此案的雲端文件；可到文件庫選擇案件上傳。','minor'));
  for(const doc of data||[]){
   const row=el('div','','ti-case-listrow'),
      name=el('span',doc.filename+'｜'+(doc.extraction_status||'已儲存')),
      download=el('button','下載文件','ghost-btn'),
      remove=el('button','刪除文件','ghost-btn');
   download.type='button';remove.type='button';
   download.addEventListener('click',async()=>{
    download.disabled=true;status(panel,'正在驗證權限並下載自己的私人文件…');
    try{
     const {data:blob,error:loadError}=await db.storage.from('ti-private-documents').download(doc.storage_path);
     if(loadError||!blob)throw loadError||Error('下載未取得文件');
     const url=URL.createObjectURL(blob),a=document.createElement('a');
     a.href=url;a.download=doc.filename;a.style.display='none';
     document.body.append(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(url),10000);
     status(panel,'已開始下載 '+doc.filename+'。');
    }catch(error){status(panel,'私人文件下載失敗：'+err(error));}
    finally{download.disabled=false;}
   });
   remove.addEventListener('click',async()=>{
    if(!window.confirm('確定永久刪除本案文件「'+doc.filename+'」？'))return;
    remove.disabled=true;
    try{
     const {error:storageError}=await db.storage.from('ti-private-documents').remove([doc.storage_path]);
     if(storageError)throw storageError;
     const {error:rowError}=await db.from('ti_documents').delete().eq('id',doc.id).eq('user_id',user.id).eq('case_id',caseId);
     if(rowError)throw rowError;
     await refreshFiles();
     status(panel,'已刪除本案件的私人文件。');
    }catch(error){status(panel,'刪除文件失敗：'+err(error));remove.disabled=false;}
   });
   row.append(name,download,remove);list.append(row);
  }
  if(data?.length)status(panel,'已同步 '+data.length+' 份本案件私人文件。');
  let history=panel.querySelector('.ti-qualification-history');
  if(!history){history=el('div','','ti-case-list ti-qualification-history');panel.append(el('h3','此案已保存的資格核對'),history);}
  history.replaceChildren();
  const {data:checks,error:checkError}=await db.from('ti_qualification_checks')
   .select('id,document_name,page_count,checks,created_at').eq('user_id',user.id)
   .eq('case_id',caseId).order('created_at',{ascending:false}).limit(10);
  if(checkError){history.append(el('p','取得資格核對紀錄失敗：'+err(checkError),'minor'));return;}
  if(!checks?.length)history.append(el('p','尚未保存此案的資格核對。可在「標書條款整理」與公司資料比對並保存。','minor'));
  for(const item of checks||[]){
   const entries=Array.isArray(item.checks)?item.checks:[],confirmed=entries.filter(x=>x.review==='本人核對符合').length;
   const row=el('div','','ti-case-listrow');
   row.append(el('strong',item.document_name),el('span',entries.length+' 項條款／'+confirmed+' 項由本人核對符合｜'+(item.created_at||'').slice(0,10),'minor'));
   history.append(row);
  }
 }
 void refreshFiles();
}
function makeHistory(panel,caseInfo,overview){
 panel.append(el('h3','行情及相似歷史案件'));
 const stats=el('div','','ti-case-kpis');
 for(const [name,value] of [['此案已公開預算',caseInfo.budget==null?'未取得':Number(caseInfo.budget).toLocaleString('zh-TW')+' 元'],['此案已公開決標金額',caseInfo.award==null?'未取得':Number(caseInfo.award).toLocaleString('zh-TW')+' 元']]){
  const cell=el('div','','metric');cell.append(el('span',name),el('strong',value));stats.append(cell);
 }
 panel.append(stats,el('p','此處僅顯示官方原文已確認的金額，無樣本時不生成報價建議。','minor'));
 const related=overview.querySelector('#relatedCases');
 if(related){
  const header=related.previousElementSibling;if(header?.tagName==='H3')panel.append(header);
  panel.append(related);
 }
 const b=el('button','查看全站決標行情','ghost-btn');b.type='button';b.onclick=()=>openOldView('analytics');panel.append(b);
}
function makeContracts(panel,caseId){
 panel.append(el('h3','合約、保證金與履約期限'));
 const form=el('form','','ti-case-editor'),subject=control('input',{required:'',maxlength:'250',placeholder:'例如：履約保證金返還'}),due=control('input',{type:'date',required:''}),type=control('select');
 for(const t of ['押標金','履約保證金','保固保證金','履約里程碑','驗收','請款','合約到期']){
  const option=el('option',t);option.value=t;type.append(option);
 }
 const save=el('button','新增履約項目','primary-btn');save.type='submit';
 form.append(field('類別',type),field('項目名稱',subject),field('到期日',due),save);
 const list=el('div','','ti-case-list');panel.append(form,list);
 async function reload(){
  const {db,user}=await owner();if(!user){status(panel,'登入後可管理自己的履約台帳。');return;}
  const {data,error}=await db.from('ti_contract_obligations').select('id,subject,obligation_type,due_date,status').eq('user_id',user.id).eq('case_id',caseId).order('due_date',{ascending:true}).limit(100);
  if(error){status(panel,'讀取履約項目失敗：'+err(error));return;}
  if(!panel.isConnected)return;list.replaceChildren();
  if(!data?.length)list.append(el('p','這個案件沒有履約管理項目。','minor'));
  for(const r of data||[]){
   const row=el('div','','ti-case-listrow');
   row.append(el('span',r.obligation_type+'｜'+r.subject),el('span',r.due_date+' · '+r.status,'minor'));list.append(row);
  }
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();save.disabled=true;
  try{const {db,user}=await owner();if(!user)throw Error('請先登入');
   const {error}=await db.from('ti_contract_obligations').insert({user_id:user.id,case_id:caseId,subject:subject.value.trim(),due_date:due.value,obligation_type:type.value});
   if(error)throw error;subject.value='';due.value='';await reload();
  }catch(x){status(panel,'新增失敗：'+err(x));}finally{save.disabled=false;}
 });
 void reload();
}
// Four task-based main tabs. Internal preparation tools continue sharing the
// original ti_* rows: this only relocates existing nodes and controls.
function moveSection(from,to,heading){
 const h=[...from.children].find(n=>n.tagName==='H3'&&n.textContent.includes(heading));
 if(!h)return;
 const next=h.nextElementSibling;
 to.append(h);
 if(next&&next!==h&&next.tagName!=='H3')to.append(next);
}
function mount(caseInfo){
 window.__tiActiveCaseId=caseInfo?.caseId||null;
 window.__tiActiveCaseTitle=caseInfo?.title||'';
 const root=$('detailContent');
 if(!root||!caseInfo?.caseId||root.querySelector('.ti-case-tabs'))return;
 const grid=root.querySelector('.detail-grid');if(!grid)return;
 const nodes=Array.from(root.children),idx=nodes.indexOf(grid);
 if(idx<0)return;
 const overview=el('section','','ti-case-panel');
 for(const element of nodes.slice(idx))overview.append(element);
 const notices=el('section','','ti-case-panel'),competition=el('section','','ti-case-panel'),preparation=el('section','','ti-case-panel');
 moveSection(overview,notices,'公告歷程與官方來源');
 moveSection(overview,notices,'最新公告原始欄位');
 const source=overview.querySelector('.detail-source');if(source)notices.append(source);
 moveSection(overview,competition,'公告出現的廠商');
 if(!notices.children.length)notices.append(el('p','此案目前只有摘要，尚無已入庫公告歷程。','minor'));
 const tabs=el('div','','ti-case-tabs');
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','案件主要任務');
 const container=el('div','','ti-case-panels'),panels=[overview,notices,competition,preparation];
 const labels=['案件重點','公告歷程','行情與競爭','投標準備'];
 panels.forEach((panel,i)=>{panel.hidden=i!==0;container.append(panel)});
 const tabButtons=[];
 labels.forEach((label,i)=>{
  const b=el('button',label,'ti-case-tab');b.type='button';b.setAttribute('role','tab');
  b.setAttribute('aria-selected',i===0?'true':'false');
  b.setAttribute('data-main-tab',String(i));
  if(i===0)b.classList.add('selected');
  b.addEventListener('click',()=>{
   panels.forEach((panel,j)=>panel.hidden=j!==i);
   tabButtons.forEach((tab,j)=>{tab.classList.toggle('selected',j===i);tab.setAttribute('aria-selected',String(j===i))});
  });
  tabButtons.push(b);tabs.append(b);
 });
 root.append(tabs,container);
 makeHistory(competition,caseInfo,overview);
 const prepTabs=el('div','','ti-prep-tabs');prepTabs.setAttribute('role','tablist');
 prepTabs.setAttribute('aria-label','投標準備項目');
 const prepPanels=[],prepButtons=[];
 const sections=[['decision','評估與決策'],['documents','資格與標書'],['tasks','待辦與分工'],['contracts','履約與保證金']];
 for(const [i,[key,label]] of sections.entries()){
  const panel=el('section','','ti-prep-panel');panel.hidden=i!==0;
  const button=el('button',label,'ti-prep-tab');button.type='button';
  button.dataset.prepTab=key;button.setAttribute('role','tab');
  button.setAttribute('aria-selected',String(i===0));
  if(i===0)button.classList.add('selected');
  button.addEventListener('click',()=>{
   prepPanels.forEach((p,j)=>p.hidden=j!==i);
   prepButtons.forEach((b,j)=>{b.classList.toggle('selected',j===i);b.setAttribute('aria-selected',String(j===i))});
  });
  prepTabs.append(button);prepButtons.push(button);prepPanels.push(panel);
 }
 preparation.append(prepTabs,...prepPanels);
 makeDecision(prepPanels[0],caseInfo.caseId);
 makeDocuments(prepPanels[1],caseInfo.caseId);
 makeTasks(prepPanels[2],caseInfo.caseId);
 makeContracts(prepPanels[3],caseInfo.caseId);
}
document.addEventListener('ti:case-opened',e=>mount(e.detail));
