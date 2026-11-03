// F12/F13 evidence-only identity and numeric summaries from the saved procurement DB.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const n=x=>Number(x||0).toLocaleString('zh-TW');
const element=(tag,value,cls='')=>{const e=document.createElement(tag);e.textContent=String(value??'');if(cls)e.className=cls;return e;};
const d=v=>{const s=String(v??'');return /^\d{8}$/.test(s)?s.slice(0,4)+'/'+s.slice(4,6)+'/'+s.slice(6,8):'日期未公開';};
const cash=v=>v==null?'未公開':'NT$'+n(v);
function link(unit,job,title){
 const a=document.createElement('a');a.textContent=title;
 a.href='./?case_unit='+encodeURIComponent(unit)+'&case_no='+encodeURIComponent(job);
 a.rel='noopener';return a;
}
async function vendor(e){
 e.preventDefault();
 const tax=$('vendorEvidenceTaxId').value.trim(),box=$('vendorEvidenceOutput');
 if(!/^\d{8}$/.test(tax)){box.textContent='請填寫 8 碼統一編號。';return;}
 box.replaceChildren(element('p','正在讀取公告中的真實廠商代碼與名稱欄位…','minor'));
 try{
  const client=await getClient(),{data,error}=await client.rpc('ti_vendor_evidence',{p_tax_id:tax});
  if(error)throw error;
  box.replaceChildren(element('p','這個統編出現在 '+n(data.notice_count)+' 份公告、'+n(data.case_count)+' 個不同案件。屬公告出現紀錄，不等於投標勝率或政府工商登記認證。','minor'));
  const aliases=data.single_company_evidence_names||[];
  box.append(element('h3','有一對一公告來源證據的公司名稱'));
  if(!aliases.length)box.append(element('p','目前沒有足以證明一對一對應的公告名稱；不推測別名。','minor'));
  for(const name of aliases){
   box.append(element('p',name.name+'｜公告 '+n(name.notices)+' 筆｜最早 '+d(name.first_date)+'／最近 '+d(name.last_date),'minor'));
  }
  box.append(element('h3','最近明確包含該統編的公告（最多 20 筆）'));
  for(const row of data.sample_notices||[]){
   const div=element('div','','timeline-item');
   div.append(link(row.unit_id,row.job_number,d(row.source_date)+'｜'+row.title+'｜'+row.job_number));
   div.append(element('p',row.agency+'｜'+row.notice_type,'minor'));box.append(div);
  }
 }catch(err){box.replaceChildren(element('p','查詢失敗：'+String(err.message||err),'notice warning'));}
}
async function award(e){
 e.preventDefault();const box=$('awardSampleOutput');
 const year=$('awardYear').value.trim(),agency=$('awardAgency').value.trim();
 const group=$('awardGroup').value;
 if(year&&!/^\d{4}$/.test(year)){box.textContent='年度請填寫 4 位數西元年。';return;}
 box.replaceChildren(element('p','正在讀取跨日真實價格樣本…','minor'));
 try{
  const client=await getClient(),{data,error}=await client.rpc('ti_award_samples',{
   p_group:group,p_agency:agency,p_year:year?Number(year):null,p_limit:30
  });
  if(error)throw error;
  box.replaceChildren();
  const summary=element('div','','stat-row');
  const entries=[['可比較樣本',n(data.count)+' 案'],['中位數',data.median_ratio==null?'無樣本':(Number(data.median_ratio)*100).toFixed(1)+'%'],
    ['25% 分位',data.q1_ratio==null?'無樣本':(Number(data.q1_ratio)*100).toFixed(1)+'%'],
    ['75% 分位',data.q3_ratio==null?'無樣本':(Number(data.q3_ratio)*100).toFixed(1)+'%']];
  for(const [title,value] of entries){const card=element('div','','stat-compact');card.append(element('span',title),element('b',value));summary.append(card);}
  box.append(summary);
  box.append(element('p',Number(data.count)<5?'樣本少於 5，不適合推斷行情。':'沒有做規格、數量、得標方式與年期的可比性校正；中位數只是本次條件下的觀察數值。','notice warning'));
  const rows=data.rows||[];
  for(const row of rows){
   const div=element('div','','timeline-item');
   div.append(link(row.unit_id,row.job_number,row.title||'案名未公開'));
   div.append(element('p',d(row.latest_notice_date)+'｜'+(row.agency||'機關未公開')+
     '｜'+(row.group_name||'未分類')+'｜預算 '+cash(row.budget_amount)+'｜決標 '+cash(row.award_amount)+
     '｜決標／預算 '+(Number(row.ratio)*100).toFixed(1)+'%','minor'));
   box.append(div);
  }
  if(!rows.length)box.append(element('p','目前沒有足夠的雙金額真實公告樣本。','empty'));
 }catch(err){box.replaceChildren(element('p','查詢失敗：'+String(err.message||err),'notice warning'));}
}
$('vendorEvidenceForm').addEventListener('submit',e=>void vendor(e));
$('awardSampleForm').addEventListener('submit',e=>void award(e));
document.querySelector('[data-view="analytics"]').addEventListener('click',()=>{
 if($('awardSampleOutput').textContent==='尚未查詢。')void award({preventDefault(){}});
});
