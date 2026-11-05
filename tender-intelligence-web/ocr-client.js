// Browser-side OCR (Tesseract + PDF.js). Documents stay local; upload only happens on explicit separate action.
import {parseDocument} from './app.js';
const $=id=>document.getElementById(id);
const status=t=>{if($('tiOcrStatus'))$('tiOcrStatus').textContent=t;};
function script(src,globalName){
 return new Promise((resolve,reject)=>{
  if(window[globalName])return resolve(window[globalName]);
  const existing=document.querySelector('script[data-ocr-lib="'+globalName+'"]');
  if(existing){existing.addEventListener('load',()=>resolve(window[globalName]),{once:true});existing.addEventListener('error',()=>reject(Error('OCR 元件下載失敗')),{once:true});return;}
  const e=document.createElement('script');e.src=src;e.async=true;e.dataset.ocrLib=globalName;
  e.onload=()=>window[globalName]?resolve(window[globalName]):reject(Error('OCR 元件初始化失敗'));
  e.onerror=()=>reject(Error('OCR 元件下載失敗，請檢查網路連線'));document.head.append(e);
 });
}
async function run(){
 const f=$('documentFile').files?.[0],button=$('tiOcrButton'),output=$('tiOcrOutput');
 if(!f){status('請先選擇掃描型 PDF 或 JPG/PNG 圖片。');return;}
 if(!/\.(pdf|png|jpg|jpeg|webp)$/i.test(f.name)){status('OCR 僅支援 PDF、PNG、JPG、WEBP；文字文件請直接用整理條款。');return;}
 if(f.size>15*1024*1024){status('文件上限 15MB。');return;}
 button.disabled=true;output.replaceChildren();let worker;
 try{
  status('正在載入本機 OCR 元件與繁體中文／英文辨識模型…');
  const Tesseract=await script('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
  worker=await Tesseract.createWorker('chi_tra+eng',1,{logger:m=>{if(m.status==='recognizing text')status('正在辨識文字：'+Math.round((m.progress||0)*100)+'%');}});
  const pages=[];
  if(/\.pdf$/i.test(f.name)){
   // Same pinned PDF.js used by the existing document parser.
   const pdfjs=await script('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
   pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
   const pdf=await pdfjs.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
   const max=Math.min(pdf.numPages,8);
   for(let p=1;p<=max;p++){
    status('正在檢查第 '+p+'／'+max+' 頁的文字層…');
    const page=await pdf.getPage(p),txt=await page.getTextContent();
    const existing=txt.items.map(x=>String(x.str||'')).join(' ').trim();
    if(existing.length>=50){pages.push({source:'第 '+p+' 頁',text:existing,method:'原始文字層'});continue;}
    status('第 '+p+'／'+max+' 頁需要 OCR，正在辨識…');
    const viewport=page.getViewport({scale:1.65}),canvas=document.createElement('canvas');
    canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('無法建立圖片畫布');
    await page.render({canvasContext:context,viewport}).promise;
    const result=await worker.recognize(canvas);
    pages.push({source:'第 '+p+' 頁',text:String(result?.data?.text||'').trim(),method:'OCR'});
    canvas.width=0;canvas.height=0;
   }
   if(pdf.numPages>max)status('僅處理前 '+max+' 頁，其餘 '+(pdf.numPages-max)+' 頁仍須人工確認。');
  }else{
   const result=await worker.recognize(f);
   pages.push({source:'圖片 OCR',text:String(result?.data?.text||'').trim(),method:'OCR'});
  }
  const actual=pages.filter(p=>p.text.trim());
  if(!actual.length)throw Error('辨識結果沒有可用文字，請人工核對圖片畫質與文件原文。');
  window.__tiOcrCache={name:f.name,size:f.size,lastModified:f.lastModified,pages};
  document.dispatchEvent(new CustomEvent('ti:ocr-complete',{detail:{pages}}));
  const pre=document.createElement('pre');pre.className='ti-ocr-preview';pre.textContent=pages.map(p=>'【'+p.source+'｜'+p.method+'】\n'+(p.text||'未辨識')).join('\n\n').slice(0,125000);
  output.append(pre);
  status('已辨識 '+actual.length+' 頁／區段，結果已帶入條款整理。OCR 可能有錯字，請逐頁核對；文件沒有被自動上傳。');
 }catch(error){status('OCR 未完成：'+String(error?.message||error).slice(0,220));}
 finally{try{await worker?.terminate()}catch{}button.disabled=false;}
}
function init(){const button=$('tiOcrButton');if(button)button.addEventListener('click',()=>void run());}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
