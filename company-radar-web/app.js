const $ = (s) => document.querySelector(s);
const fmtMoney = (n) => {
  n = Number(n || 0);
  if (!n) return "—";
  if (n >= 100000000) return (n/100000000).toFixed(n%100000000===0?0:1)+" 億";
  return (n/10000).toLocaleString()+" 萬";
};
const esc = (v) => String(v ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const savedKey = "company-radar-saved-v2";
let saved = new Set(JSON.parse(localStorage.getItem(savedKey) || "[]").map(String));
let payload = {companies:[],stats:{}};
let companies = [];
let filtered = [];

function eventClass(event) {
  if (event === "增資") return "capital";
  if (event === "搬遷") return "move";
  if (event === "名稱變更") return "director";
  return "";
}

function rowTemplate(c) {
  const types = Array.isArray(c.eventTypes) && c.eventTypes.length ? c.eventTypes : [c.event || "資料異動"];
  return `
  <article class="company-row">
    <div class="score ${c.score >= 85 ? "hot" : ""}">${esc(c.score)}</div>
    <div class="company-main">
      <button class="company-name" data-open="${esc(c.taxId)}">${esc(c.name)}</button>
      <div class="company-meta">${esc(c.taxId)} ・ ${esc((c.city||"")+(c.district||""))} ・ ${esc(c.industry||"未分類")}</div>
    </div>
    <div class="event-cell">
      <span>最新事件</span>
      <span class="event-badge ${eventClass(types[0])}">${esc(types.join("＋"))}</span>
    </div>
    <div class="metric">
      <span>資本額</span>
      <strong>${fmtMoney(c.capital)}</strong>
    </div>
    <div class="metric">
      <span>異動日期</span>
      <strong>${esc(c.eventDate||"—")}</strong>
    </div>
    <button class="star-btn ${saved.has(String(c.taxId)) ? "saved" : ""}" data-save="${esc(c.taxId)}" aria-label="加入追蹤">${saved.has(String(c.taxId)) ? "★" : "☆"}</button>
  </article>`;
}

function populateOptions() {
  const cityEl = $("#cityFilter");
  const industryEl = $("#industryFilter");
  cityEl.innerHTML = '<option value="all">全部地區</option>';
  industryEl.innerHTML = '<option value="all">全部產業</option>';
  const cities = [...new Set(companies.map(c => c.city).filter(Boolean))].sort();
  const industries = [...new Set(companies.map(c => c.industry).filter(Boolean))].sort();
  cityEl.insertAdjacentHTML("beforeend", cities.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(""));
  industryEl.insertAdjacentHTML("beforeend", industries.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(""));
}

function applyFilters() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const event = $("#eventFilter").value;
  const city = $("#cityFilter").value;
  const industry = $("#industryFilter").value;
  const minCapital = Number($("#capitalFilter").value);
  const sort = $("#sortSelect").value;

  filtered = companies.filter(c => {
    const hay = [c.name,c.taxId,c.industry,c.city,c.district,c.address,(c.eventTypes||[]).join(" ")].join(" ").toLowerCase();
    const types = Array.isArray(c.eventTypes) ? c.eventTypes : [c.event];
    return (!q || hay.includes(q))
      && (event === "all" || types.includes(event))
      && (city === "all" || c.city === city)
      && (industry === "all" || c.industry === industry)
      && Number(c.capital||0) >= minCapital;
  });

  filtered.sort((a,b) => {
    if (sort === "capital") return Number(b.capital||0) - Number(a.capital||0);
    if (sort === "date") return String(b.eventDate||"").localeCompare(String(a.eventDate||""));
    return Number(b.score||0) - Number(a.score||0);
  });
  renderList();
}

function renderList() {
  $("#companyList").innerHTML = filtered.map(rowTemplate).join("");
  $("#resultCount").textContent = filtered.length.toLocaleString();
  $("#emptyState").classList.toggle("hidden", filtered.length > 0);
  bindRows();
}

function renderStats() {
  const s = payload.stats || {};
  $("#statTotal").textContent = Number(s.detected ?? companies.length).toLocaleString();
  $("#statHot").textContent = Number(s.highPriority ?? companies.filter(c => c.score >= 80).length).toLocaleString();
  $("#statNew").textContent = Number(s.newCompanies ?? companies.filter(c => (c.eventTypes||[]).includes("新設立")).length).toLocaleString();
  $("#statCapital").textContent = Number(s.capitalIncrease ?? companies.filter(c => (c.eventTypes||[]).includes("增資")).length).toLocaleString();
}

function bindRows() {
  document.querySelectorAll("[data-open]").forEach(btn => btn.addEventListener("click", () => openDrawer(btn.dataset.open)));
  document.querySelectorAll("[data-save]").forEach(btn => btn.addEventListener("click", () => toggleSave(btn.dataset.save)));
}

function toggleSave(id) {
  id = String(id);
  saved.has(id) ? saved.delete(id) : saved.add(id);
  localStorage.setItem(savedKey, JSON.stringify([...saved]));
  renderList();
  renderSaved();
  toast(saved.has(id) ? "已加入追蹤清單" : "已移除追蹤");
}

function renderSaved() {
  const list = companies.filter(c => saved.has(String(c.taxId))).sort((a,b)=>b.score-a.score);
  $("#savedList").innerHTML = list.map(rowTemplate).join("");
  $("#savedEmpty").classList.toggle("hidden", list.length > 0);
  bindRows();
}

function openDrawer(id) {
  const c = companies.find(x => String(x.taxId) === String(id));
  if (!c) return;
  const types = Array.isArray(c.eventTypes) && c.eventTypes.length ? c.eventTypes : [c.event || "資料異動"];
  const reasons = Array.isArray(c.reasons) ? c.reasons : [];
  $("#drawerContent").innerHTML = `
    <div class="drawer-head">
      <p class="eyebrow">真實 Open Data 商機情報</p>
      <h2>${esc(c.name)}</h2>
      <div class="drawer-sub">統編 ${esc(c.taxId)} ・ ${esc((c.city||"")+(c.district||""))}</div>
    </div>
    <div class="drawer-score">
      <div><span style="display:block;color:#667085;font-size:11px">商機分數</span><small style="color:#667085">規則式：事件強度＋公開資本額</small></div>
      <strong>${esc(c.score)}</strong>
    </div>
    <h3 style="font-size:14px;margin:0">為什麼現在值得看？</h3>
    <div class="reason-list">${reasons.map(x=>`<div class="reason">✓ ${esc(x)}</div>`).join("") || '<div class="reason">官方資料顯示今日有異動。</div>'}</div>
    <div class="detail-grid">
      <div class="detail-item"><span>事件</span><strong>${esc(types.join("＋"))}</strong></div>
      <div class="detail-item"><span>異動日期</span><strong>${esc(c.eventDate||"—")}</strong></div>
      <div class="detail-item"><span>資本額</span><strong>${fmtMoney(c.capital)}</strong></div>
      <div class="detail-item"><span>設立日期</span><strong>${esc(c.setup||"—")}</strong></div>
      <div class="detail-item"><span>主要產業</span><strong>${esc(c.industry||"未分類")}</strong></div>
      <div class="detail-item"><span>組織別</span><strong>${esc(c.orgType||"—")}</strong></div>
      <div class="detail-item" style="grid-column:1/-1"><span>公開營業地址</span><strong>${esc(c.address||"—")}</strong></div>
    </div>
    <div class="action-box">
      <h3>建議業務切入</h3>
      <p>${esc(c.action||"先確認本次異動原因，再決定接觸方式。")}</p>
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
  const headers = ["公司名稱","統編","縣市","行政區","產業","資本額","事件","異動日期","商機分數","地址"];
  const rows = filtered.map(c => [c.name,c.taxId,c.city,c.district,c.industry,c.capital,(c.eventTypes||[c.event]).join("+"),c.eventDate,c.score,c.address]);
  const csvEsc = v => `"${String(v??"").replaceAll('"','""')}"`;
  const csv = "\ufeff" + [headers, ...rows].map(r => r.map(csvEsc).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `企業商機雷達_${payload.date||"latest"}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1800);
}

function renderDataStatus() {
  const generated = payload.generatedAt ? new Date(payload.generatedAt).toLocaleString("zh-TW") : "尚未完成第一次同步";
  $("#lastUpdated").textContent = `資料更新：${generated}`;
  const mode = $("#sourceMode");
  const status = $("#sourceStatus");
  if (payload.generatedAt) {
    mode.textContent = payload.baselineReady ? "Live Open Data" : "Baseline 建立完成";
    status.textContent = payload.baselineReady
      ? `已比對全國 ${Number(payload.rowCount||0).toLocaleString()} 筆營業中稅籍；事件來自每日快照差分與經濟部 API。`
      : `已載入全國 ${Number(payload.rowCount||0).toLocaleString()} 筆營業中稅籍；下一次同步起開始產生前後差分事件。`;
  } else {
    mode.textContent = "等待首次同步";
    status.textContent = "GitHub Actions 尚未完成第一輪政府 Open Data 同步。";
  }
}

async function loadData(showToast=false) {
  try {
    const res = await fetch(`./data/opportunities.json?v=${Date.now()}`, {cache:"no-store"});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
    companies = Array.isArray(payload.companies) ? payload.companies : [];
    populateOptions();
    renderStats();
    applyFilters();
    renderSaved();
    renderDataStatus();
    if (showToast) toast("已載入最新資料");
  } catch (err) {
    console.error(err);
    companies = [];
    filtered = [];
    renderStats();
    renderList();
    $("#sourceMode").textContent = "資料載入失敗";
    $("#sourceStatus").textContent = "無法讀取 opportunities.json，請查看 GitHub Actions 是否成功。";
    if (showToast) toast("最新資料載入失敗");
  }
}

["searchInput","eventFilter","cityFilter","industryFilter","capitalFilter","sortSelect"].forEach(id => {
  $("#"+id).addEventListener(id === "searchInput" ? "input" : "change", applyFilters);
});
document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click",()=>switchView(btn.dataset.view)));
$("#drawerClose").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);
$("#exportBtn").addEventListener("click", exportCsv);
$("#refreshBtn").addEventListener("click", () => loadData(true));
document.addEventListener("keydown", e => { if(e.key === "Escape") closeDrawer(); });

loadData();
