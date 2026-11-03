// PRD F02-F05: real archive search via Postgres, never a browser-only 100-row filter.
// This module has no service-role secrets and uses public, RLS-protected Supabase RPC.
import {getClient} from './backend.js';
import {csvEscape,formatMoney,dateLabel,safeOfficial} from './core.mjs';

const $=id=>document.getElementById(id);
const fields={
 q:'advQuery',x:'advExclude',any:'advAny',agency:'advAgency',kind:'advKind',
 group:'advGroup',location:'advLocation',method:'advMethod',min:'advMin',max:'advMax',
 start:'advStart',end:'advEnd',sort:'advSort',open:'advOpen'
};
let page=1,latest=null,request=0,seen=false;
function status(message,error=false){
 const el=$('advStatus');el.textContent=message;
 el.classList.toggle('danger',error);
}
function node(tag,cls,text){
 const e=document.createElement(tag);
 if(cls)e.className=cls;
 if(text!==undefined)e.textContent=String(text);
 return e;
}
function t(s){return String(s??'').trim()}
function getForm(){
 const d={};
 for(const [name,id] of Object.entries(fields)){
  const input=$(id);d[name]=input.type==='checkbox'?input.checked:input.value;
 }
 return d;
}
function parseQuery(raw,extra,selectedAny){
 const tokens=(raw.match(/"[^"]+"|[^\s]+/g)||[]).map(x=>x.replace(/^"|"$/g,'').trim()).filter(Boolean);
 const and=tokens.some(x=>/^AND$/i.test(x)),or=tokens.some(x=>/^OR$/i.test(x));
 if(and&&or)throw Error('請選擇 AND 或 OR 其中一種組合；目前不支援混合括號運算。');
 const terms=[],excludes=[];
 for(const token of tokens){
  if(/^(AND|OR)$/i.test(token))continue;
  if(token.startsWith('-')&&token.length>1)excludes.push(token.slice(1));
  else if(token.startsWith('+')&&token.length>1)terms.push(token.slice(1));
  else terms.push(token);
 }
 excludes.push(...extra.split(/[,，、\n]+/).map(t).filter(Boolean));
 if(terms.length>12||excludes.length>12||[...terms,...excludes].some(x=>x.length>60))
  throw Error('包含詞和排除詞各最多 12 個，每詞最多 60 字。');
 return {terms:[...new Set(terms)],excludes:[...new Set(excludes)],
   any:or?true:and?false:selectedAny==='true'};
}
function ymd(v){return v?Number(v.replaceAll('-','')):null;}
function args(d,p){
 const query=parseQuery(d.q,d.x,d.any);
 if(d.start&&d.end&&d.start>d.end)throw Error('公告起始日期不得晚於結束日期。');
 const min=d.min!==''?Number(d.min):null,max=d.max!==''?Number(d.max):null;
 if(min!==null&&max!==null&&max<min)throw Error('最高公開預算不可小於最低公開預算。');
 return {
  p_terms:query.terms,p_exclude:query.excludes,p_any:query.any,
  p_agency:t(d.agency),p_kind:d.kind,p_group:d.group,p_location:t(d.location),
  p_method:t(d.method),p_min_budget:min,p_max_budget:max,
  p_date_from:ymd(d.start),p_date_to:ymd(d.end),
  p_deadline_only:Boolean(d.open),p_sort:d.sort,p_page:p,p_limit:30
 };
}
function date(v){
 if(!v)return '未公開';
 const d=new Date(v);
 return Number.isNaN(d.getTime())?'未公開':
   d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function rawLink(row){
 const u=new URL('https://pcc-api.openfun.app/api/tender');
 u.searchParams.set('unit_id',row.unit_id);
 u.searchParams.set('job_number',row.job_number);
 return u.href;
}
function makeCard(r){
 const card=node('article','case-card');
 const left=node('div','case-left');
 const right=node('div','case-right');
 const title=document.createElement('a');
 title.className='case-title';title.textContent=r.title;
 title.href='./?mode=title&q='+encodeURIComponent(r.title||'');
 title.title='在主搜尋檢視同名公告與完整詳情';left.append(title);
 const meta=node('div','case-meta');
 for(const content of [r.latest_notice_type||'公告類型未提供',r.agency||'機關未公開',r.group_name||'未分類','案號 '+r.job_number])
  meta.append(node('span','',content));
 const line=node('div','case-meta');
 line.append(node('span','','公告 '+dateLabel(String(r.latest_notice_date))));
 if(r.deadline_at)line.append(node('span','','截標 '+date(r.deadline_at)));
 if(r.verified_location)line.append(node('span','','履約地（公告）：'+r.verified_location));
 if(r.verified_tender_method)line.append(node('span','','招標方式：'+r.verified_tender_method));
 left.append(meta,line);
 const links=node('div','detail-actions');
 const api=document.createElement('a');api.href=rawLink(r);api.target='_blank';
 api.rel='noopener noreferrer';api.className='ghost-btn';api.textContent='來源 API 詳情';
 links.append(api);
 const official=safeOfficial(r.official_url);
 if(official){
  const anchor=document.createElement('a');anchor.href=official;anchor.target='_blank';
  anchor.rel='noopener noreferrer';anchor.className='ghost-btn';anchor.textContent='官方公告';
  links.append(anchor);
 }
 left.append(links);
 right.append(node('small','','公開預算'),node('strong','',formatMoney(r.budget_amount)));
 if(r.award_amount!==null&&r.award_amount!==undefined)right.append(node('small','','決標金額'),node('strong','',formatMoney(r.award_amount)));
 card.append(left,right);
 return card;
}
async function search(p=1){
 const n=++request;
 let opts;
 try{opts=args(getForm(),p);}
 catch(e){status('查詢條件錯誤：'+e.message,true);return;}
 $('advSubmit').disabled=true;status('正在查詢自有 Supabase 中實際已收錄的公告，跨日期條件在資料庫端處理…');
 try{
  const client=await getClient();
  const {data,error}=await client.rpc('ti_archive_search',opts);
  if(error)throw error;
  if(n!==request)return;
  if(!data||!Array.isArray(data.rows))throw Error('資料庫沒有傳回有效的分頁結果');
  latest=data;page=p;seen=true;
  $('advResults').replaceChildren(...(data.rows.length?data.rows.map(makeCard):[
   node('div','empty','已收錄資料中沒有符合條件的案件；缺漏日期、預算或履約地未知的案件並未填零或推測。')
  ]));
  const maxPage=Math.max(1,Math.ceil(Number(data.total||0)/30));
  $('advPageInfo').textContent='第 '+page+'／'+maxPage+' 頁（每頁最多 30 件）';
  $('advPrev').disabled=page<=1;$('advNext').disabled=page>=maxPage;
  const known=data.rows.filter(r=>r.verified_location).length;
  status('實際已入庫資料符合條件 '+Number(data.total).toLocaleString('zh-TW')+
   ' 件｜本頁 '+data.rows.length+' 件，'+known+' 件有原公告履約地。'+
   ' 未完成回填或來源 API 失敗的日期不在搜尋結果內；未知金額與履約地不會被猜測。');
 }catch(e){
  if(n===request)status('資料庫進階搜尋失敗：'+String(e.message||e).slice(0,220),true);
 }finally{
  if(n===request)$('advSubmit').disabled=false;
 }
}
function queryUrl(){
 const u=new URL(window.location.href);
 u.search='';
 u.searchParams.set('view','advanced');
 const d=getForm();
 for(const [name,value] of Object.entries(d)){
  if(value!==''&&value!==false){
   u.searchParams.set('a_'+name,String(value));
  }
 }
 return u.href;
}
function loadUrl(){
 const p=new URLSearchParams(window.location.search);
 if(p.get('view')!=='advanced')return false;
 for(const [key,id] of Object.entries(fields)){
   const value=p.get('a_'+key);
   if(value===null)continue;
   const e=$(id);
   if(e.type==='checkbox')e.checked=value==='true';
   else if(e.tagName==='SELECT' && [...e.options].some(o=>o.value===value))e.value=value;
   else if(e.tagName!=='SELECT')e.value=value;
 }
 const target=document.querySelector('[data-view="advanced"]');
 if(target)target.click();
 return true;
}
async function copyUrl(){
 try{const s=queryUrl();await navigator.clipboard.writeText(s);status('已複製搜尋連結：'+s);}
 catch{status('瀏覽器無法自動複製，以下可自行複製：'+queryUrl());}
}
function exportCsv(){
 if(!latest||!latest.rows.length){status('請先查詢到有資料的結果。',true);return;}
 const headings=['案名','機關','案號','公告類型','公告日期','預算','決標金額','公告履約地','公告招標方式','政府原公告','OpenFun API'];
 const data=latest.rows.map(r=>[
  r.title,r.agency,r.job_number,r.latest_notice_type,r.latest_notice_date,
  r.budget_amount,r.award_amount,r.verified_location,r.verified_tender_method,
  safeOfficial(r.official_url),rawLink(r)
 ]);
 const csv=[headings,...data].map(row=>row.map(csvEscape).join(',')).join('\r\n');
 const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
 const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;
 a.download='台灣標案進階搜尋-第'+page+'頁.csv';a.click();
 URL.revokeObjectURL(u);
 status('已匯出目前第 '+page+' 頁的 '+data.length+' 筆；非全庫查詢結果。');
}
function init(){
 $('advancedForm').addEventListener('submit',e=>{e.preventDefault();void search(1);});
 $('advClear').addEventListener('click',()=>{request++;$('advancedForm').reset();latest=null;page=1;seen=false;$('advResults').replaceChildren();$('advPageInfo').textContent='尚未搜尋';status('條件已清除。');});
 $('advPrev').addEventListener('click',()=>{if(page>1)void search(page-1);});
 $('advNext').addEventListener('click',()=>{if(latest&&page<Math.ceil(Number(latest.total)/30))void search(page+1);});
 $('advShare').addEventListener('click',()=>void copyUrl());
 $('advCsv').addEventListener('click',exportCsv);
 document.querySelector('[data-view="advanced"]')?.addEventListener('click',()=>{if(!seen)void search(1);});
 loadUrl();
}
init();
