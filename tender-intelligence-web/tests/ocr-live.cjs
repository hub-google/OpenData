// Real on-site OCR audit: no artificial OCR result injection or mock Supabase.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {PDFDocument}=require('pdf-lib');
const BASE='https://hub-google.github.io/OpenData/tender-intelligence-web/';
const DIR='tender-intelligence-web/audits/ocr';
const tests=[],exceptions=[];
fs.mkdirSync(DIR,{recursive:true});
let browser,page;
const brief=x=>String(x?.message||x||'').replace(/\s+/g,' ').slice(0,450);
async function test(name,fn){
 try{const data=await fn();tests.push({name,status:'PASS',data});console.log('PASS',name,JSON.stringify(data).slice(0,550));}
 catch(e){tests.push({name,status:'FAIL',error:brief(e)});console.error('FAIL',name,brief(e));}
}
async function parsed(){
 return page.evaluate(async()=>{
  const {parseDocument}=await import('./app.js');
  const f=document.querySelector('#documentFile').files[0];
  return await parseDocument(f);
 });
}
async function recognize(){
 await page.locator('#tiOcrButton').click();
 await page.waitForFunction(()=>{
   const s=document.querySelector('#tiOcrStatus')?.textContent||'';
   return s.includes('已取得 ')||s.startsWith('OCR 未完成：');
 },null,{timeout:185000});
 const message=await page.locator('#tiOcrStatus').innerText();
 if(message.startsWith('OCR 未完成'))throw Error(message);
 await page.waitForFunction(()=>document.querySelector('#documentOutput')?.textContent?.includes('ISO'),null,{timeout:25000});
 const pages=await parsed();
 const extracted=pages.map(x=>x.text||'').join('\n').replace(/\s+/g,' ').toUpperCase();
 if(!extracted.includes('ISO')||!extracted.includes('27001'))throw Error('沒有取得預期的實際辨識文字：'+extracted.slice(0,350));
 const list=await page.locator('#documentOutput').innerText();
 if(!list.includes('資格／證明')||!list.includes('27001'))throw Error('OCR 結果沒有被送進條款整理：'+brief(list));
 return {message,pages:pages.map(x=>({source:x.source,method:x.method,characters:x.text.length})),sample:extracted.slice(0,180),qualification:list.slice(0,200)};
}
async function run(){
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-TW',timezoneId:'Asia/Taipei'});
 page.on('pageerror',e=>exceptions.push(brief(e)));
 await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:45000});
 const nav=page.locator('[data-view="documents"]').first();
 const details=nav.locator('xpath=ancestor::details[1]');
 if(await details.count()&&await details.getAttribute('open')===null)await details.locator('summary').click();
 await nav.click();
 const png64=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=1850;c.height=500;
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle='#000';ctx.font='bold 110px Arial';ctx.fillText('ISO 27001',80,160);
  ctx.font='bold 86px Arial';ctx.fillText('CERTIFICATE REQUIRED',80,315);
  return c.toDataURL('image/png').split(',')[1];
 });
 const png=Buffer.from(png64,'base64');
 const pdf=await PDFDocument.create(),image=await pdf.embedPng(png);
 const pdfPage=pdf.addPage([960,350]);pdfPage.drawImage(image,{x:0,y:40,width:960,height:260});
 const pdfData=Buffer.from(await pdf.save());
 await test('Scanned PDF has no text layer until actual local OCR',async()=>{
  await page.locator('#documentFile').setInputFiles({name:'official-scan.pdf',mimeType:'application/pdf',buffer:pdfData});
  const pages=await parsed();
  if(pages[0]?.text?.trim())throw Error('掃描 PDF 在 OCR 前就有文字層，測試樣本無效');
  return {page_count:pages.length,text_before:pages[0]?.text?.length||0};
 });
 await test('Scanned PDF OCR feeds same original page into requirements review',async()=>{
  const result=await recognize();
  if(result.pages[0]?.source!=='第 1 頁'||!result.pages[0]?.method?.includes('OCR'))
   throw Error('掃描 PDF 沒有保留來源頁碼與辨識方法');
  await page.screenshot({path:path.join(DIR,'ocr-real-scanned-pdf.png')});
  return result;
 });
 await test('Long PDF OCR can process a later page then accumulate earlier pages',async()=>{
  const batch=await PDFDocument.create(),graphic=await batch.embedPng(png);
  for(let i=0;i<2;i++){
   const page=batch.addPage([960,350]);page.drawImage(graphic,{x:0,y:40,width:960,height:260});
  }
  const bytes=Buffer.from(await batch.save());
  await page.locator('#documentFile').setInputFiles({name:'two-page-scan.pdf',mimeType:'application/pdf',buffer:bytes});
  await page.locator('#tiOcrStartPage').fill('2');
  const second=await recognize();
  const recognized=second.pages.filter(x=>x.characters>0&&x.method?.startsWith('OCR'));
  if(recognized.length!==1||recognized[0].source!=='第 2 頁'||
     !second.pages.some(x=>x.source==='第 1 頁'&&x.characters===0))
   throw Error('未辨識頁應保持空白，第二頁應標為 OCR：'+JSON.stringify(second.pages));
  await page.locator('#tiOcrStartPage').fill('1');
  const merged=await recognize();
  if(merged.pages.length!==2||merged.pages[0].source!=='第 1 頁'||merged.pages[1].source!=='第 2 頁')
   throw Error('跨批辨識文字未保留原頁碼：'+JSON.stringify(merged.pages));
  const saved=await parsed();
  if(saved.filter(x=>x.method?.includes('OCR')).length!==2)throw Error('完整文件解析未使用兩批辨識文字');
  await page.screenshot({path:path.join(DIR,'ocr-scanned-pdf-two-batches.png')});
  return {first_batch:second.pages.length,total:merged.pages.length,source_pages:merged.pages.map(x=>x.source)};
 });
 await test('Nine-page scanned PDF continues with next eight-page batch button',async()=>{
  const batch=await PDFDocument.create(),graphic=await batch.embedPng(png);
  for(let i=0;i<9;i++){
   const page=batch.addPage([960,350]);page.drawImage(graphic,{x:0,y:40,width:960,height:260});
  }
  await page.locator('#documentFile').setInputFiles({
   name:'nine-page-scan.pdf',mimeType:'application/pdf',buffer:Buffer.from(await batch.save())
  });
  const first=await recognize();
  const firstRead=first.pages.filter(x=>x.characters>0&&x.method?.startsWith('OCR'));
  if(firstRead.length!==8||!first.pages.some(x=>x.source==='第 9 頁'&&x.characters===0))
   throw Error('第一批應辨識8頁，保留第9頁未辨識：'+JSON.stringify(first.pages));
  const next=page.locator('#tiOcrNextBatch');
  if(await next.isDisabled())throw Error('第9頁尚未完成，但下一批按鈕被禁用');
  await next.click();
  await page.waitForFunction(()=>document.querySelector('#tiOcrStatus')?.textContent?.includes('已取得 9 頁'),null,{timeout:120000});
  const pages=await parsed();
  const recognized=pages.filter(x=>x.text?.includes('ISO')&&x.method?.startsWith('OCR'));
  if(recognized.length!==9)throw Error('下一批沒有累計保留9頁OCR原文：'+JSON.stringify(pages.map(x=>({source:x.source,method:x.method}))));
  if(!await next.isDisabled())throw Error('已掃描全部9頁後下一批按鈕仍可操作');
  await page.screenshot({path:path.join(DIR,'ocr-real-nine-page-batch.png')});
  return {first_batch:firstRead.length,total_pages:recognized.length,next_disabled:true};
 });
 await test('Image OCR feeds shared parser; changing files invalidates stale cache',async()=>{
  await page.locator('#documentFile').setInputFiles({name:'official-scan.png',mimeType:'image/png',buffer:png});
  const before=await page.evaluate(async()=>{
   try{const {parseDocument}=await import('./app.js');await parseDocument(document.querySelector('#documentFile').files[0]);return 'unexpected-success';}
   catch(e){return String(e.message||e);}
  });
  if(!before.includes('OCR'))throw Error('圖片未辨識前不應有文字：'+before);
  const result=await recognize();
  if(result.pages[0]?.source!=='圖片 OCR')throw Error('圖片辨識來源不正確');
  await page.screenshot({path:path.join(DIR,'ocr-real-image.png')});
  return result;
 });
 await test('Switching to new source clears old OCR evidence',async()=>{
  await page.locator('#documentFile').setInputFiles({name:'different.txt',mimeType:'text/plain',buffer:Buffer.from('新文件只有中文說明，不含舊版 ISO 證照要求','utf8')});
  const result=await parsed();
  const cached=await page.evaluate(()=>window.__tiOcrCache);
  if(cached!==null)throw Error('更換文件後仍保留舊版 OCR 快取');
  if(result.some(p=>p.text.includes('27001')))throw Error('文件內容遭到先前 OCR 污染');
  return {cache:cached,text:result[0]?.text};
 });
}
run().catch(e=>tests.push({name:'Browser setup',status:'FAIL',error:brief(e)}))
.finally(async()=>{
 try{await browser?.close()}catch{}
 const report={at:new Date().toISOString(),target:BASE,browser:'Real Playwright Chromium + Tesseract OCR',tests,page_errors:exceptions};
 fs.writeFileSync(path.join(DIR,'ocr-live-report.json'),JSON.stringify(report,null,2));
 console.log('OCR_AUDIT',tests.filter(x=>x.status==='PASS').length,'/',tests.length,'errors',exceptions.length);
 if(tests.some(x=>x.status!=='PASS')||exceptions.length)process.exitCode=1;
});
