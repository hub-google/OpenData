#!/usr/bin/env python3
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCES = {
    "taipei-static.json": {
        "url": "https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json",
        "min": 1000,
    },
    "taipei-realtime.json": {
        "url": "https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json",
        "min": 500,
    },
    "ntpc-static.json": {
        "url": "https://data.ntpc.gov.tw/api/datasets/b1464ef0-9c7c-4a6f-abf7-6bdf32847e68/json",
        "min": 100,
        "paged": True,
    },
    "ntpc-realtime.json": {
        "url": "https://data.ntpc.gov.tw/api/datasets/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json",
        "min": 50,
        "paged": True,
    },
    "taoyuan.json": {
        "url": "https://opendata.tycg.gov.tw/api/dataset/f4cc0b12-86ac-40f9-8745-885bddc18f79/resource/0381e141-f7ee-450e-99da-2240208d1773/download",
        "min": 100,
    },
    "taichung.json": {
        "url": "https://motoretag.taichung.gov.tw/DataAPI/api/ParkingAPIV2/Opendata",
        "min": 1,
        "optional": True,
    },
}

def request_json(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "OpenData-Parking/1.0",
            "Accept": "application/json,text/plain,*/*",
            "Origin": "https://hub-google.github.io",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read()
        info = {
            "status": r.status,
            "cors": r.headers.get("Access-Control-Allow-Origin"),
            "content_type": r.headers.get("Content-Type"),
        }
    return json.loads(raw.decode("utf-8-sig")), info

def extract_rows(data):
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    d = data.get("data")
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        for key in ("park", "records", "items"):
            if isinstance(d.get(key), list):
                return d[key]
    r = data.get("result")
    if isinstance(r, dict):
        for key in ("records", "items"):
            if isinstance(r.get(key), list):
                return r[key]
    for key in ("records", "items"):
        if isinstance(data.get(key), list):
            return data[key]
    return []

def fetch_paged(base_url):
    merged = []
    page = 0
    last_info = {}
    seen = set()
    while page < 5:
        url = f"{base_url}?page={page}&size=1000"
        data, info = request_json(url)
        rows = extract_rows(data)
        last_info = info
        signature = json.dumps(rows[:3], ensure_ascii=False, sort_keys=True) if rows else ""
        if not rows or signature in seen:
            break
        seen.add(signature)
        merged.extend(rows)
        if len(rows) < 1000:
            break
        page += 1
    return merged, {**last_info, "pages": len(seen)}

def fetch_source(spec):
    if spec.get("paged"):
        return fetch_paged(spec["url"])
    return request_json(spec["url"])

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    out.mkdir(parents=True, exist_ok=True)
    meta = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "sources": {},
    }

    staged = {}
    for filename, spec in SOURCES.items():
        try:
            data, info = fetch_source(spec)
            count = len(extract_rows(data))
            if count < spec["min"]:
                raise RuntimeError(f"unexpected record count {count}")
            staged[filename] = data
            meta["sources"][filename] = {
                "url": spec["url"],
                "count": count,
                **info,
            }
        except Exception as e:
            meta["sources"][filename] = {
                "url": spec["url"],
                "error": f"{type(e).__name__}: {e}",
            }
            if not spec.get("optional"):
                raise

    for filename, data in staged.items():
        (out / filename).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    (out / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(meta, ensure_ascii=False))

if __name__ == "__main__":
    main()
