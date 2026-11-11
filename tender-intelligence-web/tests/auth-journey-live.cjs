const fs=require('node:fs'),{chromium}=require('playwright');
const BASE='https://hub-google.github.io/OpenData/tender-intelligence-web/';
const DIR='tender-intelligence-web/audits',records=[],pageErrors=[];
fs.mkdirSync(DIR,{recursive:true});
const prefix='【稽核測試-20261105-'+Date.now().toString().slice(-7)+'】';
let browser,page,loggedIn=false;
const short=(s,n=400)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,n);
async function step(name,fn){
 try{const data=await fn();records.push({name,status:'PASS',data});console.log('PASS',name,JSON.stringify(data).slice(0,500));}
 catch(e){records.push({name,status:'FAIL',error:short(e.message)});console.log('FAIL',name,short(e.message));}
}
async function nav(id){
 const btn=page.locator('[data-view="'+id+'"]').first(),grp=btn.locator('xpath=ancestor::details[1]');
 if(await grp.count() && (await grp.getAttribute('open'))===null)await grp.locator('summary').click();
 await btn.click();await page.waitForTimeout(220);
}
async function shot(name){try{await page.screenshot({path:DIR+'/'+name+'.png',timeout:10000});return name+'.png';}catch(e){return 'unavailable';}}
const file={name:'tender-audit-check.txt',mimeType:'text/plain',buffer:Buffer.from('資格：廠商須具備資訊安全設備維護實績，並檢附有效資格證明。履約期限：116年12月31日。押標金：依官方招標文件規定。','utf8')};
async function run(){
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1400,height:900},locale:'zh-TW',timezoneId:'Asia/Taipei'});
 page.setDefaultTimeout(14000);page.on('pageerror',e=>pageErrors.push(short(e.message)));
 await step('使用網站的一鍵測試帳號登入',async()=>{
  await page.goto(BASE+'?demo=1',{waitUntil:'domcontentloaded',timeout:40000});
  await page.locator('#accountDemoQuick').waitFor({state:'visible',timeout:30000});
  await page.locator('#accountDemoQuick').click();
  await page.waitForFunction(()=>document.querySelector('#accountInfo')?.textContent?.includes('測試帳號已登入'),null,{timeout:25000});
  loggedIn=true;
  return {account_button:short(await page.locator('#accountButton').innerText()),screen:await shot('11-login')};
 });
 if(!loggedIn)return;
 await step('建立私人公司資料並儲存',async()=>{
  await nav('company');await page.locator('#tiCompanyName').fill(prefix+'模擬資安服務公司');
  await page.locator('#tiCompanyServices').fill('資安、資訊系統、設備維護');
  await page.locator('#tiCompanyIntro').fill('系統測試資料，非真實公司');
  await page.locator('#tiCompanySave').click();
  await page.waitForFunction(prefix=>document.querySelector('#tiCompanyStatus')?.textContent?.includes('已儲存'),prefix,{timeout:10000});
  return {status:short(await page.locator('#tiCompanyStatus').innerText()),screen:await shot('12-company-save')};
 });
 await step('新增公司實績並查回清單',async()=>{
  await page.locator('#tiAssetType').selectOption('project');
  await page.locator('#tiAssetTitle').fill(prefix+'模擬維護實績');
  await page.locator('#tiAssetIssuer').fill('測試來源（非真實）');
  await page.locator('#tiAssetDetails').fill('這筆資料僅驗證表單與資料庫寫入，不表示真實資格。');
  await page.locator('#tiAssetSave').click();
  await page.waitForFunction(value=>document.querySelector('#tiCompanyAssets')?.textContent?.includes(value),prefix+'模擬維護實績',{timeout:10000});
  return {status:short(await page.locator('#tiCompanyStatus').innerText()),visible:await page.locator('#tiCompanyAssets').innerText(),screen:await shot('13-company-asset')};
 });
 await step('從真實標案詳情加入私人追蹤',async()=>{
  await page.goto(BASE+'?case_unit=3.1.1&case_no=UT-11601',{waitUntil:'domcontentloaded',timeout:40000});
  await page.locator('.ti-case-tab').first().waitFor({timeout:22000});
  await page.locator('#detailContent .detail-actions').first().getByRole('button',{name:'加入投標追蹤'}).click();
  await page.waitForTimeout(1200);
  return {button:short(await page.locator('#detailContent .detail-actions').first().innerText(),150),screen:await shot('14-save-case')};
 });
 await step('官方資料缺漏補抓請求',async()=>{
  await page.waitForFunction(()=>document.querySelector('.ti-decision-brief')?.textContent?.includes('資料完整度'),null,{timeout:12000});
  const brief=page.locator('.ti-decision-brief');
  await brief.getByRole('button',{name:'補抓這件標案的官方詳情'}).click();
  await page.waitForFunction(()=>document.querySelector('.ti-decision-brief')?.textContent?.includes('已加入補抓佇列'),null,{timeout:8500});
  return {status:short(await brief.innerText(),290)};
 });
 await step('案件詳情：儲存投標評估',async()=>{
  await page.getByRole('tab',{name:'投標評估'}).click();
  const p=page.locator('#detailContent .ti-case-panel:not([hidden])');
  await p.locator('select').first().selectOption('評估中');
  await p.locator('textarea').first().fill(prefix+'：尚未取得招標文件，不可判斷公司資格');
  await p.getByRole('button',{name:'儲存案件決策'}).click();await page.waitForTimeout(1000);
  return {status:short(await p.innerText(),300),screen:await shot('15-decision')};
 });
 await step('案件詳情：新增待辦事項',async()=>{
  await page.getByRole('tab',{name:'任務協作'}).click();
  const p=page.locator('#detailContent .ti-case-panel:not([hidden])');
  await p.locator('input').first().fill(prefix+'核對招標資格');
  await p.getByRole('button',{name:'新增任務'}).click();await page.waitForTimeout(1300);
  return {content:short(await p.innerText(),340),screen:await shot('16-task')};
 });
 await step('案件詳情：直接上傳私人文件',async()=>{
  await page.getByRole('tab',{name:'文件與標書'}).click();
  const p=page.locator('#detailContent .ti-case-panel:not([hidden])');
  await p.locator('input[type=file]').first().setInputFiles(file);
  await p.getByRole('button',{name:'上傳至此案文件庫'}).click();
  const saved=await page.waitForFunction(()=>document.querySelector('#detailContent .ti-case-panel:not([hidden])')?.textContent?.includes('tender-audit-check.txt'),null,{timeout:12000}).then(()=>true).catch(()=>false);
  const content=short(await p.innerText(),480),toast=short(await page.locator('#toast').innerText(),300);
  if(!saved){
   const rows=await page.evaluate(async()=>{
    const {getClient}=await import('./backend.js'),db=await getClient(),{data:{user}}=await db.auth.getUser();
    const {data,error}=await db.from('ti_documents').select('filename,case_id,storage_path').eq('user_id',user.id).order('created_at',{ascending:false}).limit(5);
    return {data,error:error?.message};
   });
   throw Error('文件已存但案件清單未更新：'+toast+'；'+JSON.stringify(rows).slice(0,380));
  }
  if(content.includes('文件尚未儲存成功'))throw Error('私有文件上傳失敗：'+toast+'；'+content);
  return {content,toast,screen:await shot('17-document')};
 });
 await step('下載單案私有文件並確認原始位元內容',async()=>{
  const panel=page.locator('#detailContent .ti-case-panel:not([hidden])');
  const [download]=await Promise.all([
   page.waitForEvent('download',{timeout:15000}),
   panel.getByRole('button',{name:'下載文件'}).first().click()
  ]);
  const bytes=fs.readFileSync(await download.path());
  if(!bytes.equals(file.buffer))throw Error('下載位元內容與上傳檔案不一致');
  return {filename:download.suggestedFilename(),bytes:bytes.length};
 });
 await step('標書條款：公司實績候選比對並保存',async()=>{
  await page.locator('#closeDetail').click();await nav('documents');
  await page.locator('#documentFile').setInputFiles(file);
  await page.locator('#documentCaseId').selectOption('3.1.1::UT-11601');
  await page.locator('#tiCompareCompany').click();await page.waitForTimeout(1700);
  const checkCount=await page.locator('#tiCompareResults .ti-qualify-row').count();
  if(checkCount)await page.locator('#tiCompareResults button').last().click();
  await page.waitForTimeout(900);
  const status=short(await page.locator('#tiCompareStatus').innerText());
  if(!status.includes('已保存')||!status.includes('此標案'))throw Error('資格記錄未關聯案件：'+status);
  return {check_count:checkCount,status,screen:await shot('18-qualification')};
 });
 await step('監控：新增測試用競品條件',async()=>{
  await nav('alerts');
  await page.getByRole('tab',{name:'競品追蹤'}).click();
  await page.locator('[name="competitorName"]').fill(prefix+'不存在廠商');
  await page.locator('.ti-tracker-module button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-watch-status]')?.textContent?.includes('已保存 1 個指定廠商'),null,{timeout:15000});
  const status=short(await page.locator('[data-watch-status]').innerText()),url=page.url();
  if(!await page.locator('[data-watch-list]').innerText().then(t=>t.includes(prefix+'不存在廠商')))
   throw Error('監控清單沒有新增的指定廠商');
  if(!status.includes('已保存 1 個指定廠商')&&!status.includes('已載入 1 個指定廠商'))throw Error('競品新增未完成：'+status+'；當前網址：'+url+'；頁面錯誤：'+pageErrors.slice(-1));
  return {status,url,screen:await shot('19-competitor')};
 });
 await step('報表：建立每日測試排程',async()=>{
  await nav('alerts');await page.getByRole('tab',{name:'自動報表'}).click();
  const input=page.locator('[name="reportTitle"]');
  if(!await input.isVisible())throw Error('報表表單不可見：'+JSON.stringify(await input.evaluate(e=>({hiddenAncestors:[...function*(n){for(let x=n;x;x=x.parentElement)if(x.hidden||getComputedStyle(x).display==='none')yield x.id||x.className||x.tagName}(e)],view:document.querySelector('#currentViewLabel')?.textContent}))));
  await input.fill(prefix+'投標追蹤');
  await page.locator('[name="reportType"]').selectOption('my_pipeline');
  await page.locator('[name="reportFrequency"]').selectOption('daily');
  await page.locator('.ti-report-form button[type="submit"]').click();await page.waitForTimeout(1300);
  const schedules=page.locator('[data-report-schedules]');
  await page.waitForFunction(()=>document.querySelector('[data-report-schedules]')?.textContent?.includes('立即產生一次'),{timeout:10000});
  await schedules.getByRole('button',{name:'立即產生一次'}).first().click();
  await page.waitForFunction(()=>document.querySelector('[data-report-results]')?.textContent?.includes('預覽內容'),{timeout:12000});
  await page.locator('[data-report-results]').getByRole('button',{name:'預覽內容'}).first().click();
  const status=short(await page.locator('[data-report-status]').innerText()),
    preview=short(await page.locator('.ti-report-preview:not([hidden])').first().innerText(),280);
  if(!status.includes('已立即產生報表'))throw Error('立即產生報表未成功：'+status);
  const [download]=await Promise.all([
   page.waitForEvent('download',{timeout:15000}),
   page.locator('[data-report-results]').getByRole('button',{name:'下載 CSV'}).first().click()
  ]);
  const csv=fs.readFileSync(await download.path(),'utf8');
  if(!csv.includes('UT-11601')||!csv.includes('case_id'))throw Error('CSV 缺少儲存的投標案例');
  return {status,preview,download:download.suggestedFilename(),bytes:Buffer.byteLength(csv),screen:await shot('20-report')};
 });
 await step('私人資料跨帳號隔離測試',async()=>{
  const other=await browser.newContext({locale:'zh-TW',timezoneId:'Asia/Taipei'});
  const p2=await other.newPage();
  try{
   await p2.goto(BASE,{waitUntil:'domcontentloaded',timeout:35000});
   await p2.locator('#accountDemoQuick').click();
   await p2.waitForFunction(()=>document.querySelector('#accountButton')?.textContent?.includes('測試帳號已登入'),null,{timeout:20000});
   const rows=await p2.evaluate(async()=>{
    const {getClient}=await import('./backend.js'),db=await getClient();
    const [docs,assets,cases,reports]=await Promise.all([
     db.from('ti_documents').select('id').limit(20),
     db.from('ti_company_assets').select('id').limit(20),
     db.from('ti_saved_cases').select('case_id').limit(20),
     db.from('ti_report_jobs').select('id').limit(20)
    ]);
    return {docs:docs.data?.length,assets:assets.data?.length,cases:cases.data?.length,
      reports:reports.data?.length,errors:[docs.error,assets.error,cases.error,reports.error].map(x=>x?.message).filter(Boolean)};
   });
   if(rows.errors.length||rows.docs||rows.assets||rows.cases||rows.reports)
     throw Error('新測試帳號看到了別人的資料或存取失敗：'+JSON.stringify(rows));
   await p2.evaluate(async()=>{const {getClient}=await import('./backend.js');(await getClient()).auth.signOut()});
   return rows;
  }finally{await other.close();}
 });
 await step('返回頁面：確認私人公司資料跨頁保存',async()=>{
  await nav('company');await page.locator('#tiCompanyRefresh').click();await page.waitForTimeout(1200);
  return {company:await page.locator('#tiCompanyName').inputValue(),asset:short(await page.locator('#tiCompanyAssets').innerText(),240),screen:await shot('21-readback')};
 });
 await step('投標績效統計只計入自行記錄的已結案結果',async()=>{
  await nav('tracking');
  const panel=page.locator('#trackingPerformance');
  await panel.waitFor({state:'visible',timeout:10000});
  const results=()=>panel.locator('.ti-performance-metric strong').allTextContents();
  const first=await results();
  if(first.length!==4||first[3]!=='—')throw Error('未有已結案紀錄卻顯示得標率：'+JSON.stringify(first));
  const select=page.locator('#trackingOutput .track-fields select').first();
  await select.selectOption('已得標');
  const won=await results();
  if(won[2]!=='1'||won[3]!=='100.0%')throw Error('自行記錄已得標績效錯誤：'+JSON.stringify(won));
  await select.selectOption('未得標');
  const lost=await results();
  if(lost[2]!=='0'||lost[3]!=='0.0%')throw Error('自行記錄未得標績效錯誤：'+JSON.stringify(lost));
  await select.selectOption('評估中');
  const reset=await results();
  if(reset[3]!=='—')throw Error('回復未決後應隱藏得標率：'+JSON.stringify(reset));
  return {initial:first,won,lost,reset,screen:await shot('22-private-bid-outcomes')};
 });
 await step('刪除單案私人文件並確認已從資料庫移除',async()=>{
  await page.goto(BASE+'?case_unit=3.1.1&case_no=UT-11601',{waitUntil:'domcontentloaded',timeout:35000});
  await page.getByRole('tab',{name:'文件與標書'}).click();
  const panel=page.locator('#detailContent .ti-case-panel:not([hidden])');
  await panel.getByRole('button',{name:'刪除文件'}).first().waitFor({timeout:12000});
  page.once('dialog',dialog=>dialog.accept());
  await panel.getByRole('button',{name:'刪除文件'}).first().click();
  await page.waitForFunction(()=>!document.querySelector('#detailContent .ti-case-panel:not([hidden])')?.textContent?.includes('tender-audit-check.txt'),null,{timeout:12000});
  const result=await page.evaluate(async()=>{
   const {getClient}=await import('./backend.js'),db=await getClient(),{data:{user}}=await db.auth.getUser();
   const {data,error}=await db.from('ti_documents').select('id').eq('user_id',user.id).eq('case_id','3.1.1::UT-11601');
   return {remaining:data?.length,error:error?.message};
  });
  if(result.error||result.remaining!==0)throw Error('文件刪除後資料庫仍有紀錄：'+JSON.stringify(result));
  return result;
 });
 await step('清理本次測試帳號下的私人測試資料',async()=>{
  const result=await page.evaluate(async()=>{
   const {getClient}=await import('./backend.js'),db=await getClient(),{data:{user}}=await db.auth.getUser();
   if(!user?.is_anonymous)throw Error('refuse cleanup of non-anonymous user');
   const removed={};
   const {data:docs}=await db.from('ti_documents').select('id,storage_path').eq('user_id',user.id);
   for(const table of ['ti_detail_requests','ti_qualification_checks','ti_report_jobs','ti_report_schedules','ti_competitor_watches','ti_company_assets','ti_company_profiles','ti_bid_decisions','ti_tasks','ti_contract_obligations','ti_saved_cases','ti_watch_rules']){
    const {error}=await db.from(table).delete().eq('user_id',user.id);
    removed[table]=error?.message||'delete requested';
   }
   if(Array.isArray(docs)&&docs.length){
    const owned=docs.map(x=>x.storage_path).filter(p=>p?.startsWith(user.id+'/'));
    if(owned.length){const {error}=await db.storage.from('ti-private-documents').remove(owned);removed.storage=error?.message||'deleted';}
    const {error}=await db.from('ti_documents').delete().eq('user_id',user.id);removed.ti_documents=error?.message||'deleted';
   }
   await db.auth.signOut();
   return removed;
  });
  return {cleanup:result};
 });
}
function save(){
 const data={generated_at:new Date().toISOString(),target:BASE,browser:'Playwright Chromium, anonymous demo account',prefix,results:records,page_errors:pageErrors};
 fs.writeFileSync(DIR+'/2026-11-05-auth-click-audit.json',JSON.stringify(data,null,2));
 const rows=['# 標案網站測試帳號實際操作報告','','時間：'+data.generated_at,'使用獨立匿名測試帳號；資料為非真實公司測試資訊。','','| 測試 | 結果 | 資料庫或網頁回應 |','|---|---|---|'];
 for(const r of records)rows.push('| '+r.name+' | '+r.status+' | '+short(JSON.stringify(r.data||r.error),350).replace(/\|/g,'/')+' |');
 rows.push('','頁面 JS 例外：'+pageErrors.length,'未實測 Email/LINE 對外寄達，也沒有建立真實採購契約。');
 fs.writeFileSync(DIR+'/2026-11-05-auth-click-audit.md',rows.join('\n'));
 console.log('AUTH AUDIT',records.filter(r=>r.status==='PASS').length,'/',records.length);
}
run().catch(e=>{records.push({name:'測試流程未預期中止',status:'FAIL',error:short(e.message)});console.error(e)})
.finally(async()=>{try{await browser?.close()}catch{}save();if(!records.length||records.some(r=>r.status!=='PASS')||pageErrors.length)process.exitCode=1;});
