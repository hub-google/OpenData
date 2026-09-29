#!/usr/bin/env python3
from __future__ import annotations
import csv, gzip, io, json, re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
UA="OpenData-UrbanRenewalRadar/1.0 (+https://github.com/hub-google/OpenData)"

SOURCES={
 "land_value":{
  "page":"https://data.taipei/dataset/detail?id=7ac6eac3-a998-43ff-a289-6a4e3203c2c3",
  "url":"https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=7802c9b4-fc64-466c-82fc-ec5884bb6871",
  "needles":["行政區","段小段","地號","公告土地現值","公告地價"]},
 "zoning":{
  "page":"https://data.taipei/dataset/detail?id=a132a433-db7c-4387-8085-83e6a093b17f",
  "url":"https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=bed9a0d3-cb43-438e-825b-93810f8f2b9d",
  "needles":["行政區","大段","小段","母號","子號","分區說明"]},
 "far_bcr":{
  "page":"https://data.taipei/dataset/detail?id=d61ca24b-7b2b-4e75-8004-c568902e6300",
  "url":"https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=e2a43cdf-07c8-43db-9d37-62bb2e19654b",
  "needles":["行政區","分區","建蔽率","容積率"]},
 "public_land":{
  "page":"https://data.taipei/dataset/detail?id=ca644935-035e-4ecf-bd93-3d8df351bdb7",
  "url":"https://tpland.blob.core.windows.net/blobfs/publand.csv",
  "needles":["行政區","段小段","地號","面積","土地權屬情形","管理機關"]},
 "cadastral_cleanup":{
  "page":"https://data.gov.tw/dataset/145830",
  "url":"https://data.taipei/api/dataset/d1a8a4b8-f389-498b-a9bc-d93b64f2c2a9/resource/9f996b76-47e6-449c-9d0a-346cdc21bb42/download",
  "needles":["鄉鎮市區","段小段","地號","面積","權利範圍"]},
}

def fetch(url):
    req=Request(url,headers={"User-Agent":UA,"Accept":"text/csv,application/octet-stream,*/*"})
    with urlopen(req,timeout=180) as r:return r.read()

def decode(blob,needles):
    choices=[]
    for enc in ("utf-8-sig","utf-8","cp950","big5hkscs","big5"):
        for errors in ("strict","replace"):
            try:s=blob.decode(enc,errors=errors)
            except UnicodeDecodeError:continue
            head=s[:4000]
            score=sum(1 for x in needles if x in head)
            choices.append((score,-head.count("\ufffd"),enc,errors,s))
    choices.sort(key=lambda x:(x[0],x[1]),reverse=True)
    if not choices:return blob.decode("utf-8",errors="replace"),"unknown"
    score,_,enc,errors,s=choices[0]
    if score<2: raise RuntimeError(f"Could not identify CSV headers; best={enc}/{errors} hits={score}; head={s[:300]}")
    return s,f"{enc}/{errors}"

def clean(s):return re.sub(r"\s+","",str(s or "").replace("\ufeff",""))
def nval(s):
    t=clean(s).replace(",","").replace("%","")
    if not t:return None
    try:return float(t)
    except:return None

def rows_for(name):
    cfg=SOURCES[name];blob=fetch(cfg["url"]);text,enc=decode(blob,cfg["needles"])
    rd=csv.DictReader(io.StringIO(text))
    rows=[{clean(k):str(v or "").strip() for k,v in r.items()} for r in rd]
    print(json.dumps({"source":name,"bytes":len(blob),"rows":len(rows),"encoding":enc,"headers":[clean(x) for x in (rd.fieldnames or [])]},ensure_ascii=False))
    return rows,{"bytes":len(blob),"rows":len(rows),"encoding":enc,"page":cfg["page"],"url":cfg["url"],"headers":[clean(x) for x in (rd.fieldnames or [])]}

def raw_land_no(v):
    s=re.sub(r"\D","",str(v or ""))
    return s.zfill(8)[-8:] if s else ""

def raw_from_parts(main,sub):
    def i(v):
        s=re.sub(r"\D","",str(v or ""))
        return int(s) if s else 0
    return f"{i(main):04d}{i(sub):04d}"

def display_no(raw):
    s=raw_land_no(raw)
    if len(s)!=8:return str(raw or "")
    a,b=int(s[:4]),int(s[4:])
    return str(a) if b==0 else f"{a}-{b}"

def parcel_id(district,section,raw):
    return "|".join([clean(district),clean(section),raw_land_no(raw)])

def pick(row,prefix):
    for k,v in row.items():
        if k==prefix or k.startswith(prefix):
            if str(v).strip():return str(v).strip()
    return ""

def zone_norm(s):
    return clean(s).replace("（","(").replace("）",")")

def parse_ratio(s):
    t=clean(s)
    if not t:return None
    if "/" in t:
        try:
            a,b=t.split("/",1);return float(a)/float(b)
        except:return None
    if "%" in str(s):
        v=nval(s);return v/100 if v is not None else None
    try:
        v=float(t)
        if v>1 and v<=100:return v/100
        return v
    except:return None

def main():
    DATA.mkdir(parents=True,exist_ok=True)
    lv,lvmeta=rows_for("land_value")
    parcels={}
    for r in lv:
        district=pick(r,"行政區");section=pick(r,"段小段");raw=raw_land_no(pick(r,"地號"))
        if not(district and section and raw):continue
        pid=parcel_id(district,section,raw)
        parcels[pid]={
          "parcel_id":pid,"county":pick(r,"縣市別") or "臺北市","district":district,"section":section,"subsection":None,
          "land_no":display_no(raw),"land_no_raw":raw,"land_area":None,
          "official_land_value":nval(pick(r,"公告土地現值")),
          "announced_land_price":nval(pick(r,"公告地價")),
          "observed_owner_records":None,"max_share":None,"top2_share":None,"top3_share":None,"share_hhi":None,
          "ownership_complexity_score":None,"ownership_data_completeness":"unknown","ownership_score_confidence":"none",
          "integration_difficulty":"資料不足","land_use_zone":None,"building_coverage_ratio":None,"floor_area_ratio":None,
          "building_age":None,"building_count":None,"household_count":None,
          "urban_renewal_flag":False,"dangerous_old_building_flag":False,"unclaimed_inheritance_flag":False,"land_act_34_1_flag":False,
          "cadastral_cleanup_flag":False,"public_land_flag":False,"public_ownership_ratio":None,
          "transaction_price":None,"nearby_transaction_price":None,"development_score":None,"integration_difficulty_score":None,
          "data_flags":["land_value_master"]
        }

    # Ownership observations generated from the declared-land-price dataset.
    own_path=DATA/"parcel_ownership.json"
    if own_path.exists():
        own=json.loads(own_path.read_text(encoding="utf-8"))
        for o in own.get("parcels",[]):
            pid=o["parcel_id"]
            p=parcels.get(pid)
            if p is None:
                p={"parcel_id":pid,"county":o.get("county","臺北市"),"district":o.get("district"),"section":o.get("section"),
                   "subsection":o.get("subsection"),"land_no":o.get("land_no"),"land_no_raw":o.get("land_no_raw"),
                   "land_area":None,"official_land_value":None,"announced_land_price":None,"observed_owner_records":None,
                   "max_share":None,"top2_share":None,"top3_share":None,"share_hhi":None,"ownership_complexity_score":None,
                   "ownership_data_completeness":"unknown","ownership_score_confidence":"none","integration_difficulty":"資料不足",
                   "land_use_zone":None,"building_coverage_ratio":None,"floor_area_ratio":None,"building_age":None,"building_count":None,
                   "household_count":None,"urban_renewal_flag":False,"dangerous_old_building_flag":False,
                   "unclaimed_inheritance_flag":False,"land_act_34_1_flag":False,"cadastral_cleanup_flag":False,
                   "public_land_flag":False,"public_ownership_ratio":None,"transaction_price":None,"nearby_transaction_price":None,
                   "development_score":None,"integration_difficulty_score":None,"data_flags":[]}
                parcels[pid]=p
            for k in ["land_area","observed_owner_records","max_share","top2_share","top3_share","share_hhi",
                      "ownership_complexity_score","ownership_data_completeness","ownership_score_confidence",
                      "integration_difficulty","integration_difficulty_lower_bound","observed_share_sum","observed_share_reliability",
                      "has_common_ownership"]:
                p[k]=o.get(k)
            p["integration_difficulty_score"]=o.get("ownership_complexity_score")
            if p.get("announced_land_price") is None:p["announced_land_price"]=o.get("announced_land_price")
            p["data_flags"].append("declared_land_price_ownership_observation")

    zoning,zmeta=rows_for("zoning")
    print("DEBUG land_value_keys", [(pick(r,"行政區"),pick(r,"段小段"),pick(r,"地號")) for r in lv[:5]])
    print("DEBUG zoning_keys", [(pick(r,"行政區"),pick(r,"大段"),pick(r,"小段"),pick(r,"母號"),pick(r,"子號")) for r in zoning[:5]])
    zone_hits=0
    for r in zoning:
        district=pick(r,"行政區");section=clean(pick(r,"大段")+pick(r,"小段"))
        raw=raw_from_parts(pick(r,"母號"),pick(r,"子號"))
        pid=parcel_id(district,section,raw)
        if pid in parcels:
            parcels[pid]["land_use_zone"]=pick(r,"分區說明") or None
            parcels[pid]["data_flags"].append("parcel_zoning")
            zone_hits+=1

    far,fbmeta=rows_for("far_bcr")
    controls=defaultdict(list)
    for r in far:
        d=pick(r,"行政區");z=zone_norm(pick(r,"分區"))
        if d and z:
            controls[(clean(d),z)].append({
              "bcr":nval(pick(r,"建蔽率")),"far":nval(pick(r,"容積率上限"))
            })
    control_hits=0
    for p in parcels.values():
        if not p.get("land_use_zone"):continue
        key=(clean(p["district"]),zone_norm(p["land_use_zone"]))
        vals=controls.get(key)
        if vals:
            b=[x["bcr"] for x in vals if x["bcr"] is not None];fa=[x["far"] for x in vals if x["far"] is not None]
            p["building_coverage_ratio"]=b[0] if len(set(b))==1 and b else (max(b) if b else None)
            p["floor_area_ratio"]=fa[0] if len(set(fa))==1 and fa else (max(fa) if fa else None)
            p["data_flags"].append("zone_level_far_bcr")
            control_hits+=1

    pub,pubmeta=rows_for("public_land")
    print("DEBUG public_land_keys", [(pick(r,"行政區"),pick(r,"段小段"),pick(r,"地號")) for r in pub[:5]])
    public_hits=0
    for r in pub:
        district=pick(r,"行政區");section=pick(r,"段小段");raw=raw_land_no(pick(r,"地號"))
        pid=parcel_id(district,section,raw)
        p=parcels.get(pid)
        if not p:continue
        p["public_land_flag"]=True
        ratio_raw=pick(r,"土地權屬情形_比例")
        ratio=parse_ratio(ratio_raw)
        if ratio is not None:
            p["public_ownership_ratio"]=max(p.get("public_ownership_ratio") or 0,ratio)
        p.setdefault("public_ownership_raw",[]).append({
           "ownership_type":pick(r,"土地權屬情形"),"ratio_raw":ratio_raw or None,"agency":pick(r,"管理機關") or None
        })
        if p.get("land_area") is None:p["land_area"]=nval(pick(r,"面積"))
        p["data_flags"].append("public_land")
        public_hits+=1

    cleanup,clmeta=rows_for("cadastral_cleanup")
    cleanup_hits=0
    for r in cleanup:
        district=pick(r,"鄉鎮市區");section=pick(r,"段小段");raw=raw_land_no(pick(r,"地號"))
        pid=parcel_id(district,section,raw)
        p=parcels.get(pid)
        if not p:continue
        p["cadastral_cleanup_flag"]=True
        p.setdefault("cadastral_cleanup_rights_raw",[]).append(pick(r,"權利範圍") or None)
        if p.get("land_area") is None:p["land_area"]=nval(pick(r,"面積"))
        if not p.get("land_use_zone"):p["land_use_zone"]=pick(r,"使用分區/使用地類別") or None
        p["data_flags"].append("cadastral_cleanup")
        cleanup_hits+=1

    # Development score: deliberately simple and explainable. Missing area/building age
    # does not get guessed. This is a value-screening score, not an appraisal.
    for p in parcels.values():
        score=0;why=[]
        area=p.get("land_area")
        if area is not None:
            if area>=1000:score+=25;why.append("基地面積≥1,000㎡")
            elif area>=500:score+=18;why.append("基地面積≥500㎡")
            elif area>=250:score+=12
            elif area>=100:score+=6
        farv=p.get("floor_area_ratio")
        if farv is not None:
            if farv>=400:score+=25;why.append("分區容積率上限≥400%")
            elif farv>=300:score+=20
            elif farv>=225:score+=15
            elif farv>=160:score+=8
        if p.get("official_land_value"):
            # relative price is not scored without a citywide distribution in this MVP
            why.append("已有公告土地現值，可供後續市場價值比較")
        if p.get("cadastral_cleanup_flag"):
            why.append("地籍清理旗標：可能增加整合/法律複雜度，不作開發價值加分")
        p["development_score"]=score if (area is not None or farv is not None) else None
        p["development_reasons"]=why

    rows=list(parcels.values())
    rows.sort(key=lambda x:(x["district"] or "",x["section"] or "",x["land_no_raw"] or ""))

    cols=[
      "parcel_id","county","district","section","subsection","land_no","land_no_raw","land_area",
      "official_land_value","announced_land_price","observed_owner_records","max_share","top2_share","top3_share","share_hhi",
      "ownership_complexity_score","ownership_data_completeness","ownership_score_confidence","integration_difficulty",
      "land_use_zone","building_coverage_ratio","floor_area_ratio","building_age","building_count","household_count",
      "urban_renewal_flag","dangerous_old_building_flag","unclaimed_inheritance_flag","land_act_34_1_flag",
      "cadastral_cleanup_flag","public_land_flag","public_ownership_ratio","transaction_price","nearby_transaction_price",
      "development_score","integration_difficulty_score"
    ]
    out=io.StringIO();w=csv.DictWriter(out,fieldnames=cols,extrasaction="ignore");w.writeheader()
    for p in rows:w.writerow(p)
    with gzip.open(DATA/"parcel_master.csv.gz","wt",encoding="utf-8-sig",newline="") as f:f.write(out.getvalue())

    radar=[p for p in rows if p.get("observed_owner_records") is not None or p.get("public_land_flag") or p.get("cadastral_cleanup_flag")]
    radar.sort(key=lambda x:((x.get("development_score") or 0),(x.get("observed_owner_records") or 0)),reverse=True)
    stats={
      "generated_at":datetime.now(timezone.utc).isoformat(),"parcel_count":len(rows),"radar_count":len(radar),
      "ownership_observation_count":sum(1 for p in rows if p.get("observed_owner_records") is not None),
      "public_land_parcel_count":sum(1 for p in rows if p.get("public_land_flag")),
      "cadastral_cleanup_parcel_count":sum(1 for p in rows if p.get("cadastral_cleanup_flag")),
      "zoning_join_count":zone_hits,"far_bcr_join_count":control_hits,"public_land_join_rows":public_hits,"cleanup_join_rows":cleanup_hits,
      "sources":{"land_value":lvmeta,"zoning":zmeta,"far_bcr":fbmeta,"public_land":pubmeta,"cadastral_cleanup":clmeta},
      "field_policy":{
        "ownership":"申報地價資料只作 observed ownership，不宣稱完整地主母體。",
        "far_bcr":"由行政區＋土地使用分區連接的分區控制值，非個案最終法定可建量。",
        "urban_renewal_flag":"尚未接完整全市都更地號母表，目前維持 false，不推論。",
        "dangerous_old_building_flag":"尚未取得完整地號級免費清冊，目前維持 false，不推論。",
        "unclaimed_inheritance_flag":"官方有年度公告，但尚未取得穩定結構化全量檔，目前維持 false。",
        "land_act_34_1_flag":"尚未找到全市結構化免費母表，目前維持 false。"
      }
    }
    (DATA/"parcel_master_stats.json").write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding="utf-8")
    (DATA/"parcel_radar.json").write_text(json.dumps({"meta":stats,"parcels":radar[:10000]},ensure_ascii=False),encoding="utf-8")
    print(json.dumps(stats,ensure_ascii=False))

if __name__=="__main__":main()
