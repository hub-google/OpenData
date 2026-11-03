// Public one-click Email unsubscribe endpoint. Opaque random tokens, never auth credentials.
// GET displays a confirmation to prevent email scanners from cancelling subscriptions.
// POST from RFC 8058 clients or the confirmation form disables Email only.
const URL=Deno.env.get("SUPABASE_URL")||"";
const ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const headers={apikey:ROLE,Authorization:"Bearer "+ROLE,"Content-Type":"application/json"};
function html(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
Deno.serve(async req=>{
 const url=new URL(req.url),token=url.searchParams.get("token")||"";
 const valid=/^[0-9a-f]{64}$/.test(token);
 const page=(message,status=200,button=false)=>{
  const form=button?'<form method="POST"><button type="submit" style="padding:12px 24px;font-size:1.05rem">確認停止 Email 通知</button></form>':'';
  return new Response('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>政府標案 Email 退訂</title>'+
    '<main style="max-width:560px;margin:12vh auto;padding:24px;font-family:system-ui;line-height:1.7">'+
    '<h1>政府標案 Email 通知</h1><p>'+html(message)+'</p>'+form+
    '<p><a href="https://hub-google.github.io/OpenData/tender-intelligence-web/">回標案情報中心</a></p></main></html>',{
    status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
   });
 };
 if(!valid)return page("退訂網址格式不正確或已經失效。",400);
 if(req.method==="GET")return page("請確認是否要停止這個帳戶後續收到的政府標案 Email 通知。站內通知與 LINE 設定不受影響。",200,true);
 if(req.method!=="POST")return page("只支援 POST 退訂。",405);
 try{
  const r=await fetch(URL+"/rest/v1/rpc/ti_unsubscribe_email",{
   method:"POST",headers,body:JSON.stringify({token}),signal:AbortSignal.timeout(15000)
  });
  if(!r.ok)return page("暫時無法退訂。請登入標案網站關閉 Email 通知。",502);
  const ok=await r.json();
  return ok===true?page("已成功停止此帳戶的後續 Email 標案通知。",200):
    page("此連結已失效。請登入標案網站管理通知設定。",400);
 }catch{return page("暫時無法退訂。請登入標案網站關閉 Email 通知。",502)}
});
