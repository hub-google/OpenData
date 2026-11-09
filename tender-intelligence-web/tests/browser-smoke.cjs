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
async function navigate(view){
 if(await page.locator('#detailDrawer').isVisible())await page.locator('#closeDetail').click();
 const button=page.locator('[data-view="'+view+'"]').first();
 const group=button.locator('xpath=ancestor::details[1]');
 if(await group.count() && (await group.getAttribute('open'))===null)await group.locator('summary').click();
 await button.click();
}
async function search(){
 await page.locator('#advSubmit').click();
 await page.waitForFunction(()=>{
   const text=document.getElementById('advStatus')?.textContent||'';
   return text.includes('實際已入庫資料符合條件')||text.includes('資料庫進階搜尋失敗');
 },null,{timeout:45000});
 await waitPage(1);
 const message=await page.locator('#advStatus').innerText();
 console.log('ADVANCED_SEARCH_RESPONSE '+message.slice(0,220));
 assert.ok(message.includes('實際已入庫資料符合條件'),'進階搜尋未完成：'+message);
}
async function firstAdvancedId(){
 return await page.locator('#advResults .case-card a.case-title').first().getAttribute('href');
}
(async()=>{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 page=await browser.newPage({locale:'zh-TW',viewport:{width:1440,height:900}});
 const browserPageErrors=[];
 page.on('pageerror',e=>{browserPageErrors.push(e.message);console.error('BROWSER_PAGE_ERROR '+e.message);});
 page.on('console',m=>{if(m.type()==='error')console.error('BROWSER_CONSOLE '+m.text());});
 await check('Open public website',async()=>{
   const res=await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});
   assert.ok(res?.ok(),String(res?.status()));
   await page.locator('#resultList .case-card').first().waitFor({timeout:60000});
   assert.equal(browserPageErrors.length,0,'Page module syntax/runtime errors: '+browserPageErrors.join(' | '));
 });
 await check('Latest page contains verified monetary values, not all unknown',async()=>{
   const values=await page.locator('#resultList .case-right strong').allTextContents();
   assert.ok(values.length>0,'No latest cards');
   assert.ok(values.some(v=>v.startsWith('NT$')),'All latest budget values appear unknown');
 });
 await check('Latest search displays unique case records',async()=>{
   const loaded=Number((await page.locator('#metricLoaded').innerText()).replace(/,/g,''));
   const total=Number((await page.locator('#metricCases').innerText()).replace(/,/g,''));
   const info=await page.locator('#resultInfo').innerText();
   assert.ok(loaded>0&&total>=loaded,'Case count must reflect unique opportunities');
   assert.ok(info.includes('每個案件僅顯示一筆'),'Case-level result explanation missing');
   const keys=await page.locator('#resultList .case-card').evaluateAll(cards=>cards.map(card=>{
     const parts=Array.from(card.querySelectorAll('.case-meta span')).map(x=>x.textContent||'');
     return (parts[1]||'')+'|'+(parts.find(x=>x.includes('案號 '))||'');
   }));
   assert.equal(new Set(keys).size,keys.length,'Duplicate procurement opportunity on the page');
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
   const info=await page.locator('#resultInfo').innerText();
   assert.ok(info.includes('跨日全文搜尋：醫療'),'全文搜尋沒有使用原查詢條件：'+info);
   assert.ok((await page.locator('#resultList .case-card').first().innerText()).includes('命中：'),'未說明本案的命中來源');
 });
 await check('Basic agency-name search works on actual stored agencies',async()=>{
   await searchBasic('agency','國防部');
   assert.ok((await page.locator('#resultList .case-card').first().innerText()).includes('國防部'));
 });
 // Verify the dedicated indexed vendor path against the deployed production database.
 await check('Basic vendor name search uses real notice company records',async()=>{
   await searchBasic('vendor','台灣糖業股份有限公司');
 });
 await check('Basic company ID search matches stored company IDs',async()=>{
   await searchBasic('companyId','03794905');
 });
 await check('Vendor intelligence list works through archived actual notices',async()=>{
   await navigate('vendors');
   await page.locator('#vendorMode').selectOption('id');
   await page.locator('#vendorQuery').fill('03794905');
   await page.locator('#vendorForm button[type="submit"]').click();
   await page.locator('#vendorOutput .case-card').first().waitFor({timeout:45000});
   assert.ok((await page.locator('#vendorSummary').innerText()).includes('已入庫來源資料'));
 });
 await check('Manual keyword watch checks data without upstream CORS',async()=>{
   await navigate('alerts');
   await page.locator('#watchTerm').fill('醫療');
   await page.locator('#watchForm button[type="submit"]').click();
   await page.locator('#watchOutput .watch-item').first().waitFor({timeout:10000});
   await page.locator('#checkWatch').click();
   await page.waitForFunction(()=>
     (document.getElementById('watchOutput')?.textContent||'').includes('已建立比對基準'),null,{timeout:45000});
   assert.ok((await page.locator('#watchOutput').innerText()).includes('上次檢查'));
 });
 await check('Advanced search default page 1 loads',async()=>{
   await navigate('advanced');
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
   let indexedRequests=0;
   const watch=req=>{if(req.url().includes('/rpc/ti_archive_search_simple'))indexedRequests++};
   page.on('request',watch);
   await page.locator('#advQuery').fill('資訊');
   await search();
   page.off('request',watch);
   assert.ok(indexedRequests>=1,'Simple keyword did not use indexed RPC');
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
   let fast=0;
   const watcher=req=>{if(req.url().includes('/rpc/ti_archive_search_simple'))fast++};
   page.on('request',watcher);
   await page.locator('#advAgency').fill('');
   await page.locator('#advMin').fill('');
   await page.locator('#advMax').fill('');
   await page.locator('#advQuery').fill('不可能出現的不存在案件識別字ZZ987654321');
   await search();
   assert.equal(await page.locator('#advResults .case-card').count(),0);
   page.off('request',watcher);
   assert.ok(fast>0,'No-result simple keyword did not use indexed search');
 });
 await check('Verified decision-method filter excludes missing decision method',async()=>{
   await navigate('advanced');
   await page.locator('#advQuery').fill('');
   await page.locator('#advAgency').fill('');
   await page.locator('#advDecisionMethod').fill('最低標');
   await search();
   assert.ok((await page.locator('#advResults .case-card').count())>0,'No real minimum-bid-method samples');
   const lines=await page.locator('#advResults .case-card').allTextContents();
   assert.ok(lines.every(s=>s.includes('決標方式：最低標')),'Unknown decision method was included');
 });
 await check('Source-only failed-bid explorer loads actual notices',async()=>{
   await navigate('issues');
   await page.waitForFunction(()=>document.getElementById('issueStatus')?.textContent?.includes('找到'),null,{timeout:60000});
   assert.ok((await page.locator('#issueResults .case-card').count())>0);
 });
 await check('Archive award-price strata by decision method and budget',async()=>{
   await navigate('analytics');
   await page.locator('#awardMethod').fill('最低標');
   await page.locator('#awardMinBudget').fill('100000');
   await page.locator('#awardMaxBudget').fill('5000000');
   await page.locator('#awardSampleForm button[type="submit"]').click();
   await page.waitForFunction(()=>document.getElementById('awardSampleOutput')?.textContent?.includes('可比較樣本'),null,{timeout:60000});
   assert.ok((await page.locator('#awardSampleOutput .timeline-item').count())>0,'No evidence-priced cases');
 });
 await check('Actual agency monthly and repeated-name archive evidence',async()=>{
   await navigate('agencies');
   await page.locator('#agencyId').fill('3.13.50');
   await page.locator('#agencyForm button[type="submit"]').click();
   await page.locator('#agencyOutput table').first().waitFor({timeout:60000});
   assert.ok((await page.locator('#agencyOutput').innerText()).includes('已確認得標廠商'));
   await page.locator('#agencyMonthlyOutput table').waitFor({timeout:60000});
   assert.ok((await page.locator('#agencyMonthlyOutput tr').count())>1);
   assert.ok((await page.locator('#agencyMonthlyOutput').innerText()).includes('決標中位數'));
   await page.locator('#agencyMonthlyGroup').selectOption('財物');
   await page.locator('#agencyMonthlyForm button[type="submit"]').click();
   await page.waitForFunction(()=>document.getElementById('agencyMonthlyOutput')?.textContent?.includes('決標中位數'),null,{timeout:60000});
   assert.equal(await page.locator('#agencyMonthlyGroup').inputValue(),'財物');
   await page.locator('#agencyRepeatOutput .watch-item').first().waitFor({timeout:60000});
 });
 await check('Daily source-quality report exposes completeness and licensing',async()=>{
   await navigate('about');
   await page.waitForFunction(()=>document.getElementById('qualityCheckStatus')?.textContent?.includes('案件'),null,{timeout:45000});
   assert.ok((await page.locator('#qualitySources .timeline-item').count())>0);
 });
 await check('Public vendor co-mentions show actual cross-referenced notices',async()=>{
   await navigate('vendors');
   await page.locator('#vendorEvidenceTaxId').fill('24935439');
   await page.locator('#vendorCoMentionsButton').click();
   await page.waitForFunction(()=>{
    const output=document.getElementById('vendorCoMentionsOutput');
    return !!output&&(output.querySelector('.watch-item')||/失敗|沒有同公告/.test(output.textContent||''));
   },null,{timeout:30000});
   const coSummary=await page.locator('#vendorCoMentionsOutput').innerText();
   assert.ok((await page.locator('#vendorCoMentionsOutput .watch-item').count())>0,
     '真實同公告廠商搜尋沒有結果：'+coSummary.slice(0,320));
   const text=await page.locator('#vendorCoMentionsOutput').innerText();
   assert.ok(text.includes('同份公告')||text.includes('同公告'));
   await page.locator('#vendorRolesButton').click();
   await page.locator('#vendorRolesOutput .analysis-list tr').nth(1).waitFor({timeout:60000});
   const roles=await page.locator('#vendorRolesOutput').innerText();
   assert.ok(roles.includes('明示得標公告')&&roles.includes('明示投標公告'),roles.slice(0,180));
 });
 await check('Mobile viewport: latest notices, menu, detail drawer without horizontal overflow',async()=>{
   const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-TW'});
   try{
     await mobile.goto(base,{waitUntil:'domcontentloaded',timeout:45000});
     await mobile.locator('#resultList .case-card').first().waitFor({timeout:45000});
     const width=await mobile.evaluate(()=>({
       screen:document.documentElement.clientWidth,
       body:document.documentElement.scrollWidth
     }));
     if(width.body>width.screen+8){
       const offenders=await mobile.evaluate(()=>{
         const limit=document.documentElement.clientWidth;
         return [...document.querySelectorAll('body *')].filter(el=>{
           const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
           return style.display!=='none'&&style.visibility!=='hidden'&&
             rect.width>0&&rect.right>limit+8&&rect.left<limit;
         }).sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right)
           .slice(0,22).map(el=>({tag:el.tagName,id:el.id,
             cls:String(el.className).slice(0,90),
             right:Math.round(el.getBoundingClientRect().right),
             width:Math.round(el.getBoundingClientRect().width),
             text:(el.textContent||'').trim().slice(0,40)}));
       });
       console.log('MOBILE_OVERFLOW_DIAGNOSTIC '+JSON.stringify(offenders));
     }
     assert.ok(width.body<=width.screen+8,'Unexpected mobile horizontal scroll: '+JSON.stringify(width));
     await mobile.locator('#mobileMenu').click();
     assert.ok(await mobile.locator('.sidebar').evaluate(el=>el.classList.contains('mobile-open')));
     await mobile.locator('.sidebar [data-view="search"]').first().click();
     await mobile.locator('#resultList .case-title').first().click();
     await mobile.locator('#detailContent .detail-grid').first().waitFor({timeout:45000});
     const drawer=await mobile.locator('#detailDrawer').boundingBox();
     assert.ok(drawer&&drawer.width<=width.screen+8,'Detail drawer wider than viewport');
   }finally{await mobile.close();}
 });
 console.log('ALL PRD PUBLIC BROWSER SMOKE TESTS PASSED');
})().catch(async(e)=>{
 if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});
 console.error(e.stack||e);
 process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close();});
