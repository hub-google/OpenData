// PRD V6/U13/U14: account-scoped decision evidence, contract deadlines,
// and expressly unverified self-published supplier profiles.
import {getClient} from './backend.js';
import {csvEscape,formatMoney} from './core.mjs';
const $=id=>document.getElementById(id);
const E=(tag,cls='',t)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(t!==undefined)x.textContent=String(t);return x};
function add(p,...children){children.forEach(c=>c&&p.append(c));return p}
let client=null,user=null,saved=[],obligations=[];
const crit=[
 ['text','產品類別及文本相符',25],
 ['credentials','法定資格與實績已核實',25],
 ['scope','履約地點與承作規模',15],
 ['schedule','準備時間與交件條件',15],
 ['competition','具有可比的歷史競爭證據',10],
 ['margin','有證據支持的公司毛利／商業考量',10]
];
const guidance=[
 ['招標、決標及更正公告','一案可能公告多次。先核對機關、案號、公告類型及最新截止時間；網站列出的是來源實際可取得的公告，不能把所有招標都稱尚可投。','https://web.pcc.gov.tw/'],
 ['投標資格及投標文件','依原公告與招標文件核對營業項目、資格證明、實績、保險、服務建議書、截止收件時間。文件未揭露的條件必須標示未知。','https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030065'],
 ['押標金和履約保證金','押標金通常是投標階段擔保，履約保證金與得標後履約相關；法律有例外。金額、繳納及返還方式仍應逐案核對文件與法規。','https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030079'],
 ['最低標與最有利標','決標可能依價格或綜合評選程序，應看公告中的決標方式與評選文件；不要把「決標金額／預算」當成任一案件的建議報價。','https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030057'],
 ['電子投標和領標','官方電子投標、領標及繳費依政府電子採購網與個別採購案規定；本站只提供資訊與內部工作流程，不代送標或代繳款項。','https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030105'],
 ['共同供應契約','屬於特定政府採購機制，履約方式、適用機關、訂購流程與契約期限須查公告及官方制度，不應將一般招標推定為共同供應契約。','https://web.pcc.gov.tw/']
];
function errText(e){return String(e?.message||e||'未知錯誤').slice(0,240);}
function msg(id,t){$(id).textContent=t;}
function loginHint(id){msg(id,'請先使用上方「登入／跨裝置同步」，才能使用此私人資料功能。');}
function localDate(d){return d?String(d).slice(0,10):'未設定';}
function setOptions(id,includeEmpty){
 const sel=$(id),old=sel.value;sel.replaceChildren();
 const z=E('option','',includeEmpty?'不關聯案件':'請選擇收藏的真實案件');z.value='';sel.append(z);
 for(const it of saved){const opt=E('option','',it.title+'｜'+it.case_id.split('::').slice(1).join('::'));opt.value=it.case_id;sel.append(opt);}
 if(saved.some(x=>x.case_id===old))sel.value=old;
}
async function refreshSaved(){
 if(!user){saved=[];setOptions('decisionCase',false);setOptions('contractCase',true);return;}
 try{
  const {data,error}=await client.from('ti_saved_cases').select('case_id,title').eq('user_id',user.id).order('added_at',{ascending:false}).limit(500);
  if(error)throw error;
  saved=data||[];setOptions('decisionCase',false);setOptions('contractCase',true);
 }catch(e){msg('decisionOutput','讀取收藏案件失敗：'+errText(e));}
}
function drawCriteria(){
 const area=$('decisionCriteria');area.replaceChildren();
 for(const [key,label,weight] of crit){
  const container=E('div','panel');container.style.padding='12px';
  const row=E('div','inline-form');
  const labelNode=E('strong','',label+'（權重 '+weight+'）');
  const select=E('select');select.id='crit_'+key;
  for(const [v,name]of [['','尚未核對'],['yes','有證據符合'],['no','有證據不符'],['unknown','文件尚不清楚']]){
   const opt=E('option','',name);opt.value=v;select.append(opt);
  }
  const evidence=E('input');evidence.id='ev_'+key;evidence.maxLength=350;
  evidence.placeholder='原文頁碼／公司文件／具體可核對的事實';
  select.addEventListener('change',evaluate);
  evidence.addEventListener('change',evaluate);
  add(row,labelNode,select);
  add(container,row,evidence);area.append(container);
 }
}
function criteria(){
 const obj={};
 for(const [key] of crit)obj[key]={value:$('crit_'+key).value,evidence:$('ev_'+key).value.trim()};
 return obj;
}
function evaluate(){
 const data=criteria();let verified=0,yes=0,unknown=[];
 const missing=[];
 for(const [key,name,weight]of crit){
  const x=data[key];
  if(x.value==='yes'||x.value==='no'){
    if(!x.evidence)missing.push(name);
    else{verified+=weight;if(x.value==='yes')yes+=weight;}
  }else unknown.push(name);
 }
 const out=$('decisionOutput');out.replaceChildren();
 add(out,E('h2','','證據覆蓋率 '+verified+'／100 權重'),
     E('p','','已核對條件中的符合權重：'+yes+'／'+verified+'；未核對 '+(100-verified)+' 權重。這不是得標率，也不是在所有權重均有資料前的完整適配分數。'));
 if(unknown.length)add(out,E('p','minor','仍須人工確認：'+unknown.join('、')));
 if(missing.length)add(out,E('p','notice warning','已標示符合／不符但缺乏具體依據：'+missing.join('、')));
 if(crit.some(([key])=>data[key].value==='no'))add(out,E('p','notice warning','已有一或多項不符；請先核對是否為法定硬性門檻，不能僅以加權分數掩蓋。'));
 return missing.length===0;
}
async function loadDecision(){
 if(!user)return loginHint('decisionOutput');
 const id=$('decisionCase').value;
 if(!id){msg('decisionOutput','請選擇已收藏的真實標案。');return;}
 try{
  const {data,error}=await client.from('ti_bid_decisions').select('decision,criteria,evidence_notes')
    .eq('user_id',user.id).eq('case_id',id).maybeSingle();
  if(error)throw error;
  $('decisionChoice').value=data?.decision||'評估中';
  $('decisionNotes').value=data?.evidence_notes||'';
  for(const [key] of crit){
   const c=data?.criteria?.[key]||{};
   $('crit_'+key).value=['','yes','no','unknown'].includes(c.value)?c.value:'';
   $('ev_'+key).value=c.evidence||'';
  }
  evaluate();
 }catch(e){msg('decisionOutput','讀取決策紀錄失敗：'+errText(e));}
}
async function saveDecision(e){
 e.preventDefault();if(!user)return loginHint('decisionOutput');
 if(!evaluate()){msg('decisionOutput','已勾選符合或不符的欄位必須附上可核對依據，否則不會保存為已驗證。');return;}
 const caseId=$('decisionCase').value;
 if(!saved.some(x=>x.case_id===caseId))return msg('decisionOutput','請選擇你已收藏的真實案件。');
 const b=$('decisionSave');b.disabled=true;
 try{
  const {error}=await client.from('ti_bid_decisions').upsert({
   user_id:user.id,case_id:caseId,decision:$('decisionChoice').value,
   criteria:criteria(),evidence_notes:$('decisionNotes').value.trim(),
   updated_at:new Date().toISOString()
  },{onConflict:'user_id,case_id'});
  if(error)throw error;
  evaluate();$('decisionOutput').append(E('p','minor','已保存至本人 Supabase 帳戶，不會公開。'));
 }catch(e){msg('decisionOutput','保存失敗：'+errText(e));}
 finally{b.disabled=false;}
}
async function loadContracts(){
 const out=$('contractItems'),alerts=$('contractAlerts');
 if(!user){out.replaceChildren(E('div','empty','登入後才能查看私人合約與保證金資料。'));alerts.replaceChildren();return;}
 try{
  const [records,warnings]=await Promise.all([
   client.from('ti_contract_obligations').select('*').eq('user_id',user.id).order('due_date',{ascending:true}).limit(300),
   client.from('ti_contract_alerts').select('*').eq('user_id',user.id).is('read_at',null).order('created_at',{ascending:false}).limit(50)
  ]);
  if(records.error)throw records.error;if(warnings.error)throw warnings.error;
  obligations=records.data||[];
  out.replaceChildren(E('h2','','我的履約／保證金台帳（'+obligations.length+' 筆）'));
  if(!obligations.length)out.append(E('div','empty','目前沒有自行建立的合約紀錄。'));
  for(const r of obligations){
   const box=E('article','watch-item'),header=E('header','');
   add(header,E('strong','',r.subject),E('span','case-tag',r.obligation_type));box.append(header);
   add(box,E('p','minor','你設定的到期日：'+localDate(r.due_date)+'｜金額：'+
    (r.amount===null?'尚未填寫':formatMoney(r.amount))+'｜'+(r.notes||'無備註')));
   const row=E('div','inline-form'),select=E('select');
   for(const type of ['待處理','已完成','已返還','已取消']){
    const option=E('option','',type);option.value=type;select.append(option);
   }
   select.value=r.status;
   select.addEventListener('change',async()=>{
    const {error}=await client.from('ti_contract_obligations').update({status:select.value,updated_at:new Date().toISOString()})
      .eq('id',r.id).eq('user_id',user.id);
    if(error)msg('contractStatus','更新失敗：'+errText(error));
    else{msg('contractStatus','狀態已保存。');void loadContracts();}
   });
   const del=E('button','ghost-btn','刪除');
   del.type='button';del.addEventListener('click',async()=>{
    if(!confirm('刪除這筆你自行建立的履約紀錄？'))return;
    const {error}=await client.from('ti_contract_obligations').delete()
      .eq('id',r.id).eq('user_id',user.id);
    if(error)msg('contractStatus','刪除失敗：'+errText(error));
    else void loadContracts();
   });
   add(row,select,del);box.append(row);out.append(box);
  }
  alerts.replaceChildren();
  if(warnings.data?.length)add(alerts,E('h2','','尚未讀取的到期提醒'));
  for(const warning of warnings.data||[]){
   const item=obligations.find(x=>x.id===warning.obligation_id);
   const box=E('div','watch-item');
   add(box,E('strong','','提前 '+warning.reminder_days+' 天提醒：'+(item?.subject||'已刪除的項目')),
     E('p','','到期日 '+localDate(warning.due_date)));
   const button=E('button','ghost-btn','標示已讀');button.type='button';
   button.addEventListener('click',async()=>{
    const {error}=await client.from('ti_contract_alerts').update({read_at:new Date().toISOString()})
     .eq('id',warning.id).eq('user_id',user.id);
    if(error)msg('contractStatus','更新提醒失敗：'+errText(error));else void loadContracts();
   });
   add(box,button);alerts.append(box);
  }
  msg('contractStatus','私人台帳已從 Supabase 讀取；T-7／T-3／T-1 使用「你自行設定」的日期，不代表官方確認的返還日期。');
 }catch(e){msg('contractStatus','台帳讀取失敗：'+errText(e));}
}
async function saveContract(e){
 e.preventDefault();if(!user)return loginHint('contractStatus');
 const amount=$('contractAmount').value;
 const rec={
  user_id:user.id,case_id:$('contractCase').value||null,
  subject:$('contractSubject').value.trim(),obligation_type:$('contractType').value,
  amount:amount===''?null:Number(amount),due_date:$('contractDue').value,
  notes:$('contractNotes').value.trim()
 };
 if(rec.subject.length<2||!rec.due_date||rec.amount!==null&&(!Number.isFinite(rec.amount)||rec.amount<0))
  return msg('contractStatus','請填入有效的名稱、日期及非負數金額（或留空）。');
 try{
  const {error}=await client.from('ti_contract_obligations').insert(rec);
  if(error)throw error;
  $('contractForm').reset();
  await loadContracts();
  msg('contractStatus','已儲存為你自行設定的履約紀錄；不代表已向政府機關繳款。');
 }catch(e){msg('contractStatus','建立失敗：'+errText(e));}
}
function exportContracts(){
 if(!user||!obligations.length)return msg('contractStatus','目前沒有可匯出的登入帳戶私人紀錄。');
 const keys=['項目名稱','類別','金額','到期日','狀態','備註','關聯案件'];
 const rows=obligations.map(r=>[r.subject,r.obligation_type,r.amount??'',r.due_date,r.status,r.notes,r.case_id]);
 const csv=[keys,...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n');
 const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=E('a');a.href=url;a.download='政府標案履約台帳.csv';a.click();URL.revokeObjectURL(url);
}
async function loadVendorSelf(){
 if(!user)return msg('vendorSelfStatus','請登入後建立並管理自己的公司資料。');
 try{
  const {data,error}=await client.from('ti_vendor_profiles').select('*').eq('user_id',user.id).maybeSingle();
  if(error)throw error;
  $('vendorSelfName').value=data?.company_name||'';
  $('vendorSelfTax').value=data?.company_tax_id||'';
  $('vendorSelfServices').value=data?.services||'';
  $('vendorSelfAreas').value=data?.service_areas||'';
  $('vendorSelfWeb').value=data?.website_url||'';
  $('vendorSelfEmail').value=data?.contact_email||'';
  $('vendorSelfPublish').checked=!!data?.published;
  msg('vendorSelfStatus',data?(data.published?'你的資料目前公開刊登（未經平台驗證）。':'已保存草稿，未公開刊登。'):'尚未建立自行刊登資料。');
 }catch(e){msg('vendorSelfStatus','讀取公司檔案失敗：'+errText(e));}
}
async function saveVendor(e){
 e.preventDefault();if(!user)return msg('vendorSelfStatus','請先登入。');
 const web=$('vendorSelfWeb').value.trim(),email=$('vendorSelfEmail').value.trim(),tax=$('vendorSelfTax').value.trim();
 if(web&&!/^https:\/\/[a-z0-9.-]+(?:\/[^\s]*)?$/i.test(web))
  return msg('vendorSelfStatus','網站須使用 HTTPS；不接受不安全的連結。');
 if(tax&&!/^\d{8}$/.test(tax))return msg('vendorSelfStatus','統一編號必須是 8 位數，或留白。');
 const data={
  user_id:user.id,company_name:$('vendorSelfName').value.trim(),
  company_tax_id:tax||null,services:$('vendorSelfServices').value.trim(),
  service_areas:$('vendorSelfAreas').value.trim(),
  website_url:web||null,contact_email:email||null,
  published:$('vendorSelfPublish').checked,disclosure_source:'vendor_self_submitted',
  updated_at:new Date().toISOString()
 };
 try{
  const {error}=await client.from('ti_vendor_profiles').upsert(data,{onConflict:'user_id'});
  if(error)throw error;await loadVendorSelf();await loadDirectory();
 }catch(e){msg('vendorSelfStatus','公司資料保存失敗：'+errText(e));}
}
async function deleteVendor(){
 if(!user)return;
 if(!confirm('確定刪除你自行刊登的公司檔案（包含公開展示）？'))return;
 try{
  const {error}=await client.from('ti_vendor_profiles').delete().eq('user_id',user.id);
  if(error)throw error;
  $('vendorSelfForm').reset();msg('vendorSelfStatus','公司檔案已從資料庫刪除。');await loadDirectory();
 }catch(e){msg('vendorSelfStatus','刪除失敗：'+errText(e));}
}
async function loadDirectory(){
 const box=$('directoryList');box.replaceChildren(E('div','empty','正在查詢真正由廠商自行公開的名錄…'));
 try{
  const c=client||await getClient();
  let q=c.from('ti_vendor_profiles')
   .select('company_name,company_tax_id,services,service_areas,website_url,contact_email,updated_at')
   .eq('published',true).order('updated_at',{ascending:false}).limit(40);
  const value=$('directoryKeyword').value.trim();
  if(value)q=q.ilike('company_name','%'+value.replace(/[%_]/g,'\\$&')+'%');
  const {data,error}=await q;
  if(error)throw error;
  box.replaceChildren();
  if(!data?.length){box.append(E('div','empty','目前沒有符合條件、且自行同意公開的供應商檔案。'));return;}
  for(const r of data){
   const card=E('article','case-card');
   const left=E('div','case-left');
   add(left,E('h3','',r.company_name),E('p','minor','廠商自行提供，未經政府或本平台驗證｜統編：'+(r.company_tax_id||'未提供')),
     E('p','',r.services||'未提供服務說明'),E('p','minor','服務地區：'+(r.service_areas||'未提供')));
   if(r.contact_email){
    const a=E('a','','寄信給廠商');a.href='mailto:'+encodeURIComponent(r.contact_email);left.append(a);
   }
   const right=E('div','case-right');
   if(r.website_url&&r.website_url.startsWith('https://')){
    const a=E('a','','官方網站');a.href=r.website_url;a.target='_blank';a.rel='noopener noreferrer';right.append(a);
   }
   card.append(left,right);box.append(card);
  }
 }catch(e){box.replaceChildren(E('div','empty','供應商名錄讀取失敗：'+errText(e)));}
}
function buildGuide(){
 const box=$('guideContent');box.replaceChildren(E('h2','','新手從找案到投標的核對流程'));
 for(const [title,explanation,source]of guidance){
  const article=E('section','');
  add(article,E('h3','',title),E('p','',explanation));
  const a=E('a','','查看政府官方入口／最新法規');a.href=source;a.target='_blank';a.rel='noopener noreferrer';article.append(a);
  box.append(article);
 }
 add(box,E('p','minor','資料來源：政府電子採購網、全國法規資料庫。整理日期：2026-11-03；法規及公告以官方最新公布與個別採購文件為準。'));
}
async function setUser(next){
 const before=user?.id;user=next;
 if(before!==user?.id){
  await refreshSaved();
  await Promise.all([loadContracts(),loadVendorSelf()]);
 }
}
async function init(){
 drawCriteria();buildGuide();evaluate();
 $('decisionForm').addEventListener('submit',e=>void saveDecision(e));
 $('decisionCase').addEventListener('change',()=>void loadDecision());
 $('decisionEvaluate').addEventListener('click',evaluate);
 $('contractForm').addEventListener('submit',e=>void saveContract(e));
 $('contractExport').addEventListener('click',exportContracts);
 $('vendorSelfForm').addEventListener('submit',e=>void saveVendor(e));
 $('vendorSelfDelete').addEventListener('click',()=>void deleteVendor());
 $('directorySearchForm').addEventListener('submit',e=>{e.preventDefault();void loadDirectory();});
 for(const name of ['decisions','contracts','directory']){
  document.querySelector('[data-view="'+name+'"]')?.addEventListener('click',()=>{
   if(name==='directory')void loadDirectory();
   if(name==='decisions')void refreshSaved().then(loadDecision);
   if(name==='contracts')void refreshSaved().then(loadContracts);
  });
 }
 client=await getClient();
 const {data,error}=await client.auth.getSession();if(error)throw error;
 await setUser(data?.session?.user||null);
 client.auth.onAuthStateChange((_event,session)=>{
   // Defer DB queries; auth callbacks must not block token handling.
   setTimeout(()=>void setUser(session?.user||null),0);
 });
}
init().catch(e=>{msg('contractStatus','帳戶模組初始化失敗：'+errText(e));msg('vendorSelfStatus','登入／名錄模組無法載入：'+errText(e));});
