const companies = [
  {id:1,name:"曜石雲端科技股份有限公司",taxId:"90124518",city:"臺北市",district:"內湖區",industry:"資訊軟體服務",capital:80000000,event:"增資",eventDate:"2026-09-23",score:94,setup:"2022-06-18",owner:"陳○○",address:"臺北市內湖區瑞光路",reasons:["近 30 日資本額由 3,000 萬提高至 8,000 萬","位於內湖科技園區，符合 B2B 科技客群","成立 4 年且持續擴張，採購需求可能上升"],action:"適合 ERP、HR SaaS、商用網路、企業保險、融資租賃業務優先接觸。"},
  {id:2,name:"青禾健康管理有限公司",taxId:"93518742",city:"臺北市",district:"士林區",industry:"醫療保健服務",capital:12000000,event:"新設立",eventDate:"2026-09-23",score:91,setup:"2026-09-23",owner:"林○○",address:"臺北市士林區中山北路",reasons:["今日新設立","資本額高於同類新設公司中位區間","健康管理屬高頻採購服務產業"],action:"可優先推 POS、CRM、商業保險、員工福利與支付服務。"},
  {id:3,name:"禾木能源整合股份有限公司",taxId:"83294016",city:"新北市",district:"板橋區",industry:"能源技術服務",capital:150000000,event:"營業項目新增",eventDate:"2026-09-22",score:89,setup:"2021-03-11",owner:"黃○○",address:"新北市板橋區文化路",reasons:["新增能源設備與充電設施相關營業項目","資本額 1.5 億","可能正進入新產品線或專案擴張期"],action:"適合設備供應、企業金融、專案保險、工程合作與 B2B 軟體商接觸。"},
  {id:4,name:"向量智能股份有限公司",taxId:"94157023",city:"臺北市",district:"信義區",industry:"人工智慧服務",capital:50000000,event:"搬遷",eventDate:"2026-09-22",score:87,setup:"2024-02-02",owner:"吳○○",address:"臺北市信義區松仁路",reasons:["公司地址遷入信義商辦","資本額 5,000 萬","AI 產業近期擴編與雲端需求通常較高"],action:"可切入雲端、資安、辦公設備、團保、企業卡與招募服務。"},
  {id:5,name:"研川精密工業股份有限公司",taxId:"54812690",city:"桃園市",district:"龜山區",industry:"精密製造",capital:220000000,event:"增資",eventDate:"2026-09-21",score:86,setup:"2016-11-08",owner:"張○○",address:"桃園市龜山區科技一路",reasons:["資本額增加 7,000 萬","製造業擴產常伴隨設備、保險與融資需求","公司成立已逾 9 年，營運基礎較穩定"],action:"適合設備融資、產險、能源管理、工廠自動化與 ERP 業務。"},
  {id:6,name:"嶼光餐飲有限公司",taxId:"96851472",city:"臺北市",district:"大安區",industry:"餐飲服務",capital:8000000,event:"新設立",eventDate:"2026-09-21",score:82,setup:"2026-09-21",owner:"李○○",address:"臺北市大安區敦化南路",reasons:["新設立餐飲公司","位於高消費商圈","資本額 800 萬，規模高於一般單店"],action:"適合 POS、外送整合、支付、食材供應、商業保險與人力服務。"},
  {id:7,name:"瀚域物流科技有限公司",taxId:"90573164",city:"新北市",district:"五股區",industry:"物流運輸",capital:30000000,event:"董監異動",eventDate:"2026-09-20",score:80,setup:"2020-07-15",owner:"周○○",address:"新北市五股區五權路",reasons:["負責人異動","物流業具車隊、倉儲與系統採購需求","資本額 3,000 萬"],action:"適合車隊管理、產險、融資租賃、倉儲設備與物流 SaaS。"},
  {id:8,name:"森嶼生活設計有限公司",taxId:"93746281",city:"臺中市",district:"西屯區",industry:"室內設計",capital:6000000,event:"新設立",eventDate:"2026-09-20",score:77,setup:"2026-09-20",owner:"許○○",address:"臺中市西屯區臺灣大道",reasons:["新設立","位於商辦密集區","室內設計業易延伸建材、軟體、保險合作"],action:"適合設計軟體、建材供應、專業責任險與企業金融。"},
  {id:9,name:"橙果教育科技股份有限公司",taxId:"89147230",city:"臺北市",district:"中山區",industry:"教育科技",capital:35000000,event:"增資",eventDate:"2026-09-19",score:84,setup:"2023-01-09",owner:"郭○○",address:"臺北市中山區南京東路",reasons:["資本額增加 1,500 萬","教育科技具 SaaS 與雲端服務採購需求","成立未滿 4 年仍在成長期"],action:"適合雲端、支付、行銷工具、團保與企業金融。"},
  {id:10,name:"白浪旅宿管理有限公司",taxId:"93681750",city:"高雄市",district:"苓雅區",industry:"旅宿服務",capital:10000000,event:"營業項目新增",eventDate:"2026-09-19",score:75,setup:"2025-05-20",owner:"謝○○",address:"高雄市苓雅區中山二路",reasons:["新增旅宿管理相關營業項目","資本額達 1,000 萬","可能從單一據點轉為管理品牌"],action:"適合訂房系統、支付、商業保險、清潔耗材與 CRM。"},
  {id:11,name:"矩陣數據顧問有限公司",taxId:"90264831",city:"臺北市",district:"松山區",industry:"企業顧問服務",capital:5000000,event:"搬遷",eventDate:"2026-09-18",score:72,setup:"2022-09-06",owner:"王○○",address:"臺北市松山區南京東路",reasons:["地址遷入商辦","顧問業對數位工具採用率高","可能伴隨人員與辦公規模調整"],action:"適合 CRM、協作軟體、企業電信、團保與財會服務。"},
  {id:12,name:"星禾寵物健康有限公司",taxId:"93475610",city:"新竹市",district:"東區",industry:"寵物服務",capital:9000000,event:"新設立",eventDate:"2026-09-18",score:78,setup:"2026-09-18",owner:"蔡○○",address:"新竹市東區光復路",reasons:["新設立寵物健康品牌","資本額接近千萬","新竹高所得客群有利高單價寵物服務"],action:"適合支付、POS、會員系統、商業保險與設備供應。"},
  {id:13,name:"恆川材料科技股份有限公司",taxId:"82731549",city:"臺南市",district:"新市區",industry:"材料科技",capital:300000000,event:"增資",eventDate:"2026-09-17",score:92,setup:"2018-04-26",owner:"鄭○○",address:"臺南市新市區南科二路",reasons:["資本額大幅增加至 3 億","位於科技產業聚落","可能涉及擴產、研發或新專案"],action:"適合大型設備、企業金融、保險、能源與供應鏈服務。"},
  {id:14,name:"日常選物電子商務有限公司",taxId:"94016287",city:"臺北市",district:"萬華區",industry:"電子商務",capital:7000000,event:"董監異動",eventDate:"2026-09-17",score:69,setup:"2024-08-14",owner:"劉○○",address:"臺北市萬華區成都路",reasons:["負責人異動","電商具物流、支付、廣告工具需求","成立約 2 年，仍處快速調整期"],action:"適合物流、金流、CRM、廣告與商業保險。"},
  {id:15,name:"沐川生技股份有限公司",taxId:"82974153",city:"臺北市",district:"南港區",industry:"生物科技",capital:120000000,event:"搬遷",eventDate:"2026-09-16",score:88,setup:"2019-10-03",owner:"洪○○",address:"臺北市南港區研究院路",reasons:["遷入南港生技聚落","資本額 1.2 億","生技公司對實驗設備、保險與法遵服務需求高"],action:"適合設備、專業保險、企業金融、法遵與雲端服務。"},
  {id:16,name:"岳峰戶外科技有限公司",taxId:"93851026",city:"臺中市",district:"北屯區",industry:"戶外用品",capital:15000000,event:"營業項目新增",eventDate:"2026-09-16",score:74,setup:"2025-02-18",owner:"何○○",address:"臺中市北屯區崇德路",reasons:["新增電子商務與進出口項目","資本額 1,500 萬","可能準備跨通路或海外銷售"],action:"適合電商、跨境支付、物流、貿易融資與產品責任險。"}
];

const $ = (s) => document.querySelector(s);
const fmtMoney = (n) => n >= 100000000 ? (n/100000000).toFixed(n%100000000===0?0:1)+" 億" : (n/10000).toLocaleString()+" 萬";
const savedKey = "company-radar-saved";
let saved = new Set(JSON.parse(localStorage.getItem(savedKey) || "[]"));
let filtered = [...companies];

function eventClass(event) {
  if (event === "增資") return "capital";
  if (event === "搬遷") return "move";
  if (event === "董監異動") return "director";
  return "";
}

function rowTemplate(c) {
  return `
  <article class="company-row">
    <div class="score ${c.score >= 85 ? "hot" : ""}">${c.score}</div>
    <div class="company-main">
      <button class="company-name" data-open="${c.id}">${c.name}</button>
      <div class="company-meta">${c.taxId} ・ ${c.city}${c.district} ・ ${c.industry}</div>
    </div>
    <div class="event-cell">
      <span>最新事件</span>
      <span class="event-badge ${eventClass(c.event)}">${c.event}</span>
    </div>
    <div class="metric">
      <span>資本額</span>
      <strong>${fmtMoney(c.capital)}</strong>
    </div>
    <div class="metric">
      <span>異動日期</span>
      <strong>${c.eventDate}</strong>
    </div>
    <button class="star-btn ${saved.has(c.id) ? "saved" : ""}" data-save="${c.id}" aria-label="加入追蹤">${saved.has(c.id) ? "★" : "☆"}</button>
  </article>`;
}

function populateOptions() {
  const cities = [...new Set(companies.map(c => c.city))].sort();
  const industries = [...new Set(companies.map(c => c.industry))].sort();
  $("#cityFilter").insertAdjacentHTML("beforeend", cities.map(v => `<option value="${v}">${v}</option>`).join(""));
  $("#industryFilter").insertAdjacentHTML("beforeend", industries.map(v => `<option value="${v}">${v}</option>`).join(""));
}

function applyFilters() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const event = $("#eventFilter").value;
  const city = $("#cityFilter").value;
  const industry = $("#industryFilter").value;
  const minCapital = Number($("#capitalFilter").value);
  const sort = $("#sortSelect").value;

  filtered = companies.filter(c => {
    const hay = [c.name,c.taxId,c.industry,c.city,c.district].join(" ").toLowerCase();
    return (!q || hay.includes(q))
      && (event === "all" || c.event === event)
      && (city === "all" || c.city === city)
      && (industry === "all" || c.industry === industry)
      && c.capital >= minCapital;
  });

  filtered.sort((a,b) => {
    if (sort === "capital") return b.capital - a.capital;
    if (sort === "date") return b.eventDate.localeCompare(a.eventDate);
    return b.score - a.score;
  });
  renderList();
}

function renderList() {
  $("#companyList").innerHTML = filtered.map(rowTemplate).join("");
  $("#resultCount").textContent = filtered.length;
  $("#emptyState").classList.toggle("hidden", filtered.length > 0);
  bindRows();
}

function renderStats() {
  $("#statTotal").textContent = companies.length;
  $("#statHot").textContent = companies.filter(c => c.score >= 80).length;
  $("#statNew").textContent = companies.filter(c => c.event === "新設立").length;
  $("#statCapital").textContent = companies.filter(c => c.event === "增資").length;
}

function bindRows() {
  document.querySelectorAll("[data-open]").forEach(btn => btn.addEventListener("click", () => openDrawer(Number(btn.dataset.open))));
  document.querySelectorAll("[data-save]").forEach(btn => btn.addEventListener("click", () => toggleSave(Number(btn.dataset.save))));
}

function toggleSave(id) {
  saved.has(id) ? saved.delete(id) : saved.add(id);
  localStorage.setItem(savedKey, JSON.stringify([...saved]));
  renderList();
  renderSaved();
  toast(saved.has(id) ? "已加入追蹤清單" : "已移除追蹤");
}

function renderSaved() {
  const list = companies.filter(c => saved.has(c.id)).sort((a,b)=>b.score-a.score);
  $("#savedList").innerHTML = list.map(rowTemplate).join("");
  $("#savedEmpty").classList.toggle("hidden", list.length > 0);
  bindRows();
}

function openDrawer(id) {
  const c = companies.find(x => x.id === id);
  if (!c) return;
  $("#drawerContent").innerHTML = `
    <div class="drawer-head">
      <p class="eyebrow">商機情報</p>
      <h2>${c.name}</h2>
      <div class="drawer-sub">統編 ${c.taxId} ・ ${c.city}${c.district}</div>
    </div>
    <div class="drawer-score">
      <div><span style="display:block;color:#667085;font-size:11px">商機分數</span><small style="color:#667085">依事件、規模、產業與成長訊號</small></div>
      <strong>${c.score}</strong>
    </div>
    <h3 style="font-size:14px;margin:0">為什麼現在值得聯絡？</h3>
    <div class="reason-list">${c.reasons.map(x=>`<div class="reason">✓ ${x}</div>`).join("")}</div>
    <div class="detail-grid">
      <div class="detail-item"><span>最新事件</span><strong>${c.event}</strong></div>
      <div class="detail-item"><span>異動日期</span><strong>${c.eventDate}</strong></div>
      <div class="detail-item"><span>資本額</span><strong>${fmtMoney(c.capital)}</strong></div>
      <div class="detail-item"><span>成立日期</span><strong>${c.setup}</strong></div>
      <div class="detail-item"><span>產業</span><strong>${c.industry}</strong></div>
      <div class="detail-item"><span>負責人</span><strong>${c.owner}</strong></div>
      <div class="detail-item" style="grid-column:1/-1"><span>登記地址</span><strong>${c.address}</strong></div>
    </div>
    <div class="action-box">
      <h3>建議業務切入</h3>
      <p>${c.action}</p>
    </div>
  `;
  $("#drawerBackdrop").classList.remove("hidden");
  $("#detailDrawer").classList.add("open");
  $("#detailDrawer").setAttribute("aria-hidden","false");
}

function closeDrawer() {
  $("#drawerBackdrop").classList.add("hidden");
  $("#detailDrawer").classList.remove("open");
  $("#detailDrawer").setAttribute("aria-hidden","true");
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(v=>v.classList.remove("active"));
  $("#"+view+"View").classList.add("active");
  document.querySelector(`[data-view="${view}"]`).classList.add("active");
  if(view === "saved") renderSaved();
}

function exportCsv() {
  const headers = ["公司名稱","統編","縣市","行政區","產業","資本額","最新事件","異動日期","商機分數"];
  const rows = filtered.map(c => [c.name,c.taxId,c.city,c.district,c.industry,c.capital,c.event,c.eventDate,c.score]);
  const esc = v => `"${String(v).replaceAll('"','""')}"`;
  const csv = "\ufeff" + [headers, ...rows].map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "企業商機雷達.csv"; a.click();
  URL.revokeObjectURL(url);
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1800);
}

populateOptions();
renderStats();
applyFilters();
renderSaved();

["searchInput","eventFilter","cityFilter","industryFilter","capitalFilter","sortSelect"].forEach(id => {
  $("#"+id).addEventListener(id === "searchInput" ? "input" : "change", applyFilters);
});
document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click",()=>switchView(btn.dataset.view)));
$("#drawerClose").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);
$("#exportBtn").addEventListener("click", exportCsv);
$("#refreshBtn").addEventListener("click", () => { applyFilters(); toast("商機名單已重新整理"); });
document.addEventListener("keydown", e => { if(e.key === "Escape") closeDrawer(); });