// Secure LINE Login account-linking for the tender notification service.
// Requires TI_LINE_LOGIN_CHANNEL_ID and TI_LINE_LOGIN_CHANNEL_SECRET in Supabase Secrets.
// LINE Login and Messaging API channels MUST belong to the SAME LINE provider.
const BASE=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PUBLIC=Deno.env.get("SUPABASE_ANON_KEY")||"sb_publishable_L09XC4Tekm6cZaPTTczm3g_Aap-SOSy";
const CHANNEL=Deno.env.get("TI_LINE_LOGIN_CHANNEL_ID")||"";
const SECRET=Deno.env.get("TI_LINE_LOGIN_CHANNEL_SECRET")||"";
const CALLBACK=BASE+"/functions/v1/ti-line-connect";
const RETURN="https://hub-google.github.io/OpenData/tender-intelligence-web/";
const CORS={"Access-Control-Allow-Origin":"https://hub-google.github.io",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS"};
const H={apikey:SERVICE,Authorization:"Bearer "+SERVICE,"Content-Type":"application/json"};
const json=(body,status=200)=>Response.json(body,{status,headers:{...CORS,"Cache-Control":"no-store"}});
const digest=async str=>{
 const data=new TextEncoder().encode(str);
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data))).map(x=>x.toString(16).padStart(2,"0")).join("");
};
async function db(route,method="GET",body=null,prefer=""){
 const headers={...H};if(prefer)headers.Prefer=prefer;
 const r=await fetch(BASE+"/rest/v1/"+route,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(16000)});
 if(!r.ok)throw Error("DB "+r.status);
 const v=await r.text();return v?JSON.parse(v):null;
}
const go=status=>Response.redirect(RETURN+"?line="+status,302);
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(!BASE||!SERVICE)return json({error:"伺服器尚未設定"},503);
 if(!CHANNEL||!SECRET)return json({error:"LINE Login 尚未配置此標案專案的專屬頻道資訊"},503);
 if(req.method==="POST"){
  const bearer=req.headers.get("Authorization")||"";
  if(!bearer.startsWith("Bearer "))return json({error:"請先登入標案帳戶"},401);
  const who=await fetch(BASE+"/auth/v1/user",{headers:{apikey:PUBLIC,Authorization:bearer},signal:AbortSignal.timeout(12000)}).catch(()=>null);
  if(!who?.ok)return json({error:"登入已失效"},401);
  const user=await who.json();
  if(!user?.id)return json({error:"無法驗證登入者"},401);
  const nonce=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
  const state=nonce.slice(0,56),hash=await digest(state);
  const expires=new Date(Date.now()+10*60*1000).toISOString();
  await db("ti_line_oauth_state","POST",[{state_hash:hash,user_id:user.id,expires_at:expires}],"return=minimal");
  const u=new URL("https://access.line.me/oauth2/v2.1/authorize");
  u.searchParams.set("response_type","code");
  u.searchParams.set("client_id",CHANNEL);
  u.searchParams.set("redirect_uri",CALLBACK);
  u.searchParams.set("state",state);
  u.searchParams.set("scope","profile");
  return json({url:u.href,callback:CALLBACK});
 }
 if(req.method==="GET"){
  const q=new URL(req.url).searchParams,code=q.get("code")||"",state=q.get("state")||"";
  if(q.get("error"))return go("cancelled");
  if(!/^[0-9a-f]{56}$/i.test(state)||code.length<8||code.length>2048)return go("error");
  try{
   const hash=await digest(state);
   const rows=await db("ti_line_oauth_state?state_hash=eq."+hash+"&redeemed_at=is.null&expires_at=gt."+encodeURIComponent(new Date().toISOString())+"&select=user_id","PATCH",
      {redeemed_at:new Date().toISOString()},"return=representation");
   if(!Array.isArray(rows)||rows.length!==1)return go("expired");
   const user=rows[0].user_id;
   const payload=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:CALLBACK,client_id:CHANNEL,client_secret:SECRET});
   const tokenRes=await fetch("https://api.line.me/oauth2/v2.1/token",{
     method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
     body:payload.toString(),signal:AbortSignal.timeout(15000)
   });
   if(!tokenRes.ok)return go("error");
   const token=await tokenRes.json();
   if(!token.access_token)return go("error");
   const profileRes=await fetch("https://api.line.me/v2/profile",{
      headers:{"Authorization":"Bearer "+token.access_token},signal:AbortSignal.timeout(12000)
   });
   if(!profileRes.ok)return go("error");
   const profile=await profileRes.json();
   if(!/^U[0-9a-f]{32}$/i.test(profile.userId||""))return go("error");
   await db("ti_line_links?on_conflict=user_id","POST",[{user_id:user,line_user_id:profile.userId}],
    "resolution=merge-duplicates,return=minimal");
   return go("connected");
  }catch(e){console.error("LINE bind failed",String(e).slice(0,150));return go("error")}
 }
 return json({error:"unsupported method"},405);
});
