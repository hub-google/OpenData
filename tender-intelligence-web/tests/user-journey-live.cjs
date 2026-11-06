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
 if(await page.locator('#detailDrawer').isVisible())await page.locator('#closeDetail').click();
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
  if(!info.includes('資料庫符合')||info.includes('資料庫符合 100 件'))throw Error('首頁跨日搜尋沒有完整結果：'+info+'；'+short(await page.locator('#dataError').innerText(),260));
  return {info,cards:await page.locator('#resultList article').count(),sample:short(await page.locator('#resultList').innerText(),280),screenshot:await shot('02-search')};
 });
 await step('跨頁搜尋不漏案也不重複來源頁',async()=>{
  await nav('search');
  await page.locator('#statusFilter').selectOption('全部');
  await page.locator('#groupFilter').selectOption('全部');
  await page.locator('#budgetFilter').fill('');
  await page.locator('#sortFilter').selectOption('date');
  await page.locator('#searchMode').selectOption('title');
  await page.locator('#searchQuery').fill('資訊系統');
  await page.locator('#searchForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#resultInfo')?.textContent?.includes('資料庫符合')&&document.querySelector('#resultInfo')?.textContent?.includes('跨日全文搜尋：資訊系統'),null,{timeout:18000});
  const ids=async()=>page.locator('#resultList article').evaluateAll(cards=>cards.map(card=>card.textContent.match(/案號\\s*([^\\s]+)/)?.[1]||card.textContent.slice(0,100)));
  const first=await ids();
  if(first.length!==20)throw Error('首批第一頁應有 20 筆，實際 '+first.length);
  await page.locator('#nextPage').click();
  const second=await ids();
  if(second.length!==10)throw Error('首批第二頁應有 10 筆，實際 '+second.length);
  await page.locator('#nextPage').click();
  await page.waitForFunction(()=>document.querySelector('#pageInfo')?.textContent?.includes('來源第 2/'),null,{timeout:17000});
  const third=await ids();
  if(third.length!==20)throw Error('第二批第一頁應有 20 筆，實際 '+third.length);
  const duplicates=third.filter(x=>first.includes(x)||second.includes(x));
  if(duplicates.length)throw Error('跨來源頁重複案號：'+duplicates.slice(0,5).join(','));
  return {first:first.length,second:second.length,third:third.length,duplicates:0,info:await page.locator('#pageInfo').innerText()};
 });
 await step('首頁全文搜尋的全庫類別與預算篩選',async()=>{
  await nav('search');
  await page.locator('#searchMode').selectOption('title');
  await page.locator('#searchQuery').fill('資安');
  await page.locator('#groupFilter').selectOption('勞務');
  await page.locator('#statusFilter').selectOption('招標');
  await page.locator('#budgetFilter').fill('1000000');
  await page.locator('#searchForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#resultInfo')?.textContent?.includes('跨日全文搜尋：資安')&&document.querySelector('#resultInfo')?.textContent?.includes('條件已套用全庫'),null,{timeout:18000});
  const info=short(await page.locator('#resultInfo').innerText(),400);
  if(await page.locator('#dataError').isVisible())throw Error(await page.locator('#dataError').innerText());
  const matched=info.match(/資料庫符合\\s*([\\d,]+)\\s*件.*當批載入\\s*([\\d,]+)\\s*筆/);
  if(!matched)throw Error('沒有可靠的全庫符合與當批載入統計：'+info);
  const total=Number(matched[1].replaceAll(',','')),loaded=Number(matched[2].replaceAll(',',''));
  if(total<1||loaded!==Math.min(total,30))throw Error('全庫篩選與畫面筆數不一致：'+info);
  const cards=await page.locator('#resultList article').count();
  if(cards!==Math.min(loaded,20))throw Error('篩選結果卡片筆數錯誤：'+cards);
  return {info,cards,total,loaded,screenshot:await shot('02b-filtered')};
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
  await page.waitForFunction(()=>document.querySelector('#detailContent .ti-decision-brief')?.textContent?.includes('資料完整度'),null,{timeout:14000});
  const brief=short(await page.locator('#detailContent .ti-decision-brief').innerText(),360);
  if(!brief.includes('資料完整度')||tabs.length!==6)throw Error('案件整合摘要未載入：'+brief);
  return {http:res?.status(),drawer:await page.locator('#detailDrawer').isVisible(),tabs,history,brief,screenshot:await shot('09-case')};
 });
 await step('監控與通知四分頁操作',async()=>{
  await nav('alerts');
  const names=await page.locator('.ti-monitor-tab').allTextContents();
  for(const text of ['競品追蹤','自動報表','通知設定','標案監控']){
    await page.getByRole('tab',{name:text}).click();
    const selected=await page.locator('.ti-monitor-tab.selected').innerText();
    if(selected!==text)throw Error('tab 未切換：'+text+' → '+selected);
  }
  return {tabs:names,screenshot:await shot('11-monitor-tabs')};
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
