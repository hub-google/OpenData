#!/usr/bin/env python3
"""
Build Taipei urban-renewal candidate leads from official open data.

This is a SCREENING tool, not a legal/valuation conclusion.
Stage 1 uses Taipei historical use-permit data.
Stage 2 (planned) enriches parcel zoning, transaction prices and paid land/building transcripts.
"""
from __future__ import annotations
import hashlib, json, math, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"data"/"candidates.json"
USE_PERMIT_URL="https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=0f3f9675-8356-4f1a-9908-1ce8892012fa"
UA="OpenData-UrbanRenewalRadar/1.0 (+https://github.com/hub-google/OpenData)"
DISTRICTS=["中正","大同","中山","松山","大安","萬華","信義","士林","北投","內湖","南港","文山"]

def clean_tag(tag:str)->str:
    return tag.split("}",1)[-1].strip()

def txt(v):
    return re.sub(r"\s+"," ",str(v or "")).strip()

def num(v):
    s=txt(v).replace(",","")
    m=re.search(r"-?\d+(?:\.\d+)?",s)
    return float(m.group()) if m else 0.0

def intnum(v):
    return int(round(num(v))) if txt(v) else 0

def year_from(v):
    s=re.sub(r"\D","",txt(v))
    if not s:return 0
    # Common source values: 075xxxx, 75, 1986xxxx
    if len(s)>=7 and int(s[:4])>=1900:return int(s[:4])
    y=int(s[:3] if len(s)>=5 else s[:4] if len(s)==4 and int(s)>=1900 else s[:3] if len(s)>=3 else s)
    if 1<=y<=200:return y+1911
    if 1900<=y<=2100:return y
    return 0

def pick(d,*names):
    for n in names:
        if n in d and txt(d[n]):return txt(d[n])
    return ""

def district_of(address):
    for d in DISTRICTS:
        if d+"區" in address:return d+"區"
    return ""

def fetch(url):
    req=Request(url,headers={"User-Agent":UA,"Accept":"application/xml,text/xml,*/*"})
    with urlopen(req,timeout=120) as r:
        return r.read()

def parse_records(blob:bytes):
    # Generic parser: any element whose direct children contain several known fields is treated as a row.
    root=ET.fromstring(blob)
    known={"執照年度","執照號碼","發照日期","構造種類","使用分區","地上層數","戶數","地址","地段號","竣工日期"}
    out=[]
    for el in root.iter():
        kids=list(el)
        if len(kids)<5: continue
        row={clean_tag(c.tag): txt(c.text) for c in kids if c.text is not None}
        if len(known.intersection(row.keys()))>=4:
            out.append(row)
    # Deduplicate if nested XML caused repeats
    seen=set(); uniq=[]
    for r in out:
        key=(pick(r,"執照號碼"),pick(r,"地址"),pick(r,"地段號"))
        if key in seen: continue
        seen.add(key); uniq.append(r)
    return uniq

def score_row(r, now_year):
    address=pick(r,"地址","建築地點")
    zone=pick(r,"使用分區")
    floors=intnum(pick(r,"地上層數"))
    households=intnum(pick(r,"戶數"))
    completed=year_from(pick(r,"竣工日期","發照日期"))
    age=max(0,now_year-completed) if completed else 0
    arcade=num(pick(r,"騎樓基地面積"))
    other=num(pick(r,"其他基地面積"))
    site=arcade+other
    bldg=num(pick(r,"建築面積"))
    land_lot=pick(r,"地段號")
    structure=pick(r,"構造種類")
    # Older low/mid-rise stock only. Keep missing-field records if other signals are strong.
    if age and age<30:return None
    if floors and (floors<2 or floors>8):return None
    if households and households>100:return None
    if not address:return None

    pts=0; reasons=[]
    if age:
        a=min(25,max(5,8+(age-30)*0.7)); pts+=a
        if age>=45: reasons.append(f"屋齡約 {age} 年，重建需求訊號較強")
        elif age>=35: reasons.append(f"屋齡約 {age} 年，進入老屋更新觀察區間")
    else:
        pts+=3; reasons.append("竣工年份缺漏，需回查使照")

    if floors in (4,5): pts+=15; reasons.append(f"{floors} 層老公寓型態，常見於整合型重建標的")
    elif floors==3: pts+=12
    elif floors==6: pts+=10
    elif floors: pts+=5

    if households:
        if 8<=households<=24: pts+=15; reasons.append(f"{households} 戶，整合規模相對可控")
        elif 25<=households<=40: pts+=10
        elif households<=7: pts+=7
        else: pts+=4
    else: pts+=3

    if site:
        if site>=600: pts+=20; reasons.append(f"公開使照基地相關面積約 {site/3.3058:.0f} 坪，具規模")
        elif site>=400: pts+=17
        elif site>=250: pts+=13
        elif site>=150: pts+=9
        else: pts+=4
    elif bldg:
        pts+=5; reasons.append("基地面積欄位缺漏，只能先用建築面積當弱訊號")
    else:
        reasons.append("基地面積缺漏，後續需用地號重建宗地面積")

    z=zone.replace(" ","")
    if "商" in z: pts+=15; reasons.append("使照記載商業使用分區，開發強度值得優先核對")
    elif "住四" in z or "第四種住宅" in z: pts+=14
    elif "住三" in z or "第三種住宅" in z: pts+=12
    elif "住二" in z or "第二種住宅" in z: pts+=9
    elif "住一" in z or "第一種住宅" in z: pts+=6
    else: pts+=4

    if land_lot: pts+=5; reasons.append("已有地段號，可銜接分區、地籍與謄本工作流")
    if any(k in structure.upper() for k in ["RC","鋼筋混凝土"]): pts+=2

    score=min(100,round(pts))
    license_no=pick(r,"執照號碼")
    rid=hashlib.sha1((license_no+"|"+address+"|"+land_lot).encode("utf-8")).hexdigest()[:12]
    return {
        "id":rid,"score":score,"address":address,"district":district_of(address),
        "license_no":license_no,"land_lot":land_lot,"zone":zone,"structure":structure,
        "completion_year":completed or None,"age":age or None,"floors":floors or None,
        "households":households or None,"site_area_sqm":round(site,2) if site else None,
        "building_area_sqm":round(bldg,2) if bldg else None,
        "ownership_verified":False,"ownership_status":"待第二類謄本確認",
        "reasons":reasons[:5],
    }

def build():
    now=datetime.now(timezone.utc)
    blob=fetch(USE_PERMIT_URL)
    rows=parse_records(blob)
    if not rows:
        raise RuntimeError("No use-permit records parsed; source XML schema may have changed.")
    cand=[]
    for r in rows:
        x=score_row(r,now.year)
        if x and (x["age"] or 0)>=30:
            cand.append(x)
    # Remove repeated addresses/licenses and prefer stronger record.
    best={}
    for x in cand:
        key=x["address"] or x["license_no"] or x["id"]
        if key not in best or x["score"]>best[key]["score"]:best[key]=x
    cand=sorted(best.values(),key=lambda x:(x["score"],x.get("site_area_sqm") or 0),reverse=True)[:500]
    data={
      "meta":{
        "mode":"live","generated_at":now.isoformat(),"source_records":len(rows),
        "candidate_count":len(cand),
        "source":"臺北市歷年使用執照摘要",
        "source_url":"https://data.taipei/dataset/detail?id=c876ff02-af2e-4eb8-bd33-d444f5052733",
        "method":"Stage 1 ranking from age/floors/households/site-area/use-zone/parcel-reference. Ownership is not inferred."
      },
      "candidates":cand
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Wrote {len(cand)} candidates from {len(rows)} records -> {OUT}")

if __name__=="__main__":
    try: build()
    except Exception as e:
        print(f"urban-renewal build failed: {e}",file=sys.stderr)
        # Keep previously generated data if present; fail so Actions makes the problem visible.
        raise
