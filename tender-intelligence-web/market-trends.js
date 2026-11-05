// Monthly trend of real cases currently in the tender archive; not a national aggregate.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const el=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
let latest=null;
const money=n=>n===null||n===undefined?'來源未提供':Number(n).toLocaleString('zh-TW')+' 元';
function row(label,value,max){
 const line=el('div','','ti-market-row');
 const head=el('div','','ti-market-head'),desc=el('span',label),number=el('strong',Number(value||0).toLocaleString('zh-TW')+' 件');
 head.append(desc,number);
 const track=el('div','','ti-market-track'),bar=el('div','','ti-market-fill');
 bar.style.width=(max>0?Math.max(0,100*Number(value||0)/max):0)+'%';
 track.append(bar);line.append(head,track);return line;
}
function render(data){
 const trend=$('tiMarketTrend'),categories=$('tiMarketCategories'),status=$('tiMarketStatus');
 if(!trend||!categories)return;
 trend.replaceChildren();categories.replaceChildren();
 const months=Array.isArray(data.months)?data.months:[],cats=Array.isArray(data.categories)?data.categories:[];
 latest=data;
 if(!months.length){trend.append(el('p','目前已入庫來源中沒有符合本次條件的案件，不能據此認定全國沒有採購。','notice warning'));status.textContent='0 件已入庫符合條件';return;}
 const high=Math.max(...months.map(m=>Number(m.case_count)||0),1);
 for(const m of months){
  const y=String(m.month),name=y.slice(0,4)+' 年 '+y.slice(4)+' 月';
  trend.append(row(name,m.case_count,high));
  const note=el('p','公開預算：'+Number(m.known_budget_count||0).toLocaleString('zh-TW')+' 案／'+money(m.published_budget_sum)+'；公開決標：'+Number(m.known_award_count||0).toLocaleString('zh-TW')+' 案／'+money(m.published_award_sum),'minor');
  trend.append(note);
 }
 const catmax=Math.max(...cats.map(c=>Number(c.case_count)||0),1);
 for(const c of cats)categories.append(row(c.category,c.case_count,catmax));
 status.textContent='目前符合 '+Number(data.distinct_cases||0).toLocaleString('zh-TW')+' 件已入庫案件，最新公告日期：'+(data.last_case_date||'未提供')+'。'+(data.note||'');
}
function download(){
 if(!latest||!Array.isArray(latest.months)||!latest.months.length)return;
 const header=['月份','案件數','有公開預算案件','公開預算總額','有公開決標金額案件','公開決標總額'];
 const rows=[header,...latest.months.map(m=>[m.month,m.case_count,m.known_budget_count,m.published_budget_sum,m.known_award_count,m.published_award_sum])];
 const csv='\uFEFF'+rows.map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=el('a');a.href=url;a.download='已入庫標案市場趨勢.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
let busy=false;
async function load(e){
 e?.preventDefault();if(busy)return;
 busy=true;const button=$('tiMarketSubmit');button.disabled=true;
 $('tiMarketStatus').textContent='正在依實際入庫公告查詢月份與公開金額…';
 try{
  const db=await getClient();
  const {data,error}=await db.rpc('ti_market_trends_v1',{
   p_months:Number($('tiMarketMonths').value),p_agency:$('tiMarketAgency').value.trim().slice(0,100),
   p_group:$('tiMarketGroup').value
  });
  if(error)throw error;
  render(data||{months:[],categories:[],distinct_cases:0});
 }catch(error){$('tiMarketStatus').textContent='市場趨勢查詢失敗：'+String(error?.message||error).slice(0,200);}
 finally{busy=false;button.disabled=false;}
}
function init(){
 const section=$('view-analytics');if(!section)return;
 const panel=el('section','','panel analysis-panel ti-market');
 panel.append(el('h2','月份趨勢與採購類別'));
 const p=el('p','只統計本平台已收錄、依機關＋案號去重的案件，金額未知不當零；歷史覆蓋不完整時，不能推定季節性或全國行情。','minor');panel.append(p);
 const form=el('form','','ti-market-form');form.id='tiMarketForm';
 const months=document.createElement('select');months.id='tiMarketMonths';
 for(const v of [6,12,24]){const option=el('option','近 '+v+' 個月');option.value=v;months.append(option);}months.value='12';
 const group=document.createElement('select');group.id='tiMarketGroup';
 for(const val of [['','全部採購類別'],['工程','工程'],['財物','財物'],['勞務','勞務'],['未分類','未分類']]){const option=el('option',val[1]);option.value=val[0];group.append(option);}
 const agency=document.createElement('input');agency.id='tiMarketAgency';agency.maxLength=100;agency.placeholder='指定機關（選填）';
 const search=el('button','產生趨勢','primary-btn');search.id='tiMarketSubmit';search.type='submit';
 const csv=el('button','匯出月份 CSV','ghost-btn');csv.type='button';csv.addEventListener('click',download);
 for(const [label,node] of [['觀察期間',months],['採購類別',group],['機關',agency]]){const wrap=el('label',label);wrap.append(node);form.append(wrap);}
 form.append(search,csv);panel.append(form);
 const stats=el('p','正在載入已入庫歷史趨勢…','minor');stats.id='tiMarketStatus';stats.setAttribute('role','status');
 const graph=el('div','','ti-market-graph');graph.id='tiMarketTrend';
 const category=el('div','','ti-market-graph');category.id='tiMarketCategories';
 panel.append(stats,el('h3','逐月案件數'),graph,el('h3','案件類別分布'),category);
 const first=section.querySelector('.analysis-panel');if(first)first.insertAdjacentElement('afterend',panel);else section.append(panel);
 form.addEventListener('submit',load);
 document.addEventListener('ti:view-changed',event=>{if(event.detail?.view==='analytics'&&!latest)void load();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
