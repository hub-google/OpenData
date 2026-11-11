'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const BASE = 'https://hub-google.github.io/OpenData/tender-intelligence-web/';
const ROOT = path.join(process.cwd(), 'tender-intelligence-web');
const MD = path.join(ROOT, '使用者操作情境與UAT驗收劇本-2026-11-11.md');
const OUT = path.join(ROOT, 'audits', 'uat-20261111');
const SHOTS = path.join(OUT, 'screenshots');
fs.mkdirSync(SHOTS,{recursive:true});
const raw = fs.readFileSync(MD,'utf8');
const rows = [...raw.matchAll(/^#### (UAT-\d{3})｜(.+?)（(P\d)）\s*$(?:\r?\n)([\s\S]*?)(?=^#### UAT-|^## 4\.|$(?![\s\S]))/gm)];
if(rows.length!==145)throw Error('Expected exactly 145 Markdown UAT records; got '+rows.length);
const BLOCKED = new Map([
  [5,'需要正式授權測試帳號、Email／Google 真實登入及跨裝置驗證'],
  [6,'刪除帳號屬破壞性操作，缺少可刪除專用測試帳號'],
  [22,'匿名規則持久化與登入身分限制需獨立帳號驗證'],
  [23,'刪除已保存的雲端規則需使用專用測試帳號'],
  [29,'補抓寫入正式佇列；未在正式環境發送寫入要求'],
  [33,'真實語意搜尋需要授權帳號與已配置的 AI 模型'],
  [35,'額度上限不能在正式服務以高頻請求測試'],
  [36,'私人 RAG 需要已授權的真實私人文件帳號'],
  [60,'完成與刪除待辦需要專用測試帳號，避免修改現有資料'],
  [63,'匯入 JSON 有覆寫風險，缺少隔離測試工作區'],
  [64,'跨帳號資料隔離需要兩組經授權的真實會員'],
  [65,'六項私人決策證據需要經授權的收藏與會員'],
  [66,'儲存決策會寫正式私人資料，需專用帳號'],
  [67,'公司資格比對需要專用公司資料與有效證明'],
  [68,'修改公司資料會寫正式資料，需專用帳號'],
  [69,'兩案私人決策需要專用帳號'],
  [72,'缺少經授權長篇掃描 PDF 樣本與人工逐頁校對'],
  [74,'雲端私人文件上傳需要正式授權身分'],
  [75,'私人全文索引需要擁有文件的正式會員'],
  [76,'跨帳號刪檔權限需要獨立授權帳號'],
  [77,'真實公司證照與實績比對需要專用測試資料'],
  [79,'AI 額度與模型實際回執尚無測試前置'],
  [81,'AI 標書逐條覆核依賴模型設定與真實文件回執'],
  [82,'來源式私人建議書需要登入並保存本人文件'],
  [83,'私人草稿寫入需專用正式會員'],
  [84,'人工覆核狀態依賴私人既有草稿'],
  [85,'AI 撰稿需要真模型、使用者明確同意與合法原文'],
  [86,'真實私人草稿未建立，不能假裝匯出完成'],
  [87,'公司檔案寫入需要專用正式會員'],
  [88,'需要已保存的私人公司服務資料'],
  [89,'證照與實績寫入需要專用測試帳號及合法假資料'],
  [90,'私人附件權限驗證需要兩組授權帳號'],
  [91,'需真實私人證照資料與過期案例'],
  [92,'團隊建立會寫入正式資料，缺少專用測試團隊'],
  [93,'邀請碼一次性需兩名授權測試使用者'],
  [94,'團隊任務指派需隔離測試工作區'],
  [95,'非成員權限需要第三個授權測試帳號'],
  [96,'團隊移除與權限修改需要專用管理者'],
  [97,'同一會員雙團隊寫入需測試工作區'],
  [103,'競品追蹤會寫個人私人雲端資料，需專用帳號'],
  [104,'取消追蹤需專用追蹤資料'],
  [105,'建立報表排程會寫資料庫、需專用帳號'],
  [106,'產生新報表需已建立授權排程'],
  [107,'刪除排程屬破壞性操作，需測試排程'],
  [109,'實際 Email/LINE/SMS 送達需合法收件者與供應商回執'],
  [110,'新增履保台帳會寫私人資料，需專用測試身分'],
  [111,'完成／修改台帳需專用測試資料'],
  [112,'到期事件排程需測試資料且不能任意觸發正式通知'],
  [114,'公開刊登會對外顯示自填商家，缺少授權測試商家'],
  [115,'刪除刊登需專用測試刊登資料'],
  [120,'正式金流尚未驗收，不建立交易'],
  [121,'無經授權的測試付款訂單'],
  [122,'取消續費涉及真實財務風險，不能在正式會員操作'],
  [124,'建立真實 API Key 需正式會員'],
  [125,'跨會員 REST 存取需兩組經授權帳號'],
  [126,'300 次/日限額不得以正式 API 轟炸測試'],
  [127,'MCP 撤銷 Key 需專用測試金鑰'],
  [129,'建立客服對話會寫正式工單資料；未授權製造假客服記錄'],
  [130,'送出客服回報會建立正式工單；缺少可回收測試資料授權'],
  [131,'AI 轉真人會建立正式工單且 AI 金鑰未驗證'],
  [132,'客服對話回覆需既有本人測試工單'],
  [133,'客服後台操作需授權客服人員'],
  [134,'客服結案需授權客服人員及專用工單'],
  [135,'客服限額壓測會占用正式用量，需隔離測試'],
  [138,'跨租戶讀寫驗證需要兩組獨立授權帳號'],
  [143,'同一人多裝置同時寫入需隔離測試資料'],
  [144,'私人文件隔離需要授權帳號及安全測試樣本']
]);
const range=(a,b,n)=>n>=a&&n<=b;
function viewFor(n) {
 if(n===7)return 'search';
 if(n<=17)return 'search';
 if(n<=24)return 'advanced';
 if(n<=32)return 'search';
 if(n<=36)return 'search';
 if(n<=41)return 'radar';
 if(n<=46)return 'agencies';
 if(n<=51)return 'vendors';
 if(n<=53)return 'issues';
 if(n<=57)return 'analytics';
 if(n<=64)return 'tracking';
 if(n<=69)return 'decisions';
 if(n<=79)return 'documents';
 if(n<=86)return 'proposal';
 if(n<=91)return 'company';
 if(n<=97)return 'team';
 if(n<=109)return 'alerts';
 if(n<=113)return 'contracts';
 if(n<=115)return 'directory';
 if(n<=117)return 'debarred';
 if(n===118)return 'guide';
 if(n<=122)return 'billing';
 if(n<=127)return 'developer';
 if(n<=135)return 'search';
 if(n===136)return 'about';
 if(n===137||n===139||n===141||n===145)return 'search';
 if(n===142)return 'advanced';
 return 'company';
}
let browser,page,homeReady=false;
const results=[];
function clamp(s,max=350){return String(s||'').replace(/\s+/g,' ').slice(0,max);}
const has=async s => await page.locator(s).count()>0;
const text=async s => (await has(s)) ? clamp(await page.locator(s).first().innerText().catch(()=>''),300) : '';
async function stepClick(s,opts) {
 const e=page.locator(s).first();
 if(!(await e.count())) throw Error('Selector not found: '+s);
 await e.click({timeout:4500,...opts});
}
async function go(view){
 await page.evaluate(()=>{if(innerWidth>=700)document.querySelector('.sidebar')?.classList.remove('mobile-open')});
 if(await has('#detailDrawer') && await page.locator('#detailDrawer').isVisible()){
   await page.locator('#closeDetail').click({timeout:3000}).catch(()=>{});
 }
 if(await has('#tiSupportPanel') && await page.locator('#tiSupportPanel').isVisible()){
   await stepClick('#tiSupportClose').catch(()=>{});
 }
 if(view==='billing'){
   if(await page.locator('[data-view="billing"]').isVisible().catch(()=>false)){
     await stepClick('[data-view="billing"]');
     return true;
   }
   return false;
 }
 const b=page.locator('[data-view="'+view+'"]').first();
 if(!(await b.count()))throw Error('No navigation item: '+view);
 const d=b.locator('xpath=ancestor::details[1]');
 if(await d.count() && !(await d.evaluate(el=>el.open)))await d.evaluate(el=>{el.open=true});
 try{await b.click({timeout:2200})}catch(e){await b.evaluate(el=>el.click())}
 await page.waitForTimeout(130);
 return true;
}
async function firstCase(){
 await go('search');
 if(!(await has('#resultList .case-title')))return false;
 const title=page.locator('#resultList .case-title').first();
 await title.waitFor({timeout:10000});
 await title.click({timeout:6000});
 await page.locator('#detailDrawer').waitFor({state:'visible',timeout:9000});
 return true;
}
async function monitor(tab){
 await go('alerts');
 const b=page.getByRole('tab',{name:tab,exact:true});
 if(await b.count())await b.first().click({timeout:5000});
 return (await text('.ti-monitor-tab.selected'));
}
async function submitSearch(word) {
 await go('search');
 await page.locator('#searchQuery').fill(word);
 await stepClick('#searchForm button[type="submit"]');
 await page.waitForTimeout(750);
}
async function doAction(n){
 const observations=[];
 let status='PARTIAL';
 const add=t=>observations.push(t);
 const block=BLOCKED.get(n);
 const target=viewFor(n);
 if(target==='billing'){
   const visible=await go('billing');
   add(visible?'方案與帳務可見':'正式版的「方案與帳務」選單為隱藏狀態');
   return {status:visible?'PARTIAL':'BLOCKED',observations};
 }
 if(n===7){
   const demo=await browser.newPage({viewport:{width:1280,height:840},locale:'zh-TW'});
   await demo.goto(BASE+'?demo=1',{waitUntil:'domcontentloaded',timeout:45000});
   add('一般入口測試捷徑顯示='+await page.locator('#accountDemoQuick').isVisible().catch(()=>false));
   add('demo=1 測試捷徑顯示='+await demo.locator('#accountDemoQuick').isVisible().catch(()=>false));
   await demo.close();
   status='PASS';return {status,observations};
 }
 if(n===3||n===142){
   await page.setViewportSize({width:390,height:844});
   await stepClick('#mobileMenu');
   await go(target);
   add('手機寬度下水平溢出='+await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth));
   if(n===3)add('已用手機漢堡選單進入搜尋區');
   return {status:'PARTIAL',observations,restoreViewport:true};
 }
 if(n===4){await page.reload({waitUntil:'domcontentloaded',timeout:40000});add('重整後網站可載入');return {status:'PARTIAL',observations};}
 if(n===2){
   for(const v of ['search','radar','vendors','tracking','documents','alerts'])await go(v);
   add('六大主功能區已逐一點擊');
   status='PASS';return {status,observations};
 }
 if(n===1||n===8){await submitSearch(n===8?'資安':'設計');add('搜尋畫面回應：'+await text('#resultInfo'));return {status:'PARTIAL',observations};}
 if(n===9){
   await go('search');
   const ids=await page.locator('#resultList .case-card').evaluateAll(arr=>arr.map(e=>e.querySelector('.case-meta')?.textContent||e.textContent.slice(0,80)));
   add('當頁案件卡='+ids.length+',重複摘要='+String(ids.length-new Set(ids).size));
   return {status:'PARTIAL',observations};
 }
 const scenarios={10:'open',11:'soon',12:'small',13:'failed'};
 if(scenarios[n]){await go('search');await stepClick('[data-scenario="'+scenarios[n]+'"]');await page.waitForTimeout(700);add('情境切換：'+await text('#resultInfo'));return {status:'PARTIAL',observations};}
 if(n===14){
   await go('search');
   await page.locator('#budgetFilter').fill('100000');
   await page.locator('#maxBudgetFilter').fill('1000000');
   await page.locator('#locationFilter').fill('臺北');
   await stepClick('#searchForm button[type="submit"]');
   add('多軸篩選送出：'+await text('#resultInfo'));
   return {status:'PARTIAL',observations};
 }
 if(n===15){await submitSearch('台北');add('台北：'+await text('#resultInfo'));await submitSearch('臺北');add('臺北：'+await text('#resultInfo'));return {status:'PARTIAL',observations};}
 if(n===16){await submitSearch('資安');add('重整後可分享的網址：'+clamp(page.url()));return {status:'PARTIAL',observations};}
 if(n===17){await go('search');if(await has('#exportCsv')){try{const [dl]=await Promise.all([page.waitForEvent('download',{timeout:6000}),stepClick('#exportCsv')]);add('CSV 下載：'+dl.suggestedFilename());}catch(e){add('匯出等待：'+clamp(e.message,140));}}return {status:'PARTIAL',observations};}
 if(range(18,24,n)){
   await go('advanced');
   if(n===18)await page.locator('#advQuery').fill('(「網路設備」 OR 資安) AND 維護 -租賃');
   if(n===19){await page.locator('#advQuery').fill('「資訊系統」');await page.locator('#advExclude').fill('租賃,拆除');}
   if(n===20){await page.locator('#advAgency').fill('國防部');await page.locator('#advMin').fill('100000');}
   if(n<=20){await stepClick('#advSubmit');await page.waitForTimeout(850);add('進階搜尋：'+await text('#advStatus'));}
   if(n===21){await stepClick('#advClear');add('清除條件後詞='+await page.locator('#advQuery').inputValue());}
   if(n===22||n===23)add('儲存／預覽規則入口存在='+await has('#advSaveRule')+'/'+await has('#advPreviewRule')+'（匿名寫入未執行）');
   if(n===24){await stepClick('#advSubmit');await page.waitForTimeout(550);if(await page.locator('#advNext').isEnabled())await stepClick('#advNext');add('分頁='+await text('#advPageInfo'));}
   return {status:'PARTIAL',observations};
 }
 if(range(25,32,n)){
   const opened=await firstCase();
   if(!opened)return {status:'BLOCKED',observations:['目前尚無可開啟的正式案件']};
   if(n===25){for(let i=0;i<4;i++)await stepClick('#detailContent .ti-case-tab:nth-child('+(i+1)+')');add('四個任務分頁已點擊');}
   else if(n===26||n===27||n===28||n===29)await stepClick('#detailContent .ti-case-tab:nth-child(2)');
   else if(n===30)await stepClick('#detailContent .ti-case-tab:nth-child(3)');
   else if(n===31)await stepClick('#detailContent .ti-case-tab:nth-child(4)');
   else if(n===32){await stepClick('#closeDetail');add('關閉案件詳情後可返回搜尋');}
   add('詳情已開啟='+String(n===32?'關閉':await page.locator('#detailDrawer').isVisible()));
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(range(33,36,n)){
   await go('search');
   if(await has('#semanticPanel'))await page.locator('#semanticPanel').evaluate(e=>e.open=true);
   if(n===34){await page.locator('#semanticQuery').fill('醫院資安維運');await stepClick('#semanticForm button[type="submit"]').catch(e=>add('入口結果：'+clamp(e.message,100)));await page.waitForTimeout(550);add('AI 結果：'+await text('#semanticResults'));}
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(range(37,41,n)){
   await go('radar');
   if(n===37){await page.locator('#profileKeywords').fill('資安、網路設備');await page.locator('#profileExcludes').fill('土木');await stepClick('#profileForm button[type="submit"]');}
   if(n===38){await page.locator('#profileKeywords').fill('資訊系統');await stepClick('#radarFullSearch');await page.waitForTimeout(600);}
   if(n===39)await page.locator('#profileArea').fill('臺北、新北');
   if(n===40){await page.locator('#profileKeywords').fill('網站、資安');await page.locator('#profileExcludes').fill('土木、租賃');}
   add('商機雷達：'+await text('#radarFullStatus'));
   return {status:'PARTIAL',observations};
 }
 if(range(42,46,n)){
   await go('agencies');await page.locator('#agencyId').fill('3.13.50');
   await stepClick('#agencyForm button[type="submit"]');await page.waitForTimeout(650);
   add('機關輸出：'+await text('#agencyOutput'));
   return {status:'PARTIAL',observations};
 }
 if(range(47,51,n)){
   await go('vendors');
   if(n===48||n===49||n===50){
     if(await has('#vendorEvidenceTaxId'))await page.locator('#vendorEvidenceTaxId').fill('03794905');
     const sel=n===48?'#vendorEvidenceTaxId':n===49?'#vendorCoMentionsButton':'#vendorRolesButton';
     if(n===48)await stepClick('#vendorEvidenceTaxId').catch(()=>{});
     else if(await has(sel))await stepClick(sel);
   }else{
     await page.locator('#vendorMode').selectOption(n===51?'id':'name');
     await page.locator('#vendorQuery').fill(n===51?'1234567':'台灣糖業股份有限公司');
     await stepClick('#vendorForm button[type="submit"]');
   }
   await page.waitForTimeout(400);add('廠商查詢：'+await text('#vendorSummary'));
   return {status:'PARTIAL',observations};
 }
 if(n===52||n===53){await go('issues');if(await has('#issueSubmit'))await stepClick('#issueSubmit');await page.waitForTimeout(400);add('無法決標／快截止狀態：'+await text('#issueStatus'));return {status:'PARTIAL',observations};}
 if(range(54,57,n)){
   await go('analytics');
   if(await has('#awardSampleForm')){await stepClick('#awardSampleForm button[type="submit"]');await page.waitForTimeout(500);}
   add('行情樣本：'+await text('#awardSampleOutput'));
   return {status:'PARTIAL',observations};
 }
 if(range(58,64,n)){
   await go('tracking');
   if(n===62 && await has('#trackingCsv')){try{const [dl]=await Promise.all([page.waitForEvent('download',{timeout:4500}),stepClick('#trackingCsv')]);add('本人追蹤 CSV：'+dl.suggestedFilename());}catch(e){add('匯出：'+clamp(e.message,100));}}
   add('追蹤待辦入口='+await has('#taskTitle')+'；私人測試寫入未執行');
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(range(65,69,n)){await go('decisions');add('決策頁：'+await text('#decisionOutput'));return {status:block?'BLOCKED':'PARTIAL',observations};}
 if(range(70,79,n)){
   await go('documents');
   if(n===70){
     await page.locator('#documentFile').setInputFiles({name:'uat-terms.txt',mimeType:'text/plain',buffer:Buffer.from('政府採購測試文件。\n投標資格：資訊服務廠商。\n履約期限：決標後 30 日。\n押標金：無。\n','utf8')});
     await stepClick('#documentAnalyze');
     await page.waitForTimeout(350);add('TXT 本機整理結果：'+await text('#documentResults'));
   }
   if(n===73){await page.locator('#documentFile').setInputFiles([]);await stepClick('#documentAnalyze').catch(e=>add('未選檔：'+clamp(e.message,80)));add('檔案欄='+await text('#documentFileName'));}
   if(n===78){await stepClick('#documentAI').catch(e=>add('AI 未啟用回應：'+clamp(e.message,80)));add('AI 整理入口');}
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(range(80,86,n)){
   await go('proposal');
   if(n>=82){
     const opened=await firstCase();
     if(opened){
       await stepClick('#detailContent .ti-case-tab:nth-child(4)');
       const b=page.locator('[data-prep-tab="proposal"]');if(await b.count())await b.click();
     }else add('尚無可開啟案例');
   }
   add('建議書／標書檢查入口');
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(range(87,91,n)){await go('company');add('公司欄位及私人附件入口（不寫入）');return {status:block?'BLOCKED':'PARTIAL',observations};}
 if(range(92,97,n)){await go('team');add('團隊協作入口（未登入專用團隊，未寫入）');return {status:'BLOCKED',observations};}
 if(range(98,102,n)){
   await monitor('標案監控');
   if(n===100 && await has('#enableDesktop'))add('裝置通知權限='+await page.evaluate(()=>Notification.permission));
   if(n===101 && await has('#reminderDays'))await page.locator('#reminderDays').fill('7,3,1');
   add('監控標籤及通知入口可見');
   return {status:'PARTIAL',observations};
 }
 if(range(103,109,n)){
   const tab=n<=104?'競品追蹤':n<=107?'自動報表':'通知設定';
   add('當前子頁='+await monitor(tab));
   if(n===108){add('Email/LINE 外送說明：'+await text('#deliveryStatus'));}
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(range(110,113,n)){await go('contracts');add('履約事項表單存在='+await has('#contractSubject'));return {status:block?'BLOCKED':'PARTIAL',observations};}
 if(range(114,115,n)){
   await go('directory');
   if(n===115 && await has('#directorySearchForm')){await page.locator('#directoryKeyword').fill('資訊');await stepClick('#directorySearchForm button[type="submit"]');await page.waitForTimeout(350);}
   add('自行刊登／查詢入口（不向公眾刊登假資料）');
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(range(116,117,n)){await go('debarred');await page.locator('#debarredKeyword').fill('台灣糖業');await stepClick('#debarredKeyword').catch(()=>{});add('拒往來源同步：'+await text('#debarredStatus'));return {status:'PARTIAL',observations};}
 if(n===118){await go('guide');add('官方新手指南：'+await text('#guideContent'));return {status:'PARTIAL',observations};}
 if(range(123,127,n)){await go('developer');add('API／MCP 安全入口：'+await text('#developerOutput'));return {status:block?'BLOCKED':'PARTIAL',observations};}
 if(range(128,135,n)){
   await go('search');await stepClick('#tiSupportFab');
   const tab=n===129?'history':n===130||n===131?'form':n===133||n===134?'admin':'chat';
   const b=page.locator('[data-support-tab="'+tab+'"]');
   if(await b.count() && await b.isVisible())await b.click();
   add('客服現在分頁='+tab+'；不建立真實測試工單');
   return {status:block?'BLOCKED':'PARTIAL',observations};
 }
 if(n===136){await go('about');add('資料說明與同步來源顯示');return {status:'PARTIAL',observations};}
 if(n===137){await submitSearch('資訊');add('真實預算展示：'+await text('#resultInfo'));return {status:'PARTIAL',observations};}
 if(n===139){await submitSearch('<img src=x onerror=alert(1)>');add('搜尋輸入的惡意文字不得被執行');return {status:'PARTIAL',observations};}
 if(n===140){await go('search');await page.context().setOffline(true);await stepClick('#searchForm button[type="submit"]').catch(e=>add('離線錯誤：'+clamp(e.message,120)));await page.waitForTimeout(300);await page.context().setOffline(false);add('已恢復網路');return {status:'PARTIAL',observations};}
 if(n===141){const start=Date.now();await submitSearch('資訊');add('互動耗時 '+(Date.now()-start)+'ms，非 p95 壓測');return {status:'PARTIAL',observations};}
 if(n===145){await submitSearch('不可能存在之測試案號 ZZ-987654321');add('空查詢：'+await text('#resultInfo'));return {status:'PARTIAL',observations};}
 await go(target);
 add('已檢查對應頁面；完整寫入／權限測試需要獨立授權條件');
 return {status:block?'BLOCKED':'PARTIAL',observations};
}
async function main(){
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1280,height:850},locale:'zh-TW',timezoneId:'Asia/Taipei',acceptDownloads:true});
 page.setDefaultTimeout(6500);
 const errors=[];
 page.on('pageerror',e=>{if(errors.length<80)errors.push(clamp(e.message,180));});
 let initialError='';
 try{
   const response=await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:50000});
   await page.locator('#searchQuery').waitFor({timeout:30000});
   homeReady=response&&response.ok();
 }catch(e){initialError=clamp(e.message,240);}
 for(const match of rows){
   const [_,id,title,priority,details]=match;
   const n=Number(id.slice(4));
   const start=Date.now();
   const item={id,title,priority,status:'NOT_RUN',url:page.url(),started_at:new Date().toISOString(),screenshot:'screenshots/'+id+'.png',steps:[],expected:clamp((details.match(/^- \*\*預期結果\*\*：(.+)$/m)||[])[1],900),error:null};
   try{
     if(!homeReady)throw Error('正式網站未能載入：'+initialError);
     const r=await Promise.race([
       doAction(n),
       new Promise((_,reject)=>setTimeout(()=>reject(Error('Scenario timeout (30s)')),30000))
     ]);
     item.status=r.status;
     item.steps=r.observations;
     item.url=page.url();
     item.restoreViewport=!!r.restoreViewport;
   }catch(e){
     item.status=homeReady?'FAIL':'BLOCKED';
     item.error=clamp(e&&e.message,420);
     await page.context().setOffline(false).catch(()=>{});
     console.error(id,item.error);
   }
   try{
     await page.screenshot({path:path.join(SHOTS,id+'.png'),fullPage:false,timeout:8500,animations:'disabled'});
     item.screenshot_ok=fs.existsSync(path.join(SHOTS,id+'.png'));
     if(item.restoreViewport){await page.setViewportSize({width:1280,height:850});await page.evaluate(()=>document.querySelector('.sidebar')?.classList.remove('mobile-open'))}
   }catch(e){
     item.screenshot_ok=false;
     item.error=(item.error||'')+' SCREENSHOT_ERROR '+clamp(e.message,180);
   }
   item.elapsed_ms=Date.now()-start;
   results.push(item);
   fs.writeFileSync(path.join(OUT,'checkpoint.json'),JSON.stringify({generated_at:new Date().toISOString(),count:results.length,items:results},null,2),'utf8');
   console.log(id,item.status,clamp(item.steps.join('; '),150));
 }
 const e2e=[];
 const flows=[
   ['E2E-01','個人設計師找案與決策','search'],
   ['E2E-02','資訊公司機關重購商機','agencies'],
   ['E2E-03','標書資格解析與截止待辦','documents'],
   ['E2E-04','主管比較備標成本','analytics'],
   ['E2E-05','財務履約與保證金','contracts'],
   ['E2E-06','三人投標團隊','team'],
   ['E2E-07','競品報表與提醒','alerts'],
   ['E2E-08','來源資料錯誤到客服','search']
 ];
 for(const [id,title,view] of flows){
   const item={id,title,status:'PARTIAL',screenshot:'screenshots/'+id+'.png',observations:[]};
   try{
     await page.setViewportSize({width:1280,height:850});
     await go(view);
     if(id==='E2E-01'){await page.locator('#searchQuery').fill('設計');await stepClick('#searchForm button[type="submit"]');}
     if(id==='E2E-02'){await page.locator('#agencyId').fill('3.13.50');await stepClick('#agencyForm button[type="submit"]');}
     if(id==='E2E-03'){await page.locator('#documentFile').setInputFiles({name:'e2e-uat.txt',mimeType:'text/plain',buffer:Buffer.from('資格：測試用資訊服務\n履約期限：30日','utf8')});await stepClick('#documentAnalyze');}
     if(id==='E2E-07')await monitor('自動報表');
     if(id==='E2E-08')await stepClick('#tiSupportFab');
     item.observations.push('完成公開介面可安全操作部分；未使用真人帳戶與私人／金流寫入');
   }catch(e){item.status='BLOCKED';item.error=clamp(e.message,280);}
   try{await page.screenshot({path:path.join(SHOTS,id+'.png'),timeout:8500});item.screenshot_ok=true}
   catch(e){item.screenshot_ok=false;item.error=(item.error||'')+' 截圖失敗：'+clamp(e.message,180)}
   e2e.push(item);
 }
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({
   generated_at:new Date().toISOString(),target:BASE,source_md:path.relative(process.cwd(),MD),
   note:'Screenshots are browser captures of the actual production site. PARTIAL is not acceptance PASS. BLOCKED is not a completed E2E test.',
   page_errors:errors,items:results,e2e_items:e2e
 },null,2),'utf8');
 const counts=results.reduce((a,v)=>(a[v.status]=(a[v.status]||0)+1,a),{});
 const lines=['# 標案平台 145 情境｜真實瀏覽器執行證據','',
  '- 執行時間 UTC：'+new Date().toISOString(),
  '- 目標正式網站：'+BASE,
  '- 環境：GitHub Actions Linux／Playwright Chromium，匿名瀏覽器，不使用正式客戶資料',
  '- 狀態解讀：PASS＝完整驗收；PARTIAL＝已實際操作部分 UI，但未完成全部 UAT；BLOCKED＝未具備安全授權或外部服務；FAIL＝已測步驟失敗',
  '- **每個 UAT 都有一張由真實瀏覽器擷取的截圖（若 screenshot_ok=false 則需補拍），但有截圖不代表整個操作流程成功。**',
  '- 結果數量：'+JSON.stringify(counts),
  '- 已有逐功能截圖：'+results.filter(x=>x.screenshot_ok).length+'/145；跨功能流程截圖：'+e2e.filter(x=>x.screenshot_ok).length+'/8',
  '', '| 案例 | 優先 | 狀態 | 實際操作／阻礙 | 截圖 |', '|---|---|---|---|---|'];
 for(const r of results){
   const notes=clamp((r.error||r.steps.join('；')),170).replace(/\|/g,'/');
   lines.push('| '+r.id+' '+r.title.replace(/\|/g,'/')+' | '+r.priority+' | '+r.status+' | '+notes+' | '+(r.screenshot_ok?'[截圖](screenshots/'+r.id+'.png)':'截圖失敗')+' |');
 }
 lines.push('','## 8 條跨功能流程截圖','','以下僅代表已實際操作公開介面與截圖，不代表完成整條端到端故事。','','| 流程 | 狀態 | 備註 | 截圖 |','|---|---|---|---|');
 for(const x of e2e)lines.push('| '+x.id+' '+x.title+' | '+x.status+' | '+clamp(x.error||x.observations.join('；'),130).replace(/\\|/g,'/')+' | '+(x.screenshot_ok?'[截圖](screenshots/'+x.id+'.png)':'截圖未產生')+' |');
 lines.push('','## 不能宣稱完成的事項','','此輪沒有經授權的兩個正式會員、真實付款憑證、真 AI API 回執或真實寄送回執；相應情境不得標通過。','頁面 JS 例外：'+errors.length+'（可參閱 results.json）。');
 fs.writeFileSync(path.join(OUT,'README.md'),lines.join('\n'),'utf8');
 await browser.close();
 console.log('UAT_DONE '+JSON.stringify(counts)+' screenshots='+results.filter(x=>x.screenshot_ok).length+' E2E='+e2e.filter(x=>x.screenshot_ok).length);
}
main().catch(e=>{
 console.error('UAT_FATAL',e&&e.stack||e);
 process.exitCode=1;
}).finally(async()=>{try{await browser?.close()}catch(e){}});
