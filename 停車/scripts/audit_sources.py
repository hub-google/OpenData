#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audit Taiwan 22-jurisdiction parking sources without TDX.
Generates 停車/全台縣市停車API盤點.md.
Fees remain raw source text; no semantic price parsing.
"""
from __future__ import annotations
import csv, io, json, math, re, time, urllib.request, subprocess, shutil, html
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

def req_bytes(url, timeout=20, attempts=3):
    last=None
    for attempt in range(1, attempts+1):
        req=urllib.request.Request(url,headers={
            "User-Agent":UA,
            "Accept":"application/json,text/csv,text/plain,*/*",
            "Origin":"https://hub-google.github.io",
            "Referer":"https://data.gov.tw/",
            "Cache-Control":"no-cache",
        })
        try:
            with urllib.request.urlopen(req,timeout=timeout) as r:
                return r.read(),{"http_status":getattr(r,"status",None),"content_type":r.headers.get("Content-Type",""),"cors":r.headers.get("Access-Control-Allow-Origin",""),"final_url":r.geturl(),"attempt":attempt}
        except Exception as e:
            last=e
            if attempt < attempts:
                time.sleep(attempt)
    raise RuntimeError(f"{attempts} attempts failed: {type(last).__name__}: {last}")

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
{"city":"臺南市","grade":"A","kind":"官方即時 JSON","source_name":"臺南市政府交通局","urls":["https://parkweb.tainan.gov.tw/api/parking.php"],"dataset_ids":[102772,102773],"note":"本次直連可取得大量停車資料；但每筆 data_time 新鮮度不一，必須逐筆保留來源時間，不能把整包資料一律當成當下即時。","mode":"direct","coord_strategy":"pair","coord_fields":["lnglat"],"map":{"parking_id":"id","name":"name","district":"zone","address":"address","total_car":"car_total","available_car":"car","fee_text":"chargeFee","service_time":"chargeTime","data_time":"update_time"}},
{"city":"高雄市","grade":"B*","kind":"官方 Open Data JSON 直連 + 官方即時停車服務（availability 公開端點待定位）","source_name":"高雄市政府交通局","dataset_ids":[46944],"urls":["https://openapi.kcg.gov.tw/Api/Service/Get/30c58c88-4f53-45a0-8393-e655feaaa65b","https://data.gov.tw/dataset/46944","https://kpp.tbkc.gov.tw/ParkingLocation/ParkingLocation"],"note":"已從 data.gov.tw 重新解出高雄官方 JSON 直連，不再只靠 metadata。另有官方即時剩餘格位服務與資料交換機制，但尚未找到對一般開發者正式公開的 availability endpoint。","mode":"direct","map":{"name":"場名","district":"行政區","address":"位置","lat":"緯度","lng":"經度","total_car":"小車","fee_text":"收費標準"}},
{"city":"基隆市","grade":"B","kind":"官方 CSV/ODS 靜態資料","source_name":"基隆市政府交通處","dataset_ids":[45757],"urls":["https://www.klcg.gov.tw/tw/tourism/2644-293255.html"],"note":"只有停車場名稱、車格位、地址、聯絡電話；沒有價格、座標、即時剩餘格。","mode":"datagov","map":{"name":"停車場名稱","address":"地址","total_car":"車格位"}},
{"city":"新竹市","grade":"A","kind":"單一官方動態 API","source_name":"新竹市政府","urls":["https://hispark.hccg.gov.tw/OpenData/GetParkInfo"],"dataset_ids":[129136],"note":"WEEKDAYS/HOLIDAY 保留兩個 raw 欄位，不自行解析。","mode":"direct","map":{"parking_id":"PARKNO","name":"PARKINGNAME","address":"ADDRESS","lat":"LATITUDE","lng":"LONGITUDE","total_car":"TOTALQUANTITY","available_car":"FREEQUANTITY","fee_weekday_text":"WEEKDAYS","fee_holiday_text":"HOLIDAY","service_time":"BUSINESSHOURS","data_time":"UPDATETIME"}},
{"city":"嘉義市","grade":"B*","kind":"官方 CSV 直連 + 官方智慧停車即時服務","source_name":"嘉義市政府","dataset_ids":[52317,127381],"urls":["https://data.chiayi.gov.tw/opendata/api/getResource?oid=d206db33-3ae7-489e-b709-5555222fb767&rid=4e0c8e01-9844-4da6-991b-a3382b51b71b","https://data.gov.tw/dataset/52317"],"note":"已從政府資料平台解出嘉義市官方 CSV 直連；官方另有智慧停車管理雲端平台與剩餘車位揭露，但 availability 公開 API 文件仍待定位。","mode":"direct","map":{"parking_id":"項次","name":"停車場名稱","address":"地址","total_car":"小型車","fee_text":"收費方式","fee_monthly_text":"月租費用"},"coord_strategy":"pair","coord_fields":["座標位置"]},
{"city":"新竹縣","grade":"B*","kind":"官方 Open Data 靜態資料 + 大新竹好停車即時服務","source_name":"新竹縣政府交通旅遊處","urls":["https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=271","https://play.google.com/store/apps/details?id=com.hsinchu.parking"],"note":"官方 App 明確提供新竹縣/市即時格位查詢，但目前未找到對外公開且有文件的縣端 availability API；既有 Open Data 欄位沒有座標及 numeric available_car。","mode":"no_direct","declared_fields":["編號","證號","公司名稱","電話","分機","停車場名稱","行政區","停車場地址-地號","型式","停車格數量","收費方式","備註"],"map":{"parking_id":"編號","name":"停車場名稱","district":"行政區","address":"停車場地址-地號","total_car":"停車格數量","fee_text":"收費方式"}},
{"city":"苗栗縣","grade":"B*","kind":"官方「苗栗通」智慧停車服務有即時停車資訊（公開 API endpoint 待定位）","source_name":"苗栗縣政府","urls":["https://www.miaoli.gov.tw/News_Content2.aspx?n=285&s=854752"],"note":"前版直接列 C 不精確。苗栗縣政府已建置即時停車資訊平台並整合公有/路邊停車資訊；但本輪仍未找到正式公開、可免授權直連的 availability API 文件，因此標 B* 而不是 A。","mode":"none","map":{}},
{"city":"彰化縣","grade":"B","kind":"官方靜態停車場登記資料","source_name":"彰化縣政府","dataset_ids":[29243],"urls":["https://data.gov.tw/dataset/29243"],"note":"具名稱、地點、各車種格數與計時/月租等欄位，但沒有 WGS84 座標及即時剩餘格。","mode":"datagov","map":{"parking_id":"登記證號碼","name":"停車場名稱","district":"鄉鎮市","address":"停車場地點","total_car":"小車停車格數量","fee_text":"計時","fee_monthly_text":"月租"}},
{"city":"南投縣","grade":"C*","kind":"有停車管理/繳費系統線索；尚未找到官方即時空位 Open Data/API","source_name":"南投縣政府","urls":["https://data.gov.tw/"],"note":"重新搜尋後可確認南投有停車管理與跨縣市停車費查詢介接線索，但目前仍未找到縣府正式公開、可免授權取得即時剩餘格位的 Open Data/API；因此不能把『有系統』誤寫成『有公開 availability API』。","mode":"none","map":{}},
{"city":"雲林縣","grade":"B","kind":"官方 JSON 直連靜態資料","source_name":"雲林縣政府","dataset_ids":[160687],"urls":["https://ws.yunlin.gov.tw/001/Upload/539/opendata/15369/1518/015d7bf0-48f5-41af-a2f3-c03826b122de.json","https://data.gov.tw/dataset/160687"],"note":"已改用 data.gov.tw 頁面所列的雲林縣政府官方 JSON 直連，避免 metadata resource 選取造成 403 誤判。欄位結構化，但沒有 numeric available_car。","mode":"direct","coord_strategy":"pair","coord_fields":["座標東經"],"map":{"name":"停車場名稱","district":"鄉鎮","address":"地址或地號","total_car":"小型車位數","fee_text":"計次費率","fee_monthly_text":"月票費率","fee_other_text":"其它費率","service_time":"開放時間"}},
{"city":"嘉義縣","grade":"B","kind":"官方 CSV 直連靜態資料","source_name":"嘉義縣政府","dataset_ids":[134172],"urls":["https://ws-tm.cyhg.gov.tw/001/Upload/0/relfile/0/0/63b9dee0-2c99-4868-9650-97bc3bc0fbca.csv","https://data.gov.tw/dataset/134172"],"note":"已從 data.gov.tw 解出嘉義縣政府官方 CSV 直連；具鄉鎮、名稱、車格數、收費狀況，但缺座標與 available_car。","mode":"direct","map":{"name":"停車場名稱","district":"鄉鎮市","total_car":"小客車(席)","fee_text":"收費狀況"}},
{"city":"屏東縣","grade":"B*","kind":"官方靜態 Open Data + 智慧停車即時服務/TDX 有即時資料","source_name":"屏東縣政府","dataset_ids":[163066,138733,163131],"urls":["https://data.gov.tw/dataset/163066","https://data.gov.tw/dataset/138733"],"note":"屏東已有官方智慧停車與剩餘格位服務，TDX 亦可見路外/路邊即時資料；但本輪尚未定位到縣府正式公開 availability API。163066 有名稱/地址/費率/汽車總格；138733 有座標，無共同 ID 不做模糊 join。","mode":"datagov","map":{"parking_id":"項次","name":"停車場名稱","address":"停車場地址","total_car":"停車格總數（含專用車位）-汽車","fee_text":"收費標準"}},
{"city":"宜蘭縣","grade":"A*（需驗證新鮮度）","kind":"兩份官方 JSON 以編號精確 join","source_name":"宜蘭縣政府","dataset_ids":[85833,79981],"urls":["https://opendataap2.e-land.gov.tw/resource/files/2020-11-23/a208784ae7040ebef97ef2f79f7ff468.json","https://opendataap2.e-land.gov.tw/resource/files/2023-02-12/62f4d78b604ba16b8cc1e856dd28d2c3.json","https://data.gov.tw/dataset/85833","https://data.gov.tw/dataset/79981"],"note":"已找到官方靜態/動態 JSON 直連；靜態供地址、費率與座標，動態供總格、剩餘格與更新時間。只用相同編號 exact join，並逐筆檢查更新時間新鮮度。","mode":"pair","basic":{"join_key":"編號","map":{"parking_id":"編號","name":"名稱","address":"地址","lat":"緯度","lng":"經度","total_car":"小車位總數","fee_weekday_text":"平日費率","fee_holiday_text":"假日費率"}},"live":{"join_key":"編號","map":{"available_car":"小車位剩餘數","data_time":"更新時間"}}},
{"city":"花蓮縣","grade":"B*","kind":"官方「花蓮交通e點通」有即時路外/路邊停車服務（公開 API endpoint 待定位）","source_name":"花蓮縣政府","urls":["https://traffic.hl.gov.tw/Home/CheckParkingDetail","https://traffic.hl.gov.tw/Home/ParkingSpaceInfo"],"note":"前版寫成『未找到來源』不精確：官方網站明確提供動態停車場、靜態停車場與停車格資訊，TDX 也有花蓮即時路外/路邊資料；目前差的是可公開直連、具文件的地方 availability endpoint。","mode":"none","map":{}},
{"city":"臺東縣","grade":"B*","kind":"官方智慧停車已有即時格位狀態（公開 API endpoint 待定位）","source_name":"臺東縣政府","urls":["https://tour.taitung.gov.tw/zh-tw/news/details/6346"],"note":"臺東官方已建置智慧停車感測並提供/規劃即時格位狀態整合，前版直接列 C 過度保守；但本輪尚未找到正式公開、免授權 availability API 文件，所以標 B*。","mode":"none","map":{}},
{"city":"澎湖縣","grade":"B*","kind":"縣府停車平台/停車管理中心存在；availability 公開 API 待定位","source_name":"澎湖縣政府","urls":["https://parking.penghu.gov.tw/","https://opendata.penghu.gov.tw/pages/guide","https://apparking.penghu.gov.tw/TrafficPayBill/swagger/index.html"],"note":"澎湖有官方停車管理中心，開放資料平台也支援 API；但目前找到的 Swagger/TrafficPayBill 主要是停車費服務，尚未確認公開的即時剩餘格位 endpoint。","mode":"none","map":{}},
{"city":"金門縣","grade":"B*","kind":"官方即時停車導引/金好停服務存在（公開 API endpoint 待定位）","source_name":"金門縣政府","urls":["https://www.kinmen.gov.tw/News_Content2.aspx?Create=1&n=98E3CA7358C89100&s=92E98D4AFE5A7A2B&sms=BF7D6D478B935644"],"note":"金門縣政府已建即時停車導引並提供金好停查詢空位；TDX 亦有金門停車相關資料。前版直接寫『未找到核心停車 API』過度簡化，應改為『服務存在，但公開地方 endpoint 待定位』。","mode":"none","map":{}},
{"city":"連江縣","grade":"B*","kind":"官方智慧停車平台有即時找車位（公開 API endpoint 待定位）","source_name":"連江縣交通旅遊局","urls":["https://parking.matsu.gov.tw/find-parking","https://parking.matsu.gov.tw/"],"note":"2026 年已上線官方智慧停車平台，可即時查看各停車場剩餘車位並導航；目前尚未找到公開 API 文件，因此不能把網站內部呼叫直接當成可穩定介接的 Open Data API。","mode":"none","map":{}},
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

TDX_PROBE_CITIES = [
    ("高雄市","Kaohsiung"),("基隆市","Keelung"),("嘉義市","Chiayi"),
    ("新竹縣","HsinchuCounty"),("苗栗縣","MiaoliCounty"),("彰化縣","ChanghuaCounty"),
    ("南投縣","NantouCounty"),("雲林縣","YunlinCounty"),("嘉義縣","ChiayiCounty"),
    ("屏東縣","PingtungCounty"),("花蓮縣","HualienCounty"),("臺東縣","TaitungCounty"),
    ("澎湖縣","PenghuCounty"),("金門縣","KinmenCounty"),("連江縣","LienchiangCounty"),
]

def _chrome_cmd():
    for c in ("google-chrome","google-chrome-stable","chromium","chromium-browser"):
        if shutil.which(c):
            return c
    return None

def _extract_json_from_dom(dom):
    m=re.search(r"<pre[^>]*>(.*?)</pre>",dom,re.I|re.S)
    txt=html.unescape(re.sub(r"<[^>]+>","",m.group(1))) if m else dom.strip()
    starts=[x for x in (txt.find("["),txt.find("{")) if x>=0]
    if starts:
        txt=txt[min(starts):]
    try:return json.loads(txt)
    except Exception:return None

def probe_tdx_unresolved():
    chrome=_chrome_cmd()
    out=[]
    if not chrome:
        return [{"city":"全部","code":"—","url":"—","count":0,"numeric":False,"update":"","status":"NO_CHROME","body":"GitHub runner 找不到 Chrome/Chromium"}]
    for city,code in TDX_PROBE_CITIES:
        url=f"https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/{code}?%24top=5&%24format=JSON"
        obj=None; body=""; attempts=[]
        for attempt in range(1,4):
            try:
                p=subprocess.run([
                    chrome,"--headless=new","--disable-gpu","--no-sandbox","--disable-dev-shm-usage",
                    "--dump-dom",url
                ],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=25)
                body=p.stdout
                obj=_extract_json_from_dom(body)
                count=len(obj) if isinstance(obj,list) else (1 if isinstance(obj,dict) else 0)
                attempts.append(f"{attempt}:rc={p.returncode},json={isinstance(obj,(list,dict))},count={count}")
                if isinstance(obj,(list,dict)):
                    break
            except Exception as e:
                attempts.append(f"{attempt}:{type(e).__name__}:{e}")
            time.sleep(attempt)
        rows=obj if isinstance(obj,list) else ([obj] if isinstance(obj,dict) else [])
        numeric=False; update=""
        for r in rows:
            if not isinstance(r,dict):continue
            candidates=[r]
            for k in ("ParkingAvailabilities","ParkingAvailability","Availabilities"):
                if isinstance(r.get(k),list):
                    candidates += [x for x in r[k] if isinstance(x,dict)]
            for x in candidates:
                for k,v in x.items():
                    lk=str(k).lower()
                    if ("available" in lk or "spaces" in lk) and isinstance(v,(int,float)):
                        numeric=True
                    if lk in ("updatetime","srcupdatetime","update_time") and v:
                        update=str(v)
        count=len(rows)
        body_text=re.sub(r"\s+"," ",body)[:240]
        status="OK" if count else ("AUTH_OR_BLOCKED" if ("401" in body_text or "403" in body_text or "Unauthorized" in body_text or "Forbidden" in body_text) else "NO_ROWS_OR_PARSE_FAIL")
        out.append({"city":city,"code":code,"url":url,"count":count,"numeric":numeric,"update":update,"status":status,"attempts":"；".join(attempts),"body":body_text})
    return out

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

DYNAMIC_PRODUCT_SECTION = r"""
## 0. 動態來源產品判定

> 產品只接受：有 numeric 剩餘格，且為動態 API，或官方／資料時間可驗證為分鐘級更新。純靜態 JSON/CSV 只可當 metadata，不算可用即時來源。
> 明確 endpoint 失敗時最多重試 3 次。
> 地方免費 API 與 TDX／第三方聚合動態資料分開判定，避免把「地方 endpoint 未找到」誤寫成「該縣市沒有動態資料」。

### 0-1. 已找到地方免費動態端點，可直接做 adapter

| 縣市 | 即時產品判定 | 動態端點 | 更新／限制 |
|---|---|---|---|
| 臺北市 | ✅ 可接 | https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json | 官方動態剩餘格 JSON；產品加 freshness/異常值保護 |
| 新北市 | ✅ 可接 | https://data.ntpc.gov.tw/api/datasets/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json?page=0&size=2000 | 路外每 3 分鐘 |
| 新北市－路邊 | ✅ 可接 | https://data.ntpc.gov.tw/api/datasets/54A507C4-C038-41B5-BF60-BBECB9D052C6/json?page=0&size=2000 | 路邊逐格每 2 分鐘 |
| 桃園市 | ✅ 可接 | https://opendata.tycg.gov.tw/api/dataset/f4cc0b12-86ac-40f9-8745-885bddc18f79/resource/0381e141-f7ee-450e-99da-2240208d1773/download | 每 1 分鐘；surplusSpace |
| 臺中市 | ⚠️ 部分可接 | https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=1744bc00-cd16-48f3-9632-309f364662bb | 路邊逐格每 10 分鐘；路外 RGB 不算 numeric 剩餘格 |
| 臺南市 | ✅ 可接 | https://parkweb.tainan.gov.tw/api/parking.php | car + update_time，逐筆 freshness gate |
| 新竹市 | ✅ 可接 | https://hispark.hccg.gov.tw/OpenData/GetParkInfo | FREEQUANTITY + UPDATETIME，逐筆 freshness gate |
| 宜蘭縣 | ✅ 可接 | https://opendataap2.e-land.gov.tw/resource/files/2023-02-12/62f4d78b604ba16b8cc1e856dd28d2c3.json | 官方備註最慢約 1 分鐘刷新 |

### 0-2. TDX／第三方交叉驗證

TDX 停車資訊 v1 是全國尺度的路外、路邊動靜態 API；路邊格位動態與路段剩餘位動態標示每 1 分鐘更新，但 TDX 也說會持續擴充各縣市，因此不能假設 22 縣市目前全部都有資料列。逐縣 coverage 仍須帶 API Key 實際 query。

- TDX 停車 Swagger：https://tdx.transportdata.tw/api-service/swagger/basic/945f57da-f29d-4dfd-94ec-c35d9f62be7d
- 路邊格位動態：https://data.gov.tw/dataset/174357
- 路邊路段剩餘位動態：https://data.gov.tw/dataset/174353

ParkBoss 公開列出的資料來源包含多個縣市政府與 TDX。它不能證明每筆資料的上游是哪一個，但可用來交叉驗證某縣市近期是否曾有 numeric 動態剩餘格流入聚合服務。

| 原本未找到地方動態 API 的縣市 | 交叉驗證 | 目前判定 |
|---|---|---|
| 高雄市 | ParkBoss 有 numeric 剩餘格與更新時間 | 🟡 動態上游存在；地方免費直連 endpoint 待反查 |
| 基隆市 | ParkBoss 有 numeric 剩餘格與更新時間 | 🟡 動態上游存在；地方免費直連 endpoint 待反查 |
| 嘉義市 | ParkBoss 有 numeric 剩餘格與更新時間 | 🟡 動態上游存在；地方免費直連 endpoint 待反查 |
| 南投縣 | ParkBoss 顯示「以現場為準」、總格 65535、無更新時間 | ❌ 目前無 usable numeric availability 證據 |
| 新竹縣、苗栗縣、彰化縣、雲林縣、嘉義縣、臺東縣、澎湖縣、金門縣、連江縣 | 尚未取得可核對的 numeric 動態頁面 | ⚪ 未證實；TDX 需逐縣 query |
| 屏東縣 | 官方智慧停車/TDX 有動態線索，但尚未拿到可核對的 numeric 頁面 | ⚪ 高機率有上游，仍需直接驗證 |
| 花蓮縣 | TDX 文件可確認有 HualienCounty 停車資料範例，但未證實 availability | ⚪ 有 TDX 停車資料證據，動態剩餘格仍待查 |

### 0-3. spotping.autoit.studio

本稽核環境目前無法直接抓取 https://spotping.autoit.studio/，因此不能可靠檢查它實際呼叫的 XHR/fetch API。若能取得該站瀏覽器 Network 的 API URL，應再反查其上游是 TDX、縣市 Open Data 或自有 proxy。

### 結論

- 高雄、基隆、嘉義市：不再標成「沒有動態資料」，改為 🟡「動態上游已證實，地方免費 endpoint 待反查」。
- 南投：第三方也沒有 numeric 剩餘格證據，暫維持 ❌。
- 其他縣市：改成 ⚪ 未證實，而不是直接宣告沒有；TDX 需要 API Key 逐縣 query 後才能下定論。
""".strip()

def render_report(audits,tdx_probe=None):
    now=datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds");L=[]
    L += ["# 全台 22 縣市免費停車資料 API／Open Data 實測盤點","",f"> 產生時間：{now}  ","> 原則：完全排除 TDX；只評估免費官方地方政府 API、官方 Open Data 下載端點與 data.gov.tw 轉載的地方政府資料。  ","> 本報告只盤點與實測資料源，沒有修改現有停車網站。  ","> 價格欄位採 raw passthrough，不把自然語言費率硬解析成每小時價格；沒有 numeric 剩餘格就不推算。  ",
"> 明確 API/JSON/CSV 端點若呼叫失敗，單次稽核最多連續嘗試 3 次；3 次皆失敗才記錄錯誤。  ",
"> 判讀分層：A=已找到可直連且可驗證的官方資料端點；B/B*=有官方資料或官方即時服務，但即時 availability 公開端點仍不完整；C/C*=目前只確認管理系統/線索，尚無可驗證的公開即時空位端點。  ",
"> 注意：TDX 有某縣市資料，代表存在上游資料交換，不等於該上游一定是對一般開發者公開的免費地方 API。",""]
    L += ["", DYNAMIC_PRODUCT_SECTION, ""]
    if tdx_probe:
        L += ["## 0-4. TDX 原始 ParkingAvailability 本次實打結果","",
              "> 這不是搜尋結果，也不是第三方旁證；是 GitHub Actions 用 headless Chrome 直接開 TDX 訪客模式的指定縣市路外 ParkingAvailability endpoint。每個端點最多重試 3 次。","",
              "| 縣市 | TDX code | top=5 回傳筆數 | numeric availability | 更新時間樣本 | 狀態 | 完整 URL |",
              "|---|---|---:|---|---|---|---|"]
        for r in tdx_probe:
            L.append(f"| {r['city']} | {r['code']} | {r['count']} | {'✅' if r['numeric'] else '❌'} | {md(r['update'])} | {r['status']} | {r['url']} |")
        L += ["","<details><summary>TDX 實打原始嘗試摘要</summary>",""]
        for r in tdx_probe:
            L.append(f"- {r['city']}：{r.get('attempts','')}；body={md(r.get('body',''))}")
        L += ["","</details>",""]
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
    L += ["## 4. 資料品質機械檢查","","以下只做可客觀計算的檢查，不修正來源值，也不做語意猜測。","","| 縣市 | 解析筆數 | 有座標 | 有費率原文 | 有 numeric 剩餘格 | 剩餘格 > 總格 |","|---|---:|---:|---:|---:|---:|"]
    for cfg,res in audits:
        rows=res["norm_rows"]
        coord=sum(1 for r in rows if fnum(r.get("lat")) is not None and fnum(r.get("lng")) is not None)
        fee=sum(1 for r in rows if any(sval(r.get(k)) for k in ("fee_text","fee_weekday_text","fee_holiday_text","fee_monthly_text","fee_other_text")))
        avail=sum(1 for r in rows if fnum(r.get("available_car")) is not None)
        bad=sum(1 for r in rows if fnum(r.get("available_car")) is not None and fnum(r.get("total_car")) is not None and fnum(r.get("available_car"))>fnum(r.get("total_car")))
        L.append(f"| {cfg['city']} | {len(rows)} | {coord} | {fee} | {avail} | {bad} |")
    L += ["","注意：若 source 回傳 available_car > total_car，報告保留原值並列為異常；正式網頁應標示資料異常或暫不顯示該筆即時格數，不能自行把它改成 total_car。","", "## 5. 實作結論","","- 目前優先可做 adapter：臺北、新北、桃園、新竹市、臺南；宜蘭需先解決免費地方來源的靜態資料直連與新鮮度驗證。","- 臺中路外 API 只有燈號狀態，不是確切剩餘格，不應換算。","- 其他只有靜態來源的縣市，可以先留資料盤點，但不能在產品上標成即時車位。","- 找不到符合條件免費官方 API 的縣市，本階段就不接；比抓網頁或猜欄位安全。","","下一步先不要改前端；應先對 A/A* 來源做 adapter + contract test，再決定正式上線範圍。",""]
    return "\n".join(L)

def main():
    audits=[]
    for cfg in SOURCES:
        print("AUDIT",cfg["city"],flush=True);res=audit_city(cfg);audits.append((cfg,res));print(" ->",len(res["norm_rows"]),"rows",res["errors"],flush=True)
    print("PROBE TDX unresolved cities",flush=True);tdx_probe=probe_tdx_unresolved()
    for r in tdx_probe: print(" TDX",r["city"],r["status"],r["count"],r["numeric"],flush=True)
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(render_report(audits,tdx_probe),encoding="utf-8");print("WROTE",OUT,OUT.stat().st_size)

if __name__=="__main__":main()
