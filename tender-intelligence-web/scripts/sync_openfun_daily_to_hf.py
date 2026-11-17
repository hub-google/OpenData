#!/usr/bin/env python3
"""Continuously archive OpenFun PCC daily public-source records to a PUBLIC HF repository.

No Supabase dependency and no writes to FoodRadar's tables or dataset.
This job saves original source objects, not inferred notices or fabricated data.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.errors import EntryNotFoundError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API = "https://pcc-api.openfun.app/api"
REPO = "hub-google/TenderIntelligence"


def http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"Accept": "application/json", "User-Agent": "TenderIntelligence-PublicArchive/1.0"})
    retry = Retry(
        total=3, backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"])
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def fetch_json(session: requests.Session, path: str, **params):
    response = session.get(API + path, params=params, timeout=(15, 70))
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, (dict, list)):
        raise RuntimeError(f"{path}: invalid public API payload")
    return value


def source_dates(session: requests.Session) -> list[date]:
    info = fetch_json(session, "/getinfo")
    value = str(info.get("最新資料時間", ""))[:10]
    latest = date.fromisoformat(value)
    if latest > datetime.now(timezone.utc).date() + timedelta(days=1):
        raise RuntimeError("Public API returned an implausible future date")
    return [latest - timedelta(days=1), latest]


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def archive_bytes(rows: list[dict]) -> bytes:
    # No timestamp in the archive: an unchanged source is byte-for-byte stable.
    payload = (json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
               + "\n").encode("utf-8")
    stream = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=stream,
                       mtime=0, compresslevel=6) as handle:
        handle.write(payload)
    return stream.getvalue()


def remote_sha(token: str, filename: str) -> str | None:
    try:
        path = hf_hub_download(repo_id=REPO, repo_type="dataset",
                               filename=filename, token=token)
    except EntryNotFoundError:
        return None
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    token = os.environ.get("HF_TOKEN", "")
    if not token:
        raise RuntimeError("HF_TOKEN is not configured")
    api = HfApi(token=token)
    repo = api.repo_info(repo_id=REPO, repo_type="dataset")
    if repo.private:
        raise RuntimeError("Refusing to export: target must be public")
    session = http_session()
    dates = source_dates(session)
    latest_date = dates[-1]
    manifests = []
    failed_dates = []
    for day in (dates[-1], dates[0]):
        try:
            dataset = fetch_json(session, "/listbydate", date=day.strftime("%Y%m%d"))
        except requests.RequestException as exc:
            if day == latest_date:
                raise RuntimeError(f"Latest official source {day} is unavailable; no pointer updated") from exc
            failed_dates.append({"date": day.isoformat(), "status": "upstream_unavailable",
                                 "retry_required": True})
            print("TENDER_PUBLIC_SOURCE_GAP=" + json.dumps(failed_dates[-1]), flush=True)
            continue
        rows = dataset.get("records") if isinstance(dataset, dict) else None
        if not isinstance(rows, list):
            raise RuntimeError(f"{day}: no source records array")
        if day == dates[-1] and not rows:
            raise RuntimeError(f"{day}: newest public source date has zero records")
        invalid = sum(1 for row in rows if not isinstance(row, dict))
        if invalid:
            raise RuntimeError(f"{day}: source contains {invalid} non-object rows")
        raw = archive_bytes(rows)
        archive_path = f"Daily/{day.isoformat()}/notices.json.gz"
        digest = sha(raw)
        already = remote_sha(token, archive_path)
        if already != digest:
            api.upload_file(
                repo_id=REPO, repo_type="dataset", path_in_repo=archive_path,
                path_or_fileobj=raw,
                commit_message=f"Update public OpenFun PCC raw announcements {day.isoformat()}"
            )
            verified_path = hf_hub_download(
                repo_id=REPO, repo_type="dataset", filename=archive_path,
                token=token, force_download=True
            )
            if sha(Path(verified_path).read_bytes()) != digest:
                raise RuntimeError(f"{day}: remote archive checksum mismatch")
        manifests.append({
            "date": day.isoformat(), "archive": archive_path,
            "sha256": digest, "records": len(rows), "bytes": len(raw),
            "unchanged": already == digest
        })
        print(json.dumps({"archived_date": day.isoformat(),
                          "records": len(rows), "remote_verified": True,
                          "unchanged": already == digest},
                         ensure_ascii=False), flush=True)
    pointer = {
        "schema_version": 1,
        "source": API + "/listbydate",
        "latest_date": latest_date.isoformat(),
        "snapshots": sorted(manifests, key=lambda item: item["date"]),
        "source_gaps": failed_dates,
        "complete": not failed_dates,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "public": True,
        "supabase_independent": True
    }
    raw = (json.dumps(pointer, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    api.upload_file(
        repo_id=REPO, repo_type="dataset",
        path_in_repo="Daily/latest.json", path_or_fileobj=raw,
        commit_message=f"Publish verified latest public tender dates {latest_date.isoformat()}"
    )
    downloaded = hf_hub_download(repo_id=REPO, repo_type="dataset",
                                 filename="Daily/latest.json", token=token,
                                 force_download=True)
    if sha(Path(downloaded).read_bytes()) != sha(raw):
        raise RuntimeError("Public HF latest pointer checksum mismatch")
    print("TENDER_PUBLIC_DAILY_ARCHIVE_" + ("PARTIAL" if failed_dates else "OK") + "=" +
          json.dumps({"dataset": REPO, "latest_date": latest_date.isoformat(),
                      "source_dates": len(manifests),
                      "source_rows": sum(x["records"] for x in manifests),
                      "retry_gaps": failed_dates}, ensure_ascii=False), flush=True)
    if failed_dates:
        raise SystemExit("Previous-day upstream unavailable: newest data archived, source gap requires retry")


if __name__ == "__main__":
    main()
