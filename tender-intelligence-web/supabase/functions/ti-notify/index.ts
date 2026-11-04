// @ts-nocheck -- Runtime Deno parser check; strict typing to be completed separately.
// Supabase ti-notify: scheduled outbound Email and LINE transport.
// No fake success: provider credentials must exist as Supabase Secrets.
// Dedicated to the tender project; never use LINE channels from unrelated apps.
const URL=Deno.env.get("SUPABASE_URL")||"";
const ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const RESEND=Deno.env.get("RESEND_API_KEY")||"";
const EMAIL_FROM=Deno.env.get("TI_EMAIL_FROM")||"";
const LINE_ACCESS=Deno.env.get("TI_LINE_CHANNEL_ACCESS_TOKEN")||"";
const TENDER="https://hub-google.github.io/OpenData/tender-intelligence-web/";
const h={apikey:ROLE,Authorization:"Bearer "+ROLE,"Content-Type":"application/json"};
const scrub=v=>String(v??"").replace(/[\r\n]+/g," ").slice(0,550);
const html=s=>scrub(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
async function rpc(name,body){
  const r=await fetch(URL+"/rest/v1/rpc/"+name,{method:"POST",headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error("database "+name+" HTTP "+r.status);
  return await r.json();
}
async function rest(path){
  const r=await fetch(URL+"/rest/v1/"+path,{headers:h,signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error("database read HTTP "+r.status);
  return r.json();
}
function link(r){
  const [unit,...job]=String(r.case_id||"").split("::");
  if(unit&&job.length)return TENDER+"?"+new URLSearchParams({case_unit:unit,case_no:job.join("::")});
  return TENDER;
}
async function deterministicKey(prefix,value){
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prefix+value)));
 return Array.from(digest.slice(0,16)).map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function lineRetryUuid(notificationId){
 const d=new Uint8Array(await crypto.subtle.digest('SHA-256',
   new TextEncoder().encode('ti-line:'+String(notificationId))));
 const b=d.slice(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;
 const h=Array.from(b).map(v=>v.toString(16).padStart(2,'0')).join('');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
async function sendEmail(recipient,events,digest,userId,batchId=''){
  const token=await rpc("ti_issue_unsubscribe_token",{target_user:userId});
  if(!/^[0-9a-f]{64}$/.test(token||""))throw Error("unsubscribe token unavailable");
  const unsubscribeURL=URL+"/functions/v1/ti-unsubscribe?token="+token;
  const lines=events.slice(0,20).map(r=>'<li><b>'+html(r.reason)+'</b> '+html(r.subject)+
  '<br>'+html(r.agency)+' ／ 案號 '+html(r.job_number)+
  '<br><a href="'+link(r)+'">開啟標案搜尋</a></li>').join("");
  const subject=digest?'政府標案每日摘要｜'+events.length+' 筆符合監控':
    '政府標案更新｜'+events.length+' 筆新公告';
  const r=await fetch("https://api.resend.com/emails",{
    method:"POST",headers:{"Authorization":"Bearer "+RESEND,"Content-Type":"application/json",
      "Idempotency-Key":"ti-email-"+await deterministicKey(userId,batchId||events.map(r=>String(r.notification_id)).sort().join(','))},
    body:JSON.stringify({
       from:EMAIL_FROM,to:[recipient],subject,
       headers:{"List-Unsubscribe":"<"+unsubscribeURL+">","List-Unsubscribe-Post":"List-Unsubscribe=One-Click"},
       html:'<h2>政府標案監控</h2><p>以下為你主動訂閱的政府標案資料異動：</p><ul>'+lines+
         '</ul><p>資料來源：政府電子採購網，透過 OpenFun API；請以官方公告為準。</p>'+
         '<p><a href="'+unsubscribeURL+'">一鍵取消 Email 訂閱</a> ｜ <a href="'+TENDER+'">開啟標案平台管理通知</a></p>',
       text:'政府標案監控\n'+events.map(r=>r.reason+' '+r.subject+' '+r.agency+' '+r.job_number+' '+link(r)).join('\n')+
         '\n取消 Email 訂閱：'+unsubscribeURL+'\n通知設定：'+TENDER
    }),signal:AbortSignal.timeout(25000)
  });
  const x=await r.json().catch(()=>({}));
  if(!r.ok)throw Error("Resend "+r.status+" "+scrub(x.message||x.name||"寄送失敗"));
  if(!x.id)throw Error("Email provider did not return message id");
  return x.id;
}
async function sendLine(to,r){
  const message='【政府標案通知】'+scrub(r.reason)+'\n'+scrub(r.subject)+
    '\n'+scrub(r.agency)+'｜'+scrub(r.job_number)+
    '\n'+link(r)+'\n可在標案情報中心關閉推播。';
  const res=await fetch("https://api.line.me/v2/bot/message/push",{
    method:"POST",headers:{"Authorization":"Bearer "+LINE_ACCESS,"Content-Type":"application/json",
      "X-Line-Retry-Key":await lineRetryUuid(r.notification_id)},
    body:JSON.stringify({to,messages:[{type:"text",text:message.slice(0,4000)}]}),
    signal:AbortSignal.timeout(18000)
  });
  // LINE returns 409 for a retry key that was previously accepted: do not resend.
  if(res.status===409&&res.headers.get("x-line-accepted-request-id"))
    return res.headers.get("x-line-accepted-request-id");
  if(!res.ok)throw Error("LINE Messaging API HTTP "+res.status);
  return res.headers.get("x-line-request-id")||"accepted";
}
async function sendLineDigest(to,events,batchId){
  const blocks=events.slice(0,20).map((r,i)=>(i+1)+'. '+scrub(r.subject).slice(0,80)+
    '｜'+scrub(r.reason).slice(0,70)+'\n'+link(r));
  const message=('【政府標案每日摘要】'+events.length+' 筆公告更新\n\n'+blocks.join('\n\n')+
    '\n\n請至標案情報中心管理訂閱。').slice(0,4900);
  const res=await fetch("https://api.line.me/v2/bot/message/push",{
    method:"POST",headers:{"Authorization":"Bearer "+LINE_ACCESS,"Content-Type":"application/json",
      "X-Line-Retry-Key":await lineRetryUuid('daily:'+batchId)},
    body:JSON.stringify({to,messages:[{type:"text",text:message}]}),
    signal:AbortSignal.timeout(18000)
  });
  if(res.status===409&&res.headers.get("x-line-accepted-request-id"))
    return res.headers.get("x-line-accepted-request-id");
  if(!res.ok)throw Error("LINE digest HTTP "+res.status);
  return res.headers.get("x-line-request-id")||"accepted";
}
Deno.serve(async req=>{
  if(req.method!=="POST")return Response.json({error:"POST only"},{status:405});
  if(!URL||!ROLE)return Response.json({error:"server configuration missing"},{status:503});
  const token=req.headers.get("x-ti-cron")||"";
  if(token.length<32)return Response.json({error:"unauthorized"},{status:401});
  try{if(await rpc("ti_verify_ingest_token",{candidate:token})!==true)
    return Response.json({error:"unauthorized"},{status:401});
  }catch{return Response.json({error:"unauthorized"},{status:401});}
  const configured={email:!!RESEND&&!!EMAIL_FROM,line:!!LINE_ACCESS};
  const now=new Date(),taipeiHour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",hour12:false}).format(now));
  let candidates;
  try{candidates=await rpc("ti_claim_deliveries",{
    p_limit:60,p_email_ready:configured.email,p_line_ready:configured.line,p_digest_hour:taipeiHour===8
  });}
  catch(e){return Response.json({error:scrub(e),configured},{status:502});}
  const groupedEmail=new Map(),line=[];
  for(const r of candidates||[]){
    if(r.channel==="email"){
      let list=groupedEmail.get(r.user_id);
      if(!list){list=[];groupedEmail.set(r.user_id,list);}
      list.push(r);
    }else if(r.channel==="line")line.push(r);
  }
  let sent=0,failed=0,skipped=0;
  for(const [user,events] of groupedEmail){
    if(!configured.email){skipped+=events.length;continue;}
    // Immediate mode: one stable provider key per notification; a partial DB failure
    // cannot change the key for the remaining notifications and resend the same email.
    for(const r of events){
      try{
        const provider=await sendEmail(r.recipient,[r],false,user,String(r.notification_id));
        await rpc("ti_record_delivery",{
          p_notification:r.notification_id,p_user:r.user_id,p_channel:"email",p_status:"sent",
          p_provider_id:provider,p_error:""
        });
        sent++;
      }catch(e){
        failed++;
        try{await rpc("ti_record_delivery",{
          p_notification:r.notification_id,p_user:r.user_id,p_channel:"email",p_status:"failed",
          p_provider_id:"",p_error:scrub(e)
        });}catch{}
      }
    }
  }
  if(configured.line)for(const r of line){
    try{
      const id=await sendLine(r.recipient,r);
      await rpc("ti_record_delivery",{
        p_notification:r.notification_id,p_user:r.user_id,p_channel:"line",p_status:"sent",
        p_provider_id:id,p_error:""
      });sent++;
    }catch(e){
      failed++;
      try{await rpc("ti_record_delivery",{
        p_notification:r.notification_id,p_user:r.user_id,p_channel:"line",p_status:"failed",
        p_provider_id:"",p_error:scrub(e)
      });}catch{}
    }
  }
  else skipped+=line.length;
  // User-selected daily digests are persistently snapshotted. Each cohort and retry
  // always uses the same provider idempotency key, even across cron restarts.
  let daily=[];
  try{daily=await rpc("ti_claim_digest_batches",{
    p_email_ready:configured.email,p_line_ready:configured.line,p_limit:12
  });}
  catch(e){return Response.json({error:"daily digest queue: "+scrub(e),configured,
    immediate:{sent,failed,skipped}},{status:502});}
  let digestSent=0,digestFailed=0;
  for(const batch of daily||[]){
    const events=Array.isArray(batch.notifications)?batch.notifications:[];
    if(!events.length){
      try{await rpc("ti_cancel_stale_digest_batch",{p_batch:batch.batch_id});}
      catch(e){console.warn("stale digest cancellation failed",scrub(e));digestFailed++;}
      continue;
    }
    try{
      const provider=batch.channel==="email"
        ?await sendEmail(batch.recipient,events,true,batch.user_id,batch.batch_id)
        :await sendLineDigest(batch.recipient,events,batch.batch_id);
      await rpc("ti_finish_digest_batch",{
        p_batch:batch.batch_id,p_status:"sent",p_provider:provider,p_error:""
      });
      digestSent++;
    }catch(e){
      digestFailed++;
      try{await rpc("ti_finish_digest_batch",{
        p_batch:batch.batch_id,p_status:"failed",p_provider:"",p_error:scrub(e)
      });}catch{}
    }
  }
  return Response.json({ok:true,configured,pending:(candidates||[]).length,sent,failed,skipped,
    daily_batches:(daily||[]).length,digestSent,digestFailed,
    note:"sent counts only accepted provider responses; no simulated delivery"},{headers:{"Cache-Control":"no-store"}});
});
