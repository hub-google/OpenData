#!/usr/bin/env python3
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCES = {
    "taipei-static.json": "https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json",
    "taipei-realtime.json": "https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json",
    "ntpc-static.json": "https://data.ntpc.gov.tw/api/datasets/b1464ef0-9c7c-4a6f-abf7-6bdf32847e68/json?page=0&size=2000",
    "ntpc-realtime.json": "https://data.ntpc.gov.tw/api/datasets/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json?page=0&size=2000",
    "taoyuan.json": "https://opendata.tycg.gov.tw/api/dataset/f4cc0b12-86ac-40f9-8745-885bddc18f79/resource/0381e141-f7ee-450e-99da-2240208d1773/download",
}
MIN_COUNTS = {
    "taipei-static.json": 1000,
    "taipei-realtime.json": 500,
    "ntpc-static.json": 100,
    "ntpc-realtime.json": 50,
    "taoyuan.json": 100,
}

def fetch_json(url):
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

def count_records(data):
    return len(extract_rows(data))

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    out.mkdir(parents=True, exist_ok=True)
    meta = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "sources": {},
    }

    staged = {}
    for filename, url in SOURCES.items():
        data, info = fetch_json(url)
        count = count_records(data)
        if count < MIN_COUNTS[filename]:
            raise RuntimeError(f"{filename}: unexpected record count {count}")
        staged[filename] = data
        meta["sources"][filename] = {"url": url, "count": count, **info}

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
