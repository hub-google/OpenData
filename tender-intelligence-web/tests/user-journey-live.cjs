const fs=require('node:fs');
const {chromium}=require('playwright');
const BASE='https://hub-google.github.io/OpenData/tender-intelligence-web/';
const DIR='tender-intelligence-web/audits';
fs.mkdirSync(DIR,{recursive:true});
const results=[],errors=[],requests=[];
let browser,page;
const short=(s,n=450)=>String(s||'').replace(/\s+/g,' ').slice(0,n);
async function step(name,fn){
 try{const data=await fn();results.push({name,status:'PASS',data});console.log('PASS',name,JSON.stringify(data).slice(0,500))}
 catch(e){results.push({name,status:'FAIL',error:short(e.message)});console.error('FAIL',name,short(e.message))}
}
async function nav(view){
 const b=page.locator('[data-view="'+view+'"]').first();
 const d=b.locator('xpath=ancestor::details[1]');
 if(await d.count() && (await d.getAttribute('open'))===null)await d.locator('summary').click();
 await b.click();await page.waitForTimeout(300);
}
async function shot(n){try{await page.screenshot({path:DIR+'/'+n+'.png',timeout:10000});return n+'.png'}catch(e){return short(e.message,70)}}
async function main(){
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1400,height:900},locale:'zh-TW',timezoneId:'Asia/Taipei'});
 page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(short(e.message,250)));
 page.on('requestfailed',r=>requests.push({url:short(r.url(),170),error:short(r.failure()?.errorText,120)}));
 await step('首頁與五大功能區',async()=>{
  const response=await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:40000});
  await page.locator('#searchForm').waitFor();await page.waitForTimeout(3500);
  return {http:response?.status(),title:await page.title(),groups:await page.locator('.ti-nav-summary').allTextContents(),kpi:short(await page.locator('#verifiedMetricsNote').innerText()),screenshot:await shot('01-home')};
 });
 await step('標案搜尋：資訊系統',async()=>{
  await nav('search');await page.locator('#searchMode').selectOption('title');
  await page.locator('#searchQuery').fill('資訊系統');await page.locator('#searchForm button[type="submit"]').click();await page.waitForTimeout(4500);
  const info=short(await page.locator('#resultInfo').innerText());
  if(!info.includes('資料庫符合')||info.includes('資料庫符合 100 件'))throw Error('首頁仍把 100 筆當全部命中：'+info);
  return {info,cards:await page.locator('#resultList article').count(),sample:short(await page.locator('#resultList').innerText(),280),screenshot:await shot('02-search')};
 });
 await step('進階搜尋：資安維護最低一百萬',async()=>{
  await nav('advanced');await page.locator('#advQuery').fill('資安 AND 維護');
  await page.locator('#advExclude').fill('租賃');await page.locator('#advMin').fill('1000000');
  await page.locator('#advKind').selectOption('招標');await page.locator('#advGroup').selectOption('勞務');
  await page.locator('#advOpen').check();await page.locator('#advSubmit').click();await page.waitForTimeout(4500);
  return {status:short(await page.locator('#advStatus').innerText()),page:short(await page.locator('#advPageInfo').innerText()),sample:short(await page.locator('#advResults').innerText(),300),screenshot:await shot('03-advanced')};
 });
 await step('商機雷達：跨日搜尋',async()=>{
  await nav('radar');await page.locator('#profileKeywords').fill('資安,資訊系統');
  await page.locator('#profileExcludes').fill('租賃');
  await page.locator('#profileForm button[type="submit"]').click();await page.locator('#radarFullSearch').click();await page.waitForTimeout(4500);
  return {status:short(await page.locator('#radarFullStatus').innerText()),items:await page.locator('#radarFullResults .case-card').count(),screenshot:await shot('04-radar')};
 });
 await step('市場情報：廠商查詢',async()=>{
  await nav('vendors');await page.locator('#vendorMode').selectOption('name');
  await page.locator('#vendorQuery').fill('台灣糖業股份有限公司');
  await page.locator('#vendorForm button[type="submit"]').click();await page.waitForTimeout(5000);
  return {summary:short(await page.locator('#vendorSummary').innerText()),sample:short(await page.locator('#vendorOutput').innerText(),250),screenshot:await shot('05-vendor')};
 });
 await step('市場行情：未分類逐月趨勢',async()=>{
  await nav('analytics');await page.locator('#tiMarketMonths').selectOption('6');
  await page.locator('#tiMarketGroup').selectOption('未分類');await page.locator('#tiMarketSubmit').click();await page.waitForTimeout(4500);
  return {status:short(await page.locator('#tiMarketStatus').innerText()),bars:await page.locator('#tiMarketTrend .ti-market-row').count(),screenshot:await shot('06-market')};
 });
 await step('私人公司資料：未登入狀態',async()=>{
  await nav('company');return {company_fields:await page.locator('#tiCompanyForm input').count(),assets:await page.locator('#tiAssetForm').count(),status:short(await page.locator('#tiCompanyStatus').innerText()),screenshot:await shot('07-company')};
 });
 await step('監控與自動報表入口',async()=>{
  await nav('alerts');return {keyword:await page.locator('#watchTerm').count(),competitor:await page.locator('[name="competitorName"]').count(),report:await page.locator('.ti-report-form').count(),screenshot:await shot('08-alerts')};
 });
 await step('指定真實標案深連結與六分頁',async()=>{
  const res=await page.goto(BASE+'?case_unit=3.1.1&case_no=UT-11601',{waitUntil:'domcontentloaded',timeout:40000});
  await page.waitForTimeout(6000);
  const tabs=await page.locator('.ti-case-tab').allTextContents();
  let history='';if(tabs.length){await page.getByRole('tab',{name:'歷史行情'}).click();history=short(await page.locator('.ti-case-panel:not([hidden])').innerText(),230);}
  const brief=short(await page.locator('#detailContent .ti-decision-brief').innerText(),360);
  if(!brief.includes('資料完整度')||tabs.length!==6)throw Error('案件整合摘要未載入：'+brief);
  return {http:res?.status(),drawer:await page.locator('#detailDrawer').isVisible(),tabs,history,brief,screenshot:await shot('09-case')};
 });
 await step('手機側欄與商機雷達',async()=>{
  await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:40000});
  await page.setViewportSize({width:390,height:800});await page.locator('#mobileMenu').click();await nav('radar');
  return {radar:await page.locator('#view-radar').isVisible(),horizontal_overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),
   scroll_width:await page.evaluate(()=>document.documentElement.scrollWidth),
   overflowing:await page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>{
    const r=el.getBoundingClientRect(),st=getComputedStyle(el);
    return r.width>0&&r.right>innerWidth+2&&r.left>=0&&st.display!=='none'&&st.visibility!=='hidden';
   }).slice(0,20).map(el=>({tag:el.tagName,id:el.id,cls:String(el.className||'').slice(0,80),width:Math.round(el.getBoundingClientRect().width),right:Math.round(el.getBoundingClientRect().right)}))),
   screenshot:await shot('10-mobile')};
 });
}
function save(){
 const report={generated_at:new Date().toISOString(),url:BASE,browser:'Playwright Chromium on GitHub Actions; anonymous session',results,page_errors:errors,request_failures:requests.slice(0,35)};
 fs.writeFileSync(DIR+'/2026-11-05-live-click-audit.json',JSON.stringify(report,null,2),'utf8');
 const md=['# 台灣標案平台正式網站公開操作稽核','','測試時間：'+report.generated_at,'測試環境：GitHub Actions Playwright Chromium，未登入；實際開啟 GitHub Pages。','','| 情境 | 結果 | 觀察 |','|---|---|---|'];
 for(const r of results)md.push('| '+r.name+' | '+r.status+' | '+short(JSON.stringify(r.data||r.error),360).replace(/\|/g,'/')+' |');
 md.push('','頁面 JS 例外：'+errors.length,'網路失敗請求：'+requests.length,'','未登入的私人資料 CRUD 與發送通知不屬於本次驗收。');
 fs.writeFileSync(DIR+'/2026-11-05-live-click-audit.md',md.join('\n'),'utf8');
 console.log('TOTAL',results.filter(x=>x.status==='PASS').length,'/',results.length,'PAGE_ERRORS',errors.length,'NETWORK_ERRORS',requests.length);
}
main().catch(e=>{results.push({name:'測試意外中止',status:'FAIL',error:short(e.message)});console.error(e)})
.finally(async()=>{try{await browser?.close()}catch(e){}save()});
