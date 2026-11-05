// Evidence-first tender briefing displayed before the six case tabs.
import {getClient} from './backend.js';
const node=(tag,text='',cls='')=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;};
const sourceUrl='https://web.pcc.gov.tw/';
let token=0;
const dateTime=v=>{
 try{return new Intl.DateTimeFormat('zh-TW',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Taipei'}).format(new Date(v))}
 catch{return '尚未取得'}
};
function jump(tabIndex){
 const b=document.querySelectorAll('#detailContent .ti-case-tab')[tabIndex];
 b?.click();b?.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function action(text,onClick){
 const b=node('button',text,'ghost-btn');b.type='button';b.addEventListener('click',onClick);return b;
}
function cell(label,value,help=''){
 const box=node('div','','ti-brief-cell'),small=node('small',label),strong=node('strong',value);
 box.append(small,strong);if(help)box.append(node('span',help,'minor'));return box;
}
async function render(info){
 const now=++token,root=document.getElementById('detailContent'),tabs=root?.querySelector('.ti-case-tabs');
 if(!root||!tabs)return;
 root.querySelector('.ti-decision-brief')?.remove();
 const brief=node('section','','ti-decision-brief');
 brief.setAttribute('aria-label','投標前五項重點');
 brief.append(node('h3','投標前先確認這五件事'));
 const grid=node('div','','ti-brief-grid'),actions=node('div','','ti-brief-actions'),summary=node('p','正在查核已入庫的官方資料…','minor');
 brief.append(grid,summary,actions);tabs.before(brief);
 const db=await getClient();
 const [{data:caseRow,error:ce},{data:detailRow,error:de}]=await Promise.all([
  db.from('ti_cases').select('latest_notice_type,latest_notice_date,agency,unit_id,job_number,budget_amount,deadline_at,official_url,group_name,source_fetched_at').eq('id',info.caseId).maybeSingle(),
  db.from('ti_case_details').select('details,fetched_at').eq('case_id',info.caseId).maybeSingle()
 ]);
 if(now!==token||!brief.isConnected)return;
 grid.replaceChildren();actions.replaceChildren();
 if(ce||de||!caseRow){
  summary.textContent='官方詳情暫時無法查核，請使用上方資料 API 或電子採購網查證，不可據此判定可投標。';
  actions.append(action('前往標書文件',()=>jump(2)),action('先記錄待確認事項',()=>jump(1)));
  return;
 }
 const details=detailRow?.details||{},deadline=caseRow.deadline_at||details.deadline_at,
 official=caseRow.official_url||details.official_page,
 classification=caseRow.group_name&&caseRow.group_name!=='未分類',
 qualification=String(details.qualification||'').trim(),
 deposit=String(details.deposit||'').trim(),
 budget=caseRow.budget_amount,
 stage=String(caseRow.latest_notice_type||'');
 const awarded=/決標/.test(stage)&&!/無法決標/.test(stage);
 const past=deadline&&new Date(deadline)<new Date();
 const timeStatus=awarded?'最新公告為決標':deadline?(past?'公告截止時間已過':'尚未到官方截止時間'):'未取得官方截標時間';
 const timeDetail=deadline?dateTime(deadline):'不能把未知當成仍可投標';
 const known=[Boolean(deadline),Boolean(official),Boolean(qualification),Boolean(deposit),budget!==null&&budget!==undefined,Boolean(classification)];
 grid.append(
  cell('① 還能投嗎？',timeStatus,timeDetail),
  cell('② 資格符合嗎？',qualification?'有官方資格段落，待核對':'資格要求尚未取得','不能自動判定符合'),
  cell('③ 金額與擔保',budget!=null?Number(budget).toLocaleString('zh-TW')+' 元':'預算未知',deposit?'押標金原文：'+deposit.slice(0,60):'押標金仍待查'),
  cell('④ 該準備什麼？','招標文件與附件須人工核對','標書解析會記錄原文頁碼'),
  cell('⑤ 下一步誰負責？','建立投標待辦並指派','可在工作區追蹤期限')
 );
 const evidence=known.filter(Boolean).length;
 summary.textContent='資料完整度 '+evidence+'/6 個關鍵欄位｜依已入庫官方公告核對，不代表其他缺漏欄位在官方不存在。'+
  (detailRow?.fetched_at?'｜詳情更新：'+dateTime(detailRow.fetched_at):'｜尚未補齊案件詳情')+
  (caseRow.source_fetched_at?'｜摘要同步：'+dateTime(caseRow.source_fetched_at):'');
 actions.append(action('核對資格與標書',()=>jump(2)),action('評估是否投標',()=>jump(1)),action('建立待辦',()=>jump(3)));
 if(official){
  const a=node('a','開啟官方公告','ghost-btn');a.href=official;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);
 }else{
  const a=node('a','到政府採購網查原文','ghost-btn');a.href=sourceUrl;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);
  actions.append(action('複製機關與案號',()=>{
   const id=(caseRow.agency||caseRow.unit_id||'')+'　案號 '+(caseRow.job_number||'');
   navigator.clipboard.writeText(id).then(()=>{summary.textContent='已複製「'+id+'」，請到政府採購網依機關與案號查詢。';}).catch(()=>{summary.textContent='無法使用剪貼簿。機關：'+caseRow.agency+'；案號：'+caseRow.job_number;});
  }));
 }
}
document.addEventListener('ti:case-opened',event=>void render(event.detail).catch(error=>{
 const root=document.querySelector('#detailContent .ti-decision-brief');
 if(root)root.querySelector('.minor').textContent='資料讀取失敗：'+String(error?.message||error).slice(0,150);
}));
