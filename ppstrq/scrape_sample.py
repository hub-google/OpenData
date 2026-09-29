#!/usr/bin/env python3
"""Fetch a small, reproducible sample from Taiwan PPSTRQ public query.

Scope: company/business debtor records (debtorType=1) whose debtor name contains
the configured keyword. This script intentionally uses ordinary public form POSTs,
sequential requests, retries, and a delay between detail requests.
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
KEYWORD = "杰"
LIMIT = 100
DELAY_SECONDS = 0.8

OUT_DIR = Path("ppstrq/data")
CSV_PATH = OUT_DIR / "sample_100_company_records.csv"
JSON_PATH = OUT_DIR / "sample_100_company_records.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/153 Safari/537.36"
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


def parse_result_page(html):
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
        reg_unit_code, cert_no = m.groups()
        records.append(
            {
                "登記機關代碼": reg_unit_code,
                "登記機關": cells[1],
                "案件類別": cells[2],
                "債務人名稱": cells[3],
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
    amounts = []
    for row in soup.select("div.pubDetailRow"):
        text = " ".join(row.stripped_strings)
        if "擔保債權金額" not in text:
            continue
        amount_rows.append(text)
        for raw in re.findall(r"擔保債權金額\s*([0-9,]+)", text):
            try:
                amounts.append(int(raw.replace(",", "")))
            except ValueError:
                pass

    return {
        "登記核准日期": first_value(fields, "登記核准日期"),
        "變更核准日期": first_value(fields, "變更核准日期"),
        "註銷日期": first_value(fields, "註銷日期"),
        "契約啟始日期": first_value(fields, "契約啟始日期"),
        "契約終止日期": first_value(fields, "契約終止日期"),
        "標的物所有人": first_value(fields, "標的物所有人"),
        "標的物所在地": first_value(fields, "標的物所在地"),
        "動產明細項數": first_value(fields, "動產明細項數"),
        "是否最高限額": first_value(fields, "是否最高限額"),
        "是否浮動擔保": first_value(fields, "是否浮動擔保"),
        "標的物種類": first_value(fields, "標的物種類"),
        "擔保債權金額明細": "；".join(amount_rows),
        "擔保債權金額合計": sum(amounts) if amounts else "",
    }


def main():
    session = requests.Session()
    session.headers.update(HEADERS)

    r = session.get(QUERY_URL, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form", id="queryForm")
    if not form:
        raise RuntimeError("queryForm not found")

    action = urljoin(r.url, form.get("action", ""))
    query_data = form_fields(form)
    query_data.update(
        {
            "method": "query",
            "currentPage": "0",
            "debtorType": "1",
            "debtorTypeRadio": "1",
            "queryDebtorName": KEYWORD,
            "queryDebtorNo": "",
            "creditorType": "",
            "queryCreditorName": "",
            "queryCreditorNo": "",
        }
    )

    first = post_with_retry(session, action, query_data, r.url)
    soup1, page_records, total, _, total_pages = parse_result_page(first.text)
    if not total_pages:
        raise RuntimeError("No result pages found")

    qform = soup1.find("form", id="queryForm")
    if qform:
        returned = form_fields(qform)
        for key, value in returned.items():
            query_data[key] = value
        query_data["debtorTypeRadio"] = "1"

    records = page_records[:]
    pages_needed = min(total_pages, (LIMIT + 9) // 10)

    for page in range(2, pages_needed + 1):
        query_data["method"] = "query"
        query_data["currentPage"] = str(page)
        pr = post_with_retry(session, QUERY_URL, query_data, first.url)
        _, rows, _, got_page, _ = parse_result_page(pr.text)
        if got_page != page:
            raise RuntimeError(f"Expected page {page}, got {got_page}")
        records.extend(rows)
        print(f"query page {page}/{pages_needed}: +{len(rows)} rows")
        time.sleep(0.3)

    records = records[:LIMIT]
    if len(records) < LIMIT:
        raise RuntimeError(f"Only collected {len(records)} list rows; expected {LIMIT}")

    for idx, rec in enumerate(records, start=1):
        detail_data = dict(query_data)
        detail_data["regUnitCode"] = rec["登記機關代碼"]
        detail_data["certificateAppNoWord"] = rec["登記編號"]

        det = post_with_retry(session, DETAIL_URL, detail_data, QUERY_URL)
        rec.update(parse_detail(det.text))
        rec["樣本序號"] = idx
        print(
            f"detail {idx:03d}/{LIMIT}: {rec['債務人名稱']} | "
            f"{rec['擔保債權金額合計']}"
        )
        time.sleep(DELAY_SECONDS)

    columns = [
        "樣本序號",
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
        "標的物所有人",
        "標的物所在地",
        "動產明細項數",
        "是否最高限額",
        "是否浮動擔保",
        "標的物種類",
    ]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)

    payload = {
        "source": QUERY_URL,
        "scope": "company/business debtor records (debtorType=1)",
        "query_keyword": KEYWORD,
        "query_total_matches_at_run": total,
        "query_total_pages_at_run": total_pages,
        "sample_size": len(records),
        "records": records,
    }
    JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    with_amount = sum(1 for x in records if isinstance(x.get("擔保債權金額合計"), int))
    print(f"DONE records={len(records)} with_amount={with_amount} total_match={total}")
    print(CSV_PATH)
    print(JSON_PATH)


if __name__ == "__main__":
    main()
