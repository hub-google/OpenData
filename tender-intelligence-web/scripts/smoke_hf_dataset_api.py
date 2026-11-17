#!/usr/bin/env python3
"""Read-only end-to-end validation of HF Dataset Viewer public tender APIs."""
import json
import os
import sys
import time
from urllib.parse import urlencode
import requests

BASE = "https://datasets-server.huggingface.co/"
DS = "hub-google/TenderIntelligence"
SESSION = requests.Session()
SESSION.headers.update({"Accept": "application/json", "User-Agent": "Mozilla/5.0 (tender-hf-public-verification)"})

def get(path, **params):
    url = BASE + path + "?" + urlencode({"dataset": DS, **params})
    r = SESSION.get(url, timeout=40)
    print("HF_DATASET_VIEWER", path, "HTTP", r.status_code, "CORS", r.headers.get("access-control-allow-origin"),flush=True)
    if r.status_code != 200:
        print("HF_DATASET_VIEWER_BODY", r.text[:850],flush=True)
        raise RuntimeError(f"{path}: HTTP {r.status_code}")
    data = r.json()
    return data

def main():
    # Changes to HF repos may need time to index; retries do not claim success.
    for attempt in range(1, 11):
        try:
            splits = get("splits")
            configs = {x["config"] for x in splits["splits"]}
            required = {"ti_cases", "ti_notices", "ti_case_details", "ti_debarred_vendor_notices", "ti_case_search_index", "ti_case_vendor_search"}
            if not required <= configs:
                raise RuntimeError("config missing: " + str(required - configs))
            cases = get("rows", config="ti_cases", split="train", offset=0, length=2)
            if not cases.get("rows"): raise RuntimeError("HF /rows returned no source-backed cases")
            target = cases["rows"][0]["row"]
            assert target.get("id") and target.get("title"), target
            clause = '"id"=' + "'" + target["id"].replace("'", "''") + "'"
            match = get("filter",config="ti_cases",split="train",where=clause,offset=0,length=2)
            if not match.get("rows") or match["rows"][0]["row"].get("id")!=target["id"]:
                raise RuntimeError("HF exact case id filter does not match")
            recent = get("filter",config="ti_cases",split="train",
                         where='"latest_notice_date">=20260801',
                         orderby='"latest_notice_date" DESC',offset=0,length=5)
            if not recent.get("rows"): raise RuntimeError("HF ranged sorted filter returned empty")
            test = get("search",config="ti_cases",split="train",query="100K",offset=0,length=5)
            print("HF_TITLE_SEARCH_ROWS",len(test.get("rows",[])),flush=True)
            assert "rows" in test and "num_rows_total" in test
            print("TENDER_HF_PUBLIC_API_VERIFIED="+json.dumps({
                "cases_total":cases.get("num_rows_total"),
                "exact_case":target["id"],
                "range_results":len(recent["rows"]),
                "fts_results":len(test["rows"]),
                "configs":len(configs)
            },ensure_ascii=False),flush=True)
            return
        except Exception as e:
            print("HF_API_NOT_READY",attempt,str(e)[:450],flush=True)
            if attempt==10:raise
            time.sleep(18)
if __name__=="__main__":
    main()
