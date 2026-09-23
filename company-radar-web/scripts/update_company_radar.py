#!/usr/bin/env python3
"""
Build a real daily Taiwan company opportunity feed from government Open Data.

Sources
- MOF nationwide tax registration file (BGMOPEN1.zip), refreshed daily.
- MOEA/GCIS company setup-by-date API.
- MOEA/GCIS company change-by-date API.

The first successful run establishes a nationwide baseline. Later runs compare the
current BGM snapshot with the cached prior snapshot to classify observable
changes such as capital, address, name and industry changes.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "company-radar-web"
DATA_DIR = WEB_DIR / "data"
HISTORY_DIR = DATA_DIR / "history"
CACHE_DIR = ROOT / ".cache" / "company-radar"
STATE_DB = CACHE_DIR / "company_state.sqlite"

BGM_URL = "https://eip.fia.gov.tw/data/BGMOPEN1.zip"
GCIS_BASE = "https://data.gcis.nat.gov.tw/od/data/api"
GCIS_SETUP = "467E8A3A-72C6-4663-9557-D9D74C597E14"
GCIS_CHANGE = "4347A009-6489-4F19-AC79-78F366BE7976"
GCIS_BASIC = "5F64D864-61CB-4D0D-8AD9-492047CC1EA6"

MAX_FRONTEND_ROWS = int(os.environ.get("RADAR_MAX_ROWS", "5000"))
HISTORY_DAYS = int(os.environ.get("RADAR_HISTORY_DAYS", "60"))
UA = "OpenData-Company-Radar/1.0 (+https://github.com/hub-google/OpenData)"


def log(msg: str) -> None:
    print(f"[company-radar] {msg}", flush=True)


def request_bytes(url: str, timeout: int = 120, retries: int = 4) -> bytes:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:
            last = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def roc_date(d: date) -> str:
    return f"{d.year - 1911:03d}{d.month:02d}{d.day:02d}"


def gcis_by_date(endpoint: str, field: str, value: str) -> list[dict]:
    rows: list[dict] = []
    skip = 0
    top = 1000
    while True:
        query = urllib.parse.urlencode({
            "$format": "json",
            "$filter": f"{field} eq {value}",
            "$skip": str(skip),
            "$top": str(top),
        })
        url = f"{GCIS_BASE}/{endpoint}?{query}"
        try:
            payload = json.loads(request_bytes(url, timeout=60).decode("utf-8-sig"))
        except Exception as exc:
            log(f"WARNING: GCIS {field} query failed: {exc}")
            return rows

        if isinstance(payload, dict):
            payload = payload.get("value") or payload.get("data") or []
        if not isinstance(payload, list):
            log(f"WARNING: unexpected GCIS response for {field}: {type(payload).__name__}")
            return rows
        rows.extend(payload)
        if len(payload) < top:
            break
        skip += top
        if skip > 500000:
            break
    return rows



def gcis_basic_company(tax_id: str) -> dict | None:
    """補齊剛設立、尚未進稅籍檔公司的資本額/地址。失敗時不影響主流程。"""
    query = urllib.parse.urlencode({
        "$format": "json",
        "$filter": f"Business_Accounting_NO eq {tax_id}",
        "$skip": "0",
        "$top": "1",
    })
    url = f"{GCIS_BASE}/{GCIS_BASIC}?{query}"
    payload = json.loads(request_bytes(url, timeout=30, retries=2).decode("utf-8-sig"))
    if isinstance(payload, dict):
        payload = payload.get("value") or payload.get("data") or []
    if isinstance(payload, list) and payload:
        return payload[0]
    return None

def clean_int(value) -> int:
    text = str(value or "").replace(",", "").strip()
    try:
        return int(float(text)) if text else 0
    except ValueError:
        return 0


def norm(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def row_value(row: dict, *keys: str) -> str:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return norm(row[key])
    return ""


def extract_area(address: str) -> tuple[str, str]:
    address = address or ""
    m = re.match(r"^(.{2,3}[市縣])", address)
    city = m.group(1) if m else "未分類"
    rest = address[len(city):] if m else address
    d = re.match(r"^(.{1,4}(?:區|鄉|鎮|市))", rest)
    district = d.group(1) if d else ""
    return city, district


def init_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=MEMORY")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            tax_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            capital INTEGER NOT NULL,
            setup_date TEXT NOT NULL,
            org_type TEXT NOT NULL,
            invoice TEXT NOT NULL,
            industry_codes TEXT NOT NULL,
            industry_names TEXT NOT NULL
        )
    """)
    return conn


def parse_bgm_to_db(zip_bytes: bytes, db_path: Path) -> int:
    if db_path.exists():
        db_path.unlink()
    conn = init_db(db_path)
    insert_sql = """
        INSERT OR REPLACE INTO companies
        (tax_id,name,address,capital,setup_date,org_type,invoice,industry_codes,industry_names)
        VALUES (?,?,?,?,?,?,?,?,?)
    """

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not names:
            raise RuntimeError("BGMOPEN1.zip did not contain a CSV file")
        csv_name = names[0]
        log(f"Parsing {csv_name} from BGMOPEN1.zip")
        with zf.open(csv_name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
            reader = csv.DictReader(text)
            batch = []
            count = 0
            for row in reader:
                tax_id = row_value(row, "統一編號")
                if not re.fullmatch(r"\d{8}", tax_id):
                    continue
                codes = [row_value(row, "行業代號")]
                inds = [row_value(row, "名稱")]
                for i in range(1, 4):
                    codes.append(row_value(row, f"行業代號{i}"))
                    inds.append(row_value(row, f"名稱{i}"))
                codes = [x for x in codes if x]
                inds = [x for x in inds if x]
                batch.append((
                    tax_id,
                    row_value(row, "營業人名稱"),
                    row_value(row, "營業地址"),
                    clean_int(row_value(row, "資本額")),
                    row_value(row, "設立日期"),
                    row_value(row, "組織別名稱"),
                    row_value(row, "使用統一發票"),
                    "|".join(codes),
                    "|".join(inds),
                ))
                if len(batch) >= 5000:
                    conn.executemany(insert_sql, batch)
                    count += len(batch)
                    batch.clear()
            if batch:
                conn.executemany(insert_sql, batch)
                count += len(batch)
        conn.commit()
    conn.execute("CREATE INDEX IF NOT EXISTS idx_companies_capital ON companies(capital)")
    conn.commit()
    conn.close()
    return count


def load_company(conn: sqlite3.Connection, tax_id: str) -> dict | None:
    row = conn.execute("""
        SELECT tax_id,name,address,capital,setup_date,org_type,invoice,industry_codes,industry_names
        FROM companies WHERE tax_id=?
    """, (tax_id,)).fetchone()
    if not row:
        return None
    keys = ["taxId","name","address","capital","setup","orgType","invoice","industryCodes","industryNames"]
    return dict(zip(keys, row))


def score_company(event_types: list[str], capital: int, changes: dict | None = None) -> int:
    """商機分數不是異動熱度；只獎勵仍可能帶來後續支出的訊號。"""
    changes = changes or {}
    types = set(event_types)

    # 主訊號：後面仍有採購、擴編、營運建置機會
    if "增資" in types:
        score = 72
    elif "新設立" in types:
        score = 66
    elif "產業異動" in types:
        score = 58
    else:
        # 搬遷/改名/一般登記異動大多是落後或不明訊號，不可因公司很大就變高分
        score = 18

    if "新設立" in types and "產業異動" in types:
        score += 8
    if "增資" in types and "產業異動" in types:
        score += 12
    if "增資" in types and "搬遷" in types:
        score += 5  # 搬遷只當擴張佐證，不是主商機
    if "新設立" in types and "搬遷" in types:
        score += 2

    if {"增資", "新設立", "產業異動"} & types:
        if capital >= 100_000_000:
            score += 14
        elif capital >= 50_000_000:
            score += 11
        elif capital >= 10_000_000:
            score += 8
        elif capital >= 5_000_000:
            score += 6
        elif capital >= 1_000_000:
            score += 3

    cap = changes.get("capital") or {}
    delta = clean_int(cap.get("delta"))
    before = clean_int(cap.get("before"))
    if "增資" in types and delta:
        if delta >= 100_000_000:
            score += 10
        elif delta >= 50_000_000:
            score += 8
        elif delta >= 10_000_000:
            score += 5
        if before and delta >= before:
            score += 4

    # 只有落後/弱訊號永遠不列成高價值商機
    if not ({"增資", "新設立", "產業異動"} & types):
        score = min(score, 35)
    if "減資" in types and not ({"增資", "新設立", "產業異動"} & types):
        score = min(score, 20)

    return max(1, min(99, score))


def money_zh(n: int) -> str:
    if n >= 100_000_000:
        return f"{n / 100_000_000:.1f} 億".replace(".0 億", " 億")
    if n >= 10_000:
        return f"{n / 10_000:,.0f} 萬"
    return f"{n:,}"


def industry_spend_themes(industry: str) -> list[str]:
    text = industry or ""
    if any(k in text for k in ["製造", "電子", "機械", "金屬", "半導體"]):
        return ["設備/自動化", "原料與供應鏈", "廠務/能源", "物流", "產險與員工保障"]
    if any(k in text for k in ["餐飲", "食品", "零售", "咖啡", "超商"]):
        return ["展店/通路", "POS與支付", "物流/倉儲", "行銷", "招募與員工保障"]
    if any(k in text for k in ["軟體", "資訊", "電腦", "資料處理", "雲端"]):
        return ["雲端/資安", "企業軟體", "招募", "行銷", "辦公與員工保障"]
    if any(k in text for k in ["營造", "工程", "建築", "不動產"]):
        return ["工程設備", "車輛/機具", "融資與保險", "工安", "供應商與人力"]
    if any(k in text for k in ["醫療", "藥", "生醫", "健康"]):
        return ["設備/醫材", "法遵", "資訊系統", "專業人才", "責任險與員工保障"]
    return ["企業軟體/電信", "招募", "金融與保險", "行銷", "設備與營運採購"]


def opportunity_profile(event_types: list[str], capital: int, changes: dict, industry: str) -> dict:
    types = set(event_types)
    themes = industry_spend_themes(industry)

    if "增資" in types:
        signal_class = "資金到位"
        stage = "前中段訊號"
        value = "高"
        lead_window = "未來 1–6 個月值得追蹤"
        meaning = "公司近期資本額增加。資金已到位，不代表缺錢；真正價值是後續可能進入擴產、擴編、設備或新專案支出期。"
        action = "先查增資幅度與產業，再問『這次資金主要投入哪個計畫？』；不要再用融資缺口當第一切角。"
    elif "新設立" in types:
        signal_class = "開辦期"
        stage = "前段訊號"
        value = "高"
        lead_window = "未來 0–6 個月值得追蹤"
        meaning = "法人剛成立，供應商與營運配置通常尚未完全固定；開辦、招募、系統、保險與採購仍有切入空間。"
        action = "優先找高資本額且產業需求明確的新公司，從開辦必需品與第一批供應商關係切入。"
    elif "產業異動" in types:
        signal_class = "新業務訊號"
        stage = "前中段訊號"
        value = "中高"
        lead_window = "未來 1–12 個月值得追蹤"
        meaning = "稅籍行業分類出現變化，可能是營運方向、產品線或收入結構改變的訊號；需再確認是否為真正的新事業。"
        action = "先確認新增/改變的業務方向，再找該新業務啟動必須購買的服務，而不是泛泛推銷。"
    elif "搬遷" in types:
        signal_class = "落後佐證"
        stage = "後段訊號"
        value = "低"
        lead_window = "事件多半已發生；只適合做擴張佐證"
        meaning = "地址變更通常在搬遷後才登記；不應拿來賣搬家、裝潢或首次網路佈建。"
        action = "不要把搬遷本身當主商機；只有搭配增資、產業變化等訊號時，才把它視為擴張的佐證。"
    elif "減資" in types:
        signal_class = "風險訊號"
        stage = "後段/風險"
        value = "低"
        lead_window = "不作一般銷售主名單"
        meaning = "減資更適合風險、授信與供應鏈監控，不代表公司正準備增加支出。"
        action = "從一般銷售名單降權；若產品是徵信、授信、法遵或供應鏈風險服務才提高關注。"
    else:
        signal_class = "待確認"
        stage = "未知"
        value = "觀察"
        lead_window = "先查明異動內容"
        meaning = "官方確認今日有公司登記異動，但目前欄位不足以判斷是否與未來支出有關。"
        action = "先補查異動明細；沒有確認增資、新業務或其他成長訊號前，不列為高優先業務名單。"

    if "搬遷" in types and ({"增資", "新設立", "產業異動"} & types):
        meaning += " 同時出現地址變更，可作為組織/據點調整的佐證，但不單獨視為需求。"

    score = score_company(event_types, capital, changes)
    tier = "A" if score >= 80 else "B" if score >= 65 else "C" if score >= 50 else "觀察"
    return {
        "score": score,
        "tier": tier,
        "signalClass": signal_class,
        "signalStage": stage,
        "commercialValue": value,
        "leadWindow": lead_window,
        "commercialMeaning": meaning,
        "likelyNeeds": themes,
        "action": action,
        "actionable": score >= 50 and bool({"增資", "新設立", "產業異動"} & types),
    }


def main() -> int:
    today = date.today()
    roc = roc_date(today)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    log(f"Target date: {today.isoformat()} (ROC {roc})")
    setup_rows = gcis_by_date(GCIS_SETUP, "Company_Setup_Date", roc)
    change_rows = gcis_by_date(GCIS_CHANGE, "Change_Of_Approval_Data", roc)
    setup_map = {norm(x.get("Business_Accounting_NO")): norm(x.get("Company_Name")) for x in setup_rows}
    change_map = {norm(x.get("Business_Accounting_NO")): norm(x.get("Company_Name")) for x in change_rows}
    setup_map = {k: v for k, v in setup_map.items() if re.fullmatch(r"\d{8}", k)}
    change_map = {k: v for k, v in change_map.items() if re.fullmatch(r"\d{8}", k)}
    log(f"GCIS setup={len(setup_map)}, changed={len(change_map)}")

    zip_bytes = request_bytes(BGM_URL, timeout=180)
    log(f"Downloaded BGMOPEN1.zip: {len(zip_bytes) / 1024 / 1024:.1f} MB")

    with tempfile.TemporaryDirectory() as td:
        current_db = Path(td) / "current.sqlite"
        row_count = parse_bgm_to_db(zip_bytes, current_db)
        log(f"Loaded {row_count:,} active tax registrations")

        baseline_ready = STATE_DB.exists() and STATE_DB.stat().st_size > 0
        conn = sqlite3.connect(current_db)
        conn.row_factory = sqlite3.Row

        # 新設公司常比財政部稅籍檔更早出現；僅對尚未有完整稅籍資料者補查公司登記基本資料。
        basic_info: dict[str, dict] = {}
        enrichment_available = True
        enriched = 0
        for tax_id in setup_map:
            existing = load_company(conn, tax_id)
            if existing and existing.get("capital") and existing.get("address"):
                continue
            if not enrichment_available:
                break
            try:
                info = gcis_basic_company(tax_id)
                if info:
                    basic_info[tax_id] = info
                    enriched += 1
                time.sleep(0.03)
            except Exception as exc:
                enrichment_available = False
                log(f"WARNING: GCIS basic-company enrichment unavailable; continuing without it: {exc}")
        log(f"GCIS new-company enrichment={enriched}")

        events: dict[str, dict] = {}

        if baseline_ready:
            conn.execute("ATTACH DATABASE ? AS prev", (str(STATE_DB),))
            diff_sql = """
                SELECT c.*,
                       p.name AS p_name, p.address AS p_address, p.capital AS p_capital,
                       p.industry_codes AS p_industry_codes, p.industry_names AS p_industry_names
                FROM companies c
                JOIN prev.companies p ON c.tax_id=p.tax_id
                WHERE c.name<>p.name
                   OR c.address<>p.address
                   OR c.capital<>p.capital
                   OR c.industry_codes<>p.industry_codes
                   OR c.industry_names<>p.industry_names
            """
            for r in conn.execute(diff_sql):
                tax_id = r["tax_id"]
                types = []
                reasons = []
                changes = {}
                if r["capital"] > r["p_capital"]:
                    types.append("增資")
                    delta = r["capital"] - r["p_capital"]
                    changes["capital"] = {"before": r["p_capital"], "after": r["capital"], "delta": delta}
                    reasons.append(f"資本額由 {money_zh(r['p_capital'])} 增加至 {money_zh(r['capital'])}（+{money_zh(delta)}）")
                elif r["capital"] < r["p_capital"]:
                    types.append("減資")
                    changes["capital"] = {"before": r["p_capital"], "after": r["capital"], "delta": r["capital"] - r["p_capital"]}
                    reasons.append(f"資本額由 {money_zh(r['p_capital'])} 變更為 {money_zh(r['capital'])}")
                if r["address"] != r["p_address"]:
                    types.append("搬遷")
                    changes["address"] = {"before": r["p_address"], "after": r["address"]}
                    reasons.append(f"營業地址由「{r['p_address'] or '未提供'}」變更為「{r['address'] or '未提供'}」")
                if r["industry_codes"] != r["p_industry_codes"] or r["industry_names"] != r["p_industry_names"]:
                    types.append("產業異動")
                    changes["industry"] = {"before": r["p_industry_names"], "after": r["industry_names"]}
                    reasons.append("稅籍行業分類與前一日快照不同")
                if r["name"] != r["p_name"]:
                    types.append("名稱變更")
                    changes["name"] = {"before": r["p_name"], "after": r["name"]}
                    reasons.append(f"名稱由「{r['p_name']}」變更為「{r['name']}」")
                if types:
                    events[tax_id] = {"types": types, "reasons": reasons, "changes": changes}

            conn.execute("DETACH DATABASE prev")
            log(f"Snapshot diff events={len(events)}")
        else:
            log("No previous baseline found; this run establishes the nationwide baseline.")

        # GCIS is authoritative for today's approval/setup date. Merge those signals.
        for tax_id in change_map:
            item = events.setdefault(tax_id, {"types": [], "reasons": [], "changes": {}})
            if not item["types"]:
                item["types"].append("其他公司登記異動")
                item["reasons"].append("經濟部公司資料異動 API 顯示今日有核准變更")
            elif "其他公司登記異動" not in item["types"]:
                item["reasons"].append("經濟部公司資料異動 API 同步顯示今日有核准變更")

        for tax_id in setup_map:
            item = events.setdefault(tax_id, {"types": [], "reasons": [], "changes": {}})
            if "新設立" not in item["types"]:
                item["types"].insert(0, "新設立")
                item["reasons"].insert(0, "經濟部公司資料設立 API 顯示今日核准設立")
            item["types"] = [x for x in item["types"] if x != "其他公司登記異動"]

        companies = []
        counts: dict[str, int] = {}
        for tax_id, event in events.items():
            c = load_company(conn, tax_id)
            basic = basic_info.get(tax_id) or {}
            if c is None:
                c = {
                    "taxId": tax_id,
                    "name": norm(basic.get("Company_Name")) or setup_map.get(tax_id) or change_map.get(tax_id) or "公司資料同步中",
                    "address": norm(basic.get("Company_Location")),
                    "capital": clean_int(basic.get("Paid_In_Capital_Amount")) or clean_int(basic.get("Capital_Stock_Amount")),
                    "setup": norm(basic.get("Company_Setup_Date")),
                    "orgType": "",
                    "invoice": "",
                    "industryCodes": "",
                    "industryNames": "",
                    "owner": norm(basic.get("Responsible_Name")),
                }
            elif basic:
                if not c.get("address"):
                    c["address"] = norm(basic.get("Company_Location"))
                if not c.get("capital"):
                    c["capital"] = clean_int(basic.get("Paid_In_Capital_Amount")) or clean_int(basic.get("Capital_Stock_Amount"))
                if not c.get("setup"):
                    c["setup"] = norm(basic.get("Company_Setup_Date"))
                c["owner"] = norm(basic.get("Responsible_Name"))

            types = list(dict.fromkeys(event["types"]))
            for t in types:
                counts[t] = counts.get(t, 0) + 1
            city, district = extract_area(c["address"])
            industries = [x for x in c["industryNames"].split("|") if x]
            industry = industries[0] if industries else "未分類"
            reasons = list(dict.fromkeys(event["reasons"]))
            profile = opportunity_profile(types, c["capital"], event.get("changes", {}), industry)
            if c["capital"]:
                reasons.append(f"目前公開資本額 {money_zh(c['capital'])}")
            if industry != "未分類":
                reasons.append(f"主要稅籍行業：{industry}")

            companies.append({
                "id": tax_id,
                "name": c["name"],
                "taxId": tax_id,
                "city": city,
                "district": district,
                "industry": industry,
                "industries": industries,
                "capital": c["capital"],
                "event": types[0] if types else "資料異動",
                "eventTypes": types,
                "eventDate": today.isoformat(),
                "score": profile["score"],
                "tier": profile["tier"],
                "signalClass": profile["signalClass"],
                "signalStage": profile["signalStage"],
                "commercialValue": profile["commercialValue"],
                "leadWindow": profile["leadWindow"],
                "commercialMeaning": profile["commercialMeaning"],
                "likelyNeeds": profile["likelyNeeds"],
                "actionable": profile["actionable"],
                "changes": event.get("changes", {}),
                "setup": c["setup"],
                "owner": c.get("owner", ""),
                "address": c["address"],
                "orgType": c["orgType"],
                "invoice": c["invoice"],
                "reasons": reasons[:6],
                "action": profile["action"],
            })

        conn.close()

        companies.sort(key=lambda x: (x["score"], x["capital"]), reverse=True)
        total_detected = len(companies)
        visible = companies[:MAX_FRONTEND_ROWS]

        now_tpe = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
        payload = {
            "generatedAt": now_tpe,
            "date": today.isoformat(),
            "baselineReady": baseline_ready,
            "rowCount": row_count,
            "stats": {
                "detected": total_detected,
                "actionable": sum(1 for x in companies if x.get("actionable")),
                "highPriority": sum(1 for x in companies if x["score"] >= 80 and x.get("actionable")),
                "newCompanies": counts.get("新設立", 0),
                "capitalIncrease": counts.get("增資", 0),
                "addressChange": counts.get("搬遷", 0),
                "industryChange": counts.get("產業異動", 0),
                "laggingOnly": sum(1 for x in companies if not x.get("actionable")),
            },
            "eventCounts": counts,
            "sources": [
                {
                    "name": "財政部財政資訊中心－全國營業(稅籍)登記資料集",
                    "url": "https://data.gov.tw/dataset/9400",
                    "refresh": "每日",
                },
                {
                    "name": "經濟部商業發展署－公司資料設立查詢",
                    "url": "https://data.gcis.nat.gov.tw/od/detail?oid=8D314711-6324-4CE7-A358-2FF284A9F84D",
                    "refresh": "API",
                },
                {
                    "name": "經濟部商業發展署－公司資料異動查詢",
                    "url": "https://data.gov.tw/dataset/84880",
                    "refresh": "API",
                },
            ],
            "notes": [
                "第一次成功執行會建立全台營業中稅籍 baseline；從下一次執行開始才可依前後快照辨識資本額、地址與產業欄位的實際變化。",
                "商機分數改以『未來支出可能性』為核心：新設、增資、產業變化為主訊號；搬遷、改名與不明異動只作佐證或觀察。",
                "地址變更通常屬落後訊號；系統不再把搬遷本身解讀成搬家、裝潢或網路佈建商機。",
                "「其他公司登記異動」代表經濟部 API 確認今日有核准變更，但目前公開欄位差分不足以判定是哪一種異動。",
                f"前端最多載入分數最高的 {MAX_FRONTEND_ROWS:,} 筆；統計數字以全部偵測事件計算。",
            ],
            "companies": visible,
        }

        out = DATA_DIR / "opportunities.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        hist = HISTORY_DIR / f"{today.isoformat()}.json"
        hist.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        cutoff = today - timedelta(days=HISTORY_DAYS)
        for old in HISTORY_DIR.glob("*.json"):
            try:
                d = date.fromisoformat(old.stem)
            except ValueError:
                continue
            if d < cutoff:
                old.unlink()

        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(current_db, STATE_DB)

    log(f"Wrote {len(visible):,}/{total_detected:,} opportunities to {out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERROR: {exc}")
        raise
