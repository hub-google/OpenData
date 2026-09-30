#!/usr/bin/env python3
import re, subprocess, json, html
from pathlib import Path
from urllib.parse import urljoin

UA="Mozilla/5.0"

def curl(url, timeout=20):
    p=subprocess.run(["curl","-4","-k","-L","--compressed","--max-time",str(timeout),"-A",UA,"-sS",url],
                     stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout+5)
    return p.returncode,p.stdout,p.stderr

base="https://www.qparking.com.tw/parking/"
rc,page,err=curl(base)
urls=set()
for pat in [
    r'<script[^>]+src=["\']([^"\']+)["\']',
    r'(component---[^"\'\\ ]+\.js)',
    r'["\']([^"\']+\.js)["\']',
]:
    for x in re.findall(pat,page,re.I):
        urls.add(urljoin("https://www.qparking.com.tw/",html.unescape(x).replace("\\u002F","/").lstrip("/")))

# Gatsby page data and app data are often more stable than chunk hashes.
urls.add("https://www.qparking.com.tw/page-data/parking/page-data.json")
urls.add("https://www.qparking.com.tw/page-data/app-data.json")
urls.add("https://www.qparking.com.tw/component---src-pages-parking-index-jsx-0bacd16388e361d52931.js")

records=[]
all_text=[("PAGE",page)]
for u in sorted(urls):
    rc,body,e=curl(u)
    records.append({"url":u,"rc":rc,"bytes":len(body.encode()),"stderr":e[-300:]})
    if body:
        all_text.append((u,body))
        # If page-data points to component chunk, fetch it too.
        for x in re.findall(r'["\']([^"\']*component---[^"\']+\.js)["\']',body,re.I):
            uu=urljoin("https://www.qparking.com.tw/",html.unescape(x).lstrip("/"))
            if uu not in [r["url"] for r in records]:
                rc2,b2,e2=curl(uu)
                records.append({"url":uu,"rc":rc2,"bytes":len(b2.encode()),"stderr":e2[-300:]})
                all_text.append((uu,b2))

hints=[]
for src,blob in all_text:
    pats=[
      r'https?://[^"\'<>\\\s)]+',
      r'["\']([^"\']*(?:api|graphql|parking|park|lot|space|store|search|query)[^"\']*)["\']',
      r'(?:fetch|axios\.(?:get|post)|XMLHttpRequest|\.get\(|\.post\()[^;]{0,700}',
    ]
    for pat in pats:
        for hit in re.findall(pat,blob,re.I):
            val=hit if isinstance(hit,str) else "".join(hit)
            val=html.unescape(val)
            if len(val)>900: continue
            key=val.lower()
            if any(k in key for k in ("api","parking","park","lot","qpk","qparking","graphql","space","store","query")):
                tup=(src,val)
                if tup not in hints: hints.append(tup)

out=Path("停車/QParking上游反查.md")
lines=["# QParking 上游反查","",f"- homepage curl rc={rc}","",
       "## 抓取的 JS / page-data",""]
for r in records: lines.append(f"- {r['url']} — rc={r['rc']} bytes={r['bytes']} stderr={r['stderr']}")
lines += ["","## API / endpoint / backend hints",""]
for src,val in hints[:500]:
    lines.append(f"- `{val}` ← {src}")
out.write_text("\n".join(lines),encoding="utf-8")
print(out.read_text(encoding="utf-8"))
