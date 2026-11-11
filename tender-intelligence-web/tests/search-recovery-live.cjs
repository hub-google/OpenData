'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE='https://hub-google.github.io/OpenData/tender-intelligence-web/';
const OUT='tender-intelligence-web/audits/search-recovery';
fs.mkdirSync(OUT,{recursive:true});
const checks=[];
let browser, page;
async function check(name,fn,file){
 try{const details=await fn();checks.push({name,status:'PASS',details});console.log('PASS',name,JSON.stringify(details));}
 catch(error){checks.push({name,status:'FAIL',error:String(error?.stack||error).slice(0,1800)});console.error('FAIL',name,String(error?.message||error));}
 finally{if(file&&page)await page.screenshot({path:path.join(OUT,file),timeout:15000}).catch(e=>console.error('SCREENSHOT_ERROR',e.message));}
}
(async()=>{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 page=await browser.newPage({locale:'zh-TW',timezoneId:'Asia/Taipei',viewport:{width:1366,height:900}});
 const errors=[],http=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url());http.push({status:r.status(),path:u.origin+u.pathname});}});
 const rpc='**/rest/v1/rpc/ti_case_search_v3';
 let intercepted=0;
 await page.route(rpc,async route=>{
  intercepted++;
  await route.fulfill({status:503,contentType:'application/json',
   headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},
   body:JSON.stringify({code:'TEST_503',message:'UAT simulated upstream unavailable'})});
 });
 await check('UAT: Supabase HTTP 503 must stop spinner and show explicit error',async()=>{
  const res=await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:45000});
  assert.ok(res?.ok(),'GitHub Pages HTTP '+res?.status());
  await page.locator('#dataError').waitFor({state:'visible',timeout:55000});
  const info=await page.locator('#dataError').innerText();
  assert.match(info,/真實資料讀取失敗/,'Must display real error, not mock cases');
  assert.equal(await page.locator('#resultList .case-card').count(),0,'No fabricated cards may appear');
  assert.ok(intercepted>=1,'App must attempt true database RPC');
  return {intercepted,error:info.slice(0,350),http:http.slice(-5)};
 },'01-upstream-503.png');
 await page.unroute(rpc);
 await check('UAT: after outage, retry can read genuine matching cases',async()=>{
  await page.locator('#searchMode').selectOption('title');
  await page.locator('#searchQuery').fill('資安');
  await page.locator('#searchForm button[type=submit]').click();
  await page.waitForFunction(()=>{
   const info=document.getElementById('resultInfo')?.textContent||'';
   return info.includes('符合')||document.getElementById('dataError')?.hidden===false;
  },null,{timeout:55000});
  if(await page.locator('#dataError').isVisible())throw Error('Real upstream remains unavailable: '+(await page.locator('#dataError').innerText()).slice(0,250));
  await page.locator('#resultList .case-card').first().waitFor({timeout:20000});
  const info=await page.locator('#resultInfo').innerText();
  const cards=await page.locator('#resultList .case-card').count();
  assert.ok(cards>0);
  assert.ok(info.includes('資安'),'Retry should keep query');
  return {cards,info:info.slice(0,330)};
 },'02-recovered-search.png');
 await check('UAT: public page never exposes production debug credentials',async()=>{
  const value=await page.locator('#accountDemoQuick').isVisible().catch(()=>false);
  assert.equal(value,false,'Demo one-click login must not appear on public route');
  assert.equal(errors.length,0,'Runtime JavaScript exceptions: '+errors.join(';'));
  return {publicDemoButtonVisible:value,jsErrors:errors.length};
 },'03-public-entry.png');
})().catch(e=>{checks.push({name:'setup',status:'FAIL',error:String(e?.stack||e)});console.error(e);})
.finally(async()=>{
 await browser?.close().catch(()=>{});
 const report={generated_at:new Date().toISOString(),target:BASE,
  checks,summary:{passed:checks.filter(x=>x.status==='PASS').length,total:checks.length}};
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(report,null,2));
 console.log('SEARCH_RECOVERY_UAT',report.summary);
 if(checks.length<3||checks.some(x=>x.status!=='PASS'))process.exitCode=1;
});
