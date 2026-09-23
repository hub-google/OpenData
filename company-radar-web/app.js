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

const savedKey = "company-radar-saved-v3";
let saved = new Set(JSON.parse(localStorage.getItem(savedKey) || "[]").map(String));
let payload = {companies:[],stats:{}};
let companies = [];
let filtered = [];

function signalClassName(c) {
  if (["資金到位","大型專案啟動"].includes(c.signalClass)) return "capital";
  if (["落後佐證","風險訊號"].includes(c.signalClass)) return "move";
  if (["新業務訊號","新事業啟動","據點擴張"].includes(c.signalClass)) return "director";
  return "";
}

function rowTemplate(c) {
  const types = Array.isArray(c.eventTypes) && c.eventTypes.length ? c.eventTypes : [c.event || "資料異動"];
  return `
  <article class="company-row">
    <div class="score ${c.score >= 80 && c.actionable ? "hot" : ""}">${esc(c.score)}</div>
    <div class="company-main">
      <button class="company-name" data-open="${esc(c.taxId)}">${esc(c.name)}</button>
      <div class="company-meta">${esc(c.taxId)} ・ ${esc((c.city||"")+(c.district||""))} ・ ${esc(c.industry||"未分類")}</div>
    </div>
    <div class="event-cell">
      <span>商機訊號</span>
      <span class="event-badge ${signalClassName(c)}">${esc(c.signalClass || "待確認")}・${esc(c.tier || "觀察")}</span>
    </div>
    <div class="metric">
      <span>主要事件</span>
      <strong>${esc(types.join("＋"))}</strong>
    </div>
    <div class="metric">
      <span>資本額</span>
      <strong>${fmtMoney(c.capital)}</strong>
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
  const signal = $("#signalFilter").value;
  const event = $("#eventFilter").value;
  const city = $("#cityFilter").value;
  const industry = $("#industryFilter").value;
  const minCapital = Number($("#capitalFilter").value);
  const sort = $("#sortSelect").value;

  filtered = companies.filter(c => {
    const hay = [c.name,c.taxId,c.industry,c.city,c.district,c.address,c.signalClass,c.commercialMeaning,(c.eventTypes||[]).join(" ")].join(" ").toLowerCase();
    const types = Array.isArray(c.eventTypes) ? c.eventTypes : [c.event];
    const signalOk =
      signal === "all" ||
      (signal === "actionable" && c.actionable) ||
      (signal === "watch" && !c.actionable) ||
      c.signalClass === signal;
    return (!q || hay.includes(q))
      && signalOk
      && (event === "all" || types.includes(event))
      && (city === "all" || c.city === city)
      && (industry === "all" || c.industry === industry)
      && Number(c.capital||0) >= minCapital;
  });

  filtered.sort((a,b) => {
    if (sort === "capital") return Number(b.capital||0) - Number(a.capital||0);
    if (sort === "date") return String(b.eventDate||"").localeCompare(String(a.eventDate||""));
    return Number(b.score||0) - Number(a.score||0) || Number(b.capital||0)-Number(a.capital||0);
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
  $("#statTotal").textContent = Number(s.actionable ?? companies.filter(c=>c.actionable).length).toLocaleString();
  $("#statHot").textContent = Number(s.highPriority ?? companies.filter(c => c.actionable && c.score >= 80).length).toLocaleString();
  $("#statNew").textContent = Number(s.newCompanies ?? companies.filter(c => (c.eventTypes||[]).includes("新設立")).length).toLocaleString();
  $("#statCapital").textContent = Number(s.capitalIncrease ?? companies.filter(c => (c.eventTypes||[]).includes("增資")).length).toLocaleString();
  const industry = Number(s.industryChange || 0);
  const businessAdd = Number(s.businessItemAdded || 0);
  const branches = Number(s.newBranches || 0);
  const awards = Number(s.giantProcurement || 0);
  const lagging = Number(s.laggingOnly || 0);
  $("#statsNote").textContent = `新事業項目 ${businessAdd.toLocaleString()} 家・新設分公司 ${branches.toLocaleString()} 家・巨額標案 ${awards.toLocaleString()} 家・產業變化 ${industry.toLocaleString()} 家；另有 ${lagging.toLocaleString()} 家僅屬落後／不明訊號。`;
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
  const needs = Array.isArray(c.likelyNeeds) ? c.likelyNeeds : [];
  $("#drawerContent").innerHTML = `
    <div class="drawer-head">
      <p class="eyebrow">企業成長／擴張訊號</p>
      <h2>${esc(c.name)}</h2>
      <div class="drawer-sub">統編 ${esc(c.taxId)} ・ ${esc((c.city||"")+(c.district||""))}</div>
    </div>
    <div class="drawer-score">
      <div>
        <span style="display:block;color:#667085;font-size:11px">商機分數・${esc(c.tier||"觀察")}</span>
        <small style="color:#667085">${esc(c.signalClass||"待確認")}｜${esc(c.signalStage||"未知")}</small>
      </div>
      <strong>${esc(c.score)}</strong>
    </div>

    <h3 style="font-size:14px;margin:0">這個訊號真正代表什麼？</h3>
    <div class="action-box" style="margin-top:10px">
      <p>${esc(c.commercialMeaning || "目前只能確認有官方異動，尚不足以判定商機。")}</p>
    </div>

    <h3 style="font-size:14px;margin:22px 0 0">為什麼被抓到？</h3>
    <div class="reason-list">${reasons.map(x=>`<div class="reason">✓ ${esc(x)}</div>`).join("") || '<div class="reason">官方資料顯示今日有異動。</div>'}</div>

    <div class="detail-grid">
      <div class="detail-item"><span>事件</span><strong>${esc(types.join("＋"))}</strong></div>
      <div class="detail-item"><span>建議追蹤時窗</span><strong>${esc(c.leadWindow||"—")}</strong></div>
      <div class="detail-item"><span>資本額</span><strong>${fmtMoney(c.capital)}</strong></div>
      <div class="detail-item"><span>設立日期</span><strong>${esc(c.setup||"—")}</strong></div>
      <div class="detail-item"><span>主要產業</span><strong>${esc(c.industry||"未分類")}</strong></div>
      <div class="detail-item"><span>商機價值</span><strong>${esc(c.commercialValue||"觀察")}</strong></div>
      <div class="detail-item" style="grid-column:1/-1"><span>公開營業地址</span><strong>${esc(c.address||"—")}</strong></div>
    </div>

    <div class="action-box">
      <h3>後續可能支出方向</h3>
      <p>${esc(needs.join("、") || "需先確認異動內容")}</p>
    </div>
    ${Array.isArray(c.changes?.businessItemsAdded) && c.changes.businessItemsAdded.length ? `
      <div class="action-box"><h3>新增營業項目</h3><p>${c.changes.businessItemsAdded.map(x=>esc(x.desc||x.code)).join("、")}</p></div>` : ""}
    ${Array.isArray(c.changes?.newBranches) && c.changes.newBranches.length ? `
      <div class="action-box"><h3>新設分公司</h3><p>${c.changes.newBranches.map(x=>`${esc(x.name||x.taxId)}｜${esc(x.location||"")}`).join("<br>")}</p></div>` : ""}
    ${Array.isArray(c.changes?.giantProcurements) && c.changes.giantProcurements.length ? `
      <div class="action-box"><h3>政府巨額採購</h3><p>${c.changes.giantProcurements.map(x=>`${esc(x.caseName||"政府標案")}${x.awardAmount ? "｜"+fmtMoney(x.awardAmount) : ""}`).join("<br>")}</p></div>` : ""}
    ${c.hiringSignal?.postings ? `
      <div class="action-box"><h3>徵才佐證</h3><p>台灣就業通命中 ${esc(c.hiringSignal.postings)} 筆${c.hiringSignal.people ? "，預計招募 "+esc(c.hiringSignal.people)+" 人" : ""}${c.hiringSignal.roles?.length ? "｜"+c.hiringSignal.roles.map(esc).join("、") : ""}<br><small>官方介面單次最多 1000 筆，僅作佐證。</small></p></div>` : ""}
    <div class="action-box">
      <h3>怎麼切入比較合理</h3>
      <p>${esc(c.action||"先確認本次異動原因，再決定是否接觸。")}</p>
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
  const headers = ["公司名稱","統編","縣市","行政區","產業","資本額","商機訊號","事件","商機等級","商機分數","建議追蹤時窗","可能支出方向","地址"];
  const rows = filtered.map(c => [c.name,c.taxId,c.city,c.district,c.industry,c.capital,c.signalClass,(c.eventTypes||[c.event]).join("+"),c.tier,c.score,c.leadWindow,(c.likelyNeeds||[]).join(" / "),c.address]);
  const csvEsc = v => `"${String(v??"").replaceAll('"','""')}"`;
  const csv = "\ufeff" + [headers, ...rows].map(r => r.map(csvEsc).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `企業擴張雷達_${payload.date||"latest"}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1800);
}

function renderDataStatus() {
  const generated = payload.generatedAt ? new Date(payload.generatedAt).toLocaleString("zh-TW") : "尚未完成同步";
  $("#lastUpdated").textContent = `資料更新：${generated}`;
  const mode = $("#sourceMode");
  const status = $("#sourceStatus");
  if (payload.generatedAt) {
    mode.textContent = "Live Expansion Signals";
    status.textContent = `每日比對全國 ${Number(payload.rowCount||0).toLocaleString()} 筆營業中稅籍；只有仍可能帶來後續支出的訊號才列為商機。`;
  } else {
    mode.textContent = "等待同步";
    status.textContent = "GitHub Actions 尚未完成政府 Open Data 同步。";
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

["searchInput","signalFilter","eventFilter","cityFilter","industryFilter","capitalFilter","sortSelect"].forEach(id => {
  $("#"+id).addEventListener(id === "searchInput" ? "input" : "change", applyFilters);
});
document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click",()=>switchView(btn.dataset.view)));
$("#drawerClose").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);
$("#exportBtn").addEventListener("click", exportCsv);
$("#refreshBtn").addEventListener("click", () => loadData(true));
document.addEventListener("keydown", e => { if(e.key === "Escape") closeDrawer(); });

loadData();
