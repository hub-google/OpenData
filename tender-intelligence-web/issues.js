// F14 source-verifiable lists, no inferred legal status or invented deadlines.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const text=(tag,value,cls='')=>{const x=document.createElement(tag);x.textContent=String(value??'');if(cls)x.className=cls;return x;};
let page=1,total=0,mode='failed',keyword='',requestId=0;
const number=v=>Number(v||0).toLocaleString('zh-TW');
const publication=v=>{const s=String(v||'');return /^\d{8}$/.test(s)?s.slice(0,4)+'/'+s.slice(4,6)+'/'+s.slice(6,8):'未公開';};
const clock=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'未公開':d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});};
function createCard(row){
 const card=text('article','','case-card');
 const left=text('div','','case-left');
 const title=document.createElement('a');
 title.className='case-title';title.textContent=row.title||'案名未公開';
 title.href='./?case_unit='+encodeURIComponent(row.unit_id)+'&case_no='+encodeURIComponent(row.job_number);
 left.append(title);
 left.append(text('p',[
  row.agency||'機關未公開','案號 '+row.job_number,row.latest_notice_type||'類型未公開',
  '公告日 '+publication(row.latest_notice_date)
 ].join(' ｜ '),'minor'));
 left.append(text('p',row.deadline_at?'已記錄官方截止時間：'+clock(row.deadline_at):'官方截止時間目前無紀錄；請到原公告核對','minor'));
 const actions=text('div','','detail-actions');
 const related=text('div','','detail-timeline');
 const button=text('button','查詢同機關相同案名的其他案件','ghost-btn');
 button.type='button';button.addEventListener('click',async()=>{
  button.disabled=true;related.replaceChildren(text('p','正在查詢真實已入庫資料…','minor'));
  try{
   const c=await getClient(),{data,error}=await c.rpc('ti_possible_rebids',{p_case_id:row.id});
   if(error)throw error;
   related.replaceChildren();
   if(!Array.isArray(data)||!data.length){related.append(text('p','目前未找到其他不同案號、相同機關及相同案名的已入庫案件。','minor'));return;}
   related.append(text('p','僅為同機關／同案名候選，不能推定確定重新招標。','minor'));
   for(const item of data){
    const line=text('div','','timeline-item'),link=document.createElement('a');
    link.href='./?case_unit='+encodeURIComponent(item.unit_id)+'&case_no='+encodeURIComponent(item.job_number);
    link.textContent=publication(item.latest_notice_date)+'｜'+item.title+'｜案號 '+item.job_number+'｜'+(item.latest_notice_type||'');
    line.append(link);related.append(line);
   }
  }catch(e){related.replaceChildren(text('p','來源查詢失敗：'+String(e.message||e),'minor'))}
  finally{button.disabled=false;}
 });
 actions.append(button);left.append(actions,related);card.append(left);return card;
}
async function query(p=1){
 mode=$('issueMode').value;keyword=$('issueKeyword').value.trim();
 const token=++requestId;const status=$('issueStatus');
 status.textContent='正在查詢已入庫的真實公告…';$('issueSubmit').disabled=true;
 try{
  const client=await getClient();
  const {data,error}=await client.rpc('ti_issue_search',{p_mode:mode,p_keyword:keyword,p_page:p,p_limit:20});
  if(error)throw error;
  if(token!==requestId)return;
  if(!data||!Array.isArray(data.rows))throw Error('資料庫回傳不符合格式');
  page=p;total=Number(data.total||0);
  const box=$('issueResults');box.replaceChildren();
  if(!data.rows.length)box.append(text('div','目前符合的已入庫資料為 0 案；資料缺漏不代表全國沒有這類案件。','empty'));
  for(const row of data.rows)box.append(createCard(row));
  const pages=Math.max(1,Math.ceil(total/20));
  $('issuePage').textContent='第 '+page+'／'+pages+' 頁';
  $('issuePrev').disabled=page<=1;$('issueNext').disabled=page>=pages;
  status.textContent='在已入庫資料中找到 '+number(total)+' 案；'+
    (mode==='closing'?'僅計入來源已記錄截止時間、7 天內尚未到期的招標類公告。':
     mode==='failed'?'依該案最近已入庫的公告類型為「無法決標」，不推定後續一定重招。':
     '招標公告已有紀錄，但截止時間尚未補齊；不可假設仍可投標。');
 }catch(e){if(token===requestId)status.textContent='查詢失敗：'+String(e.message||e);}
 finally{if(token===requestId)$('issueSubmit').disabled=false;}
}
$('issueForm').addEventListener('submit',e=>{e.preventDefault();query(1)});
$('issuePrev').addEventListener('click',()=>{if(page>1)query(page-1)});
$('issueNext').addEventListener('click',()=>{if(page<Math.ceil(total/20))query(page+1)});
$('issueMode').addEventListener('change',()=>query(1));
document.querySelector('[data-view="issues"]').addEventListener('click',()=>{if(!total)query(1)});
