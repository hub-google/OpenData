#!/usr/bin/env python3
"""Build browser-friendly, source-verified public tender search and case-detail shards.

No server, no Workers, no Supabase. A customer downloads one compact public
case catalog and, on demand, a single 1/64th announcement/details bucket.
"""
import gzip
import hashlib
import io
import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download

REPO="hub-google/TenderIntelligence"
SNAPSHOTS={
  "records":"snapshots/20261117T023629Z",
  "search":"search-indexes/20261117T024932Z"
}
SHARD_BUCKETS=64
ROWS={
 "ti_cases":"records",
 "ti_notices":"records",
 "ti_case_details":"records",
 "ti_case_search_index":"search",
 "ti_case_vendor_search":"search",
 "ti_debarred_vendor_notices":"records"
}

def sha(buf):return hashlib.sha256(buf).hexdigest()

def bucket(case_id):
 return f"{int(hashlib.sha256(case_id.encode('utf8')).hexdigest()[:2],16)%SHARD_BUCKETS:02x}"

def download(token,path):
 return Path(hf_hub_download(repo_id=REPO,repo_type="dataset",filename=path,token=token))

def rows_for(token,table):
 base=SNAPSHOTS[ROWS[table]]
 manifest=json.loads(download(token,base+"/manifest.json").read_text())
 part=manifest["tables"][table]
 yielded=0
 for shard in part["shards"]:
  file=download(token,base+"/"+shard["file"])
  if sha(file.read_bytes())!=shard["sha256"]:raise RuntimeError("Bad HF original shard SHA "+shard["file"])
  local=0
  with gzip.open(file,"rt",encoding="utf8") as inp:
   for line in inp:
    if line.strip():
     local+=1;yield json.loads(line)
  if local!=shard["rows"]:raise RuntimeError("Bad source shard count")
  yielded+=local
 if yielded!=part["rows"]:raise RuntimeError("Bad table row count")

def stable_gzip(value):
 raw=json.dumps(value,ensure_ascii=False,separators=(",",":")).encode("utf8")
 stream=io.BytesIO()
 with gzip.GzipFile(fileobj=stream,mode="wb",filename="",mtime=0,compresslevel=6) as handle:
  handle.write(raw)
 return stream.getvalue()

def put(folder,path,value,manifest):
 raw=stable_gzip(value)
 file=folder/path
 file.parent.mkdir(parents=True,exist_ok=True)
 file.write_bytes(raw)
 manifest[path]={"bytes":len(raw),"sha256":sha(raw),"records":len(value)}
 return len(value)

def main():
 token=os.environ["HF_TOKEN"]
 api=HfApi(token=token)
 assert not api.repo_info(repo_id=REPO,repo_type="dataset").private
 with tempfile.TemporaryDirectory(prefix="tender_hf_browser_") as temp:
  root=Path(temp);files={}
  for table in ("ti_cases","ti_case_search_index","ti_case_vendor_search","ti_debarred_vendor_notices"):
   values=list(rows_for(token,table))
   if table=="ti_cases":
    values.sort(key=lambda r:(r.get("latest_notice_date") or 0,r.get("id") or ""),reverse=True)
    for row in values:
     row.pop("first_seen_at",None)
   path=f"{table}.json.gz"
   put(root,Path(path),values,files)
   print("TENDER_HF_BROWSER_PACK "+table+" "+str(len(values)),flush=True)
  for table in ("ti_notices","ti_case_details"):
   b=defaultdict(list); total=0
   for row in rows_for(token,table):
    b[bucket(str(row["case_id"]))].append(row);total+=1
   for key in [f"{i:02x}" for i in range(SHARD_BUCKETS)]:
    records=b[key]
    if table=="ti_notices":
     records.sort(key=lambda r:(r.get("source_date") or 0,str(r.get("filename") or "")),reverse=True)
    put(root,Path(table)/f"{key}.json.gz",records,files)
   print("TENDER_HF_BROWSER_PACK "+table+" "+str(total),flush=True)
  manifest={
   "format":"source-backed-public-tender-browser",
   "schema_version":1,
   "source_snapshots":SNAPSHOTS,
   "created_at":datetime.now(timezone.utc).isoformat(),
   "hash_bucket_count":SHARD_BUCKETS,
   "files":files,
   "private_data":False,
  }
  (root/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
  api.upload_folder(repo_id=REPO,repo_type="dataset",folder_path=str(root),
                    path_in_repo="browser/v1",
                    commit_message="Publish verified zero-compute public tender search and case history")
  for relative, expected in files.items():
   path=download(token,"browser/v1/"+relative)
   if sha(path.read_bytes())!=expected["sha256"]:
    raise RuntimeError("Remote browser shard failed SHA256: "+relative)
  print("TENDER_HF_BROWSER_REMOTE_VERIFIED="+json.dumps({
    "files":len(files),
    "bytes":sum(v["bytes"] for v in files.values()),
    "cases":files["ti_cases.json.gz"]["records"],
    "notices":sum(v["records"] for k,v in files.items() if k.startswith("ti_notices/")),
  }),flush=True)
if __name__=="__main__":
 main()
