// @ts-nocheck -- Deno runtime source validation; provider behavior requires live-secret verification.
// PRD F16: a bounded, openly accessible RSS of REAL stored procurement headlines.
// Only titles/agency/notice type, not bulk raw documents. Official source is authoritative.
// Limit=30 and public 5-minute caching to avoid unlicensed bulk distribution.
const SUPA=Deno.env.get("SUPABASE_URL")||"";
const PUB=Deno.env.get("SUPABASE_ANON_KEY")||
 Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"sb_publishable_L09XC4Tekm6cZaPTTczm3g_Aap-SOSy";
const BASE="https://hub-google.github.io/OpenData/tender-intelligence-web/";
const SOURCES="https://pcc-api.openfun.app/api/tender";
const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
function safeOfficial(value){
 try{const x=new URL(String(value||""));return x.protocol==="https:"&&x.hostname==="web.pcc.gov.tw"?x.href:""}
 catch{return""}
}
function link(r){
 const official=safeOfficial(r.official_url);if(official)return official;
 const u=new URL(SOURCES);u.searchParams.set("unit_id",r.unit_id);u.searchParams.set("job_number",r.job_number);
 return u.href;
}
function date(v){
 const s=String(v||"");
 if(!/^\d{8}$/.test(s))return new Date(0).toUTCString();
 const d=new Date(s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8)+"T00:00:00+08:00");
 return Number.isNaN(d.getTime())?new Date(0).toUTCString():d.toUTCString();
}
Deno.serve(async req=>{
 if(req.method!=="GET")return new Response("GET only",{status:405});
 const u=new URL(req.url);
 const keyword=String(u.searchParams.get("keyword")||"").trim().slice(0,40);
 const type=String(u.searchParams.get("type")||"").trim().slice(0,30);
 const q=new URL(SUPA+"/rest/v1/ti_cases");
 q.searchParams.set("select","unit_id,job_number,title,agency,latest_notice_type,latest_notice_date,official_url");
 q.searchParams.set("order","latest_notice_date.desc,unit_id.asc,job_number.asc");
 q.searchParams.set("limit","30");
 if(keyword)q.searchParams.set("title","ilike.*"+keyword.replace(/[,*()%]/g,"")+"*");
 if(type)q.searchParams.set("latest_notice_type","ilike.*"+type.replace(/[,*()%]/g,"")+"*");
 const response=await fetch(q,{headers:{apikey:PUB,Authorization:"Bearer "+PUB},signal:AbortSignal.timeout(17000)});
 if(!response.ok)return new Response("Upstream database unavailable",{status:502,headers:{"Cache-Control":"no-store"}});
 const data=await response.json();
 if(!Array.isArray(data))return new Response("Invalid source data",{status:502});
 const title="台灣政府標案情報｜已成功入庫的公告索引";
 const items=data.map(r=>{
  const l=link(r),pub=date(r.latest_notice_date);
  return "<item><title>"+esc(r.title)+"</title>"+
    "<link>"+esc(l)+"</link><guid isPermaLink=\"false\">"+
    esc(r.unit_id+"::"+r.job_number+"::"+r.latest_notice_date)+"</guid>"+
    "<pubDate>"+esc(pub)+"</pubDate><description>"+
    esc((r.agency||"機關未公開")+"｜"+(r.latest_notice_type||"類型未公開")+
    "｜公告來源：政府電子採購網；結構化資料：OpenFun PCC API。詳細資料請核對原公告。")+
    "</description></item>";
 }).join("");
 const xml='<?xml version="1.0" encoding="UTF-8"?>'+
  '<rss version="2.0"><channel><title>'+esc(title)+'</title>'+
  '<link>'+esc(BASE)+'</link><description>部分歷史日期仍在回填。'+
  '本 RSS 只涵蓋目前成功入庫的公告，且限最近 30 案，非完整全國公告。</description>'+
  '<language>zh-TW</language>'+items+'</channel></rss>';
 return new Response(xml,{status:200,headers:{
  "Content-Type":"application/rss+xml; charset=utf-8",
  "Cache-Control":"public,max-age=300,s-maxage=300",
  "Access-Control-Allow-Origin":"https://hub-google.github.io",
  "X-Content-Type-Options":"nosniff"
 }});
});
