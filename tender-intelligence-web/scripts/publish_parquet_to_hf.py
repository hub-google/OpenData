#!/usr/bin/env python3
"""Create HUGGING FACE DATASET VIEWER searchable Parquet configs from verified public archives.

- Only the 6 publicly sourced ti_* tables are exported.
- Source snapshot is verified against its SHA256 manifest before conversion.
- Upload through Hugging Face Repositories; never expose private user data.
- Does not read Supabase or alter another project's tables.
"""
import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from huggingface_hub import HfApi, hf_hub_download

REPO = "hub-google/TenderIntelligence"
SNAPSHOTS = {
    "records": "snapshots/20261117T023629Z",
    "search": "search-indexes/20261117T024932Z",
}
TABLES = [
    ("records", "ti_cases"),
    ("records", "ti_notices"),
    ("records", "ti_case_details"),
    ("records", "ti_debarred_vendor_notices"),
    ("search", "ti_case_search_index"),
    ("search", "ti_case_vendor_search"),
]
NUMERIC = {"budget_amount", "award_amount"}
INTEGER = {"latest_notice_date", "source_date", "records_count"}
COMPLEX = {"raw_brief", "company_role_keys", "details", "company_ids", "company_names"}

def digest(buf):
    return hashlib.sha256(buf).hexdigest()

def convert_row(row):
    ret = {}
    for k, v in row.items():
        if v is None:
            ret[k] = None
        elif k in NUMERIC:
            ret[k] = float(v)
        elif k in INTEGER:
            ret[k] = int(v)
        elif k in COMPLEX:
            ret[k] = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        elif isinstance(v, (list, dict)):
            ret[k] = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        else:
            ret[k] = str(v)
    return ret

def fetch(token, path):
    return Path(hf_hub_download(repo_id=REPO, repo_type="dataset",
               filename=path, token=token, force_download=False))

def write_table(token, collection, name, folder):
    snapshot = SNAPSHOTS[collection]
    manifest = json.loads(fetch(token, snapshot + "/manifest.json").read_text())
    definition = manifest["tables"][name]
    output = folder / "tabular" / name
    output.mkdir(parents=True, exist_ok=True)
    writer = None
    schema = None
    count = 0
    columns = None
    for shard in definition["shards"]:
        path = fetch(token, snapshot + "/" + shard["file"])
        if digest(path.read_bytes()) != shard["sha256"]:
            raise RuntimeError("source checksum mismatch: " + str(path))
        rows = []
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(convert_row(json.loads(line)))
        if len(rows) != shard["rows"]:
            raise RuntimeError("manifest shard row-count mismatch: " + shard["file"])
        if rows:
            if columns is None:
                columns = list(rows[0])
            normalized = [{k: row.get(k) for k in columns} for row in rows]
            table = pa.Table.from_pylist(normalized, schema=schema)
            if writer is None:
                # Enforce a stable schema even if the first 10,000 values of a column are NULL.
                fields = []
                for field in table.schema:
                    if field.name in INTEGER:
                        typ = pa.int64()
                    elif field.name in NUMERIC:
                        typ = pa.float64()
                    else:
                        typ = pa.string()
                    fields.append(pa.field(field.name, typ))
                schema = pa.schema(fields)
                table = pa.Table.from_pylist(normalized, schema=schema)
                writer = pq.ParquetWriter(output / "train.parquet", schema, compression="zstd")
            writer.write_table(table)
        count += len(rows)
    if writer:
        writer.close()
    if count != definition["rows"]:
        raise RuntimeError(f"{name}: {count} != {definition['rows']} records")
    print("TENDER_PARQUET_BUILD=" + json.dumps({"table":name,"rows":count},ensure_ascii=False),flush=True)
    return count

def update_card(api, token):
    base = fetch(token, "README.md").read_text(encoding="utf-8")
    if base.startswith("---\n"):
        sep=base.find("\n---\n",4)
        if sep<0: raise RuntimeError("invalid existing dataset card metadata")
        base=base[sep+5:]
    configs = ["---", "configs:"]
    for _,name in TABLES:
        configs.extend([
            "  - config_name: " + name,
            "    data_files:",
            "      - split: train",
            "        path: tabular/" + name + "/*.parquet"
        ])
    configs.extend(["---", "",base])
    api.upload_file(repo_id=REPO,repo_type="dataset",path_in_repo="README.md",
                    path_or_fileobj="\n".join(configs).encode("utf-8"),
                    commit_message="Expose six source-backed indexed tables to HF Dataset Viewer")

def main():
    token = os.environ["HF_TOKEN"]
    api=HfApi(token=token)
    if api.repo_info(repo_id=REPO,repo_type="dataset").private:
        raise RuntimeError("Source must be public")
    with tempfile.TemporaryDirectory() as temp:
        folder=Path(temp)
        counts={}
        for set_name,table_name in TABLES:
            counts[table_name]=write_table(token,set_name,table_name,folder)
        api.upload_folder(repo_id=REPO,repo_type="dataset",
                          folder_path=str(folder / "tabular"),
                          path_in_repo="tabular",
                          commit_message="Publish six verified searchable Parquet public tender tables")
    update_card(api,token)
    print("TENDER_PUBLIC_PARQUET_VERIFIED="+json.dumps(counts),flush=True)

if __name__=="__main__":
    main()
