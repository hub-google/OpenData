#!/usr/bin/env python3
from __future__ import annotations
import csv, io, json, math, random, re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
SOURCE_PAGE="https://data.taipei/dataset/detail?id=e434a75a-5692-4a41-bb29-edb97d7f624e"
DOWNLOAD_URL="https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=e96325f8-7c25-4369-9ee2-04a0ad9fb551"
UA="OpenData-UrbanRenewalRadar/1.0 (+https://github.com/hub-google/OpenData)"

EXPECTED=[
"行政區","段小段","地號","標示部面積","所有權登記次序","所有權持分類別",
"所有權持分分母","所有權持分分子","公告地價","申報地價","核定申報地價情形"
]

def fetch(url:str)->bytes:
    req=Request(url,headers={"User-Agent":UA,"Accept":"text/csv,*/*"})
    with urlopen(req,timeout=60) as r:
        return r.read()

def decode(blob:bytes)->str:
    for enc in ("utf-8-sig","utf-8","cp950","big5"):
        try:return blob.decode(enc)
        except UnicodeDecodeError:pass
    return blob.decode("utf-8",errors="replace")

def clean(s):
    return re.sub(r"\s+","",str(s or "").replace("\ufeff",""))

def nval(s):
    t=clean(s).replace(",","")
    if not t:return None
    try:return float(t)
    except:return None

def display_land_no(raw):
    s=re.sub(r"\D","",str(raw or ""))
    if len(s)>=8:
        m=int(s[:4]); sub=int(s[4:8])
        return str(m) if sub==0 else f"{m}-{sub}"
    return str(raw or "").strip()

def complexity(p):
    count=p["observed_owner_records"]
    mx=p["max_share"]
    top3=p["top3_share"]
    hhi=p["share_hhi"]
    score=0.0; reasons=[]
    if count>=15:score+=35;reasons.append(f"公開資料觀察到 {count} 筆所有權登記，筆數很多")
    elif count>=8:score+=27;reasons.append(f"公開資料觀察到 {count} 筆所有權登記")
    elif count>=4:score+=18;reasons.append(f"公開資料觀察到 {count} 筆所有權登記")
    elif count>=2:score+=9
    if mx is not None:
        if mx<.15:score+=25;reasons.append(f"最大觀察持分僅 {mx:.1%}")
        elif mx<.30:score+=18
        elif mx<.50:score+=10
        elif mx>=.75:score-=8;reasons.append(f"存在高集中持分 {mx:.1%}")
    if top3 is not None:
        if top3<.50:score+=20;reasons.append(f"前三大觀察持分合計僅 {top3:.1%}")
        elif top3<.75:score+=12
        elif top3>=.90:score-=5
    if hhi is not None:
        if hhi<.10:score+=15;reasons.append(f"觀察持分 HHI {hhi:.3f}，分散度高")
        elif hhi<.20:score+=10
        elif hhi<.35:score+=5
    if p["has_common_ownership"]:
        score+=15;reasons.append("出現公同共有(B)紀錄，整合可能更複雜")
    score=max(0,min(100,round(score)))
    level="低" if score<30 else "中" if score<55 else "高" if score<75 else "很高"
    return score,level,reasons

def main():
    blob=fetch(DOWNLOAD_URL)
    text=decode(blob)
    reader=csv.DictReader(io.StringIO(text))
    headers=[clean(x) for x in (reader.fieldnames or [])]
    rows=[]
    # DictReader keeps original keys; remap after cleaning.
    for raw in reader:
        r={clean(k):str(v or "").strip() for k,v in raw.items()}
        rows.append(r)
    missing=[h for h in EXPECTED if not any(h in k for k in headers)]
    # tolerate unit suffixes on price/area headers, but not core owner/share keys
    core_missing=[h for h in ["行政區","段小段","地號","所有權登記次序","所有權持分分母","所有權持分分子"] if h not in headers]
    if core_missing:
        raise RuntimeError(f"Core columns missing: {core_missing}; headers={headers}")

    groups=defaultdict(list)
    for r in rows:
        district=r.get("行政區","").strip()
        section=r.get("段小段","").strip()
        land_raw=r.get("地號","").strip()
        if not (district and section and land_raw):continue
        groups[(district,section,land_raw)].append(r)

    parcels=[]
    for (district,section,land_raw),gr in groups.items():
        owner_seq=sorted({r.get("所有權登記次序","").strip() for r in gr if r.get("所有權登記次序","").strip()})
        shares=[]
        invalid_share=False
        owner_rows=[]
        for r in gr:
            den=nval(r.get("所有權持分分母"))
            num=nval(r.get("所有權持分分子"))
            share=(num/den) if den not in (None,0) and num is not None else None
            if share is None:invalid_share=True
            else:shares.append(share)
            owner_rows.append({
                "registration_seq":r.get("所有權登記次序") or None,
                "share_type":r.get("所有權持分類別") or None,
                "share_numerator":num,
                "share_denominator":den,
                "share":round(share,8) if share is not None else None,
            })
        shares_sorted=sorted(shares,reverse=True)
        share_sum=sum(shares_sorted) if shares_sorted else None
        max_share=shares_sorted[0] if shares_sorted else None
        top2=sum(shares_sorted[:2]) if shares_sorted else None
        top3=sum(shares_sorted[:3]) if shares_sorted else None
        hhi=sum(x*x for x in shares_sorted) if shares_sorted else None
        normalized_hhi=(sum((x/share_sum)**2 for x in shares_sorted) if share_sum and share_sum>0 else None)
        area=None
        for r in gr:
            for k,v in r.items():
                if k.startswith("標示部面積"):
                    area=nval(v)
                    if area is not None:break
            if area is not None:break
        ann_price=decl_price=None
        status=[]
        for r in gr:
            for k,v in r.items():
                if k.startswith("公告地價"): ann_price=ann_price if ann_price is not None else nval(v)
                elif k.startswith("申報地價"): decl_price=decl_price if decl_price is not None else nval(v)
                elif k=="核定申報地價情形" and v: status.append(v)
        p={
            "parcel_id":"|".join([district,section,land_raw]),
            "county":"臺北市","district":district,"section":section,"subsection":None,
            "land_no":display_land_no(land_raw),"land_no_raw":land_raw,
            "land_area":area,
            "announced_land_price":ann_price,
            "declared_land_price":decl_price,
            "observed_owner_records":len(owner_seq) if owner_seq else len(gr),
            "observed_owner_rows":len(gr),
            "max_share":round(max_share,8) if max_share is not None else None,
            "top2_share":round(top2,8) if top2 is not None else None,
            "top3_share":round(top3,8) if top3 is not None else None,
            "observed_share_sum":round(share_sum,8) if share_sum is not None else None,
            "share_hhi":round(hhi,8) if hhi is not None else None,
            "share_hhi_normalized_observed":round(normalized_hhi,8) if normalized_hhi is not None else None,
            "has_common_ownership":any((r.get("所有權持分類別") or "").strip()=="B" for r in gr),
            "ownership_data_completeness":"unknown" if invalid_share or not shares else "partial",
            "ownership_completeness_note":"申報地價資料無法證明已涵蓋該地號目前全部所有權登記；即使觀察持分合計為100%，仍不標示confirmed。",
            "observed_shares_sum_to_one": bool(share_sum is not None and abs(share_sum-1.0)<1e-6),
            "declared_price_status":sorted(set(status)),
            "owner_records":owner_rows,
        }
        s,l,rs=complexity(p)
        p["ownership_complexity_score"]=s
        p["integration_difficulty"]=l
        p["complexity_reasons"]=rs
        parcels.append(p)

    parcels.sort(key=lambda x:(x["observed_owner_records"],x["ownership_complexity_score"]),reverse=True)
    multi=[p for p in parcels if p["observed_owner_records"]>=2 and p["max_share"] is not None]
    rng=random.Random(20260929)
    samples=rng.sample(multi,min(12,len(multi))) if multi else []

    DATA.mkdir(parents=True,exist_ok=True)
    meta={
        "generated_at":datetime.now(timezone.utc).isoformat(),
        "source_page":SOURCE_PAGE,"download_url":DOWNLOAD_URL,
        "raw_bytes":len(blob),"raw_rows":len(rows),"parcel_count":len(parcels),
        "multi_owner_observed_parcels":len(multi),
        "headers":headers,
        "core_missing_columns":core_missing,
        "completeness_policy":"This dataset is an observed subset of declared-land-price records. observed_owner_records is never labelled as true total owners. ownership_data_completeness is partial or unknown, never confirmed from this source alone."
    }
    (DATA/"parcel_ownership.json").write_text(json.dumps({"meta":meta,"parcels":parcels},ensure_ascii=False,indent=2),encoding="utf-8")
    (DATA/"ownership_validation.json").write_text(json.dumps({"meta":meta,"samples":samples},ensure_ascii=False,indent=2),encoding="utf-8")
    # compact CSV for the database layer
    cols=["parcel_id","county","district","section","subsection","land_no","land_no_raw","land_area","announced_land_price","declared_land_price","observed_owner_records","max_share","top2_share","top3_share","observed_share_sum","share_hhi","share_hhi_normalized_observed","has_common_ownership","ownership_complexity_score","integration_difficulty","ownership_data_completeness"]
    with (DATA/"parcel_ownership.csv").open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
        for p in parcels:w.writerow({k:p.get(k) for k in cols})
    print(json.dumps({"rows":len(rows),"parcels":len(parcels),"multi":len(multi),"samples":len(samples),"headers":headers},ensure_ascii=False))

if __name__=="__main__":main()
