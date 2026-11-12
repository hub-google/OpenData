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
 catch(e){const screenshot=await shot('FAIL-'+String(results.length+1).padStart(2,'0'));results.push({name,status:'FAIL',error:short(e.message,850),screenshot});console.error('FAIL',name,short(e.message))}
}
async function nav(view){
 if(await page.locator('#detailDrawer').isVisible())await page.locator('#closeDetail').click();
 const b=page.locator('[data-view="'+view+'"]').first();
 const d=b.locator('xpath=ancestor::details[1]');
 if(await d.count() && (await d.getAttribute('open'))===null)await d.locator('summary').click();
 await b.click();await page.waitForTimeout(300);
}
async function shot(n){try{await page.screenshot({path:DIR+'/'+n+'.png',timeout:10000});return n+'.png'}catch(e){return short(e.message,70)}}
async function awaitBasic(keyword,timeout=50000){
 await page.waitForFunction(word=>{
  const info=document.getElementById('resultInfo')?.textContent||'';
  const loaded=document.querySelectorAll('#resultList .case-card').length;
  const failed=document.getElementById('dataError')?.hidden===false;
  return failed||(info.includes(word)&&loaded>0);
 },keyword,{timeout});
 if(await page.locator('#dataError').isVisible())throw Error('真實搜尋失敗：'+await page.locator('#dataError').innerText());
}
async function openFilters(){
 await page.locator('#searchFilters').evaluate(el=>{el.hidden=false;el.open=true});
}
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
 await step('首頁最新公告分頁與真實資料備援',async()=>{
  await nav('search');
  await page.waitForFunction(()=>{
   return document.querySelectorAll('#resultList .case-card').length>0||document.getElementById('dataError')?.hidden===false;
  },null,{timeout:50000});
  if(await page.locator('#dataError').isVisible())throw Error('首頁真實案例未能載入：'+short(await page.locator('#dataError').innerText(),280));
  const cards=await page.locator('#resultList .case-card').count();
  const info=short(await page.locator('#resultInfo').innerText());
  const pagination=await page.locator('#pageInfo').innerText();
  if(!cards||!info.includes('最新已收錄案件')||!info.includes('每個案件僅顯示一筆'))
   throw Error('首頁實際案件或來源標示不一致：'+info);
  return {cards,info,pagination,screenshot:await shot('01b-latest')};
 });
 await step('標案搜尋：資訊系統',async()=>{
  await nav('search');
  await openFilters();await page.locator('#searchFilters').evaluate(e=>e.open=false);
  await page.locator('#searchMode').selectOption('title');
  await page.locator('#searchQuery').fill('資訊系統');
  await page.locator('#searchForm button[type="submit"]').click();
  await awaitBasic('標案名稱：資訊系統');
  const info=short(await page.locator('#resultInfo').innerText());
  const count=await page.locator('#resultList .case-card').count();
  if(!info.includes('符合')||count<1)throw Error('搜尋未取得經證實的全庫案件：'+info);
  return {info,cards:count,sample:short(await page.locator('#resultList').innerText(),220),screenshot:await shot('02-search')};
 });
 await step('跨頁搜尋不漏案也不重複來源頁',async()=>{
  await nav('search');await openFilters();
  await page.locator('#statusFilter').selectOption('全部');
  await page.locator('#groupFilter').selectOption('全部');
  await page.locator('#budgetFilter').fill('');
  await page.locator('#maxBudgetFilter').fill('');
  await page.locator('#sortFilter').selectOption('date');
  await page.locator('#searchMode').selectOption('title');
  await page.locator('#searchQuery').fill('資訊系統');
  await page.locator('#searchForm button[type="submit"]').click();
  await awaitBasic('標案名稱：資訊系統');
  const keys=()=>page.locator('#resultList .case-card').evaluateAll(cards=>cards.map(x=>[
   x.querySelector('.case-meta')?.textContent?.trim()||'',
   x.innerText.match(/案號\s+([^\s]+)/)?.[1]||''
  ].join('|')));
  const before=await keys();
  if(before.length!==30||new Set(before).size!==before.length)throw Error('第一頁筆數或案號重複：'+before.length);
  if(await page.locator('#nextPage').isDisabled())throw Error('資料庫已有多頁結果，但下一頁無法使用');
  await page.locator('#nextPage').click();
  await page.waitForFunction(first=>{
   const info=document.getElementById('pageInfo')?.textContent||'';
   const card=document.querySelector('#resultList .case-card');
   return info.includes('第 2 /')&&!!card&&!card.innerText.includes(first);
  },before[0].split('|').pop(),{timeout:50000});
  if(await page.locator('#dataError').isVisible())throw Error(await page.locator('#dataError').innerText());
  const after=await keys();
  if(after.length!==30||new Set(after).size!==after.length)
    throw Error('第二頁筆數或重複案號：'+after.length);
  const overlap=after.filter(x=>before.includes(x));
  if(overlap.length)throw Error('不同頁面存在重複的案件：'+overlap.slice(0,4).join(';'));
  return {firstPage:before.length,secondPage:after.length,overlap:0,info:await page.locator('#pageInfo').innerText(),screenshot:await shot('02a-pagination')};
 });
 await step('首頁全文搜尋的全庫類別與預算篩選',async()=>{
  await nav('search');await openFilters();
  await page.locator('#searchMode').selectOption('title');
  await page.locator('#searchQuery').fill('資訊系統');
  await page.locator('#groupFilter').selectOption('勞務');
  await page.locator('#statusFilter').selectOption('招標');
  await page.locator('#budgetFilter').fill('1000000');
  await page.locator('#searchForm button[type="submit"]').click();
  await page.waitForFunction(()=>{
   const info=document.getElementById('resultInfo')?.textContent||'';
   return document.getElementById('dataError')?.hidden===false ||
    (info.includes('標案名稱：資訊系統')&&info.includes('本頁'));
  },null,{timeout:50000});
  if(await page.locator('#dataError').isVisible())throw Error(await page.locator('#dataError').innerText());
  const info=short(await page.locator('#resultInfo').innerText(),400);
  const cards=await page.locator('#resultList .case-card').count();
  const invalid=await page.locator('#resultList .case-card').evaluateAll(cs=>cs.map(c=>{
   const text=c.textContent||'';
   const money=Number((c.querySelector('.case-right strong')?.textContent||'').replace(/[^\d]/g,''));
   return {label:c.querySelector('.case-tag')?.textContent,group:text.includes('勞務'),money,valid:money>=1000000&&text.includes('勞務')&&text.includes('招標')};
  }).filter(x=>!x.valid));
  if(!info.includes('符合')||cards===0||invalid.length)throw Error('全庫篩選有錯誤或無資料：'+JSON.stringify({info,cards,invalid:invalid.slice(0,2)}));
  return {info,cards,invalid:0,screenshot:await shot('02b-filtered')};
 });
 await step('進階搜尋無條件開啟與資料庫真實分頁',async()=>{
  await nav('advanced');
  await page.waitForFunction(()=>!document.querySelector('#advSubmit')?.disabled,null,{timeout:42000});
  await page.locator('#advClear').click();
  await page.locator('#advSubmit').click();
  await page.waitForFunction(()=>{
   const t=document.getElementById('advStatus')?.textContent||'';
   return t.includes('實際已入庫資料符合條件')||t.includes('資料庫進階搜尋失敗');
  },null,{timeout:42000});
  const status=short(await page.locator('#advStatus').innerText());
  if(!status.includes('實際已入庫資料符合條件'))throw Error(status);
  const cases=page.locator('#advResults .case-card');
  if(await cases.count()!==30)throw Error('最近案件第一頁應有30案，實際 '+await cases.count());
  const first=await cases.first().locator('a.case-title').getAttribute('href');
  await page.locator('#advNext').click();
  await page.waitForFunction(first=>{
   const nav=document.getElementById('advPageInfo')?.textContent||'';
   const href=document.querySelector('#advResults .case-card a.case-title')?.getAttribute('href');
   return nav.startsWith('第 2／')&&href&&href!==first;
  },first,{timeout:42000});
  const second=await cases.first().locator('a.case-title').getAttribute('href');
  if(first===second)throw Error('進階搜尋第二頁仍顯示相同案件');
  return {status,first,second,page:await page.locator('#advPageInfo').innerText(),screenshot:await shot('02c-recent-advanced')};
 });
 await step('進階搜尋：資安維護最低一百萬',async()=>{
  await nav('advanced');
  await page.waitForFunction(()=>!document.querySelector('#advSubmit')?.disabled,null,{timeout:42000});
  await page.locator('#advQuery').fill('資安 AND 維護');
  await page.locator('#advExclude').fill('租賃');
  await page.locator('#advMin').fill('1000000');
  await page.locator('#advKind').selectOption('招標');
  await page.locator('#advGroup').selectOption('勞務');
  await page.locator('#advOpen').check();
  await page.locator('#advSubmit').click();
  await page.waitForFunction(()=>{
   const t=document.getElementById('advStatus')?.textContent||'';
   return t.includes('實際已入庫資料符合條件')||t.includes('資料庫進階搜尋失敗');
  },null,{timeout:42000});
  const status=short(await page.locator('#advStatus').innerText());
  if(!status.includes('實際已入庫資料符合條件'))throw Error('進階組合條件查詢失敗：'+status);
  return {status,caseCount:await page.locator('#advResults .case-card').count(),screenshot:await shot('03-advanced')};
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
  await page.locator('#detailContent .ti-case-tabs [role="tab"]').first().waitFor({state:'visible',timeout:30000});
  const tabs=await page.locator('#detailContent .ti-case-tab').allTextContents();
  if(tabs.join('|')!=='案件重點|公告歷程|行情與競爭|投標準備')throw Error('案件主分頁內容錯誤：'+tabs.join(','));
  for(let i=0;i<tabs.length;i++){
   await page.locator('#detailContent .ti-case-tab').nth(i).click();
   if(await page.locator('#detailContent .ti-case-panel:not([hidden])').count()!==1)throw Error('主分頁未切換：'+tabs[i]);
  }
  await page.locator('#detailContent [data-main-tab="3"]').click();
  const prepTabs=await page.locator('#detailContent .ti-prep-tab').allTextContents();
  if(prepTabs.join('|')!=='評估與決策|資格與標書|待辦與分工|履約與保證金|成本與工時|服務建議書')
   throw Error('案件子分頁內容錯誤：'+prepTabs.join(','));
  for(const id of ['decision','documents','tasks','contracts','effort','proposal']){
   await page.locator('#detailContent [data-prep-tab="'+id+'"]').click();
   const panel=page.locator('#detailContent .ti-prep-panel:not([hidden])');
   await panel.waitFor({state:'visible',timeout:12000});
  }
  return {http:res?.status(),mainTabs:tabs,prepTabs,drawer:await page.locator('#detailDrawer').isVisible(),screenshot:await shot('09-case')};
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
 if(results.some(x=>x.status!=='PASS')||!results.length||errors.length)process.exitCode=1;
}
main().catch(e=>{results.push({name:'測試意外中止',status:'FAIL',error:short(e.message)});console.error(e)})
.finally(async()=>{try{await browser?.close()}catch(e){}save()});
