// W06: source-grounded editable proposal skeleton; never an eligibility claim.
const flat=(value,n=400)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const safe=(value,n=400)=>flat(value,n).replace(/([\\*_{}\[\]<>#!|])/g,'\\$1');
const known=value=>flat(value)?safe(value):'待官方原文確認';
const amount=value=>value!==null&&value!==undefined&&value!==''&&
 Number.isFinite(Number(value))?'NT$'+Number(value).toLocaleString('zh-TW'):'待官方原文確認';
function time(value){
 if(!value)return '待官方原文確認';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?'待官方原文確認':
 new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',
 month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
export function buildProposalDraft({caseInfo,company={},assets=[],documents=[],decision=null}={}){
 if(!caseInfo?.id||!caseInfo?.title)throw Error('缺少真正的官方案件識別或案名，無法建立草稿');
 const refs=[],rows=[],seen=new Set();let scanned=0;
 for(const doc of Array.isArray(documents)?documents.slice(0,30):[]){
  for(const page of Array.isArray(doc?.extracted?.pages)?doc.extracted.pages:[]){
   if(++scanned>350||refs.length>=18)break;
   const contents=String(page.text||'');
   for(const paragraph of contents.split(/[\n。；]+/).map(x=>x.trim())){
    if(paragraph.length<6||!/資格|證照|實績|評選|配分|履約|規格|驗收|截止|保證金|服務|投標|交付|人員|保固/.test(paragraph))continue;
    const quote=paragraph.slice(0,280),id=String(doc.id)+'/'+String(page.source)+'/'+quote;
    if(seen.has(id))continue;seen.add(id);
    const ref={document_id:String(doc.id||''),filename:flat(doc.filename,180),
      source:flat(page.source,100)||'文件段落',excerpt:quote};
    refs.push(ref);rows.push(ref);
    if(refs.length>=18)break;
   }
  }
 }
 const lines=['# '+safe(caseInfo.title,170)+'｜服務建議書初稿（未審核）','',
  '> 本文件是可編輯的原文參考草稿，並非 AI 審核結果、投標資格認定或正式送件。','',
  '## 一、政府採購案件資料',
  '- 案名：'+known(caseInfo.title),'- 機關：'+known(caseInfo.agency),
  '- 案號：'+known(caseInfo.job_number),'- 案件識別：'+known(caseInfo.id),
  '- 最新公告類型：'+known(caseInfo.latest_notice_type),
  '- 已公開預算：'+amount(caseInfo.budget_amount),'- 取得的官方截標時間：'+time(caseInfo.deadline_at),
  '- 官方公告：'+(typeof caseInfo.official_url==='string'&&
    /^https:\/\/web\.pcc\.gov\.tw\//.test(caseInfo.official_url)?caseInfo.official_url:'【待查核官方來源】'),
  '',
  '## 二、投標公司介紹（資料由本人填寫，未經核驗）',
  '- 公司：'+(company.company_name?safe(company.company_name,200):'【待填】'),
  '- 服務：'+(company.services?safe(company.services,700):'【待填】'),'',
  company.company_intro?flat(company.company_intro,2200):'【待填：可提供證據的公司能力與資源】','',
  '## 三、真實招標文件引用與逐項回應',''];
 if(!rows.length)lines.push('【尚無可引用的招標文件原文】請先上傳本案標書並建立文字索引，否則不可認為需求已確認。','');
 for(const [i,r]of rows.entries()){
  lines.push('### 引用條款 '+(i+1)+'（待核對）',
   '- 來源：'+safe(r.filename,180)+'／'+safe(r.source,100),
   '- 擷取原文：', '> '+r.excerpt.replace(/\n/g,' ').slice(0,280),
   '- 我方回應：【待填：可證明的交付方法、負責人、附件及驗收條件】','');
 }
 if(rows.length>=18)lines.push('> 僅摘錄最多 18 段，未顯示的文件內容仍需逐頁人工審閱。','');
 lines.push('## 四、服務計畫（由人工依招標書補寫）','',
  '### 4.1 需求回應','【待填：逐條核對規格要求及對應方案】','',
  '### 4.2 專案組織與工作分工','【待填：真實人員、職務與資格】','',
  '### 4.3 工作時程與里程碑','【待填：按照已核對原文填入交付與驗收時間】','',
  '### 4.4 品質與風險','【待填：品質管控、安全、法遵與應變措施】','',
  '### 4.5 價格與商務條件','【待填：實際報價、稅額、押標金、履約保證金及付款方式】','',
  '## 五、公司已登錄的證照與實績（須核對真本）','');
 const items=Array.isArray(assets)?assets.slice(0,35):[];
 if(!items.length)lines.push('【尚無已登錄的公司證照或履約實績】','');
 for(const asset of items){
  lines.push('- '+known(asset.title)+
   '；發證者／客戶：'+known(asset.issuer)+
   '；文件編號：'+known(asset.reference_number)+
   '；有效至：'+(asset.expires_on?safe(asset.expires_on):'待確認')+
   (asset.id?'；私人資料識別：'+safe(asset.id):'')+
   '。（是否符合該案資格仍須人工核對）');
 }
 lines.push('','## 六、附件及送件前檢查','',
  '- [ ] 確認本案最新公告、更正內容與截止時間',
  '- [ ] 核對所有 PDF 頁面、OCR 未辨識頁及附表',
  '- [ ] 核對公司實際證照、實績、許可與資格',
  '- [ ] 依官方評選配分調整方案、服務書與附件',
  '- [ ] 確認真實報價、押標金、份數、格式與投標方式',
  '- [ ] 公司有權人員完成人工審核後自行向官方提交','');
 if(decision?.decision)lines.push('- 目前內部投標決策：'+safe(decision.decision),
  '  - 理由：'+(decision.evidence_notes?safe(decision.evidence_notes,1500):'尚未填寫'),'');
 lines.push('> 本文件不證明符合投標資格，也不預測得標率或自動進行送件。');
 return {title:(company.company_name?safe(company.company_name,80)+'｜':'')+
   flat(caseInfo.title,140)+'｜服務建議書',
  content:lines.join('\n').slice(0,98000),sourceRefs:refs,
  sourceCount:refs.length,documentCount:Array.isArray(documents)?documents.length:0,
  mode:'evidence_template'};
}
