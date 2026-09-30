#!/usr/bin/env python3
import re, json, html, urllib.request, urllib.parse, ssl, time
from pathlib import Path

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"
targets={
 "高雄":"https://kpp.tbkc.gov.tw/",
 "花蓮":"https://traffic.hl.gov.tw/Home/CheckParkingDetail",
 "花蓮首頁":"https://traffic.hl.gov.tw/",
 "金門停車網":"https://kmpark.guoyun.com.tw/KP/KP/",
 "金門縣府":"https://www.kinmen.gov.tw/",
}

def get(url, timeout=20):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"text/html,application/javascript,application/json,*/*"})
    with urllib.request.urlopen(req,timeout=timeout,context=ssl.create_default_context()) as r:
        raw=r.read()
        ct=r.headers.get("Content-Type","")
        enc="utf-8"
        m=re.search(r"charset=([\w-]+)",ct,re.I)
        if m: enc=m.group(1)
        try: txt=raw.decode(enc,"replace")
        except: txt=raw.decode("utf-8","replace")
        return txt, r.geturl(), getattr(r,"status",None), ct

def absu(base,u):
    return urllib.parse.urljoin(base,html.unescape(u))

interesting=[]
for name,url in targets.items():
    rec={"name":name,"url":url,"status":None,"final":"","scripts":[],"forms":[],"candidates":[],"errors":[]}
    try:
        text,final,status,ct=get(url)
        rec.update(status=status,final=final)
        Path("/tmp").mkdir(exist_ok=True)
        # scripts
        scripts=re.findall(r'<script[^>]+src=["\']([^"\']+)["\']',text,re.I)
        rec["scripts"]=[absu(final,x) for x in scripts]
        # forms/actions
        rec["forms"]=[absu(final,x) for x in re.findall(r'<form[^>]+action=["\']([^"\']+)["\']',text,re.I)]
        blobs=[("HTML",text,final)]
        for su in rec["scripts"][:40]:
            try:
                js,jsf,st,ct2=get(su,15)
                blobs.append((su,js,jsf))
            except Exception as e:
                rec["errors"].append(f"script {su}: {type(e).__name__}: {e}")
        # endpoint-like strings
        pats=[
          r'https?://[^"\'<>\s)]+',
          r'["\']([^"\']*(?:api|Api|API)[^"\']*)["\']',
          r'["\']([^"\']*(?:Parking|parking|Park|park)[^"\']*)["\']',
          r'["\']([^"\']*(?:Get|Search|Query|List|Detail)[^"\']*)["\']',
          r'url\s*:\s*["\']([^"\']+)["\']',
          r'fetch\(\s*["\']([^"\']+)["\']',
          r'ajax\([^)]{0,300}',
        ]
        cand=[]
        for src,blob,base in blobs:
            for pat in pats:
                for m in re.findall(pat,blob,re.I):
                    val=m if isinstance(m,str) else "".join(m)
                    val=html.unescape(val).strip()
                    if not val: continue
                    if len(val)>500: continue
                    if any(x in val.lower() for x in ("parking","park","api","getparking","availability","spaceinfo","carpark")):
                        if val.startswith("/"):
                            val=absu(base,val)
                        item={"from":src,"value":val}
                        if item not in cand: cand.append(item)
        rec["candidates"]=cand[:300]
    except Exception as e:
        rec["errors"].append(f"{type(e).__name__}: {e}")
    interesting.append(rec)

out=Path("停車/地方停車上游反查.md")
lines=["# 地方停車動態上游反查","","> 自動抓官方網站 HTML / JS bundle，尋找前端實際呼叫的 API/parking endpoint。",""]
for r in interesting:
    lines += [f"## {r['name']}","",f"- 首頁：{r['url']}",f"- HTTP：{r['status']}",f"- final：{r['final']}",""]
    if r["forms"]:
        lines.append("### Form actions")
        for x in r["forms"]: lines.append(f"- {x}")
        lines.append("")
    lines.append("### Scripts")
    for x in r["scripts"][:40]: lines.append(f"- {x}")
    lines.append("")
    lines.append("### 疑似 endpoint / API 字串")
    if r["candidates"]:
        for x in r["candidates"][:200]: lines.append(f"- {x['value']}  ← {x['from']}")
    else:
        lines.append("- 未抓到")
    if r["errors"]:
        lines += ["","### errors"]
        for x in r["errors"]: lines.append(f"- {x}")
    lines.append("")
out.write_text("\n".join(lines),encoding="utf-8")
print(out)
