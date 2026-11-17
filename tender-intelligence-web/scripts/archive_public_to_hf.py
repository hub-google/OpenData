#!/usr/bin/env python3
"""Verified, read-only archive of public Taiwan tender data to a PRIVATE HF dataset.

This intentionally does not delete or mutate Supabase records and does not
export private accounts, billing, notifications, keys, or user documents.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from huggingface_hub import HfApi, hf_hub_download

TABLES = {
    "ti_cases": "id",
    "ti_notices": "id",
    "ti_case_details": "case_id",
    "ti_debarred_vendor_notices": "id",
}
PAGE_SIZE = 500
ROWS_PER_SHARD = 10000
DATASET_CARD = """---
language:
- zh
pretty_name: Taiwan Tender Intelligence Public Records Archive
---

# Taiwan Tender Intelligence — Public Procurement Records Archive

Private, versioned, lossless snapshots of public procurement notice and
case metadata acquired by the OpenData/Tender Intelligence project.

Data provenance: the project's public data mirror of OpenFun PCC API and the
Taiwan government procurement disclosure service. The availability of an API
does not imply permission to redistribute these records commercially.
Verify source licensing before publishing any portion of this dataset.

Only the following public-source relations are archived:
ti_cases, ti_notices (including raw_brief), ti_case_details,
ti_debarred_vendor_notices.

Excluded: all member accounts, workspaces, personal data created by members,
payment information, notification records, API credentials and internal indices.
Operational production queries continue to use Supabase until a separately
verified cutover. Snapshots here are archives, not a transactional database.

The latest.json pointer changes only after every source count, archive checksum,
remote download and content checksum has been verified.
"""

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"],
        "Accept": "application/json",
        "Prefer": "count=exact",
    })
    retry = Retry(
        total=5, backoff_factor=1.4,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(("GET",)),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


def get_page(s: requests.Session, base: str, table: str, key: str,
             offset: int, limit: int, count: bool = False):
    url = f"{base}/rest/v1/{table}"
    params = {
        "select": "*" if not count else key,
        "order": f"{key}.asc",
        "limit": limit,
        "offset": offset,
    }
    r = s.get(url, params=params, timeout=(15, 120))
    r.raise_for_status()
    result = r.json()
    if not isinstance(result, list):
        raise ValueError(f"{table}: response was not a row array")
    total = None
    part = r.headers.get("content-range", "")
    if "/" in part and part.rsplit("/", 1)[1].isdigit():
        total = int(part.rsplit("/", 1)[1])
    if total is None:
        raise ValueError(f"{table}: server did not provide an exact row count")
    return result, total


def export_table(s: requests.Session, base: str, out: Path,
                 table: str, key: str) -> dict:
    folder = out / table
    folder.mkdir(parents=True)
    rows_written, index = 0, 0
    expected = None
    seen = set()
    shards = []
    stream = None
    filename = None
    shard_rows = 0

    def close_shard():
        nonlocal stream, filename, shard_rows
        if stream is not None:
            stream.close()
            shards.append({
                "file": str(filename.relative_to(out)),
                "rows": shard_rows,
                "bytes": filename.stat().st_size,
                "sha256": digest(filename),
            })
            stream = None
            filename = None
            shard_rows = 0

    try:
        while True:
            page, total = get_page(s, base, table, key, rows_written,
                                   PAGE_SIZE)
            if expected is None:
                expected = total
            if total != expected:
                raise RuntimeError(f"{table}: source count changed during export: {expected} -> {total}")
            if not page:
                break
            for row in page:
                value = row.get(key)
                if not isinstance(value, str) or not value:
                    raise RuntimeError(f"{table}: invalid primary key {key}")
                if value in seen:
                    raise RuntimeError(f"{table}: duplicate key found; aborting snapshot")
                seen.add(value)
                if stream is None:
                    filename = folder / f"part-{index:05d}.jsonl.gz"
                    stream = gzip.open(filename, "wt", encoding="utf-8",
                                       compresslevel=6)
                    shard_rows = 0
                    index += 1
                stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True,
                                        separators=(",", ":")) + "\n")
                shard_rows += 1
                rows_written += 1
                if shard_rows >= ROWS_PER_SHARD:
                    close_shard()
            if rows_written >= expected:
                break
        close_shard()
        _, ending = get_page(s, base, table, key, 0, 1, count=True)
        if expected != ending or rows_written != expected:
            raise RuntimeError(
                f"{table}: count check failed (start={expected}, end={ending}, archived={rows_written})"
            )
        print(json.dumps({"table": table, "verified_rows": rows_written,
                          "shards": len(shards)}, ensure_ascii=False), flush=True)
        return {"rows": rows_written, "primary_key": key, "shards": shards}
    finally:
        if stream is not None:
            stream.close()


def main():
    token = os.environ["HF_TOKEN"]
    repo_id = os.environ.get("HF_DATASET_REPO", "hub-google/TenderIntelligence")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo_id):
        raise ValueError("Invalid Hugging Face dataset repository")
    base = os.environ["SUPABASE_URL"].rstrip("/")
    if not base.startswith("https://"):
        raise ValueError("Source URL must use HTTPS")
    # This is an immutable full snapshot: never overwrite earlier verified data.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with tempfile.TemporaryDirectory(prefix="tender_hf_archive_") as tmp:
        out = Path(tmp) / "data"
        out.mkdir()
        s = session()
        tables = {
            table: export_table(s, base, out, table, key)
            for table, key in TABLES.items()
        }
        manifest = {
            "schema_version": 1,
            "snapshot": stamp,
            "source": base,
            "format": "jsonl-gzip-lossless",
            "snapshot_type": "full",
            "tables": tables,
            "deletion_from_source": False,
        }
        manifest_path = out / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8"
        )
        all_files = [manifest_path] + [
            out / shard["file"]
            for tab in tables.values()
            for shard in tab["shards"]
        ]
        expected_hashes = {str(f.relative_to(out)): digest(f) for f in all_files}
        api = HfApi(token=token)
        api.create_repo(repo_id=repo_id, repo_type="dataset",
                        private=True, exist_ok=True)
        info = api.repo_info(repo_id=repo_id, repo_type="dataset")
        if not info.private:
            raise RuntimeError("Refusing to upload: HF destination is PUBLIC")
        current_files = set(api.list_repo_files(repo_id=repo_id, repo_type="dataset"))
        if "README.md" not in current_files:
            api.upload_file(repo_id=repo_id, repo_type="dataset",
                            path_in_repo="README.md",
                            path_or_fileobj=DATASET_CARD.encode("utf-8"),
                            commit_message="Document private tender archive provenance")
        target = f"snapshots/{stamp}"
        api.upload_folder(repo_id=repo_id, repo_type="dataset",
                          folder_path=str(out), path_in_repo=target,
                          commit_message=f"Archive verified tender records {stamp}")
        # Verify every uploaded file, not just the API success response.
        for name, sha in expected_hashes.items():
            remote = Path(hf_hub_download(repo_id=repo_id, repo_type="dataset",
                                          filename=f"{target}/{name}",
                                          token=token, force_download=True))
            if digest(remote) != sha:
                raise RuntimeError(f"HF read-back hash mismatch: {name}")
        pointer = json.dumps({
            "snapshot": stamp, "manifest": f"{target}/manifest.json",
            "manifest_sha256": expected_hashes["manifest.json"],
            "row_counts": {key: val["rows"] for key, val in tables.items()},
            "remote_sha256_verified": True,
        }, ensure_ascii=False, indent=2).encode("utf-8")
        api.upload_file(repo_id=repo_id, repo_type="dataset",
                        path_or_fileobj=pointer, path_in_repo="latest.json",
                        commit_message=f"Publish verified tender archive {stamp}")
        print("TENDER_HF_ARCHIVE_VERIFIED=" + json.dumps({
            "dataset": repo_id,
            "snapshot": stamp,
            "rows": {key: val["rows"] for key, val in tables.items()},
            "file_count_verified": len(expected_hashes),
            "supabase_data_deleted": False,
        }, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
