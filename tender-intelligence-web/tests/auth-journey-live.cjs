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
  await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:40000});
  await page.locator('#accountDemoQuick').click();
  await page.waitForFunction(()=>document.querySelector('#accountButton')?.textContent?.includes('測試帳號已登入'),{timeout:25000});
  loggedIn=true;
  return {account_button:short(await page.locator('#accountButton').innerText()),screen:await shot('11-login')};
 });
 if(!loggedIn)return;
 await step('建立私人公司資料並儲存',async()=>{
  await nav('company');await page.locator('#tiCompanyName').fill(prefix+'模擬資安服務公司');
  await page.locator('#tiCompanyServices').fill('資安、資訊系統、設備維護');
  await page.locator('#tiCompanyIntro').fill('系統測試資料，非真實公司');
  await page.locator('#tiCompanySave').click();await page.waitForTimeout(1600);
  return {status:short(await page.locator('#tiCompanyStatus').innerText()),screen:await shot('12-company-save')};
 });
 await step('新增公司實績並查回清單',async()=>{
  await page.locator('#tiAssetType').selectOption('project');
  await page.locator('#tiAssetTitle').fill(prefix+'模擬維護實績');
  await page.locator('#tiAssetIssuer').fill('測試來源（非真實）');
  await page.locator('#tiAssetDetails').fill('這筆資料僅驗證表單與資料庫寫入，不表示真實資格。');
  await page.locator('#tiAssetSave').click();await page.waitForTimeout(1600);
  return {status:short(await page.locator('#tiCompanyStatus').innerText()),visible:await page.locator('#tiCompanyAssets').innerText(),screen:await shot('13-company-asset')};
 });
 await step('從真實標案詳情加入私人追蹤',async()=>{
  await page.goto(BASE+'?case_unit=3.1.1&case_no=UT-11601',{waitUntil:'domcontentloaded',timeout:40000});
  await page.locator('.ti-case-tab').first().waitFor({timeout:22000});
  await page.locator('#detailContent .detail-actions').first().getByRole('button',{name:'加入投標追蹤'}).click();
  await page.waitForTimeout(1200);
  return {button:short(await page.locator('#detailContent .detail-actions').first().innerText(),150),screen:await shot('14-save-case')};
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
  await p.getByRole('button',{name:'上傳至此案文件庫'}).click();await page.waitForTimeout(1800);
  return {content:short(await p.innerText(),420),screen:await shot('17-document')};
 });
 await step('標書條款：公司實績候選比對並保存',async()=>{
  await page.locator('#closeDetail').click();await nav('documents');
  await page.locator('#documentFile').setInputFiles(file);
  await page.locator('#tiCompareCompany').click();await page.waitForTimeout(1700);
  const checkCount=await page.locator('#tiCompareResults .ti-qualify-row').count();
  if(checkCount)await page.locator('#tiCompareResults button').last().click();
  await page.waitForTimeout(900);
  return {check_count:checkCount,status:short(await page.locator('#tiCompareStatus').innerText()),screen:await shot('18-qualification')};
 });
 await step('監控：新增測試用競品條件',async()=>{
  await nav('alerts');
  await page.locator('[name="competitorName"]').fill(prefix+'不存在廠商');
  await page.locator('.ti-tracker-module button[type="submit"]').click();await page.waitForTimeout(1300);
  return {status:short(await page.locator('[data-watch-status]').innerText()),screen:await shot('19-competitor')};
 });
 await step('報表：建立每日測試排程',async()=>{
  await page.locator('[name="reportTitle"]').fill(prefix+'投標追蹤');
  await page.locator('[name="reportType"]').selectOption('my_pipeline');
  await page.locator('[name="reportFrequency"]').selectOption('daily');
  await page.locator('.ti-report-form button[type="submit"]').click();await page.waitForTimeout(1300);
  return {status:short(await page.locator('[data-report-status]').innerText()),jobs:short(await page.locator('[data-report-results]').innerText(),200),screen:await shot('20-report')};
 });
 await step('返回頁面：確認私人公司資料跨頁保存',async()=>{
  await nav('company');await page.locator('#tiCompanyRefresh').click();await page.waitForTimeout(1200);
  return {company:await page.locator('#tiCompanyName').inputValue(),asset:short(await page.locator('#tiCompanyAssets').innerText(),240),screen:await shot('21-readback')};
 });
 await step('清理本次測試帳號下的私人測試資料',async()=>{
  const result=await page.evaluate(async()=>{
   const {getClient}=await import('./backend.js'),db=await getClient(),{data:{user}}=await db.auth.getUser();
   if(!user?.is_anonymous)throw Error('refuse cleanup of non-anonymous user');
   const removed={};
   const {data:docs}=await db.from('ti_documents').select('id,storage_path').eq('user_id',user.id);
   for(const table of ['ti_qualification_checks','ti_report_schedules','ti_competitor_watches','ti_company_assets','ti_company_profiles','ti_bid_decisions','ti_tasks','ti_contract_obligations','ti_saved_cases','ti_watch_rules']){
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
.finally(async()=>{try{await browser?.close()}catch{}save();});
