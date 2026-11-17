#!/usr/bin/env python3
"""Independent HTTP verification of public HF browser packs, sizes and cross-origin access."""
import gzip
import hashlib
import json
import urllib.request

BASE="https://huggingface.co/datasets/hub-google/TenderIntelligence/resolve/main/browser/v1/"
def fetch(path):
  req=urllib.request.Request(BASE+path,headers={
    "Accept":"application/json,application/octet-stream",
    "User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/157 Safari/537.36",
    "Origin":"https://hub-google.github.io"
  })
  with urllib.request.urlopen(req,timeout=45) as r:
    content=r.read()
    cors=r.headers.get("Access-Control-Allow-Origin")
    print("HF_BROWSER_HTTP="+json.dumps({"file":path,"status":r.status,
      "cors":cors,"size":len(content)}),flush=True)
    if cors not in ("*","https://hub-google.github.io"):
      raise RuntimeError("Browser CORS is unavailable for "+path)
    return content

manifest=json.loads(fetch("manifest.json"))
assert manifest["schema_version"]==1
assert manifest["hash_bucket_count"]==64
for path in ["ti_cases.json.gz","ti_case_search_index.json.gz",
             "ti_case_vendor_search.json.gz","ti_notices/00.json.gz"]:
  raw=fetch(path)
  expected=manifest["files"][path]
  if hashlib.sha256(raw).hexdigest()!=expected["sha256"]:
    raise RuntimeError("Public HTTP file checksum mismatch: "+path)
  rows=json.loads(gzip.decompress(raw))
  if len(rows)!=expected["records"]:
    raise RuntimeError("Public HTTP file count mismatch: "+path)
  if path=="ti_cases.json.gz":
    assert len(rows)>=90140 and rows[0]["id"] and rows[0]["title"]
print("TENDER_HF_BROWSER_HTTP_VERIFIED="+json.dumps({
  "files":len(manifest["files"]),
  "cases":manifest["files"]["ti_cases.json.gz"]["records"],
  "source":"public-hf-repository",
  "requires_supabase":False,
  "requires_cloudflare":False
}),flush=True)
