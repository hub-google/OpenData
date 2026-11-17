#!/usr/bin/env python3
"""Verified, read-only archive of public Taiwan tender data to a PUBLIC HF dataset repository.

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
PAGE_SIZE = 250
ROWS_PER_SHARD = 10000
DATASET_CARD = """---
language:
- zh
pretty_name: Taiwan Tender Intelligence Public Records Archive
---

# Taiwan Tender Intelligence — Public Procurement Records Archive

Public, versioned, lossless snapshots of public procurement notice and
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


def filter_literal(value: str) -> str:
    """Safely quote PostgREST filter values, including punctuation."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def get_count(s: requests.Session, base: str, table: str,
              key: str, max_key: str | None = None) -> int:
    params = {"select": key, "limit": 1}
    # Count all public rows; PostgREST single-field quoted lte filters can
    # miscount identifiers containing punctuation. Keyset bounds are enforced
    # separately by get_page() using its tested grouped filter.
    r = s.get(f"{base}/rest/v1/{table}", params=params,
              headers={"Prefer": "count=exact"}, timeout=(15, 120))
    r.raise_for_status()
    range_header = r.headers.get("content-range", "")
    if "/" not in range_header or not range_header.rsplit("/", 1)[1].isdigit():
        raise RuntimeError(f"{table}: cannot get exact source count")
    return int(range_header.rsplit("/", 1)[1])


def upper_bound(s: requests.Session, base: str, table: str, key: str) -> str | None:
    r = s.get(f"{base}/rest/v1/{table}",
              params={"select": key, "order": f"{key}.desc", "limit": 1},
              timeout=(15, 120))
    r.raise_for_status()
    rows = r.json()
    return rows[0][key] if rows else None


def get_page(s: requests.Session, base: str, table: str, key: str,
             cursor: str | None, max_key: str, limit: int):
    """Keyset pagination avoids Postgres OFFSET scans and proxy 500s."""
    params = {
        "select": "*",
        "order": f"{key}.asc",
        "limit": limit,
        "and": f"({key}.lte.{filter_literal(max_key)}" +
               (f",{key}.gt.{filter_literal(cursor)}" if cursor is not None else "") +
               ")",
    }
    r = s.get(f"{base}/rest/v1/{table}", params=params,
              headers={"Prefer": "return=representation"}, timeout=(15, 120))
    r.raise_for_status()
    rows = r.json()
    if not isinstance(rows, list):
        raise RuntimeError(f"{table}: invalid page response")
    return rows


def export_table(s: requests.Session, base: str, out: Path,
                 table: str, key: str) -> dict:
    folder = out / table
    folder.mkdir(parents=True)
    rows_written, index = 0, 0
    max_key = upper_bound(s, base, table, key)
    expected = get_count(s, base, table, key, max_key) if max_key else 0
    cursor = None
    previous_key = None
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
            if max_key is None:
                break
            page = get_page(s, base, table, key, cursor, max_key, PAGE_SIZE)
            if not page:
                break
            for row in page:
                value = row.get(key)
                if not isinstance(value, str) or not value:
                    raise RuntimeError(f"{table}: invalid primary key {key}")
                if previous_key is not None and value == previous_key:
                    raise RuntimeError(f"{table}: repeated primary key, unsafe export")
                previous_key = value
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
            cursor = previous_key
        close_shard()
        ending = get_count(s, base, table, key, max_key) if max_key else 0
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
                        private=False, exist_ok=True)
        info = api.repo_info(repo_id=repo_id, repo_type="dataset")
        if info.private:
            api.update_repo_settings(repo_id=repo_id, repo_type="dataset", private=False)
            info = api.repo_info(repo_id=repo_id, repo_type="dataset")
        if info.private:
            raise RuntimeError("HF destination must be PUBLIC")
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
