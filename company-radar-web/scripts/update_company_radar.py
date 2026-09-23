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
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
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
GCIS_BUSINESS = "236EE382-4942-41A9-BD03-CA0709025E7C"
GCIS_BRANCH = "FDB8D2C8-573D-4276-BFA4-8D3925ABE1CB"
TAIWANJOBS_URL = "https://free.taiwanjobs.gov.tw/webservice_taipei/Webservice.ashx?count=1000"
PCC_GIANT_URL = "https://web.pcc.gov.tw/peems/lapeem/lapeemGeneralPolit/downLoadOpenData"
FACTORY_CSV_URL = "https://www.ida.gov.tw/opendata/02/SDD6569.csv"

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


def gcis_company_rows(endpoint: str, tax_id: str) -> list[dict]:
    query = urllib.parse.urlencode({
        "$format": "json",
        "$filter": f"Business_Accounting_NO eq {tax_id}",
        "$skip": "0",
        "$top": "1000",
    })
    url = f"{GCIS_BASE}/{endpoint}?{query}"
    payload = json.loads(request_bytes(url, timeout=40, retries=2).decode("utf-8-sig"))
    if isinstance(payload, dict):
        payload = payload.get("value") or payload.get("data") or []
    return payload if isinstance(payload, list) else []


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
    return bool(row)


def copy_tracking_tables(current: sqlite3.Connection, previous_path: Path) -> None:
    if not previous_path.exists():
        return
    current.execute("ATTACH DATABASE ? AS prevtrack", (str(previous_path),))
    try:
        for table in ("business_items", "branches"):
            exists = current.execute(
                "SELECT 1 FROM prevtrack.sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if exists:
                current.execute(f"INSERT OR REPLACE INTO {table} SELECT * FROM prevtrack.{table}")
        current.commit()
    finally:
        current.execute("DETACH DATABASE prevtrack")


def xml_records(raw: bytes) -> list[dict]:
    """Best-effort XML flattener for official feeds with varying record tag names."""
    root = ET.fromstring(raw)
    records = []
    for elem in root.iter():
        children = list(elem)
        if len(children) < 3:
            continue
        row = {}
        useful = 0
        for child in children:
            key = child.tag.split("}")[-1].strip()
            value = norm(child.text)
            if key and value:
                row[key] = value
                useful += 1
        if useful >= 3:
            records.append(row)
    return records


def first_key(row: dict, keys: list[str]) -> str:
    for wanted in keys:
        for key, value in row.items():
            if key.lower() == wanted.lower() or wanted in key:
                if value not in (None, ""):
                    return norm(value)
    return ""


def fetch_taiwanjobs() -> dict[str, dict]:
    """Official TaiwanJobs is capped at 1000 rows; use only as corroborating evidence."""
    try:
        raw = request_bytes(TAIWANJOBS_URL, timeout=60, retries=2)
        rows = xml_records(raw)
    except Exception as exc:
        log(f"WARNING: TaiwanJobs unavailable: {exc}")
        return {}

    by_name: dict[str, dict] = {}
    for row in rows:
        name = first_key(row, ["COMPNAME", "公司名稱"])
        if not name:
            continue
        people = clean_int(first_key(row, ["JOB_PERSON", "WORKER", "雇用人數"]))
        occu = first_key(row, ["OCCU_DESC", "職務名稱"])
        item = by_name.setdefault(name, {"postings": 0, "people": 0, "roles": []})
        item["postings"] += 1
        item["people"] += people
        if occu and occu not in item["roles"] and len(item["roles"]) < 5:
            item["roles"].append(occu)
    log(f"TaiwanJobs matched-name universe={len(by_name)} from capped official feed")
    return by_name


def fetch_giant_procurements() -> dict[str, list[dict]]:
    """Recent giant government procurements in performance period; keyed by vendor tax ID."""
    try:
        raw = request_bytes(PCC_GIANT_URL, timeout=90, retries=2)
        rows = xml_records(raw)
    except Exception as exc:
        log(f"WARNING: PCC giant procurement feed unavailable: {exc}")
        return {}

    by_tax: dict[str, list[dict]] = {}
    for row in rows:
        tax_id = first_key(row, ["簽約廠商代碼", "廠商代碼", "Corporation_Number", "vendorId"])
        digits = re.sub(r"\D", "", tax_id)
        if len(digits) != 8:
            continue
        record = {
            "caseName": first_key(row, ["標案名稱", "Case_Name", "tenderName"]),
            "agency": first_key(row, ["機關名稱", "agencyName"]),
            "awardAmount": clean_int(first_key(row, ["決標金額", "awardAmount"])),
            "announceDate": first_key(row, ["決標公告日期", "announceDate"]),
            "startDate": first_key(row, ["履約起日", "決標公告履約起日", "startDate"]),
            "endDate": first_key(row, ["履約迄日", "決標公告履約迄日", "endDate"]),
        }
        by_tax.setdefault(digits, []).append(record)
    log(f"PCC giant procurement vendors={len(by_tax)}")
    return by_tax



def fetch_factories() -> dict[str, list[dict]]:
    """Registered operating factories, keyed by company/business tax ID."""
    try:
        raw = request_bytes(FACTORY_CSV_URL, timeout=120, retries=2)
        text = raw.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
    except Exception as exc:
        log(f"WARNING: factory registry unavailable: {exc}")
        return {}

    by_tax: dict[str, list[dict]] = {}
    for row in reader:
        tax_id = row_value(row, "統一編號", "公司（營利事業）統一編號", "公司(營利事業)統一編號")
        tax_id = re.sub(r"\D", "", tax_id)
        if len(tax_id) != 8:
            continue
        item = {
            "factoryName": row_value(row, "工廠名稱"),
            "factoryId": row_value(row, "工廠登記編號"),
            "address": row_value(row, "工廠地址"),
            "setupApprovalDate": row_value(row, "工廠設立核准日期"),
            "registrationDate": row_value(row, "工廠登記核准日期"),
            "industries": row_value(row, "產業類別"),
            "products": row_value(row, "主要產品"),
            "status": row_value(row, "工廠登記狀態"),
        }
        by_tax.setdefault(tax_id, []).append(item)
    log(f"Factory registry companies={len(by_tax)}")
    return by_tax


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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS business_items (
            tax_id TEXT NOT NULL,
            item_code TEXT NOT NULL,
            item_desc TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            PRIMARY KEY (tax_id, item_code)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS branches (
            tax_id TEXT NOT NULL,
            branch_tax_id TEXT NOT NULL,
            branch_name TEXT NOT NULL,
            location TEXT NOT NULL,
            setup_date TEXT NOT NULL,
            status TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            PRIMARY KEY (tax_id, branch_tax_id)
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
    if "巨額標案履約中" in types:
        score = 80
    elif "新工廠登記" in types:
        score = 78
    elif "新設分公司" in types:
        score = 76
    elif "增資" in types:
        score = 72
    elif "營業項目新增" in types:
        score = 70
    elif "新設立" in types:
        score = 66
    elif "產業異動" in types:
        score = 58
    else:
        # 搬遷/改名/一般登記異動大多是落後或不明訊號，不可因公司很大就變高分
        score = 18

    if "新工廠登記" in types and "增資" in types:
        score += 10
    if "新工廠登記" in types and "營業項目新增" in types:
        score += 8
    if "巨額標案履約中" in types and "增資" in types:
        score += 10
    if "新設分公司" in types and "增資" in types:
        score += 9
    if "營業項目新增" in types and "增資" in types:
        score += 10
    if "營業項目新增" in types and "新設分公司" in types:
        score += 8
    if "新設立" in types and "產業異動" in types:
        score += 8
    if "增資" in types and "產業異動" in types:
        score += 12
    if "增資" in types and "搬遷" in types:
        score += 5  # 搬遷只當擴張佐證，不是主商機
    if "新設立" in types and "搬遷" in types:
        score += 2

    if {"巨額標案履約中", "新工廠登記", "新設分公司", "增資", "營業項目新增", "新設立", "產業異動"} & types:
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
    if not ({"巨額標案履約中", "新工廠登記", "新設分公司", "增資", "營業項目新增", "新設立", "產業異動"} & types):
        score = min(score, 35)
    if "減資" in types and not ({"巨額標案履約中", "新工廠登記", "新設分公司", "增資", "營業項目新增", "新設立", "產業異動"} & types):
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

    if "巨額標案履約中" in types:
        signal_class = "大型專案啟動"
        stage = "前中段訊號"
        value = "很高"
        lead_window = "履約期間持續追蹤"
        meaning = "公司近期取得政府巨額採購且仍在履約期，通常代表專案已進入執行與資源投入階段；對分包、設備、人力、保險、融資與供應鏈服務具有直接價值。"
        action = "先看標案內容、履約期間與決標金額，再找執行專案會新增的設備、人力、分包、保險或週轉需求。"
    elif "新工廠登記" in types:
        signal_class = "產能落地"
        stage = "前中段訊號"
        value = "很高"
        lead_window = "登記後 0–12 個月持續追蹤"
        meaning = "公司有新工廠登記或工廠資料新出現，通常代表製造據點與產能正在落地；設備、自動化、能源、物流、工安、保險與人力需求比一般地址異動更直接。"
        action = "先看主要產品與工廠地址，再鎖定設備、自動化、能源、原料、物流、工安、產險與招募需求。"
    elif "新設分公司" in types:
        signal_class = "據點擴張"
        stage = "前中段訊號"
        value = "高"
        lead_window = "設立後 0–6 個月值得追蹤"
        meaning = "公司新增分公司，代表新據點已進入法人/營運落地階段；比單純地址變更更接近真正的展店、擴點與在地營運需求。"
        action = "從新據點營運需求切入，例如招募、支付/POS、設備、物流、保險、在地行銷與企業服務。"
    elif "增資" in types:
        signal_class = "資金到位"
        stage = "前中段訊號"
        value = "高"
        lead_window = "未來 1–6 個月值得追蹤"
        meaning = "公司近期資本額增加。資金已到位，不代表缺錢；真正價值是後續可能進入擴產、擴編、設備或新專案支出期。"
        action = "先查增資幅度與產業，再問『這次資金主要投入哪個計畫？』；不要再用融資缺口當第一切角。"
    elif "營業項目新增" in types:
        signal_class = "新事業啟動"
        stage = "前段訊號"
        value = "高"
        lead_window = "未來 1–12 個月值得追蹤"
        meaning = "公司新增登記營業項目，通常比實際營收發生更早，是目前資料裡最接近『準備做新事業』的訊號之一；但仍需確認是否真的投入經營。"
        action = "直接看新增的營業項目是什麼，再反推該新事業啟動必須採購的系統、人才、設備、通路、法遵或保險。"
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
        "actionable": score >= 50 and bool({"巨額標案履約中", "新工廠登記", "新設分公司", "增資", "營業項目新增", "新設立", "產業異動"} & types),
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

        # Carry prior per-company tracking state into today's SQLite baseline.
        copy_tracking_tables(conn, STATE_DB)

        # Secondary official signals.
        jobs_by_name = fetch_taiwanjobs()
        giant_procurements = fetch_giant_procurements()
        factories_by_tax = fetch_factories()

        business_items_by_tax: dict[str, list[dict]] = {}
        branches_by_tax: dict[str, list[dict]] = {}
        candidate_ids = list(events.keys())
        log(f"Enriching {len(candidate_ids)} changed/new companies with GCIS business items and branches")

        def fetch_company_secondary(tax_id: str) -> tuple[str, list[dict], list[dict], str]:
            try:
                items = gcis_company_rows(GCIS_BUSINESS, tax_id)
                branches = gcis_company_rows(GCIS_BRANCH, tax_id)
                return tax_id, items, branches, ""
            except Exception as exc:
                return tax_id, [], [], str(exc)

        fetched_secondary: dict[str, tuple[list[dict], list[dict], str]] = {}
        workers = min(8, max(1, len(candidate_ids)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(fetch_company_secondary, tax_id) for tax_id in candidate_ids]
            for done_idx, future in enumerate(as_completed(futures), start=1):
                tax_id, item_rows, branch_rows, err = future.result()
                fetched_secondary[tax_id] = (item_rows, branch_rows, err)
                if done_idx % 100 == 0:
                    log(f"GCIS secondary fetched {done_idx}/{len(candidate_ids)}")

        for idx, tax_id in enumerate(candidate_ids, start=1):
            item = events[tax_id]
            item_rows, branch_rows, fetch_err = fetched_secondary.get(tax_id, ([], [], "missing"))
            if fetch_err:
                log(f"WARNING: secondary GCIS enrichment failed for {tax_id}: {fetch_err}")

            current_items = []
            for row in item_rows:
                code = norm(row.get("Business_Item"))
                desc = norm(row.get("Business_Item_Desc"))
                if code:
                    current_items.append({"code": code, "desc": desc})
            business_items_by_tax[tax_id] = current_items
            if not fetch_err:
                prev_codes = {
                    r[0]: r[1]
                    for r in conn.execute(
                        "SELECT item_code,item_desc FROM business_items WHERE tax_id=?", (tax_id,)
                    ).fetchall()
                }
                new_codes = [x for x in current_items if x["code"] not in prev_codes]
                if prev_codes and new_codes and tax_id not in setup_map:
                    item["types"].append("營業項目新增")
                    item["changes"]["businessItemsAdded"] = new_codes
                    labels = "、".join((x["desc"] or x["code"]) for x in new_codes[:5])
                    item["reasons"].append(f"公司登記營業項目新增：{labels}")
                conn.execute("DELETE FROM business_items WHERE tax_id=?", (tax_id,))
                conn.executemany(
                    "INSERT OR REPLACE INTO business_items(tax_id,item_code,item_desc,observed_at) VALUES(?,?,?,?)",
                    [(tax_id, x["code"], x["desc"], today.isoformat()) for x in current_items],
                )

            current_branches = []
            for row in branch_rows:
                branch_id = norm(row.get("Branch_Office_Business_Accounting_NO"))
                if not branch_id:
                    continue
                current_branches.append({
                    "taxId": branch_id,
                    "name": norm(row.get("Branch_Office_Name")),
                    "location": norm(row.get("Branch_Office_Location")),
                    "setupDate": norm(row.get("BR_ESTAB_DATE")),
                    "status": norm(row.get("Branch_Office_Status_Desc")),
                })
            branches_by_tax[tax_id] = current_branches
            if not fetch_err:
                prev_branch_ids = {
                    r[0] for r in conn.execute(
                        "SELECT branch_tax_id FROM branches WHERE tax_id=?", (tax_id,)
                    ).fetchall()
                }
                new_branches = [
                    x for x in current_branches
                    if x["setupDate"] == roc or (prev_branch_ids and x["taxId"] not in prev_branch_ids)
                ]
                if new_branches:
                    item["types"].append("新設分公司")
                    item["changes"]["newBranches"] = new_branches
                    labels = "、".join((x["name"] or x["taxId"]) for x in new_branches[:4])
                    item["reasons"].append(f"新設分公司/據點：{labels}")
                conn.execute("DELETE FROM branches WHERE tax_id=?", (tax_id,))
                conn.executemany(
                    "INSERT OR REPLACE INTO branches(tax_id,branch_tax_id,branch_name,location,setup_date,status,observed_at) VALUES(?,?,?,?,?,?,?)",
                    [(tax_id, x["taxId"], x["name"], x["location"], x["setupDate"], x["status"], today.isoformat()) for x in current_branches],
                )

            factories = factories_by_tax.get(tax_id) or []
            today_factories = [x for x in factories if x.get("registrationDate") == roc]
            if today_factories:
                item["types"].append("新工廠登記")
                item["changes"]["newFactories"] = today_factories[:5]
                labels = "、".join((x.get("factoryName") or x.get("factoryId") or "新工廠") for x in today_factories[:4])
                item["reasons"].append(f"經濟部登記工廠名錄顯示新工廠登記：{labels}")

            awards = giant_procurements.get(tax_id) or []
            if awards:
                item["types"].append("巨額標案履約中")
                item["changes"]["giantProcurements"] = awards[:5]
                top_award = max(awards, key=lambda x: x.get("awardAmount", 0))
                amount = top_award.get("awardAmount", 0)
                case = top_award.get("caseName") or "政府巨額採購"
                item["reasons"].append(
                    f"公共工程委員會資料顯示近期巨額採購履約中：{case}"
                    + (f"（決標金額 {money_zh(amount)}）" if amount else "")
                )

            if idx % 100 == 0:
                conn.commit()
                log(f"GCIS secondary applied {idx}/{len(candidate_ids)}")

        conn.commit()

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
            registered_items = business_items_by_tax.get(tax_id, [])
            if industries:
                industry = industries[0]
            elif registered_items:
                industry = (registered_items[0].get("desc") or registered_items[0].get("code") or "未分類") + "（登記項目）"
            else:
                industry = "未分類"

            # TaiwanJobs is capped at 1000 official rows, so it is evidence only, never a sole high-priority trigger.
            hiring = jobs_by_name.get(c["name"]) or {"postings": 0, "people": 0, "roles": []}
            reasons = list(dict.fromkeys(event["reasons"]))
            if hiring.get("postings"):
                roles = "、".join(hiring.get("roles", [])[:3])
                reasons.append(
                    f"台灣就業通目前命中 {hiring['postings']} 筆職缺"
                    + (f"，預計招募 {hiring['people']} 人" if hiring.get("people") else "")
                    + (f"（{roles}）" if roles else "")
                    + "；因官方介面單次最多 1000 筆，此訊號只作佐證"
                )
            profile = opportunity_profile(types, c["capital"], event.get("changes", {}), industry)
            if hiring.get("people", 0) >= 20 and profile["actionable"]:
                profile["score"] = min(99, profile["score"] + 6)
            elif hiring.get("postings", 0) >= 3 and profile["actionable"]:
                profile["score"] = min(99, profile["score"] + 3)
            profile["tier"] = "A" if profile["score"] >= 80 else "B" if profile["score"] >= 65 else "C" if profile["score"] >= 50 else "觀察"
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
                "registeredBusinessItems": registered_items[:20],
                "branches": branches_by_tax.get(tax_id, [])[:20],
                "hiringSignal": hiring,
                "factories": factories_by_tax.get(tax_id, [])[:20],
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
                "businessItemAdded": counts.get("營業項目新增", 0),
                "newBranches": counts.get("新設分公司", 0),
                "giantProcurement": counts.get("巨額標案履約中", 0),
                "newFactory": counts.get("新工廠登記", 0),
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
                {
                    "name": "經濟部商業發展署－公司登記基本資料-應用三（營業項目）",
                    "url": "https://data.gov.tw/dataset/22198",
                    "refresh": "API",
                },
                {
                    "name": "經濟部商業發展署－統編查分公司資料",
                    "url": "https://data.gov.tw/dataset/84877",
                    "refresh": "API",
                },
                {
                    "name": "勞動部－台灣就業通網站職缺清單",
                    "url": "https://data.gov.tw/dataset/44062",
                    "refresh": "官方介面，最多1000筆/次",
                },
                {
                    "name": "公共工程委員會－與政府機關有巨額採購且在履約期間之廠商名單",
                    "url": "https://data.gov.tw/dataset/7264",
                    "refresh": "每上班日",
                },
                {
                    "name": "經濟部產業發展署－登記工廠名錄",
                    "url": "https://data.gov.tw/dataset/6569",
                    "refresh": "每季/不定期",
                },
            ],
            "notes": [
                "第一次成功執行會建立全台營業中稅籍 baseline；從下一次執行開始才可依前後快照辨識資本額、地址與產業欄位的實際變化。",
                "商機分數改以『未來支出可能性』為核心：新設、增資、產業變化為主訊號；搬遷、改名與不明異動只作佐證或觀察。",
                "地址變更通常屬落後訊號；系統不再把搬遷本身解讀成搬家、裝潢或網路佈建商機。",
                "公司營業項目與分公司資料會對今日異動企業建立獨立快照；營業項目只有在有前次快照可比較時才標示『新增』，不把第一次看到的全部項目誤判成新增。",
                "新設分公司可利用官方 BR_ESTAB_DATE 直接抓當日新據點；這類訊號比公司地址變更更接近展店/擴點商機。",
                "台灣就業通單次最多 1000 筆，因此徵才命中只作加分佐證，不以沒命中推論公司沒有在招人。",
                "公共工程委員會巨額採購履約資料是強專案訊號；命中時可直接提高商機優先級。",
                "登記工廠名錄包含統編、工廠核准日期、產業類別與主要產品；因更新頻率較低，只在官方登記日期明確吻合時標成新工廠，避免把資料集延遲誤判成今天新設。",
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
