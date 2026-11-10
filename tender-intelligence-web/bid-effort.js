// W08: private, user-entered bid preparation hours and out-of-pocket costs.
// This does not infer work hours, expenses, or success from public award notices.
import {getClient} from './backend.js';

const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=String(text);if(cls)n.className=cls;return n;};
const money=n=>'NT$'+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});
const hrs=n=>Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2})+' 小時';
const categories=['資格審查','技術規劃','標書撰寫','詢價與報價','內部會議','送件與行政','其他'];
async function owner(){
 const db=await getClient(),{data,error}=await db.auth.getUser();
 return {db,user:error||data?.user?.is_anonymous?null:data?.user||null};
}
function formField(label,input){const l=el('label',label);l.append(input);return l;}
function today(){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date()).map(part=>[part.type,part.value]));
 return [parts.year,parts.month,parts.day].join('-');
}
export function mountBidEffort(panel,caseId){
 const title=el('h3','備標成本與工時'),status=el('p','讀取工作紀錄中…','minor');
 const hint=el('p','工時、實際現金支出和人力成本估值分開列示；未填每小時成本時不推估人力費用。','minor');
 const totals=el('div','','ti-effort-totals'),form=el('form','','ti-case-editor ti-effort-form'),list=el('div','','ti-case-list');
 const date=el('input'),group=el('select'),hours=el('input'),cash=el('input'),rate=el('input'),note=el('textarea');
 date.type='date';date.required=true;
 for(const name of categories){const option=el('option',name);option.value=name;group.append(option);}
 for(const [element,max,step] of [[hours,'24','0.25'],[cash,'1000000000','0.01'],[rate,'1000000','0.01']]){
  element.type='number';element.min='0';element.max=max;element.step=step;
 }
 hours.required=true;cash.required=true;
 rate.placeholder='選填；未填不估工時成本';note.maxLength=1000;note.rows=2;
 const save=el('button','新增工作紀錄','primary-btn');save.type='submit';
 const cancel=el('button','取消修改','ghost-btn');cancel.type='button';cancel.hidden=true;
 form.append(formField('日期',date),formField('備標工作',group),formField('投入工時',hours),
  formField('實付現金支出（元）',cash),formField('估算每小時人力成本（元，可留空）',rate),
  formField('備註',note),save,cancel);
 panel.append(title,hint,totals,status,form,list);
 let editing=null,version=0;
 function reset(){
  editing=null;date.value=today();group.value='資格審查';hours.value='1';
  cash.value='0';rate.value='';note.value='';save.textContent='新增工作紀錄';cancel.hidden=true;
 }
 async function load(){
  const current=++version,{db,user}=await owner();
  if(current!==version||!panel.isConnected)return;
  if(!user){status.textContent='請先登入才能保存你的備標工作紀錄。';list.replaceChildren();totals.textContent='';return;}
  const {data,error}=await db.from('ti_bid_effort_entries')
   .select('id,work_day,category,hours,cash_cost,hourly_rate,note,updated_at')
   .eq('user_id',user.id).eq('case_id',caseId)
   .order('work_day',{ascending:false}).order('updated_at',{ascending:false}).limit(1000);
  if(current!==version||!panel.isConnected)return;
  if(error){status.textContent='讀取失敗：'+String(error.message||error);return;}
  const rows=data||[];
  const hoursTotal=rows.reduce((n,r)=>n+Number(r.hours||0),0);
  const cashTotal=rows.reduce((n,r)=>n+Number(r.cash_cost||0),0);
  const laborTotal=rows.reduce((n,r)=>n+(r.hourly_rate==null?0:Number(r.hours||0)*Number(r.hourly_rate)),0);
  const unpriced=rows.reduce((n,r)=>n+(r.hourly_rate==null?Number(r.hours||0):0),0);
  totals.textContent='投入 '+hrs(hoursTotal)+'｜現金 '+money(cashTotal)+
   '｜已填單價的人力估值 '+money(laborTotal)+(unpriced?'｜未估價工時 '+hrs(unpriced):'');
  status.textContent='已讀取 '+rows.length+' 筆私人紀錄'+(rows.length===1000?'（只顯示最近 1,000 筆，統計非全量）':'');
  list.replaceChildren();
  if(!rows.length)list.append(el('p','尚未記錄這件案件的備標成本。','minor'));
  for(const record of rows){
   const row=el('div','','ti-case-listrow ti-effort-row');
   const info=el('div','','ti-effort-info');
   info.append(el('strong',record.work_day+'｜'+record.category),
    el('p',hrs(record.hours)+'｜現金 '+money(record.cash_cost)+
     (record.hourly_rate===null?'｜工時未估價':'｜人力估值 '+money(Number(record.hours)*Number(record.hourly_rate))),'minor'));
   if(record.note)info.append(el('p',record.note,'minor'));
   const actions=el('div','','ti-effort-actions'),edit=el('button','修改','ghost-btn'),remove=el('button','刪除','ghost-btn');
   edit.type='button';remove.type='button';
   edit.addEventListener('click',()=>{
    editing=record.id;date.value=record.work_day;group.value=record.category;
    hours.value=String(record.hours);cash.value=String(record.cash_cost);
    rate.value=record.hourly_rate??'';note.value=record.note||'';
    save.textContent='儲存修改';cancel.hidden=false;form.scrollIntoView({block:'nearest'});
   });
   remove.addEventListener('click',async()=>{
    if(!confirm('確定刪除這筆工作紀錄？'))return;
    remove.disabled=true;
    const session=await owner();
    if(session.user?.id!==user.id){status.textContent='登入帳號已變更，請重新登入。';remove.disabled=false;return;}
    const result=await session.db.from('ti_bid_effort_entries').delete()
     .eq('user_id',user.id).eq('case_id',caseId).eq('id',record.id).select('id').maybeSingle();
    if(result.error||!result.data){status.textContent='刪除失敗，請重新整理後再試。';remove.disabled=false;return;}
    reset();await load();
    document.dispatchEvent(new CustomEvent('ti:bid-effort-changed',{detail:{caseId}}));
   });
   actions.append(edit,remove);row.append(info,actions);list.append(row);
  }
 }
 cancel.addEventListener('click',reset);
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  const h=Number(hours.value),expense=Number(cash.value),wage=rate.value===''?null:Number(rate.value);
  if(!date.value||!Number.isFinite(h)||h<0||h>24||!Number.isFinite(expense)||expense<0||
   expense>1000000000||(wage!==null&&(!Number.isFinite(wage)||wage<0||wage>1000000))||
   (h===0&&expense===0)){status.textContent='請輸入有效日期與工時或現金支出；每筆工時最多 24 小時。';return;}
  save.disabled=true;
  try{
   const {db,user}=await owner();if(!user)throw Error('請先登入。');
   const record={work_day:date.value,category:group.value,hours:h,cash_cost:expense,
     hourly_rate:wage,note:note.value.trim().slice(0,1000),updated_at:new Date().toISOString()};
   const query=editing?db.from('ti_bid_effort_entries').update(record).eq('user_id',user.id)
      .eq('case_id',caseId).eq('id',editing):
     db.from('ti_bid_effort_entries').insert({...record,user_id:user.id,case_id:caseId});
   const {data,error}=await query.select('id').maybeSingle();
   if(error||!data)throw error||Error('資料庫未確認保存');
   reset();status.textContent='備標工時與現金支出已保存至私人帳戶。';
   await load();document.dispatchEvent(new CustomEvent('ti:bid-effort-changed',{detail:{caseId}}));
  }catch(error){status.textContent='保存失敗：'+String(error?.message||error).slice(0,180);}
  finally{save.disabled=false;}
 });
 reset();void load();
}
