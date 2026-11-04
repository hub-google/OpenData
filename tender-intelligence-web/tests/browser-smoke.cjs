// Real-browser smoke tests for Taiwan procurement search (public, no user login).
// Runs in GitHub Actions using Playwright. No mock tender records are used.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('/tmp/tender-browser/node_modules/playwright');
const base='https://hub-google.github.io/OpenData/tender-intelligence-web/';
const out='/tmp/tender-browser-artifacts';
fs.mkdirSync(out,{recursive:true});
let browser,page;
const check=async(name,action)=>{
 const t=Date.now();
 try {await action();console.log('PASS '+name+' ('+(Date.now()-t)+' ms)');}
 catch(e) {console.error('FAIL '+name+': '+String(e));throw e;}
};
async function waitPage(n,timeout=45000){
 await page.waitForFunction(value=>{
   const text=document.getElementById('advPageInfo')?.textContent||'';
   return text.startsWith('第 '+value+'／');
 },n,{timeout});
}
async function search(){
 await page.locator('#advSubmit').click();
 await waitPage(1);
 const message=await page.locator('#advStatus').innerText();
 assert.ok(message.includes('實際已入庫資料符合條件'),'進階搜尋未完成：'+message);
}
async function firstAdvancedId(){
 return await page.locator('#advResults .case-card a.case-title').first().getAttribute('href');
}
(async()=>{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 page=await browser.newPage({locale:'zh-TW',viewport:{width:1440,height:900}});
 page.on('pageerror',e=>console.error('BROWSER_PAGE_ERROR '+e.message));
 page.on('console',m=>{if(m.type()==='error')console.error('BROWSER_CONSOLE '+m.text());});
 await check('Open public website',async()=>{
   const res=await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});
   assert.ok(res?.ok(),String(res?.status()));
   await page.locator('#resultList .case-card').first().waitFor({timeout:60000});
 });
 await check('Latest page contains verified monetary values, not all unknown',async()=>{
   const values=await page.locator('#resultList .case-right strong').allTextContents();
   assert.ok(values.length>0,'No latest cards');
   assert.ok(values.some(v=>v.startsWith('NT$')),'All latest budget values appear unknown');
 });
 await check('Latest page next button changes the visible page',async()=>{
   const original=await page.locator('#pageInfo').innerText();
   const title=await page.locator('#resultList .case-title').first().innerText();
   assert.equal(await page.locator('#nextPage').isDisabled(),false);
   await page.locator('#nextPage').click();
   await page.waitForFunction(v=>document.getElementById('pageInfo')?.textContent!==v,original);
   const after=await page.locator('#resultList .case-title').first().innerText();
   assert.notEqual(after,title);
 });
 await check('Source-backed case detail opens despite upstream API CORS',async()=>{
   const title=await page.locator('#resultList .case-title').first().innerText();
   await page.locator('#resultList .case-title').first().click();
   await page.locator('#detailContent .detail-grid').waitFor({timeout:45000});
   const content=await page.locator('#detailContent').innerText();
   assert.ok(content.includes(title),'Detail shows a different case');
   assert.ok(content.includes('已成功入庫')||content.includes('公告歷程'),'Source evidence unavailable');
   assert.ok(!content.includes('案件詳情載入失敗'),content);
 });
 await check('Exact-case share link opens same agency and case',async()=>{
   const cells=await page.locator('#detailContent .detail-grid strong').allTextContents();
   const unit=cells[0],job=cells[1];
   assert.ok(unit&&job,'Missing exact unit ID or case number');
   const p=await browser.newPage({locale:'zh-TW'});
   try{
     await p.goto(base+'?'+new URLSearchParams({case_unit:unit,case_no:job}),{waitUntil:'domcontentloaded'});
     await p.locator('#detailContent .detail-grid').waitFor({timeout:45000});
     const vals=await p.locator('#detailContent .detail-grid strong').allTextContents();
     assert.equal(vals[0],unit);
     assert.equal(vals[1],job);
   }finally{await p.close();}
   await page.locator('#closeDetail').click();
 });
 async function searchBasic(mode,keyword){
   await page.locator('#searchMode').selectOption(mode);
   await page.locator('#searchQuery').fill(keyword);
   await page.locator('#searchForm button[type="submit"]').click();
   await page.waitForFunction(term=>
     (document.getElementById('resultInfo')?.textContent||'').includes(term)
     && document.querySelectorAll('#resultList .case-card').length>0,
     keyword,{timeout:45000});
   assert.ok(await page.locator('#resultList .case-card').count()>0);
 }
 await check('Basic title search works when OpenFun CORS fails',async()=>{
   await searchBasic('title','醫療');
   assert.ok((await page.locator('#resultList .case-title').first().innerText()).includes('醫療'));
 });
 await check('Basic agency-name search works on actual stored agencies',async()=>{
   await searchBasic('agency','國防部');
   assert.ok((await page.locator('#resultList .case-card').first().innerText()).includes('國防部'));
 });
 await check('Basic vendor name search uses real notice company records',async()=>{
   await searchBasic('vendor','台灣糖業股份有限公司');
 });
 await check('Basic company ID search matches stored company IDs',async()=>{
   await searchBasic('companyId','03794905');
 });
 await check('Vendor intelligence list works through archived actual notices',async()=>{
   await page.locator('[data-view="vendors"]').first().click();
   await page.locator('#vendorMode').selectOption('id');
   await page.locator('#vendorQuery').fill('03794905');
   await page.locator('#vendorForm button[type="submit"]').click();
   await page.locator('#vendorOutput .case-card').first().waitFor({timeout:45000});
   assert.ok((await page.locator('#vendorSummary').innerText()).includes('已入庫來源資料'));
 });
 await check('Manual keyword watch checks data without upstream CORS',async()=>{
   await page.locator('[data-view="alerts"]').first().click();
   await page.locator('#watchTerm').fill('醫療');
   await page.locator('#watchForm button[type="submit"]').click();
   await page.locator('#watchOutput .watch-item').first().waitFor({timeout:10000});
   await page.locator('#checkWatch').click();
   await page.waitForFunction(()=>
     (document.getElementById('watchOutput')?.textContent||'').includes('已建立比對基準'),null,{timeout:45000});
   assert.ok((await page.locator('#watchOutput').innerText()).includes('上次檢查'));
 });
 await check('Advanced search default page 1 loads',async()=>{
   await page.locator('[data-view="advanced"]').first().click();
   await waitPage(1,60000);
   assert.ok((await page.locator('#advResults .case-card').count())>0);
 });
 await check('Advanced next page and previous page both change results',async()=>{
   const first=await firstAdvancedId();
   await page.locator('#advNext').click();
   await waitPage(2,60000);
   const second=await firstAdvancedId();
   assert.notEqual(first,second);
   await page.locator('#advPrev').click();
   await waitPage(1,60000);
   assert.equal(await firstAdvancedId(),first);
 });
 await check('Keyword search and its next page return different cases',async()=>{
   await page.locator('#advQuery').fill('資訊');
   await search();
   const first=await firstAdvancedId();
   assert.equal(await page.locator('#advNext').isDisabled(),false);
   await page.locator('#advNext').click();
   await waitPage(2,60000);
   assert.notEqual(await firstAdvancedId(),first);
 });
 await check('Boolean expression search returns real records',async()=>{
   await page.locator('#advQuery').fill('(資訊 OR 設備) AND NOT 租賃');
   await search();
   assert.ok((await page.locator('#advResults .case-card').count())>0);
 });
 await check('Amount + category filters return eligible budgets only',async()=>{
   await page.locator('#advQuery').fill('');
   await page.locator('#advGroup').selectOption('財物');
   await page.locator('#advMin').fill('3000000');
   await search();
   const budgets=await page.locator('#advResults .case-right strong').allTextContents();
   assert.ok(budgets.length>0);
   for(const s of budgets){
     const amount=Number(s.replace(/[^\d]/g,''));
     assert.ok(amount>=3000000,'Budget under filter: '+s);
   }
 });
 await check('Agency + date range returns matching records',async()=>{
   await page.locator('#advGroup').selectOption('');
   await page.locator('#advMin').fill('');
   await page.locator('#advAgency').fill('國防部');
   await page.locator('#advStart').fill('2026-11-01');
   await page.locator('#advEnd').fill('2026-11-04');
   await search();
   const agencies=await page.locator('#advResults .case-meta').first().innerText();
   assert.ok(agencies.includes('國防部'),agencies);
 });
 await check('Invalid budget interval is rejected by UI',async()=>{
   await page.locator('#advStart').fill('');
   await page.locator('#advEnd').fill('');
   await page.locator('#advMin').fill('5000000');
   await page.locator('#advMax').fill('1000000');
   await page.locator('#advSubmit').click();
   const status=await page.locator('#advStatus').innerText();
   assert.ok(status.includes('最高公開預算不可小於最低公開預算'),status);
 });
 await check('No-result query is shown as empty rather than fabricated rows',async()=>{
   await page.locator('#advAgency').fill('');
   await page.locator('#advMin').fill('');
   await page.locator('#advMax').fill('');
   await page.locator('#advQuery').fill('不可能出現的不存在案件識別字ZZ987654321');
   await search();
   assert.equal(await page.locator('#advResults .case-card').count(),0);
 });
 await check('Verified decision-method filter excludes missing decision method',async()=>{
   await page.locator('[data-view="advanced"]').first().click();
   await page.locator('#advQuery').fill('');
   await page.locator('#advAgency').fill('');
   await page.locator('#advDecisionMethod').fill('最低標');
   await search();
   assert.ok((await page.locator('#advResults .case-card').count())>0,'No real minimum-bid-method samples');
   const lines=await page.locator('#advResults .case-card').allTextContents();
   assert.ok(lines.every(s=>s.includes('決標方式：最低標')),'Unknown decision method was included');
 });
 await check('Source-only failed-bid explorer loads actual notices',async()=>{
   await page.locator('[data-view="issues"]').first().click();
   await page.waitForFunction(()=>document.getElementById('issueStatus')?.textContent?.includes('找到'),null,{timeout:60000});
   assert.ok((await page.locator('#issueResults .case-card').count())>0);
 });
 await check('Archive award-price strata by decision method and budget',async()=>{
   await page.locator('[data-view="analytics"]').first().click();
   await page.locator('#awardMethod').fill('最低標');
   await page.locator('#awardMinBudget').fill('100000');
   await page.locator('#awardMaxBudget').fill('5000000');
   await page.locator('#awardSampleForm button[type="submit"]').click();
   await page.waitForFunction(()=>document.getElementById('awardSampleOutput')?.textContent?.includes('可比較樣本'),null,{timeout:60000});
   assert.ok((await page.locator('#awardSampleOutput .timeline-item').count())>0,'No evidence-priced cases');
 });
 await check('Actual agency monthly and repeated-name archive evidence',async()=>{
   await page.locator('[data-view="agencies"]').first().click();
   await page.locator('#agencyId').fill('3.13.50');
   await page.locator('#agencyForm button[type="submit"]').click();
   await page.locator('#agencyOutput table').waitFor({timeout:60000});
   assert.ok((await page.locator('#agencyOutput').innerText()).includes('已入庫年度統計'));
   await page.locator('#agencyMonthlyOutput table').waitFor({timeout:60000});
   assert.ok((await page.locator('#agencyMonthlyOutput tr').count())>1);
   await page.locator('#agencyRepeatOutput .watch-item').first().waitFor({timeout:60000});
 });
 await check('Daily source-quality report exposes completeness and licensing',async()=>{
   await page.locator('[data-view="about"]').first().click();
   await page.waitForFunction(()=>document.getElementById('qualityCheckStatus')?.textContent?.includes('案件'),null,{timeout:45000});
   assert.ok((await page.locator('#qualitySources .timeline-item').count())>0);
 });
 await check('Public vendor co-mentions show actual cross-referenced notices',async()=>{
   await page.locator('[data-view="vendors"]').first().click();
   await page.locator('#vendorEvidenceTaxId').fill('24935439');
   await page.locator('#vendorCoMentionsButton').click();
   await page.locator('#vendorCoMentionsOutput .watch-item').first().waitFor({timeout:45000});
   const text=await page.locator('#vendorCoMentionsOutput').innerText();
   assert.ok(text.includes('同份公告')||text.includes('同公告'));
 });
 console.log('ALL PRD PUBLIC BROWSER SMOKE TESTS PASSED');
})().catch(async(e)=>{
 if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});
 console.error(e.stack||e);
 process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close();});
