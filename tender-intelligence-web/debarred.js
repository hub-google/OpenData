// PRD F18 official debarred-notice search. No inference of current debarment.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const item=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=String(text);if(cls)e.className=cls;return e};
let client;
function status(text){$('debarredStatus').textContent=text;}
async function sourceStatus(){
 try{
  client=client||await getClient();
  const [run,count]=await Promise.all([
    client.from('ti_external_source_runs').select('*')
      .eq('source_id','official-pcc-debarred-5988')
      .order('started_at',{ascending:false}).limit(1).maybeSingle(),
    client.from('ti_debarred_vendor_notices').select('id',{head:true,count:'exact'})
  ]);
  if(run.error)throw run.error;if(count.error)throw count.error;
  const d=run.data;
  status('來源：政府資料開放平臺第 5988 號（行政院公共工程委員會，公告每日更新）；'+
    '實際已入庫 '+Number(count.count||0).toLocaleString('zh-TW')+' 筆官方公開紀錄。'+
    (d?'最近一次同步：'+(d.status==='success'?'成功':d.status==='error'?'失敗':'執行中')+
    '，'+new Date(d.started_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+
    (d.error_summary?'；官方來源錯誤：'+d.error_summary:''):'尚無任何成功同步紀錄。')+
    ' 所列資料不保證為目前最新有效之拒絕往來狀態。');
 }catch(e){status('資料來源狀態無法讀取：'+String(e.message||e));}
}
async function search(e){
 e?.preventDefault();
 const query=$('debarredKeyword').value.trim(),out=$('debarredResults');
 if(query.length<2)return status('請至少輸入兩個字，或輸入完整廠商代碼。');
 out.replaceChildren(item('p','正在查詢已保存的官方公告…','minor'));
 try{
  client=client||await getClient();
  const numerical=/^\d{8}$/.test(query);
  const req=client.from('ti_debarred_vendor_notices')
   .select('company_name,company_number,case_number,case_name,agency_name,legal_clause,effective_date,expiration_date,announcement_date,appeal_result,source_url,fetched_at',{count:'exact'})
   .order('announcement_date',{ascending:false,nullsFirst:false}).limit(50);
  const {data,count,error}=await(numerical?req.eq('company_number',query):
    req.ilike('company_name','%'+query.replace(/[%_]/g,'\\$&')+'%'));
  if(error)throw error;
  out.replaceChildren();
  if(!data?.length){out.append(item('p','已入庫的官方公告沒有符合項目；不代表該公司沒有其他官方歷史公告。','empty'));return;}
  for(const row of data){
   const card=item('article','','case-card');
   const left=item('div','','case-left');
   left.append(item('h3',row.company_name||'名稱未公開'));
   left.append(item('p','廠商代碼：'+(row.company_number||'未公開')+
     '｜標案案號：'+(row.case_number||'未公開'),'minor'));
   if(row.case_name)left.append(item('p','標案：'+row.case_name));
   left.append(item('p','刊登機關：'+(row.agency_name||'未公開')+
     '｜依據條款：'+(row.legal_clause||'未公開'),'minor'));
   left.append(item('p','原公告日：'+(row.announcement_date||'未公開')+
     '｜生效日：'+(row.effective_date||'未公開')+
     '｜截止日：'+(row.expiration_date||'未公開'),'minor'));
   left.append(item('p','異議／申訴結果：'+(row.appeal_result||'來源未揭露，應另查官方'),'minor'));
   const right=item('div','','case-right');
   const link=item('a','官方資料集');link.href=row.source_url||'https://data.gov.tw/dataset/5988';
   link.rel='noopener noreferrer';link.target='_blank';link.className='ghost-btn';
   right.append(link);
   card.append(left,right);out.append(card);
  }
  status('查到 '+Number(count||0)+' 筆符合的已保存官方公告；本頁最多顯示 50 筆，請以政府電子採購網最新公告核實有效狀態。');
 }catch(e){out.replaceChildren(item('p','官方公告查詢失敗：'+String(e.message||e),'notice danger'));}
}
function init(){
 $('debarredSearchForm').addEventListener('submit',e=>void search(e));
 $('debarredRefresh').addEventListener('click',()=>void sourceStatus());
 document.querySelector('[data-view="debarred"]')?.addEventListener('click',()=>void sourceStatus());
 void sourceStatus();
}
init();
