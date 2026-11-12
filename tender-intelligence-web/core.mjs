// Pure procurement data adapters and business rules.
// No server credentials, fake sample tenders, or assumptions about missing fields.
export const API_ROOT = 'https://pcc-api.openfun.app/api';
export const asText = value => value === null || value === undefined ? '' : String(value);
export const keyOf = row => asText(row.unit_id) + '::' + asText(row.job_number);
export const safeNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(asText(value).replace(/[,元NT$新臺幣\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const formatMoney = value => {
  const n = safeNumber(value);
  return n === null ? '未公開' : 'NT$ ' + Math.round(n).toLocaleString('zh-TW');
};
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = asText(value).trim();
  const m = s.match(/^(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  let y, mo, d, h=0, mi=0;
  if (m) {
    y=Number(m[1]);mo=Number(m[2]);d=Number(m[3]);h=Number(m[4]||0);mi=Number(m[5]||0);
  } else if (/^\d{8}$/.test(s)) {
    y=Number(s.slice(0,4));mo=Number(s.slice(4,6));d=Number(s.slice(6,8));
  } else return null;
  if (y < 1911) y += 1911;
  if (mo<1 || mo>12 || d<1 || d>31 || h>23 || mi>59) return null;
  const iso = String(y).padStart(4,'0')+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0')+'T'+String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0')+':00+08:00';
  const date = new Date(iso);
  const utc = new Date(Date.UTC(y,mo-1,d));
  if (!Number.isFinite(date.getTime()) || utc.getUTCFullYear()!==y || utc.getUTCMonth()!==mo-1 || utc.getUTCDate()!==d) return null;
  return date;
}
export const dateLabel = value => {
  const d = parseDate(value);
  return d ? new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:asText(value).includes(':')?'2-digit':undefined,minute:asText(value).includes(':')?'2-digit':undefined,hour12:false}).format(d) : '未公開';
};
export const typeOf = row => asText(row?.brief?.type || row?.detail?.type || '');
export const titleOf = row => asText(row?.brief?.title || row?.detail?.['採購資料:標案名稱'] || '未命名標案');
export const categoryOf = row => asText(row?.brief?.category || '');
export function groupOf(row) {
  const s = categoryOf(row);
  if (s.startsWith('工程')) return '工程';
  if (s.startsWith('財物')) return '財物';
  if (s.startsWith('勞務')) return '勞務';
  return '未分類';
}
export function stateOf(row) {
  const s=typeOf(row);
  if (/無法決標|流標|廢標/.test(s)) return '無法決標';
  // Amending an award does not reopen bidding.
  if (/更正決標/.test(s)) return '決標';
  // Corrected reference requests/previews are not solicitations.
  if (/公開閱覽/.test(s)) return '公開閱覽';
  if (/公開徵求廠商提供參考資料/.test(s)) return '公開徵求';
  if (/更正/.test(s)) return '更正';
  if (/決標/.test(s)) return '決標';
  if (/財物變賣|財物出租|標售|標租/.test(s)) return '財物標售';
  if (/公開閱覽/.test(s)) return '公開閱覽';
  if (/公開徵求廠商提供參考資料/.test(s)) return '公開徵求';
  if (/招標|取得報價單|取得企劃書/.test(s)) return '招標';
  if (/徵求/.test(s)) return '公開徵求';
  return '其他';
}
// A case state and a notice event are different questions. Never call an
// auction open merely because a notice contains the word "招標".
export function deadlineDate(value){
  if(value instanceof Date)return Number.isNaN(value.getTime())?null:value;
  const raw=asText(value).trim();
  if(!raw)return null;
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)){
    const date=new Date(raw);
    return Number.isNaN(date.getTime())?null:date;
  }
  return parseDate(raw);
}
export function opportunityOf(row,now=Date.now()){
  const status=asText(row?.status)||stateOf(row);
  const raw=row?.deadline_at??row?.deadlineRaw??fieldsOf(row?.detail).deadline;
  const deadline=deadlineDate(raw);
  if(status==='無法決標')return {label:'無法決標',kind:'failed',deadline,canConfirmOpen:false};
  if(status==='決標')return {label:'已決標',kind:'awarded',deadline,canConfirmOpen:false};
  if(status==='招標'||status==='更正'){
    if(!deadline)return {label:'截止日待確認',kind:'unknown',deadline:null,canConfirmOpen:false};
    if(deadline.getTime()<=now)return {label:'已過公告截止時間',kind:'closed',deadline,canConfirmOpen:false};
    // A correction may have changed the terms or deadline; always show the
    // recorded timestamp but require official revalidation before bidding.
    if(status==='更正')return {label:'更正公告・期限待核',kind:'amended',deadline,canConfirmOpen:false};
    return {label:'公告截止日未到',kind:'open',deadline,canConfirmOpen:true};
  }
  return {label:status==='其他'?'案件狀態待查':status,kind:'other',deadline,canConfirmOpen:false};
}
export function deadlineLabel(value){
  const d=deadlineDate(value);
  return d?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'截止日待確認';
}

// A government notice link is reconstructed only from source-supplied date/file
// identifiers using the published PCC redirect format. Never guess a case ID.
export function officialNoticeUrl(row) {
  const direct=safeOfficial(row?.detail?.url||row?.official_url);
  if(direct)return direct;
  const date=asText(row?.date??row?.source_date??row?.latest_notice_date);
  const file=asText(row?.filename??row?.latest_filename);
  if(!/^[0-9]{8}$/.test(date)||!(/^[A-Z]{2,4}-[0-9]{1,2}-[0-9]{5,12}$/).test(file))return '';
  return 'https://web.pcc.gov.tw/prkms/tender/common/noticeDate/redirectPublic?ds='+
    date+'&fn='+encodeURIComponent(file+'.xml');
}
export function normalize(row) {
  if (!row || !row.unit_id || !row.job_number) return null;
  return {
    ...row, id:keyOf(row), title:titleOf(row), agency:asText(row.unit_name),
    noticeType:typeOf(row), category:categoryOf(row), group:groupOf(row),
    status:stateOf(row), budget:safeNumber(row.budget_amount),
    award:safeNumber(row.award_amount), posted:parseDate(row.date)
  };
}
// Keep the exact public API announcement, but fill missing amounts only from
// the same institution/case ID in the independently ingested source records.
export function mergeCaseAmounts(rows,amounts){
  return (rows||[]).map(row=>{
    const extra=amounts?.get(keyOf(row));
    if(!extra)return row;
    return {...row,
      budget_amount:safeNumber(row.budget_amount)??safeNumber(extra.budget_amount),
      award_amount:safeNumber(row.award_amount)??safeNumber(extra.award_amount)};
  });
}
export function dedupe(rows) {
  const seen=new Map();
  for(const raw of rows||[]) {
    const row=normalize(raw);
    if(!row)continue;
    const prev=seen.get(row.id);
    if(!prev || Number(row.date||0)>Number(prev.date||0) || (row.date===prev.date && asText(row.filename)>asText(prev.filename)))seen.set(row.id,row);
  }
  return [...seen.values()];
}
export function filtered(rows, options={}) {
  const min = safeNumber(options.minBudget);
  const search=asText(options.localText).trim().toLocaleLowerCase('zh-TW');
  const output=(rows||[]).filter(row=>{
    if(options.group && options.group !== '全部' && row.group !== options.group) return false;
    if(options.status && options.status !== '全部' && row.status !== options.status) return false;
    if(min !== null && (row.budget === null || row.budget<min)) return false;
    if(search && !(row.title+' '+row.agency+' '+row.category+' '+row.job_number).toLocaleLowerCase('zh-TW').includes(search))return false;
    return true;
  });
  const sort=options.sort||'date';
  return output.sort((a,b)=>sort==='budget'?(b.budget??-1)-(a.budget??-1):sort==='title'?a.title.localeCompare(b.title,'zh-TW'):Number(b.date||0)-Number(a.date||0));
}
export function fieldsOf(detail) {
  const obj=detail&&typeof detail==='object'?detail:{};
  const end = suffix => {
    const match=Object.keys(obj).find(k=>k===suffix || k.endsWith(':'+suffix));
    return match===undefined ? null : obj[match];
  };
  return {
    url: /^https:\/\/web\.pcc\.gov\.tw\//i.test(asText(obj.url)) ? obj.url : '',
    deadline: end('截止投標'), opening: end('開標時間'),
    budget: end('預算金額'), award: end('總決標金額'),
    location: end('履約地點'), period: end('履約期限'),
    contact: end('聯絡人'), phone: end('聯絡電話'),
    tenderMethod:end('招標方式'), decisionMethod:end('決標方式'),
    deposit: end('押標金額度'), qualification:end('廠商應附具之基本資格證明文件或物品')
  };
}
export function summaryOf(records) {
  const notices=[...(records||[])].sort((a,b)=>Number(b.date||0)-Number(a.date||0)||asText(b.filename).localeCompare(asText(a.filename),'zh-TW'));
  const latest=notices[0]||null;
  // Deadline is a bid announcement property, not a decision notice property.
  const tenderNotice=notices.find(r=> /招標|徵求|閱覽/.test(typeOf(r)))||null;
  const close=fieldsOf(tenderNotice?.detail).deadline;
  const stat=stateOf(latest);
  const deadline=parseDate(close);
  const isOpen=stat==='招標' || (stat==='更正' && /招標/.test(typeOf(latest)));
  return {latest,tenderNotice,notices,deadline,deadlineRaw:close,hasDeadline:!!deadline,
    isOpen:isOpen && !!deadline && deadline.getTime()>Date.now(),
    completed:stat==='決標',status:stat,fields:fieldsOf(tenderNotice?.detail),
    latestFields:fieldsOf(latest?.detail)};
}
export function amountRatio(row) {
  const a=safeNumber(row.award_amount ?? row.award);
  const b=safeNumber(row.budget_amount ?? row.budget);
  if(a===null||b===null||b<=0)return null;
  return a/b;
}
export function ratioStats(rows) {
  const vals=(rows||[]).map(amountRatio).filter(x=>x!==null&&Number.isFinite(x)).sort((a,b)=>a-b);
  if(!vals.length)return {count:0,median:null,q1:null,q3:null};
  const q = p => {const i=(vals.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return vals[lo]+(vals[hi]-vals[lo])*(i-lo);};
  return {count:vals.length,median:q(.5),q1:q(.25),q3:q(.75)};
}
export function scoreCase(row, profile={}) {
  const include=asText(profile.keywords).split(/[,，、\n]+/).map(x=>x.trim()).filter(Boolean);
  const exclude=asText(profile.excludes).split(/[,，、\n]+/).map(x=>x.trim()).filter(Boolean);
  const combined=(row.title+' '+row.category).toLocaleLowerCase('zh-TW');
  const hits=include.filter(k=>combined.includes(k.toLocaleLowerCase('zh-TW')));
  const blocks=exclude.filter(k=>combined.includes(k.toLocaleLowerCase('zh-TW')));
  const reasons=[],warnings=[];
  if(blocks.length)warnings.push('命中排除詞：'+blocks.join('、'));
  if(!include.length)warnings.push('尚未設定業務關鍵字');
  else if(hits.length)reasons.push('命中業務關鍵字：'+hits.join('、'));
  else warnings.push('未命中業務關鍵字');
  const min=safeNumber(profile.min),max=safeNumber(profile.max);
  let budgetExcluded=false;
  if(min!==null||max!==null) {
    if(row.budget===null) warnings.push('未公開預算，無法驗證金額門檻');
    else if((min!==null&&row.budget<min)||(max!==null&&row.budget>max)) {warnings.push('預算超出設定範圍');budgetExcluded=true;}
    else reasons.push('預算在設定範圍內');
  }
  const area=asText(profile.area).trim();
  if(area)warnings.push('尚無完整履約地欄位；不以機關地址冒充履約地：'+area);
  // An interpretable *match count*, deliberately not an invented win probability.
  return {matched:hits.length,reasons,warnings,excluded:blocks.length>0,qualifies:!blocks.length&&!budgetExcluded&&hits.length>0};
}
// User-facing notice timeline: change detection is limited to fields present
// in BOTH official source records, not invented missing-field differences.
export function noticeChangeSummary(current,previous){
 const sameDay=asText(current?.date)===asText(previous?.date);
 const changes=[];
 for(const [name,read] of [
   ['公告類型',typeOf],['案名',r=>asText(r?.brief?.title||r?.detail?.['採購資料:標案名稱'])],['採購類別',categoryOf],
   ['公開預算',r=>safeNumber(r?.budget_amount)]
 ]){
   const a=read(current),b=read(previous);
   if(a!==''&&a!==null&&a!==undefined&&b!==''&&b!==null&&b!==undefined&&a!==b)
     changes.push({field:name,from:asText(b),to:asText(a)});
 }
 const before=fieldsOf(previous?.detail),after=fieldsOf(current?.detail);
 for(const [name,key] of [['截止投標','deadline'],['招標方式','tenderMethod'],['履約地點','location']]){
   if(before[key]&&after[key]&&before[key]!==after[key])
     changes.push({field:name,from:asText(before[key]),to:asText(after[key])});
 }
 return {changes,sameDay,orderVerified:!sameDay,hasComparable:changes.length>0};
}
// Similarity yields a *lead*, never a legal assertion that a new case is
// an official re-tender. Different agency IDs do not qualify automatically.
export function possibleRelatedCase(reference,candidate){
 if(!reference?.unit_id||reference.unit_id!==candidate?.unit_id ||
    !reference.job_number||reference.job_number===candidate.job_number)return null;
 const compact=s=>asText(s).toLocaleLowerCase('zh-TW')
   .replace(/(?:民國)?(?:1[01-9]\d|20\d\d)(?:\s*[-–～~至]\s*(?:1[01-9]\d|20\d\d))?年度?/g,'')
   .replace(/[\s\p{P}\p{S}]/gu,'');
 const a=compact(reference.title||titleOf(reference)),b=compact(candidate.title||titleOf(candidate));
 if(a.length<5||b.length<5)return null;
 const common=a===b?1:(()=>{
   const grams=s=>new Set([...s].slice(0,-1).map((x,i)=>x+[...s][i+1]));
   const x=grams(a),y=grams(b),hits=[...x].filter(z=>y.has(z)).length;
   return (2*hits)/(x.size+y.size||1);
 })();
 return common>=.78?{score:Math.round(common*100),reason:'同機關、不同案號，案名高度相似；是否重招須以官方公告核對'}:null;
}
// Explainable supplier-side evidence. Unknown qualification documents and
// missing dates are never silently converted into a positive eligibility call.
export function assessCompanyFit(row,company={},profile={},assets=[]){
 const info=opportunityOf(row),reasons=[],unknowns=[];
 const services=asText(company.services).split(/[，,、;；\n]+/).map(x=>x.trim()).filter(x=>x.length>=2);
 const hay=(asText(row.title)+' '+asText(row.category)).toLocaleLowerCase('zh-TW');
 const hits=services.filter(x=>hay.includes(x.toLocaleLowerCase('zh-TW'))).slice(0,8);
 if(hits.length)reasons.push('公司登錄服務與案名／採購分類命中：'+hits.join('、'));
 else unknowns.push(services.length?'公司登錄服務未直接命中案名，請核對標書需求':'尚未填寫公司服務範圍');
 const budget=safeNumber(row.budget??row.budget_amount),min=safeNumber(profile.min_budget??profile.min),max=safeNumber(profile.max_budget??profile.max);
 let budgetMismatch=false;
 if(budget===null)unknowns.push('採購預算未取得');
 else if((min!==null&&budget<min)||(max!==null&&budget>max)){budgetMismatch=true;reasons.push('公開預算不在自訂承接範圍');}
 else if(min!==null||max!==null)reasons.push('公開預算落在公司自訂範圍內');
 if(info.kind==='failed'||info.kind==='awarded'||info.kind==='closed')reasons.push('案件目前非確認可投標狀態：'+info.label);
 else if(info.kind!=='open')unknowns.push('官方截標時間或更正狀態尚待確認');
 const list=Array.isArray(assets)?assets:[];
 if(!list.length)unknowns.push('尚未登錄可供核對的公司證照或實績');
 else reasons.push('已登錄 '+list.length+' 筆公司證照／實績，是否符合本案要求仍需人工核對');
 unknowns.push('標書資格、履約地及必要證明須逐項核對官方原文');
 const unavailable=['failed','awarded','closed'].includes(info.kind);
 return {label:unavailable?'目前非投標商機':budgetMismatch?'預算不符自訂條件':hits.length&&info.kind==='open'?'值得進一步評估':'待確認',
   level:unavailable||budgetMismatch?'not-recommended':hits.length&&info.kind==='open'?'review':'unknown',
   reasons,unknowns,eligibleConfirmed:false,matchedServices:hits};
}

export function compareDeadline(s) {
  const d=parseDate(s);
  if(!d)return null;
  return Math.ceil((d.getTime()-Date.now())/86400000);
}
export function csvEscape(value) {
  let s=asText(value);
  if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function safeOfficial(url) {
  try{const u=new URL(asText(url));return u.protocol==='https:'&&u.hostname==='web.pcc.gov.tw'?u.href:'';}catch{return '';}
}
