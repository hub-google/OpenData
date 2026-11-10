// F12/F13 evidence-only identity and numeric summaries from the saved procurement DB.
import {getClient} from './backend.js';
import {csvEscape} from './core.mjs';
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
let awardRequest=0;
async function award(e){
 const ticket=++awardRequest;
 e.preventDefault();const box=$('awardSampleOutput');
 const year=$('awardYear').value.trim(),agency=$('awardAgency').value.trim();
 const group=$('awardGroup').value;
 const method=$('awardMethod').value.trim();
 const min=$('awardMinBudget').value===''?null:Number($('awardMinBudget').value);
 const max=$('awardMaxBudget').value===''?null:Number($('awardMaxBudget').value);
 if((min!==null&&(!Number.isFinite(min)||min<0))||
    (max!==null&&(!Number.isFinite(max)||max<0))||
    (min!==null&&max!==null&&min>max)){
  box.textContent='公開預算範圍不正確，請確認上下限。';return;
 }
 if(year&&!/^\d{4}$/.test(year)){box.textContent='年度請填寫 4 位數西元年。';return;}
 box.replaceChildren(element('p','正在讀取跨日真實價格樣本…','minor'));
 try{
  const client=await getClient(),{data,error}=await client.rpc('ti_award_samples_v2',{
   p_group:group,p_agency:agency,p_year:year?Number(year):null,
   p_method:method,p_min_budget:min,p_max_budget:max,p_limit:30
  });
  if(error)throw error;
  if(ticket!==awardRequest)return;
  box.replaceChildren();
  const sufficient=Number(data.count)>=5;
  const summary=element('div','','stat-row');
  const percent=(ratio)=>!sufficient||ratio==null?'樣本不足':(Number(ratio)*100).toFixed(1)+'%';
  const entries=[['可比較樣本',n(data.count)+' 案'],
    ['中位數',percent(data.median_ratio)],
    ['25% 分位',percent(data.q1_ratio)],
    ['75% 分位',percent(data.q3_ratio)]];
  for(const [title,value] of entries){const card=element('div','','stat-compact');card.append(element('span',title),element('b',value));summary.append(card);}
  box.append(summary);
  box.append(element('p',Number(data.count)<5?'樣本少於 5，不適合推斷行情。':
   '僅同條件原始公告樣本；有 '+n(data.method_unknown_count)+' 件未提供決標方式、'+
   n(data.contract_period_unknown_count)+' 件未提供可辨識履約期限。未校正規格、數量、複數決標或年期，不能用來推薦報價。','notice warning'));
  const rows=data.rows||[];
  for(const row of rows){
   const div=element('div','','timeline-item');
   div.append(link(row.unit_id,row.job_number,row.title||'案名未公開'));
   div.append(element('p',d(row.latest_notice_date)+'｜'+(row.agency||'機關未公開')+
     '｜'+(row.group_name||'未分類')+'｜預算 '+cash(row.budget_amount)+'｜決標 '+cash(row.award_amount)+
     '｜決標／預算 '+(Number(row.ratio)*100).toFixed(1)+'%'+
     (row.decision_method?'｜決標方式 '+row.decision_method:'｜決標方式未公開')+
     (row.contract_period_source?'｜履約期限 '+String(row.contract_period_source).slice(0,80):'') ,'minor'));
   box.append(div);
  }
  if(!rows.length)box.append(element('p','目前沒有足夠的雙金額真實公告樣本。','empty'));
  if(rows.length){
    const exportButton=element('button','匯出畫面已列的 '+rows.length+' 件來源案件 CSV','ghost-btn');
    exportButton.type='button';
    exportButton.addEventListener('click',()=>{
      const csv=[['公告日期','機關','案號','案名','大類','預算','決標金額','決標／預算','決標方式'],
       ...rows.map(item=>[item.latest_notice_date,item.agency,item.job_number,item.title,item.group_name,
        item.budget_amount,item.award_amount,item.ratio,item.decision_method||'未公開'])];
      const blob=new Blob(['\uFEFF'+csv.map(row=>row.map(csvEscape).join(',')).join('\r\n')],
       {type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='決標行情已顯示來源樣本.csv';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
    });
    box.append(exportButton);
  }
  // Add year-to-year market detail only when its filter set truly matches
  // the existing award drilldown. Do not silently drop method or price limits.
  if(!method&&min===null&&max===null){
    const currentYear=Number(new Intl.DateTimeFormat('en-US',{
      timeZone:'Asia/Taipei',year:'numeric'}).format(new Date()));
    const endYear=year?Number(year):currentYear;
    const beginYear=Math.max(2000,endYear-2);
    const {data:trend,error:trendError}=await client.rpc('ti_award_market_summary',{
      p_start_year:beginYear,p_end_year:endYear,p_group:group,p_agency:agency
    });
    if(ticket!==awardRequest)return;
    const trendPanel=element('details','','ti-award-year-trend');
    trendPanel.append(element('summary','近三年度已入庫樣本的決標比趨勢（逐年完整集合）'));
    if(trendError)trendPanel.append(element('p','跨年度查詢失敗：'+String(trendError.message||trendError),'minor'));
    else{
      trendPanel.append(element('p','只含最新公告已決標、且預算與決標金額皆大於零的已入庫案件。來源涵蓋不完整時不能解讀為全國行情；每年有效樣本少於 5 件不顯示分位數。','minor'));
      const table=element('table','','analysis-list');
      const header=element('tr');
      for(const col of ['年度','有效樣本 n','Q1','中位數','Q3'])header.append(element('th',col));
      table.append(header);
      const ratio=(v,size)=>size>=5&&v!=null?(Number(v)*100).toFixed(1)+'%':'樣本不足';
      for(const row of trend?.years||[]){
        const tr=element('tr');
        for(const item of [row.year,n(row.n),ratio(row.q1_ratio,row.n),
          ratio(row.median_ratio,row.n),ratio(row.q3_ratio,row.n)])tr.append(element('td',item));
        table.append(tr);
      }
      if(!(trend?.years||[]).length)trendPanel.append(element('p','近三年沒有可核對的雙金額已決標案件。','minor'));
      else trendPanel.append(table);
      trendPanel.append(element('p','各年統計在資料庫對全部符合條件的案件計算，非只計畫面 30 件；不能直接用作未公開底價預測。','minor'));
    }
    box.append(trendPanel);
  }else{
    box.append(element('p','選取決標方式或金額範圍時，跨年度總體趨勢會隱藏，避免忽略篩選條件導致錯誤比較。','minor'));
  }
 }catch(err){if(ticket===awardRequest)box.replaceChildren(element('p','查詢失敗：'+String(err.message||err),'notice warning'));}
}
async function coMentions(){
 const tax=$('vendorEvidenceTaxId').value.trim(),box=$('vendorCoMentionsOutput');
 if(!/^\d{8}$/.test(tax)){box.replaceChildren(element('p','請先在上方輸入 8 碼統編。','minor'));return;}
 box.replaceChildren(element('p','正在查詢同份公告有列出哪些公司統編…','minor'));
 try{
  const client=await getClient(),{data,error}=await client.rpc('ti_vendor_co_mentions',{p_tax_id:tax,p_limit:15});
  if(error)throw error;
  box.replaceChildren(element('p','該統編見於 '+n(data.source_notice_count)+
   ' 份已入庫公告。以下僅為「共同出現在同份公告」，不是競爭者認定。','minor'));
  if(!data.co_mentions?.length){
   box.append(element('p','目前沒有同公告列出其他有效八碼公司代碼。','minor'));return;
  }
  for(const company of data.co_mentions){
   const row=element('section','','watch-item');
   const h=element('h3','統編 '+company.other_company_id+
    '｜同公告 '+n(company.shared_notices)+' 次｜不同案件 '+n(company.shared_cases)+' 件');
   row.append(h);
   row.append(element('p','最早 '+d(company.first_date)+'／最近 '+d(company.last_date)+
    '；當事人角色未經來源證實。','minor'));
   for(const cited of company.cases||[]){
    const item=element('div','','timeline-item');
    item.append(link(cited.unit_id,cited.job_number,d(cited.source_date)+'｜'+cited.title));
    row.append(item);
   }
   box.append(row);
  }
 }catch(err){box.replaceChildren(element('p','同公告公司查詢失敗：'+String(err.message||err),'minor'));}
}
$('vendorEvidenceForm').addEventListener('submit',e=>void vendor(e));
$('vendorCoMentionsButton').addEventListener('click',()=>void coMentions());

async function vendorRoles(){
 const tax=$('vendorEvidenceTaxId').value.trim(),box=$('vendorRolesOutput');
 if(!/^\d{8}$/.test(tax)){
  box.replaceChildren(element('p','請先在上方輸入完整八碼統編。','minor'));return;
 }
 box.replaceChildren(element('p','正在核對正式公告中有標明的公司角色…','minor'));
 try{
  const c=await getClient();
  const {data,error}=await c.rpc('ti_vendor_role_evidence',{p_tax_id:tax});
  if(error)throw error;
  box.replaceChildren();
  box.append(element('p','該統編出現在 '+n(data.notice_mentions)+
    ' 份已入庫公告。沒有公開完整投標名單的案件不計算得標勝率。','minor'));
  const years=element('table','','analysis-list'),head=element('tr');
  for(const title of ['年度','公告出現','不同案件','明示投標公告','明示得標公告',
   '明示未得標公告','唯一得標且金額可用樣本','對應公告金額合計']){
    head.append(element('th',title));
  }
  years.append(head);
  for(const y of data.years||[]){
   const row=element('tr');
   for(const item of [y.year,n(y.notice_mentions),n(y.case_mentions),
    n(y.explicit_bidder_notices),n(y.explicit_winner_notices),
    n(y.explicit_nonwinner_notices),n(y.single_winner_money_samples),
    Number(y.single_winner_money_samples)>0
      ?'NT$ '+n(y.single_winner_amount_samples):'無可歸屬樣本']){
      row.append(element('td',item));
   }
   years.append(row);
  }
  box.append(years,element('h3','公告中出現的主要機關'));
  for(const a of (data.agencies||[]).slice(0,10)){
   box.append(element('p',(a.agency||a.unit_id)+'｜公告 '+n(a.notice_mentions)+
     ' 筆｜明示得標 '+n(a.confirmed_award_notices)+' 筆','minor'));
  }
  box.append(element('h3','最近有角色證據的公告'));
  for(const x of (data.recent||[]).slice(0,15)){
   const row=element('div','','timeline-item');
   row.append(link(x.unit_id,x.job_number,d(x.source_date)+'｜'+x.title));
   const role=x.confirmed_winner?'公告明示得標':
    x.confirmed_nonwinner?'公告明示未得標':
    x.confirmed_bidder?'公告明示投標':'公告僅列公司';
   const amount=x.whole_case_award_amount_single_winner!=null
     ?'｜唯一得標廠商案件金額 NT$'+n(x.whole_case_award_amount_single_winner):'';
   row.append(element('p',role+'｜'+(x.agency||'機關未公開')+amount,'minor'));
   box.append(row);
  }
  if(!data.recent?.length)box.append(element('p','已入庫公告尚無可查的來源明細。','minor'));
 }catch(e){
  box.replaceChildren(element('p','廠商公告角色統計失敗：'+String(e.message||e),'notice warning'));
 }
}
$('vendorRolesButton').addEventListener('click',()=>void vendorRoles());
$('awardSampleForm').addEventListener('submit',e=>void award(e));
document.querySelector('[data-view="analytics"]').addEventListener('click',()=>{
 if($('awardSampleOutput').textContent==='尚未查詢。')void award({preventDefault(){}});
});
