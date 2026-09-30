#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build the Government Procurement Anomaly Radar from official PCC Open Data.

All inputs are official Executive Yuan Public Construction Commission sources.
The output contains only publicly available procurement records and "review
priority" signals. A signal is not a finding of illegality.
"""
from __future__ import annotations

import json
import re
import time
import difflib
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / "procurement-anomalies.json"

SOURCES = {
    "restricted_awards": {
        "name": "前1年度公告金額以上採購限制性決標公告",
        "dataset": "https://data.gov.tw/dataset/165150",
        "url": "https://web.pcc.gov.tw/tps/openDataApi/lyOpenData?runType=3",
        "format": "json",
        "frequency": "每1年",
    },
    "restricted_tenders": {
        "name": "前1年度公告金額以上採購限制性招標公告",
        "dataset": "https://data.gov.tw/dataset/165149",
        "url": "https://web.pcc.gov.tw/tps/openDataApi/lyOpenData?runType=2",
        "format": "json",
        "frequency": "每1年",
    },
    "debarred": {
        "name": "拒絕往來廠商公告",
        "dataset": "https://data.gov.tw/dataset/5988",
        "url": "https://web.pcc.gov.tw/vms/rvlm/rvlmPublicSearch/queryRVFile/json",
        "format": "json",
        "frequency": "每1日",
    },
    "concentration": {
        "name": "近1年工程採購案廠商於同一機關得標20件以上之廠商及機關名",
        "dataset": "https://data.gov.tw/dataset/6410",
        "url": "https://web.pcc.gov.tw/wr-report/wr/homeClient/downloadOpenAPI?reportId=EngOrgAndBidder2",
        "format": "xml",
        "frequency": "每1月",
    },
    "ratio_benchmark": {
        "name": "近半年工程類最低標決標金額與底價標比及預算標比",
        "dataset": "https://data.gov.tw/dataset/9320",
        "url": "https://web.pcc.gov.tw/tps/openDataApi/atmOpenData?runType=1",
        "format": "json",
        "frequency": "每1月",
    },
}

UA = "OpenData-Lab-Procurement-Anomaly-Radar/1.0 (+https://github.com/hub-google/OpenData)"

def fetch_bytes(url: str, retries: int = 4, timeout: int = 90) -> bytes:
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": UA,
                    "Accept": "application/json, application/xml, text/xml, */*",
                    "Referer": "https://data.gov.tw/",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
                if not data:
                    raise RuntimeError("empty response")
                return data
        except Exception as exc:
            last = exc
            if i + 1 < retries:
                time.sleep(3 * (i + 1))
    raise RuntimeError(f"fetch failed after {retries} tries: {url}: {last}")

def decode_text(b: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp950", "big5"):
        try:
            return b.decode(enc)
        except Exception:
            pass
    return b.decode("utf-8", errors="replace")

def extract_dict_records(obj):
    """Return the largest useful list[dict] found in a JSON payload."""
    candidates = []
    def walk(x):
        if isinstance(x, list):
            ds = [y for y in x if isinstance(y, dict)]
            if ds:
                candidates.append(ds)
            for y in x[:20]:
                walk(y)
        elif isinstance(x, dict):
            for y in x.values():
                walk(y)
    walk(obj)
    if not candidates:
        if isinstance(obj, dict):
            return [obj]
        return []
    return max(candidates, key=len)

def xml_records(data: bytes):
    root = ET.fromstring(data)
    rows = []
    for node in root.iter():
        children = list(node)
        if children and all(len(list(ch)) == 0 for ch in children):
            row = {}
            for ch in children:
                tag = ch.tag.split("}")[-1]
                row[tag] = (ch.text or "").strip()
            if len(row) >= 2:
                rows.append(row)
    # Prefer the most common row schema.
    if not rows:
        return []
    signatures = defaultdict(list)
    for row in rows:
        signatures[tuple(sorted(row))].append(row)
    return max(signatures.values(), key=len)

def norm_key(k):
    return re.sub(r"[\s　()（）_\-:/]+", "", str(k)).lower()

def value(row, candidates, default=""):
    if not isinstance(row, dict):
        return default
    normalized = {norm_key(k): v for k, v in row.items()}
    for cand in candidates:
        ck = norm_key(cand)
        if ck in normalized and normalized[ck] not in (None, ""):
            return str(normalized[ck]).strip()
    # fuzzy containment fallback
    for cand in candidates:
        ck = norm_key(cand)
        for k, v in normalized.items():
            if (ck in k or k in ck) and v not in (None, ""):
                return str(v).strip()
    return default

def num(v):
    if v is None:
        return 0
    s = str(v).replace(",", "").replace("，", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else 0

def money(v):
    n = num(v)
    return int(round(n))

def roc_year_from_date(s):
    nums = [int(x) for x in re.findall(r"\d+", str(s))]
    if not nums:
        return ""
    y = nums[0]
    if y >= 1912:
        return str(y - 1911)
    if 90 <= y <= 200:
        return str(y)
    return ""

def procurement_search_url(case_no, date="", status="決標"):
    """Official PCC full-text procurement search with case number pre-filled."""
    if not case_no:
        return "https://web.pcc.gov.tw/prkms/tender/common/bulletion/readBulletion"
    q = {
        "pageSize": "10",
        "querySentence": case_no,
        "sortCol": "TENDER_NOTICE_DATE",
        "tenderStatusType": status,
    }
    ry = roc_year_from_date(date)
    if ry:
        q["timeRange"] = ry
    return "https://web.pcc.gov.tw/prkms/tender/common/bulletion/readBulletion?" + urllib.parse.urlencode(q)

def award_query_url(agency="", vendor=""):
    q = {
        "isQuery": "true",
        "firstSearch": "false",
        "orgName": agency,
        "gottenVendorName": vendor,
        "tenderStatus": "TENDER_STATUS_1",
        "tenderWay": "TENDER_WAY_ALL_DECLARATION",
        "tenderRange": "TENDER_RANGE_ALL",
    }
    return "https://web.pcc.gov.tw/prkms/tender/common/agent/readTenderAgent?" + urllib.parse.urlencode(q)

def parse_json_source(raw):
    text = decode_text(raw)
    obj = json.loads(text)
    return extract_dict_records(obj)

def source_evidence(source_key, case_no="", date="", status="決標", agency="", vendor=""):
    src = SOURCES[source_key]
    ev = [
        {"label": "官方原始 Open Data", "url": src["url"], "kind": "raw"},
        {"label": "政府資料開放平臺說明", "url": src["dataset"], "kind": "dataset"},
    ]
    if case_no:
        ev.insert(0, {
            "label": f"政府電子採購網查詢｜案號 {case_no}",
            "url": procurement_search_url(case_no, date, status=status),
            "kind": "pcc_search",
        })
    elif agency or vendor:
        ev.insert(0, {
            "label": "政府電子採購網決標查詢｜機關＋廠商",
            "url": award_query_url(agency, vendor),
            "kind": "pcc_search",
        })
    return ev

def parse_sources():
    data = {}
    statuses = []
    for key, src in SOURCES.items():
        try:
            raw = fetch_bytes(src["url"])
            rows = parse_json_source(raw) if src["format"] == "json" else xml_records(raw)
            data[key] = rows
            statuses.append({
                "key": key,
                "name": src["name"],
                "ok": True,
                "records": len(rows),
                "url": src["url"],
                "dataset": src["dataset"],
                "frequency": src["frequency"],
            })
        except Exception as exc:
            data[key] = []
            statuses.append({
                "key": key,
                "name": src["name"],
                "ok": False,
                "records": 0,
                "url": src["url"],
                "dataset": src["dataset"],
                "frequency": src["frequency"],
                "error": str(exc)[:300],
            })
    return data, statuses

def normalize_awards(rows):
    out = []
    for r in rows:
        agency = value(r, ["機關名稱","招標機關名稱","TENDER_ORG_NAME","orgName","agencyName"])
        case_no = value(r, ["標案案號","案號","TENDER_CASE_NO","tenderId","caseNo"])
        title = value(r, ["標案名稱","採購名稱","TENDER_NAME","tenderName","caseName"])
        category = value(r, ["標的分類","採購性質","TENDER_CATE","category"])
        method = value(r, ["決標方式","招標方式","TENDER_WAY","awardWay"])
        date = value(r, ["決標日期","公告日期","AWARD_DATE","awardDate"])
        amount_raw = value(r, ["決標金額(元)","決標金額（元）","決標金額","AWARD_PRICE","awardPrice"])
        vendor = value(r, ["得標廠商名稱","得標廠商","WIN_VENDOR_NAME","gottenVendorName","vendorName"])
        if not any([agency, case_no, title, vendor]):
            continue
        out.append({
            "agency": agency, "case_no": case_no, "title": title, "category": category,
            "method": method, "date": date, "amount": money(amount_raw), "vendor": vendor,
            "raw": r,
        })
    return out

def normalize_tenders(rows):
    out = []
    for r in rows:
        agency = value(r, ["機關名稱","招標機關名稱","TENDER_ORG_NAME","orgName"])
        case_no = value(r, ["標案案號","案號","TENDER_CASE_NO","tenderId"])
        title = value(r, ["標案名稱","採購名稱","TENDER_NAME","tenderName"])
        category = value(r, ["標的分類","採購性質","category"])
        method = value(r, ["招標方式","TENDER_WAY","tenderWay"])
        date = value(r, ["公告日期","招標公告日期","TENDER_NOTICE_DATE","announceDate"])
        budget_raw = value(r, ["預算金額(元)","預算金額（元）","預算金額","BUDGET","budget"])
        law = value(r, ["依據之法條","法條","law"])
        location = value(r, ["履約地點","location"])
        if not any([agency, case_no, title]):
            continue
        out.append({
            "agency": agency, "case_no": case_no, "title": title, "category": category,
            "method": method, "date": date, "budget": money(budget_raw), "law": law,
            "location": location, "raw": r,
        })
    return out

def normalize_debarred(rows):
    out = []
    for r in rows:
        agency = value(r, ["Announce_Agency_Name","機關名稱"])
        case_no = value(r, ["Case_no","CaseNo","標案案號"])
        title = value(r, ["Case_Name","標案名稱"])
        vendor = value(r, ["Corporation_Name","廠商名稱"])
        vendor_id = value(r, ["Corporation_Number","廠商代碼","統一編號"])
        announce_date = value(r, ["Announce_Date","公告日"])
        effective = value(r, ["Effective_Date","生效日"])
        expire = value(r, ["Expire_Date","拒絕往來截止日"])
        clause = value(r, ["GPA101_Caluse","GPA101_Clause","第101條款次"])
        appeal = value(r, ["Appeal_Result","異議或申訴結果"])
        if not any([vendor, case_no, agency]):
            continue
        out.append({
            "agency": agency, "case_no": case_no, "title": title, "vendor": vendor,
            "vendor_id": vendor_id, "announce_date": announce_date, "effective": effective,
            "expire": expire, "clause": clause, "appeal": appeal, "raw": r,
        })
    return out

def normalize_concentration(rows):
    out = []
    for r in rows:
        vendor = value(r, ["廠商名稱","BidderName","vendorName","公司名稱"])
        agency = value(r, ["招標機關名稱","機關名稱","OrgName","agencyName"])
        count_raw = value(r, ["得標件數","件數","AwardCount","bidCount"])
        amount_raw = value(r, ["廠商得標金額","得標金額","AwardAmount","amount"])
        count = int(num(count_raw))
        amount = money(amount_raw)
        if not vendor and not agency:
            continue
        out.append({"vendor": vendor, "agency": agency, "count": count, "amount": amount, "raw": r})
    return out

def normalize_ratio(rows):
    out = []
    for r in rows:
        month = value(r, ["月份","month"])
        count = int(num(value(r, ["決標件數","件數","count"])))
        floor_ratio = num(value(r, ["底價標比","floorRatio"]))
        budget_ratio = num(value(r, ["預算標比","budgetRatio"]))
        if month or count or floor_ratio or budget_ratio:
            out.append({
                "month": month, "count": count, "floor_ratio": floor_ratio,
                "budget_ratio": budget_ratio,
                "raw": r,
            })
    return out

def ymd_value(s):
    nums = [int(x) for x in re.findall(r"\d+", str(s))]
    if len(nums) < 3:
        return 0
    y,m,d = nums[:3]
    if y < 1912:
        y += 1911
    return y*10000+m*100+d

def date_ordinal(s):
    nums = [int(x) for x in re.findall(r"\\d+", str(s))]
    if len(nums) < 3:
        return None
    y,m,d = nums[:3]
    if y < 1912:
        y += 1911
    try:
        return datetime(y,m,d).toordinal()
    except Exception:
        return None

def title_similarity(a, b):
    def clean(s):
        return re.sub(r"[第\\d０-９一二三四五六七八九十百千批期次年度年月\\s()（）【】\\-_/]+", "", str(s))
    aa, bb = clean(a), clean(b)
    if not aa or not bb:
        return 0.0
    return difflib.SequenceMatcher(None, aa, bb).ratio()

def active_debarment(d):
    # Prefer explicit expiry date; if unknown, report history without claiming current exclusion.
    ex = ymd_value(d.get("expire",""))
    today = int(datetime.now().strftime("%Y%m%d"))
    return bool(ex and ex >= today)

def build():
    raw, statuses = parse_sources()
    awards = normalize_awards(raw["restricted_awards"])
    tenders = normalize_tenders(raw["restricted_tenders"])
    debarred = normalize_debarred(raw["debarred"])
    concentration = normalize_concentration(raw["concentration"])
    ratio = normalize_ratio(raw["ratio_benchmark"])

    debar_by_vendor = defaultdict(list)
    for d in debarred:
        if d["vendor"]:
            debar_by_vendor[d["vendor"].strip()].append(d)

    conc_by_pair = {}
    for c in concentration:
        conc_by_pair[(c["agency"].strip(), c["vendor"].strip())] = c

    awards_by_pair = defaultdict(list)
    for a in awards:
        awards_by_pair[(a["agency"].strip(), a["vendor"].strip())].append(a)

    tender_by_case = {}
    tenders_by_agency = defaultdict(list)
    for t in tenders:
        tender_by_case[(t["agency"].strip(), t["case_no"].strip())] = t
        tenders_by_agency[t["agency"].strip()].append(t)

    # Find clusters of similar restricted tenders within 60 days. This is only a
    # screening signal; lawful phased/lot procurement can produce the same pattern.
    split_clusters = []
    used = set()
    for agency, arr in tenders_by_agency.items():
        arr = sorted(arr, key=lambda x: date_ordinal(x["date"]) or 0)
        for i, base in enumerate(arr):
            if (agency, i) in used:
                continue
            od = date_ordinal(base["date"])
            if not od:
                continue
            cluster = [base]
            indices = [i]
            for j in range(i+1, len(arr)):
                od2 = date_ordinal(arr[j]["date"])
                if not od2 or od2 - od > 60:
                    if od2 and od2 - od > 60:
                        break
                    continue
                if title_similarity(base["title"], arr[j]["title"]) >= 0.72:
                    cluster.append(arr[j]); indices.append(j)
            if len(cluster) >= 3:
                split_clusters.append((agency, cluster))
                for j in indices:
                    used.add((agency, j))

    split_case_keys = set()
    for agency, cluster in split_clusters:
        for t in cluster:
            split_case_keys.add((agency, t["case_no"].strip()))

    cases = []

    # Actual restricted-award records, enriched with other official signals.
    for a in awards:
        signals = ["restricted"]
        reasons = ["本案出現在工程會「前1年度公告金額以上採購限制性決標公告」官方資料集。"]
        pair = (a["agency"].strip(), a["vendor"].strip())
        conc = conc_by_pair.get(pair)
        if conc:
            signals.append("concentration")
            reasons.append(f"同一機關／廠商組合亦出現在工程會工程採購集中度警示資料：近1年得標 {conc['count']} 件。")
        dlist = debar_by_vendor.get(a["vendor"].strip(), [])
        if dlist:
            signals.append("debarred")
            active = any(active_debarment(x) for x in dlist)
            reasons.append("得標廠商可在工程會拒絕往來廠商公告資料找到紀錄" + ("，且資料顯示有尚未屆滿紀錄；需核對本案決標日與生效期間。" if active else "；目前僅作歷史背景提示，不能據此判定本案違規。"))

        matched_tender = tender_by_case.get((a["agency"].strip(), a["case_no"].strip()))
        bid_ratio = None
        if matched_tender and matched_tender["budget"] > 0 and a["amount"] > 0:
            bid_ratio = a["amount"] / matched_tender["budget"]
            if 0.99 <= bid_ratio <= 1.05:
                signals.append("ratio")
                reasons.append(f"同案招標資料可匹配預算 {matched_tender['budget']:,} 元，決標金額／預算 = {bid_ratio*100:.2f}%；列為標比偏高訊號，僅供查核排序。")

        same = sorted(awards_by_pair[pair], key=lambda x: ymd_value(x["date"]), reverse=True)
        if len(same) >= 3 and "concentration" not in signals:
            signals.append("concentration")
            reasons.append(f"僅就本年度限制性決標資料，同一機關與廠商已有 {len(same)} 筆紀錄；列為重複得標訊號。")

        priority = 58 + (16 if "concentration" in signals else 0) + (14 if "debarred" in signals else 0) + (8 if "ratio" in signals else 0) + min(8, max(0, len(same)-1)*2)
        priority = min(priority, 96)
        history = []
        for h in same[:8]:
            history.append({
                "date": h["date"], "title": h["title"], "case_no": h["case_no"],
                "amount": h["amount"], "vendor": h["vendor"], "agency": h["agency"],
                "evidence": source_evidence("restricted_awards", h["case_no"], h["date"], "決標"),
            })

        cases.append({
            "id": "award:" + (a["case_no"] or str(len(cases)+1)) + ":" + re.sub(r"\W+", "", a["agency"])[:20],
            "kind": "actual_award",
            "title": a["title"] or f"限制性決標｜{a['case_no']}",
            "agency": a["agency"], "case_no": a["case_no"], "category": a["category"],
            "method": a["method"], "date": a["date"], "amount": a["amount"], "vendor": a["vendor"],
            "priority": priority, "signals": sorted(set(signals)),
            "reasons": reasons,
            "metrics": [
                {"label":"決標金額","value":a["amount"]},
                {"label":"同機關同廠商限制性決標紀錄","value":len(same)},
                {"label":"官方集中度名單","value": bool(conc)},
                {"label":"拒絕往來歷史紀錄","value": len(dlist)},
                {"label":"決標／預算比","value": (round(bid_ratio*100,2) if bid_ratio is not None else None)},
            ],
            "history": history,
            "evidence": source_evidence("restricted_awards", a["case_no"], a["date"], "決標"),
        })

    # Official concentration records that do not necessarily appear in restricted-award data.
    for i,c in enumerate(concentration):
        pair = (c["agency"].strip(), c["vendor"].strip())
        same_awards = sorted(awards_by_pair.get(pair, []), key=lambda x: ymd_value(x["date"]), reverse=True)
        dlist = debar_by_vendor.get(c["vendor"].strip(), [])
        signals = ["concentration"]
        reasons = [f"工程會官方資料列示：近1年該廠商於同一機關工程採購得標 {c['count']} 件。"]
        if dlist:
            signals.append("debarred")
            reasons.append("同一廠商另可在工程會拒絕往來廠商公告找到紀錄；須逐案核對有效期間。")
        if same_awards:
            signals.append("restricted")
            reasons.append(f"同一機關／廠商另有 {len(same_awards)} 筆限制性決標資料可交叉查證。")
        priority = min(97, 72 + min(15, max(0,c["count"]-20)) + (8 if dlist else 0) + (7 if same_awards else 0))
        history = [{
            "date": h["date"], "title": h["title"], "case_no": h["case_no"],
            "amount": h["amount"], "vendor": h["vendor"], "agency": h["agency"],
            "evidence": source_evidence("restricted_awards", h["case_no"], h["date"], "決標"),
        } for h in same_awards[:8]]
        cases.append({
            "id": f"concentration:{i}",
            "kind": "concentration_pattern",
            "title": f"近1年工程採購集中｜{c['vendor']}",
            "agency": c["agency"], "case_no": "", "category": "工程類",
            "method": "", "date": "", "amount": c["amount"], "vendor": c["vendor"],
            "priority": priority, "signals": sorted(set(signals)), "reasons": reasons,
            "metrics": [
                {"label":"近1年同機關得標件數","value":c["count"]},
                {"label":"廠商得標金額","value":c["amount"]},
                {"label":"可交叉限制性決標紀錄","value":len(same_awards)},
                {"label":"拒絕往來歷史紀錄","value":len(dlist)},
            ],
            "history": history,
            "evidence": source_evidence("concentration", agency=c["agency"], vendor=c["vendor"]),
        })

    # Similar-tender clusters from real restricted-tender records.
    for i,(agency, cluster) in enumerate(split_clusters):
        total_budget = sum(t["budget"] for t in cluster)
        history = [{
            "date": t["date"], "title": t["title"], "case_no": t["case_no"],
            "amount": t["budget"], "vendor": "", "agency": t["agency"],
            "evidence": source_evidence("restricted_tenders", t["case_no"], t["date"], "招標"),
        } for t in cluster]
        cases.append({
            "id": f"split:{i}",
            "kind": "similar_tender_cluster",
            "title": f"60日內相似限制性招標群組｜{cluster[0]['title']}",
            "agency": agency, "case_no": "", "category": cluster[0]["category"],
            "method": "限制性招標群組", "date": cluster[-1]["date"],
            "amount": total_budget, "vendor": "",
            "priority": min(90, 66 + len(cluster)*5),
            "signals": ["restricted","split"],
            "reasons": [
                f"同一機關在 60 日內出現 {len(cluster)} 筆標案名稱高度相似的限制性招標公告。",
                "此規則只做『可能分案／分批』篩選；是否屬不當分割必須再看需求獨立性、預算來源、履約地點與採購法規。"
            ],
            "metrics": [
                {"label":"相似案件數","value":len(cluster)},
                {"label":"合計預算","value":total_budget},
                {"label":"期間（日）","value": max((date_ordinal(t["date"]) or 0) for t in cluster)-min((date_ordinal(t["date"]) or 0) for t in cluster)},
                {"label":"名稱相似度門檻","value":"≥72%"},
            ],
            "history": history,
            "evidence": source_evidence("restricted_tenders", agency=agency),
        })

    # Debarment records not already represented in awards; these are background / compliance signals.
    represented_vendor_case = {(c.get("vendor","").strip(), c.get("case_no","").strip()) for c in cases}
    for i,d in enumerate(debarred[:500]):
        key = (d["vendor"].strip(), d["case_no"].strip())
        if key in represented_vendor_case:
            continue
        active = active_debarment(d)
        reasons = ["本筆來自工程會每日更新的「拒絕往來廠商公告」官方資料。"]
        if active:
            reasons.append("資料中的拒絕往來截止日尚未屆滿；是否影響其他採購仍須依個案決標日期與法規程序核對。")
        else:
            reasons.append("若截止日已屆滿，本筆僅作歷史背景，不代表廠商目前仍受拒絕往來限制。")
        cases.append({
            "id": f"debarred:{i}",
            "kind": "debarment_record",
            "title": d["title"] or f"拒絕往來公告｜{d['vendor']}",
            "agency": d["agency"], "case_no": d["case_no"], "category": "拒絕往來公告",
            "method": "", "date": d["announce_date"], "amount": 0, "vendor": d["vendor"],
            "priority": 84 if active else 62, "signals": ["debarred"], "reasons": reasons,
            "metrics": [
                {"label":"生效日","value":d["effective"]},
                {"label":"截止日","value":d["expire"]},
                {"label":"政府採購法第101條款次","value":d["clause"]},
                {"label":"廠商代碼","value":d["vendor_id"]},
            ],
            "history": [],
            "evidence": source_evidence("debarred", d["case_no"], d["announce_date"], "決標"),
        })

    # Restricted tenders are real procurement events but no winner yet / not necessarily awarded.
    for i,t in enumerate(tenders[:300]):
        cases.append({
            "id": f"tender:{i}",
            "kind": "restricted_tender",
            "title": t["title"] or f"限制性招標｜{t['case_no']}",
            "agency": t["agency"], "case_no": t["case_no"], "category": t["category"],
            "method": t["method"], "date": t["date"], "amount": t["budget"], "vendor": "",
            "priority": (68 if (t["agency"].strip(), t["case_no"].strip()) in split_case_keys else 55),
            "signals": (["restricted","split"] if (t["agency"].strip(), t["case_no"].strip()) in split_case_keys else ["restricted"]), "reasons": [
                "本案出現在工程會「前1年度公告金額以上採購限制性招標公告」官方資料集。",
                "限制性招標本身是法定採購方式，不代表不當；此訊號用於觀察機關長期採購結構與後續決標對象。"
            ],
            "metrics": [
                {"label":"預算金額","value":t["budget"]},
                {"label":"依據法條","value":t["law"]},
                {"label":"履約地點","value":t["location"]},
                {"label":"招標方式","value":t["method"]},
            ],
            "history": [],
            "evidence": source_evidence("restricted_tenders", t["case_no"], t["date"], "招標"),
        })

    cases.sort(key=lambda c: (c["priority"], c["amount"]), reverse=True)
    cases = cases[:700]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "異常訊號與查核優先度只用於篩選值得人工核對的公開資料，不代表違法、圍標、圖利或弊案認定。",
        "sources": statuses,
        "summary": {
            "cases": len(cases),
            "restricted_awards": len(awards),
            "restricted_tenders": len(tenders),
            "debarred_records": len(debarred),
            "concentration_records": len(concentration),
            "ratio_benchmark_records": len(ratio),
            "combo_cases": sum(1 for c in cases if len(c["signals"]) >= 2),
        },
        "benchmarks": {"engineering_lowest_bid_ratios": ratio},
        "cases": cases,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False))
    for s in statuses:
        print(f"{'OK' if s['ok'] else 'FAIL'} {s['key']}: {s['records']} {s.get('error','')}")
    # Require at least one official source to be usable.
    if not any(s["ok"] and s["records"] > 0 for s in statuses):
        raise SystemExit("No official PCC source returned usable records.")

if __name__ == "__main__":
    build()
