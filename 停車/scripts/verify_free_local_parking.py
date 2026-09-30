#!/usr/bin/env python3
import json, re, subprocess, time, html
from pathlib import Path
from urllib.parse import urlencode

UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153 Safari/537.36"

def curl(method,url,data=None,timeout=25):
    cmd=["curl","-4","-k","-L","--compressed","--max-time",str(timeout),"-A",UA,
         "-H","Accept: application/json,text/html,*/*","-sS","-w","\n__HTTP_STATUS__:%{http_code}\n__CONTENT_TYPE__:%{content_type}\n"]
    if method=="POST":
        cmd += ["-X","POST","-H","Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
                "-H","X-Requested-With: XMLHttpRequest","--data",data or ""]
    cmd.append(url)
    p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout+10)
    out=p.stdout
    ms=re.search(r"\n__HTTP_STATUS__:(\d+)\n__CONTENT_TYPE__:(.*?)\n?$",out,re.S)
    status=int(ms.group(1)) if ms else None
    ct=ms.group(2).strip() if ms else ""
    body=out[:ms.start()] if ms else out
    return status,ct,body,p.stderr[-500:]

def attempt(method,url,data=None,parser=None):
    attempts=[]
    for i in range(1,4):
        try:
            st,ct,body,err=curl(method,url,data)
            result=parser(body,st,ct) if parser else {}
            result.update({"status":st,"content_type":ct,"bytes":len(body.encode()),"attempt":i})
            attempts.append({"attempt":i,"status":st,"bytes":len(body.encode()),"stderr":err})
            if st and 200 <= st < 300 and result.get("usable",False):
                result["attempts"]=attempts
                return result
            # Even a 200 but not usable should be recorded; retry because dynamic endpoint may be flaky.
            if i<3: time.sleep(i)
        except Exception as e:
            attempts.append({"attempt":i,"error":f"{type(e).__name__}: {e}"})
            if i<3: time.sleep(i)
    return {"usable":False,"attempts":attempts,"last_body_head":locals().get("body","")[:1000] if "body" in locals() else ""}

def parse_json_avail(keys):
    def _p(body,st,ct):
        try: obj=json.loads(body)
        except Exception:
            return {"usable":False,"json":False,"body_head":re.sub(r"\s+"," ",body)[:800]}
        rows=obj if isinstance(obj,list) else (obj.get("data",[]) if isinstance(obj,dict) and isinstance(obj.get("data"),list) else [obj] if isinstance(obj,dict) else [])
        nums=[]
        for r in rows:
            if not isinstance(r,dict): continue
            for k in keys:
                v=r.get(k)
                if isinstance(v,(int,float)): nums.append(v)
                elif isinstance(v,str) and re.fullmatch(r"-?\d+",v.strip()): nums.append(int(v.strip()))
        return {"usable":len(rows)>0 and len(nums)>0,"json":True,"rows":len(rows),"numeric_count":len(nums),
                "sample_keys":list(rows[0].keys()) if rows and isinstance(rows[0],dict) else [],
                "sample":rows[0] if rows and isinstance(rows[0],dict) else None}
    return _p

def parse_parkinglotpost(body,st,ct):
    try: obj=json.loads(body)
    except Exception:
        return {"usable":False,"json":False,"body_head":re.sub(r"\s+"," ",body)[:800]}
    rows=obj if isinstance(obj,list) else []
    rem=[]
    for r in rows:
        if not isinstance(r,dict): continue
        v=r.get("remaining")
        if isinstance(v,(int,float)) or (isinstance(v,str) and re.fullmatch(r"-?\d+",v.strip())):
            rem.append(v)
    return {"usable":len(rows)>0 and len(rem)>0,"json":True,"rows":len(rows),"remaining_numeric":len(rem),
            "sample_keys":list(rows[0].keys()) if rows else [],"sample":rows[0] if rows else None}

def parse_hualien(body,st,ct):
    n=body.count("parking_space_list_item")
    text=re.sub(r"<[^>]+>"," ",html.unescape(body))
    text=re.sub(r"\s+"," ",text)
    snippets=[]
    nums=[]
    for m in re.finditer(r"(剩餘|可停|空位|剩餘車位|目前車位)",text):
        sn=text[max(0,m.start()-80):m.end()+120]
        snippets.append(sn)
        for x in re.findall(r"\d+",sn): nums.append(int(x))
    return {"usable":n>0 and bool(nums),"items":max(0,n-1),"availability_number_hits":len(nums),
            "availability_snippets":snippets[:20],"body_head":text[:1000]}

def parse_taitung_lots(body,st,ct):
    try: obj=json.loads(body); rows=obj.get("data",[])
    except Exception:return {"usable":False,"json":False,"body_head":body[:800]}
    return {"usable":len(rows)>0,"json":True,"rows":len(rows),"sample":rows[0] if rows else None,
            "sample_keys":list(rows[0].keys()) if rows else []}

def parse_taitung_spaces(body,st,ct):
    try: obj=json.loads(body); rows=obj.get("data",[])
    except Exception:return {"usable":False,"json":False,"body_head":body[:800]}
    occupied=sum(1 for r in rows if isinstance(r,dict) and isinstance(r.get("is_parked"),bool))
    return {"usable":len(rows)>0 and occupied>0,"json":True,"rows":len(rows),"is_parked_boolean_count":occupied,
            "sample":rows[0] if rows else None}

tests=[
 ("高雄","GET","https://kpp.tbkc.gov.tw/ParkingLocation/GetParkingLocation",None,parse_json_avail(["SurplusSpace","surplusSpace","remaining","available"])),
 ("彰化","POST","https://chpark.chcg.gov.tw/ParkingLocation/ParkingLotPost","",parse_parkinglotpost),
 ("雲林","POST","https://parking.yunlin.gov.tw/ParkingLocation/ParkingLotPost","",parse_parkinglotpost),
 ("南投","POST","https://parking.nantou.gov.tw/ParkingLocation/ParkingLotPost","",parse_parkinglotpost),
 ("花蓮","POST","https://traffic.hl.gov.tw/Home/_ParkingDetailPartialView","page=1&pageNumber=100&action=DynamicParking&currentGroup=1&dataModel%5BKeyWord%5D=",parse_hualien),
 ("臺東-路外清單","GET","https://trafficweb.ttcpb.gov.tw/api/parking-lots",None,parse_taitung_lots),
 ("臺東-路邊逐格","GET","https://trafficweb.ttcpb.gov.tw/api/parking-spaces",None,parse_taitung_spaces),
]
penghu_codes=["OWIZXZ","QAHZCZ","T2THK8","NCEJ97","Y7ROW9"]
for code in penghu_codes:
    tests.append((f"澎湖-{code}","GET",f"https://zytparking.com:35170/api/external-setting/parking-lot-available-space?parkingLotCode={code}",None,parse_json_avail(["available"])))

# Kinmen likely Guoyun standard variants. Probe several plausible public routes.
for u in [
 "https://km.guoyun.com.tw/ParkingLocation/ParkingLotPost",
 "https://kmpark.guoyun.com.tw/ParkingLocation/ParkingLotPost",
 "https://km.guoyun.com.tw/TrafficPayBill/ParkingLocation/ParkingLotPost",
 "https://kmpark.guoyun.com.tw/KP/KP/ParkingLocation/ParkingLotPost",
]:
    tests.append(("金門候選","POST",u,"",parse_parkinglotpost))

results=[]
for name,method,url,data,parser in tests:
    print("TEST",name,url,flush=True)
    r=attempt(method,url,data,parser)
    r.update({"name":name,"method":method,"url":url})
    results.append(r)
    print(" ->",r.get("status"),r.get("usable"),r.get("rows"),r.get("numeric_count") or r.get("remaining_numeric") or r.get("availability_number_hits"),flush=True)

# If Taitung list works, fetch first 5 details and validate vacancy.
lot_result=next((r for r in results if r["name"]=="臺東-路外清單" and r.get("sample")),None)
if lot_result:
    # Refetch list to get IDs
    st,ct,body,err=curl("GET","https://trafficweb.ttcpb.gov.tw/api/parking-lots")
    try: rows=json.loads(body).get("data",[])
    except: rows=[]
    for item in rows[:5]:
        lid=item.get("id")
        if not lid: continue
        u=f"https://trafficweb.ttcpb.gov.tw/api/parking-lots/{lid}"
        r=attempt("GET",u,None,parse_json_avail(["vacancy","available","remaining"]))
        r.update({"name":f"臺東-detail-{lid}","method":"GET","url":u})
        results.append(r)

out=Path("停車/免費地方動態端點實測.md")
lines=[
 "# 免費地方動態停車端點實測","",
 "> 目的：繞過 TDX，直接驗證地方政府／地方營運系統公開端點是否能取得 numeric 即時剩餘格。  ",
 "> 每個候選端點最多連續試 3 次；只有實際回傳 numeric availability 才標「可用」。  ",
 "> TLS 憑證鏈異常的舊政府/營運站以 curl -k 測通性，正式產品應另註記風險。","",
 "| 對象 | 方法 | 結果 | HTTP | 筆數/項目 | numeric availability | URL |",
 "|---|---|---|---:|---:|---:|---|"
]
for r in results:
    count=r.get("rows",r.get("items","—"))
    num=r.get("numeric_count",r.get("remaining_numeric",r.get("availability_number_hits",r.get("is_parked_boolean_count","—"))))
    lines.append(f"| {r['name']} | {r['method']} | {'✅ 可用' if r.get('usable') else '❌ 未驗到'} | {r.get('status','—')} | {count} | {num} | {r['url']} |")

lines += ["","## 詳細回應摘要",""]
for r in results:
    lines += [f"### {r['name']}","",f"- URL: {r['url']}",f"- attempts: {json.dumps(r.get('attempts',[]),ensure_ascii=False)}",
              f"- sample_keys: {json.dumps(r.get('sample_keys',[]),ensure_ascii=False)}",
              f"- sample: {json.dumps(r.get('sample'),ensure_ascii=False)[:2500] if r.get('sample') is not None else '—'}"]
    if r.get("availability_snippets"):
        lines.append("- availability_snippets:")
        for x in r["availability_snippets"]: lines.append(f"  - {x}")
    if r.get("body_head"): lines.append(f"- body_head: {r['body_head'][:1500]}")
    lines.append("")
out.write_text("\n".join(lines),encoding="utf-8")
print("WROTE",out)
