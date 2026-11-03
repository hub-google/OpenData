// Notification preferences and LINE binding. Independent of the tender UI.
import {DATABASE_URL,PUBLISHABLE_KEY,getClient} from './backend.js';
const $=id=>document.getElementById(id);
const msg=text=>{if($('deliveryStatus'))$('deliveryStatus').textContent=text;};
let db=null,user=null,configured=null;
const errors=e=>String(e?.message||e||'未知錯誤').slice(0,240);
async function readiness(){
 const r=await fetch(DATABASE_URL+'/functions/v1/ti-service-status',{cache:'no-store'});
 if(!r.ok)throw Error('無法取得服務設定狀態 '+r.status);
 return r.json();
}
async function load(){
 if(!db||!user){msg('請先登入才能設定通知。');return;}
 try{
  const [prefs,link]=await Promise.all([
   db.from('ti_delivery_settings').select('*').eq('user_id',user.id).maybeSingle(),
   db.from('ti_line_links').select('linked_at').eq('user_id',user.id).maybeSingle()
  ]);
  if(prefs.error)throw prefs.error;if(link.error)throw link.error;
  const p=prefs.data||{};
  $('emailToggle').checked=!!p.email_enabled;
  $('lineToggle').checked=!!p.line_enabled;
  $('digestToggle').checked=p.daily_digest!==false;
  const connected=!!link.data;
  configured=await readiness();
  const emailStatus=configured.email_ready?(p.email_enabled?'使用者已同意，服務已配置（仍須實測寄達）':'服務已配置，尚未同意接收'):
   '此專案尚未配置 Email 發送服務（不會寄信）';
  const lineStatus=connected?'已綁定 LINE':'尚未綁定 LINE';
  const lineService=configured.line_login_ready&&configured.line_push_ready?'頻道設定已配置（仍須實測推播）':
   'LINE 專案金鑰未完整配置（不會推播）';
  msg('Email：'+emailStatus+'｜LINE：'+lineStatus+'，'+lineService+
    '｜AI 文件模型：'+(configured.ai_ready?'已有金鑰，需測試推論':'沒有設定模型金鑰'));
 }catch(e){msg('讀取通知設定失敗：'+errors(e));}
}
async function startLogin(){
 if(!user){msg('請先登入標案帳戶，才能綁定 LINE。');return;}
 try{
  const {data:{session},error}=await db.auth.getSession();
  if(error||!session?.access_token)throw Error('登入狀態失效');
  const r=await fetch(DATABASE_URL+'/functions/v1/ti-line-connect',{
    method:'POST',headers:{'Content-Type':'application/json',
      Authorization:'Bearer '+session.access_token,apikey:PUBLISHABLE_KEY},
    body:'{}'
  });
  const out=await r.json();
  if(!r.ok||!out.url)throw Error(out.error||'無法產生 LINE 授權連結');
  window.location.assign(out.url);
 }catch(e){msg('LINE 綁定無法啟動：'+errors(e));}
}
async function save(){
 if(!user){msg('請先登入帳戶。');return;}
 const record={user_id:user.id,email_enabled:$('emailToggle').checked,
    line_enabled:$('lineToggle').checked,daily_digest:$('digestToggle').checked,
    updated_at:new Date().toISOString()};
 try{
  if(record.line_enabled){
   const {data,error}=await db.from('ti_line_links').select('user_id').eq('user_id',user.id).maybeSingle();
   if(error)throw error;
   if(!data)throw Error('LINE 尚未完成綁定，不能啟用推播。');
  }
  const {error}=await db.from('ti_delivery_settings').upsert(record,{onConflict:'user_id'});
  if(error)throw error;
  await load();
  msg($('deliveryStatus').textContent+'｜通知偏好已保存。');
 }catch(e){msg('儲存通知失敗：'+errors(e));}
}
async function unlink(){
 if(!user)return msg('請先登入。');
 try{
  const {error:remove}=await db.from('ti_line_links').delete().eq('user_id',user.id);
  if(remove)throw remove;
  const {error:edit}=await db.from('ti_delivery_settings').upsert({
   user_id:user.id,line_enabled:false,updated_at:new Date().toISOString()
  },{onConflict:'user_id'});
  if(edit)throw edit;
  await load();msg($('deliveryStatus').textContent+'｜LINE 已解除綁定。');
 }catch(e){msg('解除綁定失敗：'+errors(e));}
}
async function init(){
 $('saveDelivery').addEventListener('click',()=>void save());
 $('connectLine').addEventListener('click',()=>void startLogin());
 $('unlinkLine').addEventListener('click',()=>void unlink());
 const query=new URL(window.location.href),line=query.searchParams.get('line');
 if(line){
  query.searchParams.delete('line');
  window.history.replaceState(null,'',query.pathname+query.search+query.hash);
  $('deliveryStatus').textContent=line==='connected'?'LINE 已完成身份綁定。請加入本平台的 LINE OA 好友後再開啟推播。':
   line==='cancelled'?'LINE 登入已取消。':'LINE 登入失敗或連結已過期，請重新操作。';
 }
 db=await getClient();
 const {data}=await db.auth.getSession();
 user=data?.session?.user||null;
 db.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;setTimeout(()=>void load(),0);});
 await load();
}
init().catch(e=>msg('通知模組載入失敗：'+errors(e)));
