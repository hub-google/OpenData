#!/usr/bin/env python3
import re, json, html, urllib.request, urllib.parse, ssl, time, subprocess, shutil
from pathlib import Path

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"
targets={
 "高雄KPP":"https://kpp.tbkc.gov.tw/ParkingLocation/ParkingLocation",
 "高雄首頁":"https://kpp.tbkc.gov.tw/",
 "花蓮停車資訊":"https://traffic.hl.gov.tw/Home/CheckParkingDetail",
 "花蓮首頁":"https://traffic.hl.gov.tw/",
 "屏東QParking":"https://www.qparking.com.tw/parking/",
 "屏東GreenParking":"https://pingtung.greenparking.com.tw/Pingtung/Query/Index",
 "屏東即時交通":"https://ptits.pthg.gov.tw/",
 "雲林停車":"https://parking.yunlin.gov.tw/",
 "金門停車網":"https://kmpark.guoyun.com.tw/KP/KP/",
 "金門PayBill":"https://km.guoyun.com.tw/TrafficPayBill/",
}

KEYWORDS=("parking","park","api","availability","available","space","carpark","車位","剩餘","動態","immediate")
CONTEXT_TERMS=[
 "ImmediateParking","_ParkingDetailPartialView","getPArkingLotandSpace","DynamicParking",
 "ParkingAvailability","AvailableSpaces","ParkingLocation","parking_space","remain","remaining",
 "available","surplus","freequantity","space","剩餘","車位"
]

def curl_get(url,timeout=25):
    if not shutil.which("curl"):
        raise RuntimeError("curl unavailable")
    p=subprocess.run(["curl","-4","-k","-L","--compressed","--max-time",str(timeout),
                      "-A",UA,"-H","Accept: text/html,application/javascript,application/json,*/*",
                      "-sS","-D","-",url],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    raw=p.stdout
    sep=raw.rfind(b"\r\n\r\n")
    if sep<0: sep=raw.rfind(b"\n\n")
    headers=raw[:sep].decode("latin1","replace") if sep>=0 else ""
    body=raw[sep+4:] if b"\r\n\r\n" in raw[:sep+4] else (raw[sep+2:] if sep>=0 else raw)
    status=None
    sts=re.findall(r"HTTP/\S+\s+(\d+)",headers)
    if sts: status=int(sts[-1])
    ct=""
    m=re.findall(r"(?im)^content-type:\s*([^\r\n]+)",headers)
    if m: ct=m[-1]
    txt=body.decode("utf-8","replace")
    return txt,url,status,ct,"curl4"

def get(url, timeout=20):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"text/html,application/javascript,application/json,*/*"})
    ctx=ssl.create_default_context()
    try:
        with urllib.request.urlopen(req,timeout=timeout,context=ctx) as r:
            raw=r.read()
            ct=r.headers.get("Content-Type","")
            enc="utf-8"
            m=re.search(r"charset=([\w-]+)",ct,re.I)
            if m: enc=m.group(1)
            try: txt=raw.decode(enc,"replace")
            except: txt=raw.decode("utf-8","replace")
            return txt,r.geturl(),getattr(r,"status",None),ct,"urllib"
    except Exception as first:
        try:
            return curl_get(url,max(timeout,25))
        except Exception as second:
            raise RuntimeError(f"urllib={type(first).__name__}:{first}; curl4={type(second).__name__}:{second}")

def post(url,data,timeout=20):
    encoded=urllib.parse.urlencode(data).encode()
    req=urllib.request.Request(url,data=encoded,headers={
        "User-Agent":UA,"Accept":"text/html,application/json,*/*",
        "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With":"XMLHttpRequest"
    })
    ctx=ssl._create_unverified_context()
    with urllib.request.urlopen(req,timeout=timeout,context=ctx) as r:
        raw=r.read()
        return raw.decode("utf-8","replace"),getattr(r,"status",None),r.headers.get("Content-Type","")

def absu(base,u):
    return urllib.parse.urljoin(base,html.unescape(u))

def context_snippets(blob,term,radius=800):
    out=[]
    for m in re.finditer(re.escape(term),blob,re.I):
        a=max(0,m.start()-radius); b=min(len(blob),m.end()+radius)
        sn=re.sub(r"\s+"," ",blob[a:b])
        if sn not in out: out.append(sn)
        if len(out)>=5:break
    return out

interesting=[]
all_candidates=[]
for name,url in targets.items():
    rec={"name":name,"url":url,"status":None,"final":"","method":"","scripts":[],"forms":[],"candidates":[],"contexts":[],"errors":[]}
    try:
        text,final,status,ct,method=get(url)
        rec.update(status=status,final=final,method=method)
        scripts=re.findall(r'<script[^>]+src=["\']([^"\']+)["\']',text,re.I)
        rec["scripts"]=[absu(final,x) for x in scripts]
        rec["forms"]=[absu(final,x) for x in re.findall(r'<form[^>]+action=["\']([^"\']+)["\']',text,re.I)]
        blobs=[("HTML",text,final)]
        for su in rec["scripts"][:60]:
            try:
                js,jsf,st,ct2,meth=get(su,20)
                blobs.append((su,js,jsf))
            except Exception as e:
                rec["errors"].append(f"script {su}: {type(e).__name__}: {e}")
        pats=[
          r'https?://[^"\'<>\s)]+',
          r'["\']([^"\']*(?:api|Api|API)[^"\']*)["\']',
          r'["\']([^"\']*(?:Parking|parking|Park|park)[^"\']*)["\']',
          r'["\']([^"\']*(?:Available|available|Remain|remain|Space|space)[^"\']*)["\']',
          r'["\']([^"\']*(?:Get|Search|Query|List|Detail|Immediate)[^"\']*)["\']',
          r'url\s*:\s*["\']([^"\']+)["\']',
          r'fetch\(\s*["\']([^"\']+)["\']',
        ]
        cand=[]
        contexts=[]
        for src,blob,base in blobs:
            for term in CONTEXT_TERMS:
                for sn in context_snippets(blob,term):
                    item={"from":src,"term":term,"snippet":sn}
                    if item not in contexts: contexts.append(item)
            for pat in pats:
                for mm in re.findall(pat,blob,re.I):
                    val=mm if isinstance(mm,str) else "".join(mm)
                    val=html.unescape(val).strip()
                    if not val or len(val)>600: continue
                    if any(x in val.lower() for x in KEYWORDS):
                        if val.startswith("/") or (not val.startswith("http") and ("/" in val or val.startswith("Home"))):
                            val=absu(base,val)
                        item={"from":src,"value":val}
                        if item not in cand:
                            cand.append(item)
                            all_candidates.append((name,val))
        rec["candidates"]=cand[:400]
        rec["contexts"]=contexts[:100]
    except Exception as e:
        rec["errors"].append(f"{type(e).__name__}: {e}")
    interesting.append(rec)

# Directly probe the strongest Hualien MVC actions discovered in official HTML.
probes=[]
probe_urls=[
 "https://traffic.hl.gov.tw/Home/ImmediateParking",
 "https://traffic.hl.gov.tw/Home/_ParkingDetailPartialView",
 "https://traffic.hl.gov.tw/Home/FindParkingSpaceNearBy",
 "https://traffic.hl.gov.tw/Home/FindParkingSpaceByLocationOrByAddress",
 "https://traffic.hl.gov.tw/Home/ParkingSpaceInfo",
 # likely standardized/public paths on known parking backends
 "https://kpp.tbkc.gov.tw/parking/V1/parking/ParkingAvailability",
 "https://kpp.tbkc.gov.tw/parking/V1/parking/Availability",
 "https://kpp.tbkc.gov.tw/parking/V1/parking/ParkingLot",
 "https://parking.yunlin.gov.tw/TrafficPayBill/Parking/ParkingAvailability",
 "https://km.guoyun.com.tw/TrafficPayBill/Parking/ParkingAvailability",
]
for u in probe_urls:
    pr={"url":u,"attempts":[]}
    for i in range(1,4):
        try:
            txt,final,st,ct,meth=get(u,20)
            pr.update(status=st,content_type=ct,method=meth,final=final,length=len(txt),
                      json_like=txt.lstrip().startswith(("[","{")),
                      body=re.sub(r"\s+"," ",txt)[:1500])
            pr["attempts"].append(f"{i}:status={st},len={len(txt)},via={meth}")
            break
        except Exception as e:
            pr["attempts"].append(f"{i}:{type(e).__name__}:{e}")
            time.sleep(i)
    probes.append(pr)

out=Path("停車/地方停車上游反查.md")
lines=["# 地方停車動態上游反查","","> 自動抓官方／營運網站 HTML、JS bundle，尋找前端實際呼叫的 API / parking endpoint。urllib 失敗時改用 curl -4 -k 重試。",""]
for r in interesting:
    lines += [f"## {r['name']}","",f"- 首頁：{r['url']}",f"- HTTP：{r['status']}",f"- final：{r['final']}",f"- 抓取方式：{r['method']}",""]
    if r["forms"]:
        lines.append("### Form actions")
        for x in r["forms"]: lines.append(f"- {x}")
        lines.append("")
    lines.append("### Scripts")
    for x in r["scripts"][:60]: lines.append(f"- {x}")
    lines += ["","### 疑似 endpoint / API 字串"]
    if r["candidates"]:
        for x in r["candidates"][:250]: lines.append(f"- {x['value']}  ← {x['from']}")
    else: lines.append("- 未抓到")
    if r["contexts"]:
        lines += ["","### 關鍵字附近原始 HTML / JS context"]
        for x in r["contexts"][:60]:
            lines += [f"#### {x['term']} ← {x['from']}","",f"    {x['snippet']}",""]
    if r["errors"]:
        lines += ["","### errors"]
        for x in r["errors"]: lines.append(f"- {x}")
    lines.append("")

lines += ["## 強候選 endpoint 直接試打","",
          "| URL | HTTP | content-type | bytes/chars | JSON-like | via |",
          "|---|---:|---|---:|---|---|"]
for p in probes:
    lines.append(f"| {p['url']} | {p.get('status','—')} | {p.get('content_type','—')} | {p.get('length','—')} | {p.get('json_like','—')} | {p.get('method','—')} |")
lines += ["","### Probe response snippets",""]
for p in probes:
    lines += [f"#### {p['url']}","",f"- attempts: {'; '.join(p.get('attempts',[]))}",f"- body: {p.get('body','—')}",""]

out.write_text("\n".join(lines),encoding="utf-8")
print(out)
