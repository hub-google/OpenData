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


def score_company(event_types: list[str], capital: int) -> int:
    weights = {
        "新設立": 23,
        "增資": 28,
        "搬遷": 18,
        "產業異動": 15,
        "名稱變更": 5,
        "減資": 4,
        "其他公司登記異動": 8,
    }
    score = 36 + sum(weights.get(x, 4) for x in event_types)
    if capital >= 100_000_000:
        score += 18
    elif capital >= 50_000_000:
        score += 15
    elif capital >= 10_000_000:
        score += 11
    elif capital >= 5_000_000:
        score += 8
    elif capital >= 1_000_000:
        score += 4
    return max(1, min(99, score))


def money_zh(n: int) -> str:
    if n >= 100_000_000:
        return f"{n / 100_000_000:.1f} 億".replace(".0 億", " 億")
    if n >= 10_000:
        return f"{n / 10_000:,.0f} 萬"
    return f"{n:,}"


def build_action(event_types: list[str], industry: str) -> str:
    if "新設立" in event_types:
        return "新公司剛成立，可優先切入開辦期需求：企業金融、保險、支付、電信、雲端、招募與辦公採購。"
    if "增資" in event_types:
        return "近期有增資訊號，可優先確認擴產、擴編、設備採購、融資、保險與新專案需求。"
    if "搬遷" in event_types:
        return "近期有地址異動，可優先確認搬遷、展店或擴編需求，例如網路、辦公設備、裝修、保險與人力。"
    if "產業異動" in event_types:
        return "產業欄位出現變化，可能代表新增營運方向；適合從新產品線、供應鏈與合作服務切入。"
    return f"近期有官方公司登記異動，可先確認異動原因，再依「{industry or '主要產業'}」準備對應商務提案。"


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
                if r["capital"] > r["p_capital"]:
                    types.append("增資")
                    reasons.append(f"資本額由 {money_zh(r['p_capital'])} 增加至 {money_zh(r['capital'])}")
                elif r["capital"] < r["p_capital"]:
                    types.append("減資")
                    reasons.append(f"資本額由 {money_zh(r['p_capital'])} 變更為 {money_zh(r['capital'])}")
                if r["address"] != r["p_address"]:
                    types.append("搬遷")
                    reasons.append(f"營業地址由「{r['p_address'] or '未提供'}」變更為「{r['address'] or '未提供'}」")
                if r["industry_codes"] != r["p_industry_codes"] or r["industry_names"] != r["p_industry_names"]:
                    types.append("產業異動")
                    reasons.append("稅籍行業分類與前一日快照不同")
                if r["name"] != r["p_name"]:
                    types.append("名稱變更")
                    reasons.append(f"名稱由「{r['p_name']}」變更為「{r['name']}」")
                if types:
                    events[tax_id] = {"types": types, "reasons": reasons}

            conn.execute("DETACH DATABASE prev")
            log(f"Snapshot diff events={len(events)}")
        else:
            log("No previous baseline found; this run establishes the nationwide baseline.")

        # GCIS is authoritative for today's approval/setup date. Merge those signals.
        for tax_id in change_map:
            item = events.setdefault(tax_id, {"types": [], "reasons": []})
            if not item["types"]:
                item["types"].append("其他公司登記異動")
                item["reasons"].append("經濟部公司資料異動 API 顯示今日有核准變更")
            elif "其他公司登記異動" not in item["types"]:
                item["reasons"].append("經濟部公司資料異動 API 同步顯示今日有核准變更")

        for tax_id in setup_map:
            item = events.setdefault(tax_id, {"types": [], "reasons": []})
            if "新設立" not in item["types"]:
                item["types"].insert(0, "新設立")
                item["reasons"].insert(0, "經濟部公司資料設立 API 顯示今日核准設立")
            item["types"] = [x for x in item["types"] if x != "其他公司登記異動"]

        companies = []
        counts: dict[str, int] = {}
        for tax_id, event in events.items():
            c = load_company(conn, tax_id)
            if c is None:
                c = {
                    "taxId": tax_id,
                    "name": setup_map.get(tax_id) or change_map.get(tax_id) or "公司資料同步中",
                    "address": "",
                    "capital": 0,
                    "setup": "",
                    "orgType": "",
                    "invoice": "",
                    "industryCodes": "",
                    "industryNames": "",
                }

            types = list(dict.fromkeys(event["types"]))
            for t in types:
                counts[t] = counts.get(t, 0) + 1
            city, district = extract_area(c["address"])
            industries = [x for x in c["industryNames"].split("|") if x]
            industry = industries[0] if industries else "未分類"
            reasons = list(dict.fromkeys(event["reasons"]))
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
                "score": score_company(types, c["capital"]),
                "setup": c["setup"],
                "owner": "",
                "address": c["address"],
                "orgType": c["orgType"],
                "invoice": c["invoice"],
                "reasons": reasons[:6],
                "action": build_action(types, industry),
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
                "highPriority": sum(1 for x in companies if x["score"] >= 80),
                "newCompanies": counts.get("新設立", 0),
                "capitalIncrease": counts.get("增資", 0),
                "addressChange": counts.get("搬遷", 0),
                "industryChange": counts.get("產業異動", 0),
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
