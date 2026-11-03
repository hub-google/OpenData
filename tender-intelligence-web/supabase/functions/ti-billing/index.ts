import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const dbUrl=Deno.env.get("SUPABASE_URL")||"";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const merchantId=Deno.env.get("ECPAY_MERCHANT_ID")||"";
const hashKey=Deno.env.get("ECPAY_HASH_KEY")||"";
const hashIv=Deno.env.get("ECPAY_HASH_IV")||"";
const enabled=Deno.env.get("TI_BILLING_CHECKOUT_ENABLED")==="true";
const stage=Deno.env.get("ECPAY_ENVIRONMENT")==="stage";
const ready=enabled&&!!merchantId&&!!hashKey&&!!hashIv;
const recurringEnabled=Deno.env.get("TI_BILLING_RECURRING_ENABLED")==="true";
const root=stage?"https://payment-stage.ecpay.com.tw":"https://payment.ecpay.com.tw";
const site="https://hub-google.github.io/OpenData/tender-intelligence-web/";
const callback=dbUrl+"/functions/v1/ti-billing";
const periodicCallback=callback+"?period=1";
const sb=createClient(dbUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});

function cors(req:Request):Record<string,string>{
 const origin=req.headers.get("origin")||"";
 const allowed=origin==="https://hub-google.github.io"||
   /^http:\/\/localhost(?::\d+)?$/.test(origin)||/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin);
 return { "Access-Control-Allow-Origin":allowed?origin:"https://hub-google.github.io",
   "Access-Control-Allow-Headers":"authorization,apikey,content-type",
   "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Vary":"Origin" };
}
function reply(req:Request,data:unknown,status=200):Response{
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors(req)}});
}
function error(req:Request,msg:string,status=400):Response{return reply(req,{error:msg},status);}
function ecEncode(value:string):string{
 return encodeURIComponent(value).replace(/%20/g,"+").replace(/%7E/gi,"~")
   .replace(/%2D/gi,"-").replace(/%5F/gi,"_").replace(/%2E/gi,".")
   .replace(/%21/gi,"!").replace(/%2A/gi,"*")
   .replace(/%28/gi,"(").replace(/%29/gi,")");
}
async function checkMac(fields:Record<string,string>):Promise<string>{
 const parts=Object.entries(fields).filter(([k])=>k.toLowerCase()!=="checkmacvalue")
  .sort(([a],[b])=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0)
  .map(([k,v])=>k+"="+v).join("&");
 const source=ecEncode("HashKey="+hashKey+"&"+parts+"&HashIV="+hashIv).toLowerCase();
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source)));
 return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
}
function equalsFixed(a:string,b:string):boolean{
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
async function getUser(req:Request){
 const token=req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]||"";
 if(!token) return null;
 const {data,error}=await sb.auth.getUser(token);
 return error?null:data.user;
}
function taiwanTime(now=new Date()):string{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",
   year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
   second:"2-digit",hour12:false,hourCycle:"h23"}).formatToParts(now);
 const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return m.year+"/"+m.month+"/"+m.day+" "+(m.hour==="24"?"00":m.hour)+":"+m.minute+":"+m.second;
}
function parseTaiwanDate(raw:string):string{
 const match=raw?.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
 return match?match[1]+"-"+match[2]+"-"+match[3]+"T"+match[4]+":"+match[5]+":"+match[6]+"+08:00":new Date().toISOString();
}
async function incoming(req:Request):Promise<Response>{
 if(!ready)return new Response("0|not configured",{status:503});
 const body=await req.text();
 if(body.length>32768)return new Response("0|size",{status:413});
 const p=new URLSearchParams(body);const fields:Record<string,string>={};
 for(const [key,value] of p){
  if(Object.prototype.hasOwnProperty.call(fields,key))return new Response("0|duplicate",{status:400});
  fields[key]=value;
 }
 if(!fields.CheckMacValue||fields.MerchantID!==merchantId||!fields.MerchantTradeNo)
   return new Response("0|invalid",{status:400});
 const expected=await checkMac(fields);
 if(!equalsFixed(expected,fields.CheckMacValue.toUpperCase()))
   return new Response("0|invalid mac",{status:400});
 if(fields.SimulatePaid==="1")return new Response("1|OK");
 if(fields.RtnCode!=="1"){
   // Failed authorizations never confer paid access. The merchant can review them in ECPay.
   return new Response("1|OK");
 }
 const recurringPeriod=new URL(req.url).searchParams.get("period")==="1";
 if(recurringPeriod && (fields.PeriodType!=="M"||fields.Frequency!=="1"||
      !Number.isSafeInteger(Number(fields.TotalSuccessTimes))||
      Number(fields.TotalSuccessTimes)<2))
   return new Response("0|invalid period",{status:400});
 const amount=Number(recurringPeriod?(fields.Amount||fields.amount):fields.TradeAmt);
 // ECPay can preserve the recurring order's TradeNo across months. Each successful
 // authorization is uniquely identified by the signed TotalSuccessTimes.
 const paymentKey=recurringPeriod?
   fields.MerchantTradeNo+":PERIOD:"+fields.TotalSuccessTimes:fields.TradeNo;
 if(!Number.isSafeInteger(amount)||amount<=0||!paymentKey)
   return new Response("0|invalid payment",{status:400});
 const {data, error:e}=await sb.rpc("ti_record_ecpay_payment",{
  p_merchant_trade_no:fields.MerchantTradeNo,
  p_provider_trade_no:paymentKey,
  p_amount_twd:amount,
  p_paid_at:parseTaiwanDate(fields.PaymentDate||fields.ProcessDate||fields.process_date||""),
  p_method:fields.PaymentType||"Credit"
 });
 if(e||data!==true){
  console.error("billing webhook could not apply order",e?.code||"not found or mismatch");
  return new Response("0|rejected",{status:400});
 }
 return new Response("1|OK");
}
async function statusFor(req:Request,userId:string):Promise<Response>{
 const [subscription,orders]=await Promise.all([
  sb.from("ti_billing_subscriptions").select("plan_code,current_period_end,status,auto_renew,updated_at").eq("user_id",userId).maybeSingle(),
  sb.from("ti_billing_orders").select("id,plan_code,amount_twd,payment_kind,status,created_at,paid_at,cancelled_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(20)
 ]);
 if(subscription.error||orders.error)return error(req,"無法讀取帳務資料",503);
 return reply(req,{ready,supports_recurring:ready&&recurringEnabled,environment:stage?"stage":"production",subscription:subscription.data,
   orders:orders.data||[]});
}
async function checkout(req:Request,userId:string,payload:Record<string,unknown>):Promise<Response>{
 if(!ready)return error(req,"尚未啟用正式金流，請勿輸入信用卡。",503);
 const code=String(payload.plan||"");
 const paymentKind=String(payload.kind||"recurring");
 if(!["personal","professional","team"].includes(code)||!["recurring","one_time"].includes(paymentKind))
  return error(req,"不支援的訂閱方案或付款方式");
 if(paymentKind==="recurring"&&!recurringEnabled)return error(req,"每月自動續扣須先取得綠界特約賣家及定期定額功能核准，目前未開通。",409);
 const {data:plan,error:pe}=await sb.from("ti_billing_plans").select("code,label,amount_twd,is_available").eq("code",code).single();
 if(pe||!plan?.is_available)return error(req,"目前未開放這個方案",409);
 const {data:subscription,error:se}=await sb.from("ti_billing_subscriptions").select("auto_renew,current_period_end").eq("user_id",userId).maybeSingle();
 if(se)return error(req,"會員狀態查詢失敗",503);
 if(subscription?.auto_renew&&new Date(subscription.current_period_end)>new Date())
  return error(req,"已有自動續費方案，請先取消續訂並確認有效期後再購買。",409);
 const since=new Date(Date.now()-15*60*1000).toISOString();
 const {data:pending,error:pen}=await sb.from("ti_billing_orders")
  .select("id").eq("user_id",userId).eq("status","pending").gte("created_at",since).limit(1);
 if(pen)return error(req,"訂單狀態查詢失敗",503);
 if(pending?.length)return error(req,"15 分鐘內已有待付款訂單，請完成原付款或稍後重新建立。",409);
 const tradeNo=("TI"+Date.now().toString(36)+crypto.randomUUID().replaceAll("-","").slice(0,8)).toUpperCase().slice(0,20);
 const {error:oe}=await sb.from("ti_billing_orders").insert({
  user_id:userId,merchant_trade_no:tradeNo,plan_code:code,
  amount_twd:plan.amount_twd,payment_kind:paymentKind
 });
 if(oe){console.error("create order",oe.code);return error(req,"建立訂單失敗",503);}
 const recurring=paymentKind==="recurring";
 const fields:Record<string,string>={
  MerchantID:merchantId,MerchantTradeNo:tradeNo,MerchantTradeDate:taiwanTime(),
  PaymentType:"aio",TotalAmount:String(plan.amount_twd),
  TradeDesc:"Taiwan Tender Intelligence",
  ItemName:"台灣標案情報中心 "+plan.label+" 1個月",
  ReturnURL:callback,ClientBackURL:site+"?view=billing",
  ChoosePayment:recurring?"Credit":"ALL",EncryptType:"1"
 };
 if(recurring)Object.assign(fields,{PeriodAmount:String(plan.amount_twd),PeriodType:"M",
  Frequency:"1",ExecTimes:"99",PeriodReturnURL:periodicCallback});
 fields.CheckMacValue=await checkMac(fields);
 return reply(req,{checkout_url:root+"/Cashier/AioCheckOut/V5",fields,
  payment_kind:paymentKind,amount_twd:plan.amount_twd});
}
async function cancel(req:Request,userId:string):Promise<Response>{
 if(!ready)return error(req,"金流尚未開通，無法操作取消",503);
 const {data:sub,error:se}=await sb.from("ti_billing_subscriptions")
  .select("source_order_id,auto_renew,current_period_end").eq("user_id",userId).maybeSingle();
 if(se)return error(req,"無法讀取訂閱",503);
 if(!sub?.auto_renew)return error(req,"目前沒有自動續費訂閱需要取消",409);
 const {data:order,error:oe}=await sb.from("ti_billing_orders")
  .select("merchant_trade_no,payment_kind").eq("id",sub.source_order_id).eq("user_id",userId).single();
 if(oe||order?.payment_kind!=="recurring")return error(req,"找不到對應的定期定額訂單",409);
 const form:Record<string,string>={MerchantID:merchantId,MerchantTradeNo:order.merchant_trade_no,
  Action:"Cancel",TimeStamp:String(Math.floor(Date.now()/1000))};
 form.CheckMacValue=await checkMac(form);
 const upstream=await fetch(root+"/Cashier/CreditCardPeriodAction",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams(form),signal:AbortSignal.timeout(15000)});
 const parsed=new URLSearchParams(await upstream.text());const ret=Object.fromEntries(parsed);
 const incomingMac=ret.CheckMacValue||"";
 if(!upstream.ok||!incomingMac||!equalsFixed(await checkMac(ret),incomingMac.toUpperCase())||
   ret.MerchantID!==merchantId||ret.MerchantTradeNo!==order.merchant_trade_no||ret.RtnCode!=="1")
  return error(req,"綠界尚未確認取消成功，請到綠界廠商後台查核，系統未修改訂閱狀態。",502);
 // Concurrency is bounded by provider cancellation success; no future debit should be scheduled.
 const {error:ue}=await sb.from("ti_billing_subscriptions").update({
  auto_renew:false,status:"cancelled",updated_at:new Date().toISOString()
 }).eq("user_id",userId).eq("source_order_id",sub.source_order_id);
 if(ue)return error(req,"金流已停止扣款，但本站同步失敗，請聯絡客服查核。",503);
 await sb.from("ti_billing_orders").update({cancelled_at:new Date().toISOString()}).eq("id",sub.source_order_id);
 return reply(req,{cancelled:true,access_until:sub.current_period_end});
}
Deno.serve(async(req:Request)=>{
 try{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(req.method==="POST"&&(req.headers.get("content-type")||"").includes("application/x-www-form-urlencoded"))
   return await incoming(req);
  if(req.method!=="GET"&&req.method!=="POST")return error(req,"Method not allowed",405);
  const url=new URL(req.url);
  if(req.method==="GET"&&url.searchParams.get("mode")==="plans"){
   const {data,error:e}=await sb.from("ti_billing_plans").select("code,label,amount_twd,is_available").eq("is_available",true).order("amount_twd");
   if(e)return error(req,"無法讀取方案",503);
   return reply(req,{ready,supports_recurring:ready&&recurringEnabled,environment:stage?"stage":"production",plans:data});
  }
  const user=await getUser(req);
  if(!user)return error(req,"請先登入後再管理訂閱",401);
  if(req.method==="GET"&&url.searchParams.get("mode")==="status")return await statusFor(req,user.id);
  if(req.method==="POST"){
   let data:Record<string,unknown>;
   try{data=await req.json();}catch{return error(req,"JSON格式不正確");}
   if(data.action==="checkout")return await checkout(req,user.id,data);
   if(data.action==="cancel")return await cancel(req,user.id);
  }
  return error(req,"Unsupported operation",404);
 }catch(e){
  console.error("ti-billing",e instanceof Error?e.message:"unknown");
  return error(req,"金流服務暫時無法使用",503);
 }
});
