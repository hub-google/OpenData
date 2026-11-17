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
 manifest[str(path)]={"bytes":len(raw),"sha256":sha(raw),"records":len(value)}
 return len(value)


def daily_files(api):
 import re
 return sorted(f for f in api.list_repo_files(repo_id=REPO,repo_type="dataset")
  if re.fullmatch(r"Daily/\d{4}-\d{2}-\d{2}/notices\.json\.gz",f))

def merge_daily(token,api,cases,notices,search,vendors):
 files=daily_files(api);total=0
 for file in files:
  with gzip.open(download(token,file),"rt",encoding="utf-8") as f:rows=json.load(f)
  if not isinstance(rows,list):raise RuntimeError("Invalid source archive "+file)
  for r in rows:
   if not isinstance(r,dict):continue
   unit=str(r.get("unit_id") or "");job=str(r.get("job_number") or "")
   fn=str(r.get("filename") or "")
   try:date=int(r["date"])
   except (TypeError,ValueError,KeyError):continue
   if not (unit and job and fn and 19990101<=date<=20991231):continue
   id=unit+"::"+job
   brief=r.get("brief") or {}
   if not isinstance(brief,dict):brief={}
   name=str(brief.get("title") or "來源未提供案名")
   agency=str(r.get("unit_name") or "")
   cat=str(brief.get("category") or "")
   typ=str(brief.get("type") or "")
   companies=brief.get("companies") or {}
   if not isinstance(companies,dict):companies={}
   ids=companies.get("ids") if isinstance(companies.get("ids"),list) else []
   names=companies.get("names") if isinstance(companies.get("names"),list) else []
   roles=companies.get("name_key") if isinstance(companies.get("name_key"),dict) else {}
   def money(x):
    try:return float(str(x).replace(",","").replace("元","")) if x is not None else None
    except (TypeError,ValueError):return None
   budget=money(r.get("budget_amount"));award=money(r.get("award_amount"))
   prev=cases.get(id)
   newer=not prev or date>int(prev.get("latest_notice_date") or 0) or (date==int(prev.get("latest_notice_date") or 0) and fn>=str(prev.get("latest_filename") or ""))
   url=(r.get("detail") or {}).get("url") if isinstance(r.get("detail") or {},dict) else None
   if not isinstance(url,str) or not url.startswith("https://web.pcc.gov.tw/"):url=None
   if newer:
    group=next((v for v in ("工程","財物","勞務") if cat.startswith(v)),"未分類")
    cases[id]=dict(id=id,unit_id=unit,job_number=job,title=name[:800],
      agency=agency[:450],category=cat[:700],group_name=group,
      latest_notice_type=typ,latest_notice_date=date,budget_amount=budget,
      award_amount=award,deadline_at=prev.get("deadline_at") if prev else None,
      official_url=url,latest_filename=fn,source_fetched_at=None)
   notice_id=id+"::"+str(date)+"::"+fn
   notices[notice_id]=dict(id=notice_id,case_id=id,source_date=date,filename=fn,
     notice_type=typ,title=name[:800],category=cat[:700],budget_amount=budget,
     award_amount=award,official_url=url,company_ids=ids,company_names=names,
     company_role_keys=roles,raw_brief=brief,fetched_at=None)
   prior=search.get(id,{}).get("searchable") or ""
   search[id]={"case_id":id,"searchable":prior+" "+name+" "+agency+" "+cat}
   vendor_text=" ".join(str(v) for v in ids+names)
   if vendor_text:
    prior=vendors.get(id,{}).get("vendor_text") or ""
    vendors[id]={"case_id":id,"vendor_text":prior+" "+vendor_text}
   total+=1
  print("TENDER_HF_DAILY_OVERLAY="+json.dumps({"file":file,"source_rows":len(rows)},ensure_ascii=False),flush=True)
 return len(files),total

def main():
 token=os.environ["HF_TOKEN"]
 api=HfApi(token=token)
 assert not api.repo_info(repo_id=REPO,repo_type="dataset").private
 with tempfile.TemporaryDirectory(prefix="tender_hf_browser_") as temp:
  root=Path(temp);files={}
  cases={r["id"]:r for r in rows_for(token,"ti_cases")}
  notices={r["id"]:r for r in rows_for(token,"ti_notices")}
  search={r["case_id"]:r for r in rows_for(token,"ti_case_search_index")}
  vendors={r["case_id"]:r for r in rows_for(token,"ti_case_vendor_search")}
  daily_files_count,daily_source_count=merge_daily(token,api,cases,notices,search,vendors)
  notice_counts=defaultdict(int)
  for row in notices.values():notice_counts[row["case_id"]]+=1
  for row in cases.values():
   row.pop("first_seen_at",None)
   row["notice_count"]=notice_counts.get(row["id"],0)
  cases_sorted=sorted(cases.values(),key=lambda r:(r.get("latest_notice_date") or 0,r["id"]),reverse=True)
  for table,data in (("ti_cases",cases_sorted),("ti_case_search_index",list(search.values())),
      ("ti_case_vendor_search",list(vendors.values())),
      ("ti_debarred_vendor_notices",list(rows_for(token,"ti_debarred_vendor_notices")))):
   put(root,Path(table+".json.gz"),data,files)
   print("TENDER_HF_BROWSER_PACK "+table+" "+str(len(data)),flush=True)
  for table,data in (("ti_notices",notices.values()),("ti_case_details",rows_for(token,"ti_case_details"))):
   b=defaultdict(list);total=0
   for row in data:
    b[bucket(str(row["case_id"]))].append(row);total+=1
   for key in [f"{i:02x}" for i in range(SHARD_BUCKETS)]:
    shard=b[key]
    if table=="ti_notices":shard.sort(key=lambda r:(r.get("source_date") or 0,str(r.get("filename") or "")),reverse=True)
    put(root,Path(table)/f"{key}.json.gz",shard,files)
   print("TENDER_HF_BROWSER_PACK "+table+" "+str(total),flush=True)
  manifest={
   "format":"source-backed-public-tender-browser",
   "schema_version":1,
   "source_snapshots":SNAPSHOTS,
   "daily_source_files":daily_files_count,
   "daily_overlay_source_records":daily_source_count,
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
