#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audit Taiwan 22-jurisdiction parking sources without TDX.
Generates 停車/全台縣市停車API盤點.md.
Fees remain raw source text; no semantic price parsing.
"""
from __future__ import annotations
import csv, io, json, math, re, urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("停車/全台縣市停車API盤點.md")
UA = "OpenData-Parking-Audit/1.0 (+https://github.com/hub-google/OpenData)"
DATA_GOV_META = "https://data.gov.tw/api/v2/rest/dataset/{}"

UNIFIED_FIELDS = [
    ("parking_id","停車場唯一識別碼","只用來源既有 ID；來源無 ID 時不自行用名稱雜湊"),
    ("name","停車場名稱","直接欄位"),
    ("city","縣市","本資料源固定值"),
    ("district","行政區","直接欄位；來源沒有就空白"),
    ("address","地址","直接欄位；不做地址推論"),
    ("lat","WGS84 緯度","直接 WGS84；TWD97 僅做標準座標轉換"),
    ("lng","WGS84 經度","直接 WGS84；TWD97 僅做標準座標轉換"),
    ("total_car","汽車總格數","來源明確的小型車/汽車總格"),
    ("available_car","汽車即時剩餘格","只接受來源明確剩餘數值；燈號/狀態不換算"),
    ("fee_text","一般費率原文","原文 passthrough，不解析成每小時價格"),
    ("fee_weekday_text","平日費率原文","有獨立欄位才填"),
    ("fee_holiday_text","假日費率原文","有獨立欄位才填"),
    ("fee_monthly_text","月租費原文","有獨立欄位才填"),
    ("fee_other_text","其他費率原文","有獨立欄位才填"),
    ("service_time","營業/收費時間","直接欄位"),
    ("data_time","資料更新時間","來源欄位，不用抓取時間冒充"),
    ("source_name","資料來源","官方來源名稱"),
    ("source_url","實際抓取網址","本次試抓網址"),
    ("realtime","是否有數值型即時剩餘格","只有 available_car 可直接取得才為 true"),
]

def req_bytes(url, timeout=15):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json,text/csv,text/plain,*/*","Origin":"https://hub-google.github.io"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.read(),{"http_status":getattr(r,"status",None),"content_type":r.headers.get("Content-Type",""),"cors":r.headers.get("Access-Control-Allow-Origin",""),"final_url":r.geturl()}

def decode_text(raw):
    for enc in ("utf-8-sig","utf-8","cp950","big5"):
        try:return raw.decode(enc)
        except Exception:pass
    return raw.decode("utf-8","replace")

def extract_rows_json(obj):
    if isinstance(obj,list):return obj
    if not isinstance(obj,dict):return []
    for k in ("data","result","records","items","parkingLots","ParkingLots"):
        v=obj.get(k)
        if isinstance(v,list):return v
        if isinstance(v,dict):
            for k2 in ("park","records","items","data"):
                vv=v.get(k2)
                if isinstance(vv,list):return vv
    return []

def parse_payload(raw, content_type=""):
    txt=decode_text(raw).lstrip()
    if "json" in content_type.lower() or txt.startswith("[") or txt.startswith("{"):
        try:
            obj=json.loads(txt)
            rows=extract_rows_json(obj)
            if rows:return rows,"JSON"
            if isinstance(obj,dict):return [obj],"JSON-object"
        except Exception:pass
    try:
        dialect=csv.Sniffer().sniff(txt[:4096],delimiters=",;\t")
        rows=[dict(r) for r in csv.DictReader(io.StringIO(txt),dialect=dialect)]
        if rows:return rows,"CSV"
    except Exception:pass
    return [],"unparsed"

def fetch_rows_url(url):
    raw,meta=req_bytes(url)
    rows,fmt=parse_payload(raw,meta["content_type"])
    return rows,{**meta,"format":fmt,"bytes":len(raw)}

def iter_dicts(x):
    if isinstance(x,dict):
        yield x
        for v in x.values():yield from iter_dicts(v)
    elif isinstance(x,list):
        for v in x:yield from iter_dicts(v)

def data_gov_resources(dataset_id):
    raw,meta=req_bytes(DATA_GOV_META.format(dataset_id))
    obj=json.loads(decode_text(raw))
    title=str(obj.get("title") or obj.get("datasetTitle") or "") if isinstance(obj,dict) else ""
    found=[]
    for d in iter_dicts(obj):
        url=d.get("resourceDownloadUrl") or d.get("resourceDownloadURL") or d.get("resourceURL")
        if isinstance(url,str) and url.startswith("http"):
            found.append({"url":url,"format":str(d.get("resourceFormat") or d.get("format") or "").upper()})
    out=[];seen=set()
    for x in found:
        if x["url"] not in seen:
            seen.add(x["url"]);out.append(x)
    return title,out,meta

def choose_resource(resources):
    xs=[x for x in resources if "tdx.transportdata.tw" not in x["url"].lower()]
    def score(x):
        f=x["format"];u=x["url"].lower()
        if "JSON" in f or u.endswith(".json") or "json" in u:return 0
        if "CSV" in f or u.endswith(".csv") or "csv" in u:return 1
        if "XML" in f or u.endswith(".xml"):return 5
        if "XLS" in f or u.endswith(".xls") or u.endswith(".xlsx"):return 8
        return 3
    return sorted(xs,key=score)[0] if xs else None

def fetch_data_gov(dataset_id):
    title,resources,_=data_gov_resources(dataset_id)
    chosen=choose_resource(resources)
    if not chosen:raise RuntimeError(f"data.gov.tw dataset {dataset_id} has no non-TDX JSON/CSV resource")
    rows,meta=fetch_rows_url(chosen["url"])
    return rows,{**meta,"dataset_id":dataset_id,"dataset_title":title,"resource_url":chosen["url"],"all_resources":resources}

def sval(v):
    if v is None:return ""
    if isinstance(v,(dict,list)):return json.dumps(v,ensure_ascii=False,separators=(",",":"))
    return str(v).strip()

def num(v):
    if v is None or v=="":return None
    if isinstance(v,(int,float)) and math.isfinite(float(v)):return float(v)
    m=re.search(r"-?\d+(?:\.\d+)?",str(v).replace(",",""))
    return float(m.group()) if m else None

def clean_num(v):
    x=num(v)
    if x is None:return ""
    return int(x) if x.is_integer() else x

def first(row,*keys):
    for k in keys:
        if isinstance(row,dict) and k in row and row[k] not in (None,""):return row[k]
    return ""

def parse_coord_pair(v):
    nums=[float(x) for x in re.findall(r"[-+]?\d+(?:\.\d+)?",sval(v))]
    for i in range(len(nums)-1):
        a,b=nums[i],nums[i+1]
        if 20<=a<=27 and 118<=b<=123:return (a,b)
        if 118<=a<=123 and 20<=b<=27:return (b,a)
    return ("","")

def twd97_to_wgs84(x,y):
    x,y=num(x),num(y)
    if x is None or y is None:return ("","")
    a=6378137.0;b=6356752.314245;lng0=math.radians(121);k0=0.9999;dx=250000
    x-=dx;e=math.sqrt(1-(b*b)/(a*a));M=y/k0
    mu=M/(a*(1-e*e/4-3*e**4/64-5*e**6/256));e1=(1-math.sqrt(1-e*e))/(1+math.sqrt(1-e*e))
    J1=3*e1/2-27*e1**3/32;J2=21*e1**2/16-55*e1**4/32;J3=151*e1**3/96;J4=1097*e1**4/512
    fp=mu+J1*math.sin(2*mu)+J2*math.sin(4*mu)+J3*math.sin(6*mu)+J4*math.sin(8*mu)
    e2=e*e/(1-e*e);C1=e2*math.cos(fp)**2;T1=math.tan(fp)**2
    R1=a*(1-e*e)/(1-e*e*math.sin(fp)**2)**1.5;N1=a/math.sqrt(1-e*e*math.sin(fp)**2);D=x/(N1*k0)
    lat=fp-(N1*math.tan(fp)/R1)*(D**2/2-(5+3*T1+10*C1-4*C1*C1-9*e2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*e2-3*C1*C1)*D**6/720)
    lng=lng0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*e2+24*T1*T1)*D**5/120)/math.cos(fp)
    lat,lng=math.degrees(lat),math.degrees(lng)
    return (round(lat,6),round(lng,6)) if 20<=lat<=27 and 118<=lng<=123 else ("","")

def exact_map(row,cfg,city,source_name,source_url,realtime=False):
    mp=cfg.get("map",{})
    o={k:"" for k,_d,_r in UNIFIED_FIELDS}
    o.update({"city":city,"source_name":source_name,"source_url":source_url,"realtime":bool(realtime)})
    for dst,src in mp.items():
        if isinstance(src,list):o[dst]=first(row,*src)
        elif src:o[dst]=row.get(src,"") if isinstance(row,dict) else ""
    strategy=cfg.get("coord_strategy","")
    if strategy=="twd97":
        o["lat"],o["lng"]=twd97_to_wgs84(first(row,"TW97X","tw97x","Tw97X"),first(row,"TW97Y","tw97y","Tw97Y"))
    elif strategy=="pair":
        o["lat"],o["lng"]=parse_coord_pair(first(row,*cfg.get("coord_fields",["lnglat","經緯度","座標位置"])))
    elif strategy=="taipei_entrance":
        info=row.get("EntranceCoord") if isinstance(row,dict) else None
        arr=info.get("EntrancecoordInfo") if isinstance(info,dict) else None
        if isinstance(arr,list) and arr:
            o["lat"],o["lng"]=parse_coord_pair(f"{arr[0].get('Xcod','')},{arr[0].get('Ycod','')}")
        if o["lat"]=="":
            o["lat"],o["lng"]=twd97_to_wgs84(first(row,"tw97x","TW97X"),first(row,"tw97y","TW97Y"))
    for k in ("total_car","available_car"):
        if o[k] not in ("",None):o[k]=clean_num(o[k])
    if isinstance(o["available_car"],(int,float)) and o["available_car"]<0:o["available_car"]=""
    return o

def merge_by_id(basic_rows,live_rows,basic_cfg,live_cfg,city,source_name,basic_url,live_url):
    live={sval(r.get(live_cfg["join_key"])):r for r in live_rows if isinstance(r,dict) and sval(r.get(live_cfg["join_key"]))}
    out=[]
    for b in basic_rows:
        if not isinstance(b,dict):continue
        o=exact_map(b,basic_cfg,city,source_name,basic_url,True)
        rt=live.get(sval(b.get(basic_cfg["join_key"])))
        if rt:
            for dst,src in live_cfg.get("map",{}).items():
                v=rt.get(src,"")
                if dst=="available_car":
                    x=clean_num(v);o[dst]="" if isinstance(x,(int,float)) and x<0 else x
                else:o[dst]=v
            o["source_url"]=basic_url+" + "+live_url
        else:o["realtime"]=False
        out.append(o)
    return out

def observed_fields(rows):
    keys=[];seen=set()
    for r in rows[:100]:
        if isinstance(r,dict):
            for k in r:
                if k not in seen:seen.add(k);keys.append(str(k))
    return keys

def fnum(x):
    try:return float(x)
    except Exception:return None

def dispersed_sample(rows,n=20):
    rows=[r for r in rows if isinstance(r,dict)]
    if len(rows)<=n:return rows
    pts=[]
    for i,r in enumerate(rows):
        lat,lng=fnum(r.get("lat")),fnum(r.get("lng"))
        if lat is not None and lng is not None and 20<=lat<=27 and 118<=lng<=123:pts.append((i,lat,lng))
    if len(pts)>=min(n,5):
        pts=sorted(pts,key=lambda x:(x[1],x[2]));sel=[pts[0]];remain=pts[1:]
        while remain and len(sel)<n:
            best=max(remain,key=lambda p:min((p[1]-s[1])**2+(p[2]-s[2])**2 for s in sel))
            sel.append(best);remain.remove(best)
        return [rows[x[0]] for x in sel]
    groups={}
    for r in rows:groups.setdefault(sval(r.get("district")) or "(未提供行政區)",[]).append(r)
    if len(groups)>1:
        out=[];pos={k:0 for k in groups};names=sorted(groups)
        while len(out)<n:
            added=False
            for k in names:
                i=pos[k]
                if i<len(groups[k]):
                    out.append(groups[k][i]);pos[k]+=1;added=True
                    if len(out)>=n:break
            if not added:break
        return out
    idxs=[round(i*(len(rows)-1)/(n-1)) for i in range(n)]
    return [rows[i] for i in idxs]

def md(v):
    s=sval(v).replace("|","\\|").replace("\n","<br>")
    return s if s else "—"

SOURCES = [
{"city":"臺北市","grade":"A","kind":"官方 API 直連 + ID 精確 join","source_name":"臺北市政府停車管理工程處","urls":["https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json","https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json"],"note":"費率 payex 原文直出；座標優先 EntranceCoord 既有座標，缺值才做 TWD97→WGS84 固定數學轉換。","mode":"pair","basic":{"join_key":"id","coord_strategy":"taipei_entrance","map":{"parking_id":"id","name":"name","district":"area","address":"address","total_car":"totalcar","fee_text":"payex"}},"live":{"join_key":"id","map":{"available_car":"availablecar","data_time":"updatetime"}}},
{"city":"新北市","grade":"A*","kind":"官方 API 直連 + ID 精確 join（端點穩定性待修）","source_name":"新北市政府","urls":["https://data.ntpc.gov.tw/api/datasets/b1464ef0-9c7c-4a6f-abf7-6bdf32847e68/json","https://data.ntpc.gov.tw/api/datasets/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json"],"note":"AVAILABLECAR < 0 視為未知。座標若只有 TW97，只做固定數學轉換。","mode":"pair_paged","basic":{"join_key":"ID","coord_strategy":"twd97","map":{"parking_id":"ID","name":"NAME","district":"AREA","address":"ADDRESS","total_car":"TOTALCAR","fee_text":"PAYEX"}},"live":{"join_key":"ID","map":{"available_car":"AVAILABLECAR","data_time":"UPDATETIME"}}},
{"city":"桃園市","grade":"A","kind":"單一官方 JSON API","source_name":"桃園市政府","urls":["https://opendata.tycg.gov.tw/api/dataset/f4cc0b12-86ac-40f9-8745-885bddc18f79/resource/0381e141-f7ee-450e-99da-2240208d1773/download"],"note":"欄位幾乎 1:1 對應，不解析 payGuide。","mode":"direct","map":{"parking_id":"parkId","name":"parkName","district":"areaName","address":"address","lat":"wgsX","lng":"wgsY","total_car":"totalSpace","available_car":"surplusSpace","fee_text":"payGuide","data_time":"updateTime"}},
{"city":"臺中市","grade":"B","kind":"官方 JSON API（沒有確切剩餘格）","source_name":"臺中市政府交通局","urls":["https://motoretag.taichung.gov.tw/DataAPI/api/ParkingAPIV2/Opendata"],"dataset_ids":[116052,84195,158166],"note":"路外 API 只有 AvailableCarRGB 狀態/燈號，沒有 numeric available_car；收費資料是另一份且沒有可靠共同 ID，不做名稱模糊 join。","mode":"direct","map":{"parking_id":"ID","name":"Position","lat":"Lat","lng":"Lng","total_car":"TotalCar"}},
{"city":"臺南市","grade":"A（覆蓋有限）","kind":"官方即時 JSON","source_name":"臺南市政府交通局","urls":["https://parkweb.tainan.gov.tw/api/parking.php"],"dataset_ids":[102772,102773],"note":"官方即時資料主要為少數場站；若實際回傳不足 20 筆就如實顯示，不拿靜態資料冒充即時。","mode":"direct","coord_strategy":"pair","coord_fields":["lnglat"],"map":{"parking_id":"id","name":"name","district":"zone","address":"address","total_car":"car_total","available_car":"car","fee_text":"chargeFee","service_time":"chargeTime","data_time":"update_time"}},
{"city":"高雄市","grade":"B","kind":"官方靜態 Open Data；官方稱有即時 API 但公開 endpoint/文件未找到","source_name":"高雄市政府交通局","dataset_ids":[46944],"urls":["https://data.gov.tw/dataset/46944"],"note":"不抓 kpp 網頁 HTML、不逆向私有 API。現有靜態資料可直取名稱/位置/座標/費率/小車總格。","mode":"datagov","map":{"name":"場名","district":"行政區","address":"位置","lat":"緯度","lng":"經度","total_car":"小車","fee_text":"收費標準"}},
{"city":"基隆市","grade":"B","kind":"官方 CSV/ODS 靜態資料","source_name":"基隆市政府交通處","dataset_ids":[45757],"urls":["https://www.klcg.gov.tw/tw/tourism/2644-293255.html"],"note":"只有停車場名稱、車格位、地址、聯絡電話；沒有價格、座標、即時剩餘格。","mode":"datagov","map":{"name":"停車場名稱","address":"地址","total_car":"車格位"}},
{"city":"新竹市","grade":"A","kind":"單一官方動態 API","source_name":"新竹市政府","urls":["https://hispark.hccg.gov.tw/OpenData/GetParkInfo"],"dataset_ids":[129136],"note":"WEEKDAYS/HOLIDAY 保留兩個 raw 欄位，不自行解析。","mode":"direct","map":{"parking_id":"PARKNO","name":"PARKINGNAME","address":"ADDRESS","lat":"LATITUDE","lng":"LONGITUDE","total_car":"TOTALQUANTITY","available_car":"FREEQUANTITY","fee_weekday_text":"WEEKDAYS","fee_holiday_text":"HOLIDAY","service_time":"BUSINESSHOURS","data_time":"UPDATETIME"}},
{"city":"嘉義市","grade":"B","kind":"官方靜態資料","source_name":"嘉義市政府","dataset_ids":[52317,127381],"urls":["https://data.chiayi.gov.tw"],"note":"路外資料有名稱、收費、月租、小型車格、座標、地址，但沒有 available_car。","mode":"datagov","map":{"parking_id":"項次","name":"停車場名稱","address":"地址","total_car":"小型車","fee_text":"收費方式","fee_monthly_text":"月租費用"},"coord_strategy":"pair","coord_fields":["座標位置"]},
{"city":"新竹縣","grade":"B","kind":"官方 Open Data 靜態 JSON/CSV","source_name":"新竹縣政府交通旅遊處","urls":["https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=271"],"note":"官方欄位沒有座標及 numeric available_car；不適合正式附近即時功能。","mode":"no_direct","declared_fields":["編號","證號","公司名稱","電話","分機","停車場名稱","行政區","停車場地址-地號","型式","停車格數量","收費方式","備註"],"map":{"parking_id":"編號","name":"停車場名稱","district":"行政區","address":"停車場地址-地號","total_car":"停車格數量","fee_text":"收費方式"}},
{"city":"苗栗縣","grade":"C","kind":"未找到符合需求的縣府免費公開停車結構化 API","source_name":"苗栗縣政府","urls":["https://data.gov.tw/"],"note":"本輪官方資料目錄搜尋未找到可直接提供核心欄位的苗栗縣來源；不以一般網頁或第三方資料補。","mode":"none","map":{}},
{"city":"彰化縣","grade":"B","kind":"官方靜態停車場登記資料","source_name":"彰化縣政府","dataset_ids":[29243],"urls":["https://data.gov.tw/dataset/29243"],"note":"具名稱、地點、各車種格數與計時/月租等欄位，但沒有 WGS84 座標及即時剩餘格。","mode":"datagov","map":{"parking_id":"登記證號碼","name":"停車場名稱","district":"鄉鎮市","address":"停車場地點","total_car":"小車停車格數量","fee_text":"計時","fee_monthly_text":"月租"}},
{"city":"南投縣","grade":"C","kind":"未找到符合需求的縣府免費公開停車結構化 API","source_name":"南投縣政府","urls":["https://data.gov.tw/"],"note":"本輪官方資料目錄未找到可直接支援核心欄位的來源；不抓一般網頁。","mode":"none","map":{}},
{"city":"雲林縣","grade":"B","kind":"官方 JSON/CSV 靜態資料","source_name":"雲林縣政府","dataset_ids":[160687],"urls":["https://data.gov.tw/dataset/160687"],"note":"欄位結構化，但沒有 numeric available_car；費率保留計次/月票/其它三欄。","mode":"datagov","map":{"name":"停車場名稱","district":"鄉鎮","address":"地址或地號","lng":"座標東經","total_car":"小型車位數","fee_text":"計次費率","fee_monthly_text":"月票費率","fee_other_text":"其它費率","service_time":"開放時間"}},
{"city":"嘉義縣","grade":"B","kind":"官方靜態資料","source_name":"嘉義縣政府","dataset_ids":[134172],"urls":["https://data.gov.tw/dataset/134172"],"note":"具鄉鎮、名稱、車格數、收費狀況；缺座標與 available_car。","mode":"datagov","map":{"name":"停車場名稱","district":"鄉鎮市","total_car":"小客車(席)","fee_text":"收費狀況"}},
{"city":"屏東縣","grade":"B","kind":"官方靜態資料","source_name":"屏東縣政府","dataset_ids":[163066,138733,163131],"urls":["https://data.gov.tw/dataset/163066","https://data.gov.tw/dataset/138733"],"note":"163066 有名稱/地址/費率/汽車總格但無座標；138733 有座標但沒有經驗證共同 ID，因此不做名稱模糊 join。","mode":"datagov","map":{"parking_id":"項次","name":"停車場名稱","address":"停車場地址","total_car":"停車格總數（含專用車位）-汽車","fee_text":"收費標準"}},
{"city":"宜蘭縣","grade":"A*（需驗證新鮮度）","kind":"兩份官方資料以編號精確 join","source_name":"宜蘭縣政府","dataset_ids":[85833,79981],"urls":["https://data.gov.tw/dataset/85833","https://data.gov.tw/dataset/79981"],"note":"靜態資料供地址/平假日費率/經緯度；動態資料供小車總數/剩餘數/更新時間。只用相同編號 exact join。","mode":"yilan_pair","basic_dataset":85833,"live_dataset":79981,"basic":{"join_key":"編號","map":{"parking_id":"編號","name":"名稱","address":"地址","lat":"緯度","lng":"經度","total_car":"小車位總數","fee_weekday_text":"平日費率","fee_holiday_text":"假日費率"}},"live":{"join_key":"編號","map":{"available_car":"小車位剩餘數","data_time":"更新時間"}}},
{"city":"花蓮縣","grade":"C","kind":"未找到符合需求的縣府免費公開停車結構化 API","source_name":"花蓮縣政府","urls":["https://data.gov.tw/"],"note":"本輪官方資料目錄未找到可直接支援核心欄位的花蓮縣來源。","mode":"none","map":{}},
{"city":"臺東縣","grade":"C","kind":"尚未確認到符合需求的縣府免費公開停車 API","source_name":"臺東縣政府","urls":["https://data.gov.tw/"],"note":"本輪未確認到同時具名稱、座標、價格、總格、剩餘格且可穩定呼叫的縣府 API。","mode":"none","map":{}},
{"city":"澎湖縣","grade":"C（網站有即時資訊）","kind":"縣府有即時剩餘車位服務，但未找到公開 API 文件/穩定 endpoint","source_name":"澎湖縣政府","urls":["https://www.penghu.gov.tw/ch/home.jsp?id=10549","https://apparking.penghu.gov.tw/TrafficPayBill/swagger/index.html"],"note":"官方網站有地下停車場即時剩餘車位；Swagger API definition 目前讀取失敗。依規則不逆向私有請求。","mode":"none","map":{}},
{"city":"金門縣","grade":"C","kind":"未找到符合需求的縣府免費公開停車結構化 API","source_name":"金門縣政府","urls":["https://data.gov.tw/"],"note":"本輪官方資料目錄未找到核心停車 API。","mode":"none","map":{}},
{"city":"連江縣","grade":"C","kind":"未找到符合需求的縣府免費公開停車結構化 API","source_name":"連江縣政府","urls":["https://data.gov.tw/"],"note":"本輪官方資料目錄未找到核心停車 API。","mode":"none","map":{}},
]

def fetch_paged(base):
    rows=[];seen=set()
    for page in range(5):
        url=f"{base}{'&' if '?' in base else '?'}page={page}&size=1000"
        part,_=fetch_rows_url(url)
        sig=json.dumps(part[:2],ensure_ascii=False,sort_keys=True,default=str) if part else ""
        if not part or sig in seen:break
        seen.add(sig);rows.extend(part)
        if len(part)<1000:break
    return rows

def audit_city(cfg):
    res={"norm_rows":[],"meta":[],"errors":[],"observed_fields":[],"resource_urls":[]}
    city=cfg["city"];mode=cfg["mode"];sn=cfg["source_name"]
    try:
        if mode=="direct":
            url=cfg["urls"][0];rows,meta=fetch_rows_url(url)
            res["observed_fields"]=observed_fields(rows);res["meta"].append(meta);res["resource_urls"].append(meta.get("final_url",url))
            res["norm_rows"]=[exact_map(r,cfg,city,sn,meta.get("final_url",url),"available_car" in cfg.get("map",{})) for r in rows if isinstance(r,dict)]
        elif mode in ("pair","pair_paged"):
            bu,lu=cfg["urls"][:2]
            if mode=="pair_paged":
                b,l=fetch_paged(bu),fetch_paged(lu);bm={"final_url":bu,"http_status":"paged","format":"JSON"};lm={"final_url":lu,"http_status":"paged","format":"JSON"}
            else:b,bm=fetch_rows_url(bu);l,lm=fetch_rows_url(lu)
            res["observed_fields"]=observed_fields(b)+["[live] "+x for x in observed_fields(l)];res["meta"]+=[bm,lm];res["resource_urls"]+=[bu,lu]
            res["norm_rows"]=merge_by_id(b,l,cfg["basic"],cfg["live"],city,sn,bu,lu)
        elif mode=="datagov":
            rows,meta=fetch_data_gov(cfg["dataset_ids"][0])
            res["observed_fields"]=observed_fields(rows);res["meta"].append(meta);res["resource_urls"].append(meta.get("resource_url",""))
            res["norm_rows"]=[exact_map(r,cfg,city,sn,meta.get("resource_url",""),False) for r in rows if isinstance(r,dict)]
        elif mode=="yilan_pair":
            b,bm=fetch_data_gov(cfg["basic_dataset"]);l,lm=fetch_data_gov(cfg["live_dataset"])
            res["observed_fields"]=observed_fields(b)+["[live] "+x for x in observed_fields(l)];res["meta"]+=[bm,lm];res["resource_urls"]+=[bm.get("resource_url",""),lm.get("resource_url","")]
            res["norm_rows"]=merge_by_id(b,l,cfg["basic"],cfg["live"],city,sn,bm.get("resource_url",""),lm.get("resource_url",""))
        elif mode=="no_direct":
            res["observed_fields"]=cfg.get("declared_fields",[])
    except Exception as e:res["errors"].append(f"{type(e).__name__}: {e}")
    return res

def mapping_lines(cfg):
    mp={}
    if cfg["mode"] in ("pair","pair_paged","yilan_pair"):
        mp.update(cfg.get("basic",{}).get("map",{}));mp.update(cfg.get("live",{}).get("map",{}))
    else:mp.update(cfg.get("map",{}))
    out=[]
    for dst,_d,_r in UNIFIED_FIELDS:
        if dst=="city":src="固定值："+cfg["city"]
        elif dst=="source_name":src="固定值："+cfg["source_name"]
        elif dst=="source_url":src="實際抓取 URL"
        elif dst=="realtime":src="是否存在 numeric available_car"
        elif dst in ("lat","lng") and cfg.get("coord_strategy")=="pair":src="/".join(cfg.get("coord_fields",[]))+"（只拆座標數字）"
        elif dst in ("lat","lng") and cfg.get("basic",{}).get("coord_strategy")=="twd97":src="TW97X/TW97Y → 固定 TWD97/WGS84 數學轉換"
        elif dst in ("lat","lng") and cfg.get("basic",{}).get("coord_strategy")=="taipei_entrance":src="EntranceCoord.Xcod/Ycod；缺值才 TWD97 轉換"
        else:src=mp.get(dst,"—")
        out.append((dst,src))
    return out

def render_report(audits):
    now=datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds");L=[]
    L += ["# 全台 22 縣市免費停車資料 API／Open Data 實測盤點","",f"> 產生時間：{now}  ","> 原則：完全排除 TDX；只評估免費官方地方政府 API、官方 Open Data 下載端點與 data.gov.tw 轉載的地方政府資料。  ","> 本報告只盤點與實測資料源，沒有修改現有停車網站。  ","> 價格欄位採 raw passthrough，不把自然語言費率硬解析成每小時價格；沒有 numeric 剩餘格就不推算。",""]
    L += ["## 1. 統一格式","","| 統一欄位 | 意義 | 轉換規則 |","|---|---|---|"]
    for k,d,r in UNIFIED_FIELDS:L.append(f"| {k} | {d} | {r} |")
    L += ["","### 嚴格資料規則","","1. available_car 只接受官方明確提供的數值剩餘格；紅黃綠燈、滿/未滿、感測器狀態都不換算成格數。","2. fee_* 保留官方原文；來源分平日/假日/月租就分欄保存，不做語意解析。","3. 跨資料表只允許官方共同 ID exact join；不做停車場名稱模糊比對。","4. 地址不拿去地理編碼補座標；TWD97→WGS84 只做固定數學轉換。","5. 來源缺核心欄位就留空，不自行猜。",""]
    L += ["## 2. 22 縣市總覽","","| 縣市 | 等級 | 規劃來源 | 本次抓到 | numeric 即時格 | 結論 |","|---|---:|---|---:|---:|---|"]
    for cfg,res in audits:
        n=len(res["norm_rows"]);nrt=sum(1 for r in res["norm_rows"] if r.get("available_car") not in ("",None))
        c=cfg["note"]
        if res["errors"]:c="試抓錯誤："+("；".join(res["errors"])[:120])+"；"+c
        L.append(f"| {cfg['city']} | {cfg['grade']} | {cfg['kind']} | {n} | {nrt} | {md(c)} |")
    L += ["","## 3. 各縣市欄位對應與 20 筆分散試抓",""]
    for cfg,res in audits:
        L += [f"## {cfg['city']}","",f"- 等級：{cfg['grade']}",f"- 規劃方式：{cfg['kind']}",f"- 官方來源：{cfg['source_name']}","- 候選／實際端點："]
        for u in cfg.get("urls",[]):L.append("  - "+u)
        for u in res["resource_urls"]:
            if u and u not in cfg.get("urls",[]):L.append("  - 本次 data.gov.tw 解出的實際下載端點："+u)
        if cfg.get("dataset_ids"):L.append("- data.gov.tw dataset ID："+", ".join(map(str,cfg["dataset_ids"])))
        L.append("- 判斷："+cfg["note"])
        if res["errors"]:L.append("- 本次實抓錯誤："+"；".join(res["errors"]))
        L.append(f"- 本次解析筆數：{len(res['norm_rows'])}")
        if res["observed_fields"]:L.append("- 本次實際看到的來源欄位："+"、".join(res["observed_fields"]))
        L += ["","### 欄位 → 統一格式","","| 統一欄位 | 來源欄位／固定處理 |","|---|---|"]
        for dst,src in mapping_lines(cfg):L.append(f"| {dst} | {md(src)} |")
        samples=dispersed_sample(res["norm_rows"],20);L += ["",f"### 分散試抓：{len(samples)}/20",""]
        if not samples:
            L += ["本次沒有可列示的結構化停車資料。依本專案規則，不用第三方、網頁文字或 TDX 補齊。",""];continue
        geo=sum(1 for r in res["norm_rows"] if fnum(r.get("lat")) and fnum(r.get("lng")))
        L += ["> 取樣方法："+("座標 farthest-point 分散取樣" if geo>=5 else "行政區 round-robin／資料列等距取樣")+"。只用於驗證欄位。","",
              "| # | 名稱 | 行政區 | 地址 | 總汽車格 | 剩餘汽車格 | 費率原文 | 平日費率 | 假日費率 | 月租 | lat | lng | 更新時間 |",
              "|---:|---|---|---|---:|---:|---|---|---|---|---:|---:|---|"]
        cols=["name","district","address","total_car","available_car","fee_text","fee_weekday_text","fee_holiday_text","fee_monthly_text","lat","lng","data_time"]
        for i,r in enumerate(samples,1):L.append("| "+str(i)+" | "+" | ".join(md(r.get(c,"")) for c in cols)+" |")
        if res["meta"]:
            L += ["","<details><summary>本次 HTTP 實測</summary>",""]
            for m in res["meta"]:L.append(f"- status={m.get('http_status','—')}；format={m.get('format','—')}；content-type={m.get('content_type','—')}；CORS={m.get('cors','—')}；URL={m.get('final_url') or m.get('resource_url') or '—'}")
            L += ["","</details>",""]
    L += ["## 4. 實作結論","","- 目前優先可做 adapter：臺北、新北、桃園、新竹市、臺南；宜蘭需先看動態資料時間是否真的新鮮。","- 臺中路外 API 只有燈號狀態，不是確切剩餘格，不應換算。","- 其他只有靜態來源的縣市，可以先留資料盤點，但不能在產品上標成即時車位。","- 找不到符合條件免費官方 API 的縣市，本階段就不接；比抓網頁或猜欄位安全。","","下一步先不要改前端；應先對 A/A* 來源做 adapter + contract test，再決定正式上線範圍。",""]
    return "\n".join(L)

def main():
    audits=[]
    for cfg in SOURCES:
        print("AUDIT",cfg["city"],flush=True);res=audit_city(cfg);audits.append((cfg,res));print(" ->",len(res["norm_rows"]),"rows",res["errors"],flush=True)
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(render_report(audits),encoding="utf-8");print("WROTE",OUT,OUT.stat().st_size)

if __name__=="__main__":main()
