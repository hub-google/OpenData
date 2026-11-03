import {getSession,DATABASE_URL,PUBLISHABLE_KEY} from "./backend.js";

const API=DATABASE_URL+"/functions/v1/ti-support";
const $=id=>document.getElementById(id);
const TOKEN_KEY="ti-support-visitor-v1";
const CHAT_KEY="ti-support-current-chat-v1";
const guestToken=()=>{
 let value=localStorage.getItem(TOKEN_KEY);
 if(!/^[a-f0-9]{64}$/.test(value||"")){
  value=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");
  localStorage.setItem(TOKEN_KEY,value);
 }
 return value;
};
const token=guestToken();
const support=document.createElement("div");
support.innerHTML=`
<button id="tiSupportFab" class="ti-support-fab" type="button" aria-label="開啟客服中心" aria-controls="tiSupportPanel" aria-expanded="false">
 <span class="ti-fab-icon" aria-hidden="true">✦</span><span class="ti-fab-label">客服中心</span>
 <span id="tiSupportUnread" class="ti-support-unread" hidden></span>
</button>
<section id="tiSupportPanel" class="ti-support-panel" role="region" aria-label="客服中心" hidden>
 <header class="ti-support-head">
  <div class="ti-support-head-icon" aria-hidden="true">✦</div>
  <div class="ti-support-head-title"><strong>客服與問題回報</strong><small>AI 即時協助 · 真人站內回覆</small></div>
  <button id="tiSupportClose" type="button" class="ti-support-icon-btn" aria-label="關閉客服視窗">×</button>
 </header>
 <nav class="ti-support-tabs" role="tablist" aria-label="客服服務">
  <button type="button" class="active" role="tab" aria-selected="true" data-support-tab="chat">AI 客服</button>
  <button type="button" role="tab" aria-selected="false" data-support-tab="form">問題回報</button>
  <button type="button" role="tab" aria-selected="false" data-support-tab="history">我的紀錄</button>
  <button type="button" role="tab" aria-selected="false" data-support-tab="admin" id="tiSupportAdminTab" hidden>客服管理</button>
 </nav>
 <div id="tiSupportStatus" class="ti-support-status" role="status" aria-live="polite" hidden></div>
 <div class="ti-support-body">
  <section data-support-view="chat" class="ti-support-view ti-support-chat">
   <div class="ti-support-section-top">
    <span id="tiSupportAiStatus" class="ti-support-pill">正在確認 AI 服務...</span>
    <button type="button" id="tiSupportNewChat" class="ti-support-link-btn">＋ 新對話</button>
   </div>
   <div id="tiSupportMessages" class="ti-support-messages" aria-live="polite">
    <div class="ti-support-intro"><div class="ti-support-intro-icon">✦</div><strong>你好，需要什麼協助？</strong><p>可詢問標案搜尋、資料來源、會員功能或訂閱方式。AI 不會自行修改訂單或標案資料。</p></div>
   </div>
   <form id="tiSupportChatForm" class="ti-support-compose">
    <label class="sr-only" for="tiSupportChatInput">輸入客服訊息</label>
    <textarea id="tiSupportChatInput" rows="2" maxlength="1800" placeholder="輸入你的問題…" required></textarea>
    <button type="submit" id="tiSupportChatSend" title="送出訊息" aria-label="送出客服訊息">➤</button>
   </form>
   <div class="ti-support-chat-footer"><span>AI 回答僅供操作參考，標案資訊以政府公告為準。</span><button id="tiSupportToForm" type="button">改由真人處理 →</button></div>
  </section>
  <section data-support-view="form" class="ti-support-view" hidden>
   <div class="ti-support-form-intro"><strong>提交問題，真人協助處理</strong><p>我們會保留問題紀錄，管理員在網站內回覆，不透過 Email。</p></div>
   <form id="tiSupportFeedbackForm" class="ti-support-feedback">
    <label><span class="ti-support-label-index">01</span>問題類型
     <select name="category" required>
      <option value="data">標案資料錯誤</option>
      <option value="system">網站功能異常</option>
      <option value="billing">付款與訂閱問題</option>
      <option value="suggestion">功能建議</option>
      <option value="other">其他問題</option>
     </select>
    </label>
    <label><span class="ti-support-label-index">02</span>問題主旨
     <input name="subject" maxlength="160" minlength="4" required placeholder="簡述你遇到的問題">
    </label>
    <label><span class="ti-support-label-index">03</span>詳細說明
     <textarea name="message" rows="5" maxlength="6000" minlength="10" required placeholder="請描述操作步驟、預期結果或錯誤訊息。如為標案問題，請提供案號。"></textarea>
    </label>
    <label class="ti-support-check"><input name="urgent" type="checkbox"><span>此問題影響我正常使用網站</span></label>
    <p id="tiSupportGuestHint" class="ti-support-guest-note">未登入時，請使用同一瀏覽器查看後續回覆；登入後提交可跨裝置查詢。</p>
    <button class="ti-support-primary" id="tiSupportFormSubmit" type="submit">送出問題回報</button>
   </form>
  </section>
  <section data-support-view="history" class="ti-support-view" hidden>
   <div class="ti-support-section-top"><strong>我的客服紀錄</strong><button type="button" id="tiSupportRefreshHistory" class="ti-support-link-btn">重新整理</button></div>
   <div id="tiSupportHistoryList" class="ti-support-ticket-list"></div>
   <div id="tiSupportHistoryDetail" class="ti-support-ticket-detail" hidden></div>
  </section>
  <section data-support-view="admin" class="ti-support-view" hidden>
   <div class="ti-support-section-top"><strong>人工客服管理</strong><button type="button" id="tiSupportRefreshAdmin" class="ti-support-link-btn">重新整理</button></div>
   <label class="ti-support-filter">工單狀態<select id="tiSupportAdminFilter"><option value="all">全部</option><option value="open">待處理</option><option value="in_progress">處理中</option><option value="replied">已回覆</option><option value="closed">已結案</option></select></label>
   <div id="tiSupportAdminList" class="ti-support-ticket-list"></div>
   <div id="tiSupportAdminDetail" class="ti-support-ticket-detail" hidden></div>
  </section>
 </div>
</section>`;
document.body.append(support);

let activeChat=localStorage.getItem(CHAT_KEY)||"";
let busy=false;
let initialized=false;
let staff=false;
let lastQuestion="";
const statuses={open:"待處理",in_progress:"處理中",replied:"已回覆",closed:"已結案"};
const categories={data:"標案資料錯誤",system:"網站功能異常",billing:"付款與訂閱",suggestion:"功能建議",other:"其他",general:"一般諮詢"};
function messageStatus(text,type="info"){
 const n=$("tiSupportStatus");
 n.hidden=!text;n.textContent=text||"";n.className="ti-support-status "+type;
}
async function api(action,payload={}){
 const session=await getSession().catch(()=>null);
 const headers={"Content-Type":"application/json",apikey:PUBLISHABLE_KEY};
 if(session?.access_token)headers.Authorization="Bearer "+session.access_token;
 const response=await fetch(API,{method:"POST",headers,body:JSON.stringify({action,visitor_token:token,...payload})});
 let data;try{data=await response.json()}catch{throw Error("客服伺服器回應格式錯誤")}
 if(!response.ok)throw Error(data.error||"無法連線客服服務");
 return data;
}
function setTab(name){
 messageStatus("");
 document.querySelectorAll("[data-support-tab]").forEach(btn=>{const selected=btn.dataset.supportTab===name;btn.classList.toggle("active",selected);btn.setAttribute("aria-selected",String(selected))});
 document.querySelectorAll("[data-support-view]").forEach(view=>view.hidden=view.dataset.supportView!==name);
 if(name==="history")void loadHistory();
 if(name==="admin"&&staff)void loadAdmin();
}
function busyButton(id,on,text){
 const btn=$(id);if(on){btn.dataset.oldText=btn.textContent;btn.textContent=text;btn.disabled=true}else{btn.disabled=false;btn.textContent=btn.dataset.oldText||btn.textContent}
}
function createBubble(role,text){
 const outer=document.createElement("div");
 outer.className="ti-support-bubble "+(role==="customer"?"customer":role==="staff"?"staff":"assistant");
 const author=document.createElement("small");
 author.textContent=role==="customer"?"你":role==="staff"?"真人客服":"AI 客服";
 const content=document.createElement("p");content.textContent=text;
 outer.append(author,content);
 return outer;
}
function clearMessages(){
 $("tiSupportMessages").replaceChildren();
}
function drawMessages(messages){
 clearMessages();
 if(!messages.length){
  const intro=document.createElement("div");intro.className="ti-support-intro";
  intro.innerHTML='<div class="ti-support-intro-icon">✦</div><strong>你好，需要什麼協助？</strong><p>可詢問標案搜尋、會員功能與訂閱方式。無法解決時，可轉由真人處理。</p>';
  $("tiSupportMessages").append(intro);
 }else for(const m of messages)$("tiSupportMessages").append(createBubble(m.role,m.body));
 $("tiSupportMessages").scrollTop=$("tiSupportMessages").scrollHeight;
}
async function restoreChat(){
 if(!activeChat)return;
 try{
  const data=await api("read",{thread_id:activeChat});
  if(data.thread.kind!=="ai")throw Error("不是 AI 對話");
  drawMessages(data.messages);
 }catch{
  activeChat="";localStorage.removeItem(CHAT_KEY);drawMessages([]);
 }
}
async function initialize(force=false){
 if(initialized&&!force)return;
 try{
  const x=await api("bootstrap");
  initialized=true;staff=x.staff;
  $("tiSupportAdminTab").hidden=!staff;
  $("tiSupportAdminTab").textContent=x.demo_mode?"測試客服後台":"客服管理";
  $("tiSupportAiStatus").textContent=x.gemini_ready?"Gemini AI 已配置":"AI 功能開發中";
  $("tiSupportAiStatus").classList.toggle("is-live",x.gemini_ready);
  $("tiSupportGuestHint").textContent=x.demo_mode?"這是獨立測試帳號，工單僅供你測試；登出後可能無法跨裝置找回。":x.signed_in?"此問題會連結你的登入帳號，可跨裝置查看回覆。":"未登入時，請使用同一瀏覽器查看後續回覆；登入後提交可跨裝置查詢。";
  await Promise.all([restoreChat(),loadUnread()]);
 }catch(e){initialized=false;messageStatus("客服載入失敗："+e.message,"error");$("tiSupportAiStatus").textContent="目前無法確認 AI 狀態";}
}
async function loadUnread(){
 try{
  const data=await api("list");
  $("tiSupportUnread").hidden=!data.threads.some(t=>t.kind==="form"&&t.status==="replied"&&!t.customer_read_at);
 }catch{}
}
function openSupport(){
 const panel=$("tiSupportPanel");panel.hidden=!panel.hidden;
 $("tiSupportFab").setAttribute("aria-expanded",String(!panel.hidden));
 if(!panel.hidden){void initialize(true);$("tiSupportClose").focus();}
 else $("tiSupportFab").focus();
}
window.addEventListener("ti-demo-account-ready",async()=>{
 if($("tiSupportPanel").hidden){
  $("tiSupportPanel").hidden=false;
  $("tiSupportFab").setAttribute("aria-expanded","true");
 }
 await initialize(true);
 if(staff)setTab("admin");
});
$("tiSupportFab").addEventListener("click",openSupport);
$("tiSupportClose").addEventListener("click",openSupport);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("tiSupportPanel").hidden)openSupport()});
document.querySelectorAll("[data-support-tab]").forEach(btn=>btn.addEventListener("click",()=>setTab(btn.dataset.supportTab)));
$("tiSupportNewChat").addEventListener("click",()=>{
 activeChat="";localStorage.removeItem(CHAT_KEY);lastQuestion="";drawMessages([]);messageStatus("已開始新對話");
 $("tiSupportChatInput").focus();
});
$("tiSupportChatInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("tiSupportChatForm").requestSubmit();}});
$("tiSupportChatForm").addEventListener("submit",async e=>{
 e.preventDefault();if(busy)return;
 const input=$("tiSupportChatInput"),text=input.value.trim();
 if(text.length<2){messageStatus("請至少輸入兩個字","error");return}
 busy=true;busyButton("tiSupportChatSend",true,"…");messageStatus("");
 const current=activeChat;
 const snapshot=[...$("tiSupportMessages").querySelectorAll(".ti-support-bubble")].map(n=>({role:n.classList.contains("customer")?"customer":"assistant",body:n.querySelector("p")?.textContent||""}));
 drawMessages([...snapshot,{role:"customer",body:text}]);
 try{
  const data=await api("chat",{thread_id:current||undefined,message:text,page_url:location.href});
  activeChat=data.thread_id;localStorage.setItem(CHAT_KEY,activeChat);
  lastQuestion=text;input.value="";
  $("tiSupportMessages").append(createBubble("assistant",data.reply.body));
  $("tiSupportMessages").scrollTop=$("tiSupportMessages").scrollHeight;
 }catch(err){drawMessages(snapshot);messageStatus("訊息未成功送出："+err.message,"error");}
 finally{busy=false;busyButton("tiSupportChatSend",false);}
});
$("tiSupportToForm").addEventListener("click",()=>{
 setTab("form");
 const f=$("tiSupportFeedbackForm"),draft=f.elements.message;
 if(!draft.value.trim()){
  const turns=[...$("tiSupportMessages").querySelectorAll(".ti-support-bubble")].slice(-8).map(n=>{
   const who=n.classList.contains("customer")?"使用者":"AI 客服";
   return who+"："+(n.querySelector("p")?.textContent||"");
  });
  const transcript=turns.join("\n").slice(0,5200);
  draft.value=transcript?"我需要真人協助，以下是先前與 AI 客服的對話：\n"+transcript:(lastQuestion||"");
  if(!f.elements.subject.value)f.elements.subject.value="AI 客服轉真人協助";
 }
 draft.focus();
});
$("tiSupportFeedbackForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;
 const data=new FormData(f);
 busyButton("tiSupportFormSubmit",true,"正在提交…");messageStatus("");
 try{
  const x=await api("form",{category:data.get("category"),subject:data.get("subject"),message:data.get("message"),urgent:data.has("urgent"),page_url:location.href});
  f.reset();messageStatus("問題回報已送出，工單 #"+x.short_id+"。請在「我的紀錄」查看真人回覆。","success");
  await loadUnread();
 }catch(err){messageStatus("提交失敗："+err.message,"error")}
 finally{busyButton("tiSupportFormSubmit",false)}
});
function tag(status){const el=document.createElement("span");el.className="ti-support-ticket-tag "+status;el.textContent=statuses[status]||status;return el}
function ticketRow(t,onClick){
 const btn=document.createElement("button");btn.type="button";btn.className="ti-support-ticket-row";
 const top=document.createElement("span");top.className="ti-support-ticket-row-top";
 const title=document.createElement("strong");title.textContent=(t.kind==="ai"?"AI · ":"")+(t.subject||"客服紀錄");
 const flag=t.kind==="ai"?document.createElement("span"):tag(t.status);
 if(t.kind==="ai"){flag.className="ti-support-ticket-tag replied";flag.textContent="對話紀錄";}
 top.append(title,flag);
 const foot=document.createElement("small");foot.textContent=(categories[t.category]||"客服")+" · "+new Date(t.updated_at).toLocaleString("zh-TW",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
 btn.append(top,foot);btn.addEventListener("click",onClick);return btn;
}
async function loadHistory(){
 const list=$("tiSupportHistoryList");$("tiSupportHistoryDetail").hidden=true;
 list.textContent="正在讀取…";
 try{
  const data=await api("list");
  list.replaceChildren();
  if(!data.threads.length){list.textContent="尚無客服紀錄。";return}
  for(const t of data.threads)list.append(ticketRow(t,()=>void historyDetail(t.id)));
  $("tiSupportUnread").hidden=!data.threads.some(t=>t.kind==="form"&&t.status==="replied"&&!t.customer_read_at);
 }catch(e){list.textContent="無法讀取客服紀錄："+e.message}
}
async function historyDetail(id){
 const detail=$("tiSupportHistoryDetail");detail.hidden=false;detail.textContent="正在讀取對話…";
 try{
  const {thread,messages}=await api("read",{thread_id:id});
  detail.replaceChildren();
  const back=document.createElement("button");back.className="ti-support-link-btn";back.type="button";back.textContent="← 返回紀錄";
  back.addEventListener("click",()=>{detail.hidden=true;void loadHistory()});
  const title=document.createElement("strong");title.textContent=thread.subject||"客服紀錄";
  const info=document.createElement("p");info.className="ti-support-detail-meta";info.textContent="紀錄 #"+thread.id.slice(0,8).toUpperCase()+" · "+(thread.kind==="ai"?"AI 對話紀錄":(statuses[thread.status]||thread.status));
  const messagesBox=document.createElement("div");messagesBox.className="ti-support-detail-messages";
  for(const m of messages)messagesBox.append(createBubble(m.role,m.body));
  detail.append(back,title,info,messagesBox);
  if(thread.kind==="form"){
   const followup=document.createElement("form");followup.className="ti-support-admin-reply";
   const textarea=document.createElement("textarea");textarea.rows=3;textarea.minLength=2;textarea.maxLength=6000;textarea.required=true;textarea.placeholder="還有其他需要補充的內容嗎？";
   const send=document.createElement("button");send.type="submit";send.className="ti-support-primary";send.textContent="補充問題";
   followup.append(textarea,send);
   followup.addEventListener("submit",async e=>{
    e.preventDefault();send.disabled=true;messageStatus("");
    try{
     const x=await api("customer_reply",{thread_id:thread.id,message:textarea.value});
     messagesBox.append(createBubble("customer",x.message.body));textarea.value="";
     info.textContent="紀錄 #"+thread.id.slice(0,8).toUpperCase()+" · 待處理";
     messageStatus("補充內容已保存，工單已重新進入待處理狀態。","success");
    }catch(err){messageStatus("未成功保存："+err.message,"error")}
    finally{send.disabled=false}
   });
   detail.append(followup);
  }
  $("tiSupportUnread").hidden=true;
 }catch(e){detail.textContent="讀取失敗："+e.message}
}
async function loadAdmin(){
 const list=$("tiSupportAdminList");$("tiSupportAdminDetail").hidden=true;list.textContent="讀取工單中…";
 try{
  const {threads}=await api("admin_list",{status:$("tiSupportAdminFilter").value});
  list.replaceChildren();
  if(!threads.length){list.textContent="目前沒有符合條件的工單。";return}
  for(const t of threads)list.append(ticketRow(t,()=>void adminDetail(t.id)));
 }catch(e){list.textContent="無法讀取管理工單："+e.message}
}
async function adminDetail(id){
 const detail=$("tiSupportAdminDetail");detail.hidden=false;detail.textContent="讀取工單中…";
 try{
  const {thread,messages}=await api("admin_read",{thread_id:id});
  detail.replaceChildren();
  const back=document.createElement("button");back.type="button";back.className="ti-support-link-btn";back.textContent="← 返回工單";
  back.addEventListener("click",()=>{detail.hidden=true;void loadAdmin()});
  const title=document.createElement("strong");title.textContent=thread.subject;
  const messagesBox=document.createElement("div");messagesBox.className="ti-support-detail-messages";
  for(const m of messages)messagesBox.append(createBubble(m.role,m.body));
  const statusLabel=document.createElement("label");statusLabel.className="ti-support-filter";statusLabel.textContent="處理狀態";
  const select=document.createElement("select");
  for(const [key,label] of Object.entries(statuses)){const option=document.createElement("option");option.value=key;option.textContent=label;option.selected=key===thread.status;select.append(option)}
  select.addEventListener("change",async()=>{
   select.disabled=true;
   try{await api("admin_status",{thread_id:id,status:select.value});messageStatus("工單狀態已更新","success");}
   catch(e){select.value=thread.status;messageStatus(e.message,"error")}
   finally{select.disabled=false}
  });
  statusLabel.append(select);
  const f=document.createElement("form");f.className="ti-support-admin-reply";
  const textarea=document.createElement("textarea");textarea.required=true;textarea.minLength=2;textarea.maxLength=6000;textarea.rows=3;textarea.placeholder="輸入站內真人客服回覆…";
  const send=document.createElement("button");send.type="submit";send.className="ti-support-primary";send.textContent="回覆使用者";
  f.append(textarea,send);
  f.addEventListener("submit",async e=>{
   e.preventDefault();send.disabled=true;
   try{
    const x=await api("admin_reply",{thread_id:id,message:textarea.value});
    messagesBox.append(createBubble("staff",x.message.body));textarea.value="";select.value="replied";messageStatus("已保存站內回覆","success");
   }catch(err){messageStatus("回覆失敗："+err.message,"error")}
   finally{send.disabled=false}
  });
  detail.append(back,title,statusLabel,messagesBox,f);
 }catch(e){detail.textContent="讀取失敗："+e.message}
}
$("tiSupportRefreshHistory").addEventListener("click",()=>void loadHistory());
$("tiSupportRefreshAdmin").addEventListener("click",()=>void loadAdmin());
$("tiSupportAdminFilter").addEventListener("change",()=>void loadAdmin());
