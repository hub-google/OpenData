// PRD 9 / 12: display recorded source rights, sync health and completeness.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const node=(tag,message,cls='')=>{const n=document.createElement(tag);n.textContent=String(message??'');if(cls)n.className=cls;return n;};
const num=value=>Number(value||0).toLocaleString('zh-TW');
const when=value=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚無成功紀錄';
async function refresh(){
 const q=$('qualityCheckStatus'),sources=$('qualitySources');
 if(!q||!sources)return;
 q.textContent='正在讀取最新來源資料品質核對紀錄…';
 try{
  const client=await getClient();
  const [checks,registry,liveKpis]=await Promise.all([
   client.from('ti_data_quality_checks').select('*').order('report_date',{ascending:false}).limit(1),
   client.from('ti_sources').select('id,provider,source_url,method,frequency_minutes,commercial_license_status,last_success_at,last_error_at,last_error,data_scope,can_store_raw,can_redistribute_api,license_terms_url').order('id'),
   client.rpc('ti_home_kpis')
  ]);
  if(checks.error)throw checks.error;
  if(registry.error)throw registry.error;
  if(liveKpis.error)throw liveKpis.error;
  const x=checks.data?.[0], live=liveKpis.data||{};
  q.replaceChildren();
  if(!x){q.append(node('p','目前尚未執行每日資料品質核對；這不代表資料正常。'));}else{
   const state={normal:'已通過當次基本檢查',review:'有來源缺口或波動，需核對',source_stale:'來源最近成功同步超過三小時'}[x.status]||x.status;
   q.append(node('strong',x.report_date+'｜'+state));
   q.append(node('p','案件 '+num(x.case_count)+' 件／公告 '+num(x.notice_count)+
    ' 筆／已有詳情 '+num(x.detail_count)+' 件／已確認未截止 '+num(x.open_deadline_count)+' 件'));
   q.append(node('p','預算未知 '+num(x.budget_unknown_count)+' 件／版本不一致 '+num(x.version_mismatch_count)+
    ' 件／未補齊來源日期 '+num(x.unresolved_gap_count)+' 天'));
   q.append(node('p','來源最近成功同步：'+when(live.last_success_at||x.last_source_success_at)+'｜稽核時間：'+when(x.checked_at)));
   if(Number(live.unresolved_source_dates||0)>0){
    q.append(node('p','來源尚未核實 '+num(live.unresolved_source_dates)+' 天，其中落在週末或政府預期休刊日 '+num(live.calendar_unverified_source_dates)+' 天、一般工作日 '+num(live.workday_unverified_source_dates)+' 天。這只是日曆分類，來源 HTTP 500 不代表零公告。'));
   }
   const latest=live.last_success_at?new Date(live.last_success_at):null;
   if(!latest||Date.now()-latest.getTime()>3*3600000){
    q.append(node('p','注意：來源已超過三小時未成功同步，請勿以資料庫內容代替最新官方公告。','notice warning'));
   }
   if(x.prior_day_deviation!=null)q.append(node('p','前兩日公告量變動比：'+
    (Number(x.prior_day_deviation)*100).toFixed(1)+'%（只是數量差，不能直接判定資料錯誤）'));
   if(x.notes)q.append(node('p','需複核：'+x.notes));
  }
  sources.replaceChildren();
  if(!registry.data?.length){sources.append(node('p','資料來源登記目前無資料。','minor'));return;}
  for(const item of registry.data){
   const box=node('div','','timeline-item'),heading=node('strong',item.provider+'（'+item.id+'）');
   box.append(heading,node('p','更新頻率設定：'+item.frequency_minutes+' 分鐘｜'+(item.method||'來源方式未定')+
    '｜最近成功：'+when(item.last_success_at),'minor'));
   box.append(node('p','來源範圍：'+(item.data_scope||'尚待確認'),'minor'));
   const rights={allowed:'已確認允許',unknown:'尚未確認',prohibited:'禁止'};
   box.append(node('p','商用再利用：'+(item.commercial_license_status||'待確認')+
    '｜原始內容保存：'+(rights[item.can_store_raw]||'待確認')+
    '｜第三方 API 轉供：'+(rights[item.can_redistribute_api]||'待確認'),'minor'));
   if(item.last_error_at)box.append(node('p','最近來源錯誤：'+when(item.last_error_at)+'｜'+(item.last_error||'未知'),'minor'));
   if(/^https:\/\//.test(item.source_url||'')){
    const a=document.createElement('a');a.href=item.source_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='開啟原始來源';box.append(a);
   }
   sources.append(box);
  }
 }catch(e){q.replaceChildren(node('p','讀取品質紀錄失敗：'+String(e.message||e)));sources.replaceChildren();}
}
document.querySelector('[data-view="about"]').addEventListener('click',()=>void refresh());
void refresh();
