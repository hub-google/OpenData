#!/usr/bin/env python3
"""Fetch a reproducible 100-record business sample from Taiwan PPSTRQ.

The public query sometimes returns person-like vehicle records even when the
company/business radio is selected. To avoid aggregating natural-person
financial data, this sampler filters the result list to explicit business-name
markers before requesting any detail page.
"""

import csv
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://ppstrq.nat.gov.tw"
QUERY_URL = BASE + "/pps/pubQuery/PropertyQuery/propertyQuery.do"
DETAIL_URL = BASE + "/pps/pubQuery/PropertyQuery/propertyDetail.do"

# Start with the keyword already verified to paginate normally. Additional
# uncommon business-name characters are only fallbacks if 100 business rows
# are not found.
KEYWORDS = ["杰", "祐", "宸", "鋐", "鉅", "晟"]
LIMIT = 100
DETAIL_DELAY_SECONDS = 0.65
PAGE_DELAY_SECONDS = 0.25
MAX_PAGES_PER_KEYWORD = 60

BUSINESS_MARKERS = (
    "股份有限公司",
    "有限公司",
    "企業社",
    "工程行",
    "商行",
    "工業社",
    "企業行",
    "實業社",
    "工作室",
    "工廠",
    "製造廠",
    "商號",
    "車行",
)

OUT_DIR = Path("ppstrq/data")
CSV_PATH = OUT_DIR / "sample_100_company_records.csv"
JSON_PATH = OUT_DIR / "sample_100_company_records.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/153 Safari/537.36"
    )
}


def form_fields(form):
    data = {}
    for el in form.find_all(["input", "select", "textarea"]):
        name = el.get("name")
        if not name:
            continue
        typ = (el.get("type") or "").lower()
        if typ in {"button", "submit", "reset", "radio", "checkbox"}:
            continue
        data[name] = el.get("value", "")
    return data


def post_with_retry(session, url, data, referer, attempts=4):
    last = None
    for i in range(attempts):
        try:
            r = session.post(
                url,
                data=data,
                headers={"Referer": referer},
                timeout=45,
                allow_redirects=True,
            )
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            last = exc
            if i + 1 < attempts:
                time.sleep(2 ** i)
    raise last


def is_business_name(name):
    return any(marker in (name or "") for marker in BUSINESS_MARKERS)


def parse_result_page(html, source_keyword):
    soup = BeautifulSoup(html, "html.parser")
    records = []
    for tr in soup.find_all("tr"):
        onclick = tr.get("onclick", "")
        if "goDetail" not in onclick:
            continue
        m = re.search(r"goDetail\('([^']+)','([^']+)'\)", onclick)
        if not m:
            continue
        cells = [" ".join(x.stripped_strings) for x in tr.find_all(["td", "th"])]
        if len(cells) < 7:
            continue
        debtor_name = cells[3]
        if not is_business_name(debtor_name):
            continue
        reg_unit_code, cert_no = m.groups()
        records.append(
            {
                "搜尋索引": source_keyword,
                "登記機關代碼": reg_unit_code,
                "登記機關": cells[1],
                "案件類別": cells[2],
                "債務人名稱": debtor_name,
                "抵押權人名稱": cells[4],
                "登記編號": cells[5],
                "案件狀態": cells[6],
            }
        )
    total_match = re.search(r"此查詢總筆數：\s*([0-9,]+)筆", html)
    total = int(total_match.group(1).replace(",", "")) if total_match else None
    cp = soup.find("input", {"name": "currentPage"})
    tp = soup.find("input", {"name": "totalPage"})
    current_page = int(cp.get("value")) if cp and cp.get("value", "").isdigit() else None
    total_page = int(tp.get("value")) if tp and tp.get("value", "").isdigit() else None
    return soup, records, total, current_page, total_page


def generic_detail_fields(soup):
    result = {}
    for row in soup.select("div.pubDetailRow"):
        children = row.find_all("div", recursive=False)
        i = 0
        while i < len(children):
            c = children[i]
            classes = c.get("class", [])
            if "pubDetailLabel" in classes and i + 1 < len(children):
                nxt = children[i + 1]
                if "pubDetailValue" in nxt.get("class", []):
                    label = " ".join(c.stripped_strings).rstrip("：: ").strip()
                    value = " ".join(nxt.stripped_strings).strip()
                    if label:
                        if label in result and result[label] != value:
                            old = result[label]
                            if not isinstance(old, list):
                                old = [old]
                            old.append(value)
                            result[label] = old
                        else:
                            result[label] = value
                    i += 2
                    continue
            i += 1
    return result


def first_value(fields, *labels):
    for label in labels:
        value = fields.get(label)
        if isinstance(value, list):
            return "；".join(str(x) for x in value)
        if value:
            return str(value)
    return ""


def parse_detail(html):
    soup = BeautifulSoup(html, "html.parser")
    fields = generic_detail_fields(soup)

    amount_rows = []
    priority_amounts = []
    fallback_amounts = []

    for row in soup.select("div.pubDetailRow"):
        text = " ".join(row.stripped_strings)
        if "擔保債權金額" not in text:
            continue
        amount_rows.append(text)
        parsed = []
        for raw in re.findall(r"擔保債權金額\s*[:：]?\s*([0-9][0-9,]*)", text):
            try:
                parsed.append(int(raw.replace(",", "")))
            except ValueError:
                pass
        fallback_amounts.extend(parsed)
        if "順位" in text:
            priority_amounts.extend(parsed)

    # Prefer priority creditor amounts. Older/vehicle cases sometimes expose
    # only the owner-line amount, so use that as a fallback.
    amounts = priority_amounts if priority_amounts else fallback_amounts

    return {
        "登記核准日期": first_value(fields, "登記核准日期"),
        "變更核准日期": first_value(fields, "變更核准日期"),
        "註銷日期": first_value(fields, "註銷日期"),
        "契約啟始日期": first_value(fields, "契約啟始日期"),
        "契約終止日期": first_value(fields, "契約終止日期"),
        "標的物所在地": first_value(fields, "標的物所在地"),
        "動產明細項數": first_value(fields, "動產明細項數"),
        "是否最高限額": first_value(fields, "是否最高限額"),
        "是否浮動擔保": first_value(fields, "是否浮動擔保"),
        "標的物種類": first_value(fields, "標的物種類"),
        "擔保債權金額明細": "；".join(amount_rows),
        "擔保債權金額合計": sum(amounts) if amounts else "",
    }


def query_business_rows(keyword):
    session = requests.Session()
    session.headers.update(HEADERS)

    g = session.get(QUERY_URL, timeout=30)
    g.raise_for_status()
    soup = BeautifulSoup(g.text, "html.parser")
    form = soup.find("form", id="queryForm")
    if not form:
        raise RuntimeError("queryForm not found")

    action = urljoin(g.url, form.get("action", ""))
    data = form_fields(form)
    data.update(
        {
            "method": "query",
            "currentPage": "0",
            "debtorType": "1",
            "debtorTypeRadio": "1",
            "queryDebtorName": keyword,
            "queryDebtorNo": "",
            "creditorType": "",
            "queryCreditorName": "",
            "queryCreditorNo": "",
        }
    )

    first = post_with_retry(session, action, data, g.url)
    soup1, rows, total, current_page, total_pages = parse_result_page(first.text, keyword)
    if not total_pages:
        print(f"keyword={keyword}: no pageable results")
        return [], None, None, None

    qform = soup1.find("form", id="queryForm")
    if qform:
        returned = form_fields(qform)
        data.update(returned)
    data["debtorTypeRadio"] = "1"

    all_rows = list(rows)
    pages_to_scan = min(total_pages, MAX_PAGES_PER_KEYWORD)
    print(
        f"keyword={keyword}: total={total}, pages={total_pages}, "
        f"business_on_page1={len(rows)}"
    )

    for page in range(2, pages_to_scan + 1):
        data["method"] = "query"
        data["currentPage"] = str(page)
        pr = post_with_retry(session, QUERY_URL, data, first.url)
        _, page_rows, _, got_page, _ = parse_result_page(pr.text, keyword)
        if got_page != page:
            raise RuntimeError(f"keyword={keyword}: expected page {page}, got {got_page}")
        all_rows.extend(page_rows)
        if page % 10 == 0 or page == pages_to_scan:
            print(
                f"keyword={keyword}: scanned page {page}/{pages_to_scan}, "
                f"business_rows={len(all_rows)}"
            )
        time.sleep(PAGE_DELAY_SECONDS)

    return all_rows, total, total_pages, data


def main():
    records = []
    seen = set()
    query_meta = []
    last_query_data = None

    for keyword in KEYWORDS:
        rows, total, total_pages, query_data = query_business_rows(keyword)
        if total_pages:
            query_meta.append(
                {"keyword": keyword, "total_matches": total, "total_pages": total_pages}
            )
            last_query_data = query_data
        for rec in rows:
            key = (rec["登記機關代碼"], rec["登記編號"])
            if key in seen:
                continue
            seen.add(key)
            records.append(rec)
            if len(records) >= LIMIT:
                break
        if len(records) >= LIMIT:
            break

    records = records[:LIMIT]
    if len(records) < LIMIT:
        raise RuntimeError(
            f"Only collected {len(records)} explicit business rows; expected {LIMIT}"
        )

    # Fresh public session for detail retrieval.
    detail_session = requests.Session()
    detail_session.headers.update(HEADERS)
    g = detail_session.get(QUERY_URL, timeout=30)
    g.raise_for_status()
    form = BeautifulSoup(g.text, "html.parser").find("form", id="queryForm")
    base_detail_data = form_fields(form) if form else {}

    for idx, rec in enumerate(records, start=1):
        detail_data = dict(base_detail_data)
        detail_data["regUnitCode"] = rec["登記機關代碼"]
        detail_data["certificateAppNoWord"] = rec["登記編號"]

        det = post_with_retry(detail_session, DETAIL_URL, detail_data, QUERY_URL)
        rec.update(parse_detail(det.text))
        rec["樣本序號"] = idx
        print(
            f"detail {idx:03d}/{LIMIT}: {rec['債務人名稱']} | "
            f"{rec['擔保債權金額合計']}"
        )
        time.sleep(DETAIL_DELAY_SECONDS)

    columns = [
        "樣本序號",
        "搜尋索引",
        "登記機關代碼",
        "登記機關",
        "案件類別",
        "債務人名稱",
        "抵押權人名稱",
        "登記編號",
        "案件狀態",
        "登記核准日期",
        "變更核准日期",
        "註銷日期",
        "契約啟始日期",
        "契約終止日期",
        "擔保債權金額合計",
        "擔保債權金額明細",
        "標的物所在地",
        "動產明細項數",
        "是否最高限額",
        "是否浮動擔保",
        "標的物種類",
    ]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)

    payload = {
        "source": QUERY_URL,
        "scope": (
            "explicit company/registered-business debtor records only; "
            "natural-person-like rows are filtered before detail retrieval"
        ),
        "business_markers": list(BUSINESS_MARKERS),
        "query_meta": query_meta,
        "sample_size": len(records),
        "records": records,
    }
    JSON_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with_amount = sum(
        1 for x in records if isinstance(x.get("擔保債權金額合計"), int)
    )
    print(
        f"DONE records={len(records)} with_amount={with_amount} "
        f"keywords_used={[x['keyword'] for x in query_meta]}"
    )
    print(CSV_PATH)
    print(JSON_PATH)


if __name__ == "__main__":
    main()
