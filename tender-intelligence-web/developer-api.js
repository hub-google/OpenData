// Personal API token issuance: 256-bit browser-generated secret, SHA-256 hash stored in RLS table.
// Plaintext appears once in memory only; never put secrets in URL/localStorage.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
let db=null,currentUser=null,lastUid='';
const label=(tag,value,cls='')=>{const e=document.createElement(tag);e.textContent=String(value??'');if(cls)e.className=cls;return e;};
function message(m){$('devStatus').textContent=m;}
async function sync(){
 db=db||await getClient();
 const {data,error}=await db.auth.getUser();if(error)throw error;
 const who=data?.user||null;
 if(lastUid!==who?.id){
  $('devSecretContainer').hidden=true;$('devSecret').value='';
  lastUid=who?.id||'';
 }
 currentUser=who;
 const out=$('devKeys');out.replaceChildren();
 if(!who){message('請先登入標案會員，才能管理 API 金鑰。');return;}
 const {data:keys,error:e}=await db.from('ti_api_keys')
  .select('id,name,token_prefix,created_at,expires_at,last_used_at,daily_requests,quota_day,total_requests,revoked_at')
  .eq('user_id',who.id).is('revoked_at',null).order('created_at',{ascending:false}).limit(10);
 if(e)throw e;
 message('已登入：'+(who.email||'會員')+'｜金鑰僅可存取你自己的收藏與待辦；沒有任何全國標案批次輸出權限。');
 if(!keys?.length){out.append(label('div','目前沒有有效金鑰。','empty'));return;}
 for(const key of keys){
  const wrap=label('div','','watch-item'),row=label('header','');
  row.append(label('strong',key.name+'（'+key.token_prefix+'…）'));
  const revoke=label('button','永久撤銷','ghost-btn');revoke.type='button';
  revoke.addEventListener('click',async()=>{
   if(!confirm('確定撤銷「'+key.name+'」？所有使用這把金鑰的程式將立即失效。'))return;
   revoke.disabled=true;
   const {error:d}=await db.from('ti_api_keys').delete().eq('id',key.id).eq('user_id',currentUser?.id);
   if(d){message('撤銷失敗：'+d.message);revoke.disabled=false;return;}
   $('devSecretContainer').hidden=true;$('devSecret').value='';
   await sync();
  });row.append(revoke);wrap.append(row);
  const expires=new Date(key.expires_at).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'});
  const used=key.last_used_at?new Date(key.last_used_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未使用';
  wrap.append(label('p','到期：'+expires+'｜累計請求：'+(key.total_requests||0)+
   '｜最近使用：'+used+'｜當日使用：'+(key.daily_requests||0),'minor'));
  out.append(wrap);
 }
}
async function create(e){
 e.preventDefault();
 const name=$('devKeyName').value.trim();
 if(name.length<2||name.length>80){message('用途名稱必須是 2 至 80 字。');return;}
 const button=$('devCreateButton');button.disabled=true;
 try{
  if(!currentUser)throw Error('請先登入標案會員');
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token='ti_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),
    b=>b.toString(16).padStart(2,'0')).join('');
  const {error}=await db.from('ti_api_keys').insert({
   user_id:currentUser.id,name,token_hash:digest,token_prefix:token.slice(0,11)
  });
  if(error)throw error;
  $('devSecret').value=token;$('devSecretContainer').hidden=false;
  $('devKeyName').value='';
  await sync();
  // sync does not erase the new token while the owner stays logged in.
  message('金鑰已建立。完整字串僅這次顯示，請保存在你自己安全的密碼管理器。');
 }catch(ex){message('金鑰建立失敗：'+String(ex.message||ex));}
 finally{button.disabled=false;}
}
$('devCreateForm').addEventListener('submit',e=>void create(e));
$('devCopySecret').addEventListener('click',async()=>{
 try{if(!$('devSecret').value)throw Error('沒有可以複製的金鑰');
  await navigator.clipboard.writeText($('devSecret').value);
  message('已複製完整金鑰。不要貼到 GitHub 公開檔案。');
 }catch(ex){message('無法自動複製：'+String(ex.message||ex));}
});
document.querySelector('[data-view="developer"]').addEventListener('click',()=>void sync().catch(e=>message('無法載入個人 API 管理：'+String(e.message||e))));
(async()=>{
 db=await getClient();
 db.auth.onAuthStateChange(()=>{setTimeout(()=>void sync().catch(e=>message(String(e.message||e))),0)});
})().catch(e=>message(String(e.message||e)));
