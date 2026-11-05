// PRD V2: only actual source history, with missing-value/sample disclosures.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const el=(tag,t='',cl='')=>{const node=document.createElement(tag);node.textContent=String(t??'');if(cl)node.className=cl;return node;};
const n=x=>Number(x||0).toLocaleString('zh-TW');
const date=x=>{let s=String(x||'');return /^\d{8}$/.test(s)?s.slice(0,4)+'/'+s.slice(4,6)+'/'+s.slice(6):'未提供';};
let selected='',monthlyRequest=0,repeatRequest=0;
function linkFor(item,unit){
 const a=document.createElement('a');a.textContent=item.title||item.job_number||'查看案件';
 a.href='./?'+new URLSearchParams({case_unit:unit,case_no:item.job_number});
 return a;
}
async function monthly(id,year){
 const output=$('agencyMonthlyOutput');
 output.replaceChildren(el('p','正在讀取真實已入庫公告…','minor'));
 const token=++monthlyRequest;
 try{
  const c=await getClient(),{data,error}=await c.rpc('ti_agency_monthly_report_v2',{
   p_unit_id:id,p_year:year,p_group:$('agencyMonthlyGroup').value
  });
  if(error)throw error;if(token!==monthlyRequest)return;
  output.replaceChildren();
  const rows=data?.months||[];
  if(!rows.length){output.append(el('p','此機關在該年度沒有已入庫的公告。不能推定官方沒有採購。','empty'));return;}
  const table=el('table','','analysis-list');
  const head=el('tr');
  for(const title of ['月份','公告筆數','案件數','決標類案件數','有預算金額樣本','公開預算合計','有決標金額樣本','公開決標合計','已知決標平均','已知決標中位數']){
   head.append(el('th',title));
  }
  table.append(head);
  for(const row of rows){
   const tr=el('tr');
   for(const value of [String(row.month).padStart(2,'0')+' 月',n(row.notice_count),
    n(row.case_count),n(row.award_notice_count),n(row.budget_sample_count),
    'NT$ '+n(row.known_budget_sum),n(row.award_sample_count),'NT$ '+n(row.known_award_sum),
    row.known_award_mean==null?'未公開':'NT$ '+n(Math.round(row.known_award_mean)),
    row.known_award_median==null?'未公開':'NT$ '+n(Math.round(row.known_award_median))]){
    tr.append(el('td',value));
   }
   table.append(tr);
  }
  output.append(table,el('p','本年度已入庫公告 '+n(data.notice_total)+
   ' 筆；統計按當月同案最新版本去重，與政府全國採購總量不同。','minor'));
 }catch(e){if(token===monthlyRequest)output.replaceChildren(el('p','機關月度查詢失敗：'+String(e.message||e),'minor'));}
}
async function repeats(id){
 const output=$('agencyRepeatOutput');
 output.replaceChildren(el('p','正在核對同機關不同案號的公告紀錄…','minor'));
 const token=++repeatRequest;
 try{
  const c=await getClient(),{data,error}=await c.rpc('ti_agency_repeat_evidence',{
   p_unit_id:id,p_limit:12
  });
  if(error)throw error;if(token!==repeatRequest)return;
  output.replaceChildren();
  if(!data?.groups?.length){
   output.append(el('p','尚未查得至少兩個不同案號、案名相近的來源案件；不代表不存在重複採購。','empty'));return;
  }
  for(const group of data.groups){
   const section=el('section','','watch-item');
   section.append(el('h3',group.title+'（'+n(group.case_count)+' 件不同案號）'));
   section.append(el('p','目前最早 '+date(group.earliest_date)+'／最近 '+date(group.latest_date)+
    '；相同案名僅是關聯線索，不足以推定契約續購或週期。','minor'));
   for(const item of group.evidence||[]){
    const row=el('div','','timeline-item');
    const heading=el('strong');heading.append(linkFor(item,id));
    row.append(heading,el('p','公告：'+date(item.date)+'｜案號：'+item.job_number,'minor'));
    if(item.contract_period_source_text)row.append(el('p','原公告履約期限文字：'+
      String(item.contract_period_source_text).slice(0,250),'minor'));
    section.append(row);
   }
   output.append(section);
  }
 }catch(e){if(token===repeatRequest)output.replaceChildren(el('p','歷史候選查詢失敗：'+String(e.message||e),'minor'));}
}
export async function loadAgencyEvidence(id){
 selected=String(id||'').trim();if(!selected)return;
 const year=Number($('agencyMonthlyYear').value)||new Date().getFullYear();
 await Promise.allSettled([monthly(selected,year),repeats(selected)]);
}
$('agencyMonthlyYear').value=String(new Date().getFullYear());
$('agencyMonthlyForm').addEventListener('submit',e=>{
 e.preventDefault();if(selected)void monthly(selected,Number($('agencyMonthlyYear').value));
});
