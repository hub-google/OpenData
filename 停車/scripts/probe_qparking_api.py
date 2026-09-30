#!/usr/bin/env python3
import json, urllib.request, re
from pathlib import Path

url="https://wkzshe1wa9.execute-api.ap-southeast-1.amazonaws.com/default/qpk_web_site/parking_lot?db=&asc=area_id,id,parking_lot_image.sort&disabled=false"
req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0","Accept":"application/json,*/*","Origin":"https://www.qparking.com.tw","Referer":"https://www.qparking.com.tw/"})
with urllib.request.urlopen(req,timeout=30) as r:
    raw=r.read(); status=r.status; ct=r.headers.get("content-type","")
txt=raw.decode("utf-8","replace")
obj=json.loads(txt)
rows=obj if isinstance(obj,list) else (obj.get("data",obj.get("result",[])) if isinstance(obj,dict) else [])
if isinstance(rows,dict): rows=[rows]
print("status",status,"ct",ct,"bytes",len(raw),"rows",len(rows))
keys=sorted({k for x in rows if isinstance(x,dict) for k in x})
print("keys",keys)
needles=["屏東","屏菸","勝利星村","空翔","總圖","縣府","中華"]
matches=[]
for x in rows:
    if not isinstance(x,dict): continue
    ss=json.dumps(x,ensure_ascii=False)
    if any(n in ss for n in needles): matches.append(x)
print("Pingtung matches",len(matches))
for x in matches[:50]:
    print(json.dumps(x,ensure_ascii=False))
availkeys=[k for k in keys if re.search(r"(avail|remain|space|free|surplus|vacan|use|empty|current|car)",k,re.I)]
print("availability-ish keys",availkeys)
out=Path("停車/QParkingAPI實測.md")
lines=["# QParking API 實測","",f"- URL: {url}",f"- HTTP: {status}",f"- rows: {len(rows)}",f"- keys: {', '.join(keys)}",f"- availability-ish keys: {', '.join(availkeys) or '—'}","","## 屏東相關 rows",""]
for x in matches[:100]:
    lines += ["~~~json",json.dumps(x,ensure_ascii=False,indent=2),"~~~",""]
out.write_text("\n".join(lines),encoding="utf-8")
