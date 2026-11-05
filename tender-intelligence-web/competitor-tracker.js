// Real, private competitor watchlist with manual source-backed lookup.
// Automated outbound alerts are not claimed until the event processor is configured.
import {getClient} from './backend.js';
const e=(tag,text='',cls='')=>{const x=document.createElement(tag);x.textContent=text;if(cls)x.className=cls;return x;};
let root=null,db=null,user=null;
const msg=t=>{const box=root?.querySelector('[data-watch-status]');if(box)box.textContent=t;};
async function auth(){
 db=await getClient();const {data,error}=await db.auth.getUser();user=error?null:data?.user;
 if(!user){msg('請先登入後再新增監控廠商。');return false;}return true;
}
async function load(){
 if(!root||!(await auth()))return;
 const {data,error}=await db.from('ti_competitor_watches').select('id,company_name,tax_id,created_at').eq('user_id',user.id).eq('active',true).order('created_at',{ascending:false});
 if(error){msg('讀取失敗：'+error.message);return;}
 const list=root.querySelector('[data-watch-list]');list.replaceChildren();
 if(!data?.length)list.append(e('p','還沒有指定監控廠商。','minor'));
 for(const item of data||[]){
  const row=e('div','','ti-case-listrow'),name=e('strong',item.company_name+(item.tax_id?'（'+item.tax_id+'）':'')),act=e('div','','toolbar');
  const view=e('button','查看此廠商的公告','ghost-btn');view.type='button';
  view.addEventListener('click',()=>{
   const mode=document.getElementById('vendorMode'),query=document.getElementById('vendorQuery'),form=document.getElementById('vendorForm');
   if(!mode||!query||!form)return;
   mode.value=item.tax_id?'id':'name';query.value=item.tax_id||item.company_name;
   document.querySelector('[data-view="vendors"]')?.click();form.requestSubmit();
  });
  const del=e('button','取消追蹤','ghost-btn');del.type='button';
  del.addEventListener('click',async()=>{
   del.disabled=true;const {error}=await db.from('ti_competitor_watches').delete().eq('user_id',user.id).eq('id',item.id);
   if(error){msg('取消追蹤失敗：'+error.message);del.disabled=false;return;}await load();
  });
  act.append(view,del);row.append(name,act);list.append(row);
 }
 msg('已保存 '+(data?.length||0)+' 個指定廠商。可直接查詢其真實公告；自動異動推播仍需來源事件與通知服務驗收。');
}
async function saveWatch(ev){
 ev.preventDefault();
 if(!(await auth()))return;
 const name=root.querySelector('[name="competitorName"]').value.trim(),
 tax=root.querySelector('[name="competitorTaxId"]').value.trim(),
 button=root.querySelector('button[type="submit"]');
 if(name.length<2||(tax&&!/^\d{8}$/.test(tax))){msg('請輸入至少 2 字的廠商名稱；統編若填入須為 8 碼。');return;}
 button.disabled=true;
 try{
  const {error}=await db.from('ti_competitor_watches').insert({user_id:user.id,company_name:name,tax_id:tax||null});
  if(error)throw error;
  root.querySelector('form').reset();
  await load();
 }catch(error){msg('新增失敗：'+(error.code==='23505'?'此廠商已追蹤':error.message));}
 finally{button.disabled=false;}
}
async function exportPipeline(){
 if(!(await auth()))return;
 const button=root.querySelector('[data-export-pipeline]');button.disabled=true;msg('正在讀取自己的投標追蹤紀錄…');
 try{
  const {data,error}=await db.from('ti_saved_cases').select('case_id,title,agency,stage,internal_deadline,added_at,notes').eq('user_id',user.id).order('added_at',{ascending:false}).limit(1500);
  if(error)throw error;
  const escape=v=>{const s=String(v??'').replace(/^[=+@-]/,m=>"'"+m);return '"'+s.replace(/"/g,'""')+'"';};
  const lines=[['案件ID','案件名稱','機關','階段','內部期限','加入追蹤時間','備註'],...(data||[]).map(r=>[r.case_id,r.title,r.agency,r.stage,r.internal_deadline,r.added_at,r.notes])];
  const csv='\uFEFF'+lines.map(r=>r.map(escape).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='我的投標案件_'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  msg('已產生 '+(data?.length||0)+' 筆自己的投標紀錄 CSV。只包含已保存資料。');
 }catch(x){msg('報表失敗：'+x.message)}finally{button.disabled=false;}
}
function init(){
 const section=document.getElementById('view-alerts');if(!section)return;
 root=e('section','','panel analysis-panel ti-tracker-module');
 const title=e('h2','競爭廠商追蹤與我的報表');
 const help=e('p','指定廠商後可查詢其公開採購紀錄；目前先提供私人追蹤名單，尚未宣稱自動通知已送達。','minor');
 const form=document.createElement('form');form.className='inline-form';
 const name=document.createElement('input');name.name='competitorName';name.required=true;name.maxLength=180;name.placeholder='廠商名稱';
 const tax=document.createElement('input');tax.name='competitorTaxId';tax.maxLength=8;tax.placeholder='統編（選填）';tax.inputMode='numeric';
 const submitButton=e('button','新增監控','primary-btn');submitButton.type='submit';form.append(name,tax,submitButton);
 const list=e('div','','ti-case-list');list.dataset.watchList='1';
 const exportButton=e('button','匯出我的投標紀錄 CSV','ghost-btn');exportButton.type='button';exportButton.dataset.exportPipeline='1';
 const status=e('p','登入後可以使用。','minor');status.dataset.watchStatus='1';
 root.append(title,help,form,list,exportButton,status);
 const anchor=section.querySelector('.page-heading');anchor?.insertAdjacentElement('afterend',root);
 form.addEventListener('submit',ev=>void saveWatch(ev).catch(error=>msg('新增監控失敗：'+String(error?.message||error))));exportButton.addEventListener('click',()=>void exportPipeline());
 document.addEventListener('ti:view-changed',event=>{if(event.detail?.view==='alerts')void load();});
 getClient().then(client=>client.auth.onAuthStateChange(()=>{if(!section.hidden)void load();})).catch(()=>{});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
