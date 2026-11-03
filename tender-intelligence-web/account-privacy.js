// PRD U11: explicit account deletion. No request is made without submit and confirmation.
import {getClient,DATABASE_URL,PUBLISHABLE_KEY} from './backend.js';
const $=id=>document.getElementById(id);
let client=null,user=null;
function status(text){$('accountDeleteStatus').textContent=text;}
function error(e){return String(e?.message||e||'未知錯誤').slice(0,250);}
function toggle(next){
 user=next||null;
 $('accountDeleteForm').hidden=!user||user.is_anonymous===true;
 $('accountDeleteEmail').value='';
 $('accountDeletePhrase').value='';
 status(user?'此操作將永久移除你自己的帳戶及私有文件。':'');
}
async function removeAccount(e){
 e.preventDefault();
 if(!user)return status('請先登入帳戶。');
 const email=$('accountDeleteEmail').value.trim(),
   confirmPhrase=$('accountDeletePhrase').value.trim();
 if(email.toLowerCase()!==String(user.email||'').toLowerCase()||confirmPhrase!=='刪除我的帳戶'){
  return status('目前信箱及完整確認語句不符，沒有執行刪除。');
 }
 if(!window.confirm('最後確認：永久刪除目前登入的標案會員帳戶、私人文件和設定，且不可復原？')){
  return status('已取消，未刪除任何資料。');
 }
 const submit=$('accountDeleteSubmit');submit.disabled=true;
 try{
  const {data:{session},error:sessionError}=await client.auth.getSession();
  if(sessionError||!session?.access_token)throw Error('登入驗證已過期，請重新登入。');
  status('正在核對所屬工作區並清除私人雲端資料…');
  const r=await fetch(DATABASE_URL+'/functions/v1/ti-delete-account',{
   method:'POST',headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY,
    Authorization:'Bearer '+session.access_token},
   body:JSON.stringify({email,confirm:confirmPhrase}),signal:AbortSignal.timeout(95000)
  });
  const result=await r.json().catch(()=>({error:'刪除服務返回了無效格式'}));
  if(!r.ok||!result.ok)throw Error(result.error||'帳號刪除未完成');
  status('帳戶已刪除；私人檔案處理數量：'+result.deleted_files);
  try{await client.auth.signOut()}catch{}
  localStorage.removeItem('opendata-tender-v2');
  window.location.assign(window.location.origin+window.location.pathname);
 }catch(e){
  status('刪除未完成：'+error(e)+'。若你擁有公司工作區，請先在「團隊協作」轉移或刪除工作區。');
 }finally{submit.disabled=false;}
}
async function init(){
 $('accountDeleteForm').addEventListener('submit',e=>void removeAccount(e));
 client=await getClient();
 const {data,error}=await client.auth.getSession();if(error)throw error;
 toggle(data?.session?.user||null);
 client.auth.onAuthStateChange((_event,session)=>toggle(session?.user||null));
}
init().catch(e=>status('帳戶隱私功能初始化失敗：'+error(e)));
