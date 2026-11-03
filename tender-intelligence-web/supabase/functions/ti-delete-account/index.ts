// @ts-nocheck -- Runtime Deno code; calls real Auth/Storage APIs.
// PRD U11: authenticated self-service account deletion, never administrator-wide deletion.
// Reject deletion while the account owns a workspace: transfer or delete it explicitly first.
// Remove private Storage objects using Storage API BEFORE auth admin deletion.
const SUPA=Deno.env.get("SUPABASE_URL")||"";
const SECRET=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PUB=Deno.env.get("SUPABASE_ANON_KEY")||
 Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"sb_publishable_L09XC4Tekm6cZaPTTczm3g_Aap-SOSy";
const ORIGINS=new Set(["https://hub-google.github.io","http://localhost:8000","http://127.0.0.1:8000"]);
const cors=o=>ORIGINS.has(o)?o:"https://hub-google.github.io";
const respond=(data,status,origin)=>Response.json(data,{status,headers:{
 "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"}});
const h={apikey:SECRET,Authorization:"Bearer "+SECRET,"Content-Type":"application/json"};
async function read(path){
 const r=await fetch(SUPA+"/rest/v1/"+path,{headers:h,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error("資料庫讀取失敗 HTTP "+r.status);
 return r.json();
}
async function storageList(uid){
 const r=await fetch(SUPA+"/storage/v1/object/list/ti-private-documents",{
  method:"POST",headers:h,body:JSON.stringify({prefix:uid+"/",limit:1000,offset:0}),
  signal:AbortSignal.timeout(18000)
 });
 if(!r.ok)throw Error("私有檔案列表讀取失敗 HTTP "+r.status);
 const arr=await r.json();if(!Array.isArray(arr))throw Error("私有檔案列表格式錯誤");
 if(arr.length>=1000)throw Error("私有檔案過多；請先自行刪除部分文件，再重試");
 return arr.filter(o=>o.id&&o.name).map(o=>uid+"/"+o.name);
}
async function removeObject(path){
 const fullPath=path.split("/").map(encodeURIComponent).join("/");
 const r=await fetch(SUPA+"/storage/v1/object/ti-private-documents/"+fullPath,{
  method:"DELETE",headers:h,signal:AbortSignal.timeout(18000)
 });
 if(!r.ok&&r.status!==404)throw Error("私有檔案刪除失敗 HTTP "+r.status);
}
Deno.serve(async req=>{
 const origin=cors(req.headers.get("Origin")||"");
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"}});
 if(req.method!=="POST")return respond({error:"POST only"},405,origin);
 const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
 if(jwt.length<40)return respond({error:"請先登入"},401,origin);
 const who=await fetch(SUPA+"/auth/v1/user",{
  headers:{apikey:PUB,Authorization:"Bearer "+jwt},signal:AbortSignal.timeout(15000)
 }).catch(()=>null);
 if(!who?.ok)return respond({error:"帳戶身份確認失敗，請重新登入"},401,origin);
 const user=await who.json();
 if(!user?.id||!user?.email)return respond({error:"無法驗證目前帳戶"},401,origin);
 let body;try{body=await req.json()}catch{return respond({error:"請提供 JSON"},400,origin)}
 if(body.confirm!=="刪除我的帳戶" ||
    String(body.email||"").toLowerCase().trim()!==String(user.email).toLowerCase()){
   return respond({error:"需要輸入目前帳戶完整 Email 及「刪除我的帳戶」以再次確認"},400,origin);
 }
 try{
  // Prevent unintended loss of other team members' shared workspaces.
  const owned=await read("ti_workspaces?select=id&owner_id=eq."+user.id+"&limit=1");
  if(owned.length)return respond({
    error:"帳戶尚擁有公司工作區。請先在團隊協作轉讓擁有者或確認刪除工作區，才能刪除個人帳號。"
  },409,origin);
  const rows=await read("ti_documents?select=storage_path&user_id=eq."+user.id+"&limit=1000");
  if(rows.length>=1000)return respond({error:"私人文件過多，請先刪減"},409,origin);
  const known=rows.map(x=>x.storage_path).filter(x=>x?.startsWith(user.id+"/"));
  const listed=await storageList(user.id);
  const all=[...new Set([...known,...listed])];
  if(all.length>1000)return respond({error:"私人文件過多，請先刪減"},409,origin);
  // Do not delete an account if any owned storage object fails to be cleaned up.
  for(const name of all)await removeObject(name);
  // Cascading FKs clear personal records; shared actor references are SET NULL.
  const url=SUPA+"/auth/v1/admin/users/"+encodeURIComponent(user.id);
  const del=await fetch(url,{method:"DELETE",headers:h,signal:AbortSignal.timeout(20000)});
  if(!del.ok)throw Error("身份資料刪除未完成（HTTP "+del.status+"），請重試");
  return respond({ok:true,deleted_files:all.length,
    message:"Auth 帳號已從專案刪除，資料表個人紀錄依 FK 連動刪除"},200,origin);
 }catch(e){
  return respond({error:String(e).slice(0,220)},502,origin);
 }
});
