#!/usr/bin/env python3
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCES = {
    "taipei-static.json": "https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json",
    "taipei-realtime.json": "https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json",
    "taoyuan.json": "https://opendata.tycg.gov.tw/api/dataset/f4cc0b12-86ac-40f9-8745-885bddc18f79/resource/0381e141-f7ee-450e-99da-2240208d1773/download",
}
MIN_COUNTS = {
    "taipei-static.json": 1000,
    "taipei-realtime.json": 500,
    "taoyuan.json": 100,
}

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "OpenData-Parking/1.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read()
    return json.loads(raw.decode("utf-8-sig"))

def count_records(data):
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        park = (data.get("data") or {}).get("park") if isinstance(data.get("data"), dict) else None
        if isinstance(park, list):
            return len(park)
    return 0

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    out.mkdir(parents=True, exist_ok=True)
    meta = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "sources": {},
    }

    staged = {}
    for filename, url in SOURCES.items():
        data = fetch_json(url)
        count = count_records(data)
        if count < MIN_COUNTS[filename]:
            raise RuntimeError(f"{filename}: unexpected record count {count}")
        staged[filename] = data
        meta["sources"][filename] = {"url": url, "count": count}

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
