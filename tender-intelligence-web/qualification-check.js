// Source-cited requirements against user-entered company assets. No fabricated qualifications.
import {getClient} from './backend.js';
import {parseDocument} from './app.js';
const $=id=>document.getElementById(id);
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const normalize=s=>String(s??'').normalize('NFKC').toLocaleLowerCase('zh-TW').replaceAll('臺','台').replace(/\s+/g,'');
const domains=['資通安全','網路設備','資訊系統','醫療資訊','機電工程','營造','清潔','保全','軟體維護','ISO 27001','ISO 9001','政府採購','履約實績','專業技師','證照','工程'];
let running=false;
const status=t=>{if($('tiCompareStatus'))$('tiCompareStatus').textContent=t;};
function sources(file,pages){
 const regex=/資格|證照|實績|投標廠商|公司登記|執照|ISO\s?\d|CNS\s?\d|專業人員|施工經驗|履約經歷|須具備|應具有|必須具備|證明文件|資通安全|評選資格/;
 const found=[],seen=new Set();
 for(const p of pages){
  const lines=String(p.text||'').replace(/\r/g,'\n').split(/[\n。；;]+/).map(s=>s.trim().replace(/\s+/g,' ')).filter(s=>s.length>=12&&s.length<=850);
  for(const text of lines){
   if(!regex.test(text))continue;
   const key=normalize(text).slice(0,160);
   if(seen.has(key))continue;seen.add(key);
   found.push({source:String(p.source||'未標頁碼'),requirement:text.slice(0,450),review:'待確認',suggestions:[]});
   if(found.length>=25)return found;
  }
 }
 return found;
}
function candidates(requirement,assets){
 const text=normalize(requirement),codes=(requirement.match(/(?:ISO|CNS)\s?\d{3,6}/gi)||[]).map(normalize);
 return assets.filter(a=>{
  const c=normalize([a.title,a.issuer,a.reference_number,a.details].join(' '));
  const name=normalize(a.title);
  const namedMatch=name.length>=4&&text.includes(name);
  const codedMatch=codes.some(code=>c.includes(code));
  const categories=domains.filter(term=>text.includes(normalize(term))&&c.includes(normalize(term)));
  return namedMatch||codedMatch||categories.length>0;
 }).slice(0,4);
}
async function pagesForFile(file){
 const cache=window.__tiOcrCache,matching=cache&&cache.name===file.name&&cache.size===file.size&&cache.lastModified===file.lastModified;
 if(/\.(png|jpg|jpeg|webp)$/i.test(file.name)){
  if(!matching)throw Error('圖片請先點「掃描檔 OCR」辨識文字。');
  return cache.pages;
 }
 const parsed=await parseDocument(file);
 if(!matching)return parsed;
 const extra=new Map(cache.pages.map(p=>[p.source,p]));
 return parsed.map(p=>String(p.text||'').trim()?p:(extra.get(p.source)||p));
}
async function run(){
 if(running)return;
 const file=$('documentFile').files?.[0],out=$('tiCompareResults');
 if(!file){status('請先選擇合法取得的招標文件。');return;}
 if(file.size>15*1024*1024){status('文件上限 15MB。');return;}
 running=true;$('tiCompareCompany').disabled=true;
 try{
  const db=await getClient(),{data:{user},error:authError}=await db.auth.getUser();
  if(authError||!user)throw Error('請先登入或使用測試帳號才能讀取私人公司資料。');
  const {data:assets,error}=await db.from('ti_company_assets')
   .select('id,asset_type,title,issuer,reference_number,expires_on,details')
   .eq('user_id',user.id).order('created_at',{ascending:false}).limit(200);
  if(error)throw error;
  status('正在從選取文件抽取資格條款並比對自己的證照／實績資料…');
  const pages=await pagesForFile(file),checks=sources(file,pages);
  if(!checks.length){out.replaceChildren(el('p','未擷取到可核對的資格條款。可能是掃描品質或內容格式問題，請人工閱讀原文。','notice warning'));status('沒有可用的資格條款，不會自動判定符合。');return;}
  for(const c of checks)c.suggestions=candidates(c.requirement,assets||[]).map(a=>({id:a.id,title:a.title,expires_on:a.expires_on||null}));
  out.replaceChildren();
  const header=el('p','下方是原文候選資格條款，右側公司資料僅供人工對照。**未經本人確認，均維持「待確認」**。','notice');
  out.append(header);
  const cards=[];
  for(const [i,c] of checks.entries()){
   const box=el('div','','ti-qualify-row');
   box.append(el('strong',(i+1)+'. '+c.source),el('p',c.requirement));
   const match=el('p',c.suggestions.length?'可能相關的私人公司資料：'+c.suggestions.map(a=>a.title+(a.expires_on?'（到期 '+a.expires_on+'）':'')).join('、'):'目前未找到可對照的私人公司資料。','minor');
   const select=document.createElement('select');
   for(const v of ['待確認','本人核對符合','本人核對不符合']){
    const opt=el('option',v);opt.value=v;select.append(opt);
   }
   select.setAttribute('aria-label','第 '+(i+1)+' 項資格審查狀態');
   box.append(match,select);out.append(box);cards.push({check:c,select});
  }
  const save=el('button','保存本次人工資格比對','primary-btn');save.type='button';
  save.addEventListener('click',async()=>{
   save.disabled=true;
   try{
    const {data:{user:current}}=await db.auth.getUser();
    if(!current||current.id!==user.id)throw Error('登入狀態已變更');
    const checkRows=cards.map(x=>({...x.check,review:x.select.value}));
    const caseId=$('documentCaseId')?.value||null;
    const {error:writeError}=await db.from('ti_qualification_checks').insert({
     user_id:user.id,case_id:caseId,document_name:file.name,page_count:pages.length,checks:checkRows
    });
    if(writeError)throw writeError;
    status('比對結果已保存至私人資料庫'+(caseId?'並關聯此標案':'（未關聯案件）')+'；「本人核對」由你自行負責確認。');
   }catch(e){status('保存失敗：'+String(e?.message||e));}finally{save.disabled=false;}
  });
  out.append(save);
  status('找到 '+checks.length+' 條候選資格要求，'+checks.filter(x=>x.suggestions.length).length+' 條有可對照的私人資料；沒有自行判定合格。');
 }catch(e){out.replaceChildren();status('比對未完成：'+String(e?.message||e).slice(0,220));}
 finally{running=false;$('tiCompareCompany').disabled=false;}
}
function init(){if($('tiCompareCompany'))$('tiCompareCompany').addEventListener('click',()=>void run());}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
