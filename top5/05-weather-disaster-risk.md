# 05｜Weather & Disaster Risk Intelligence

## 商業價值
- 評分：88/100
- 台灣單一產品 ARR 潛力：NT$2,000萬～1.2億
- 主要客戶：保險、工程、物流、農業、能源、戶外活動、資產管理。
- 核心問題：免費天氣資訊很多，但企業願意付費的是「這個地址／資產／工地未來或歷史的風險」。

## 核心資料來源

### A. 全測站逐時氣象資料
- 官方頁：https://data.gov.tw/dataset/9176
- 氣象署 Open Data：https://opendata.cwa.gov.tw/
- 關鍵欄位：StationName、StationId、DateTime、CoordinateName、CoordinateFormat、StationLatitude、StationLongitude、StationAltitude、CountyName、TownName、CountyCode、TownCode，以及天氣、降水、風速/風向、氣溫、相對溼度、氣壓、極值等觀測欄位。
- 更新：逐時。

### B. 空氣品質指標 AQI
- 官方頁：https://data.gov.tw/dataset/40448
- 空氣品質監測網：https://airtw.moenv.gov.tw/
- 關鍵欄位：sitename、county、aqi、pollutant、status、so2、co、o3、o3_8hr、pm10、pm2.5、no2、nox、no、wind_speed、wind_direc。
- 更新：每小時。

### C. 土石流潛勢溪流
- 官方頁：https://data.gov.tw/dataset/7279
- 115 年影響範圍：https://data.gov.tw/dataset/176526
- 115 年大規模崩塌潛勢區：https://data.gov.tw/dataset/176527
- 115 年大規模崩塌影響範圍：https://data.gov.tw/dataset/176528
- 災害潛勢地圖：https://dmap.ncdr.nat.gov.tw/
- 關鍵欄位：Debrisno、County、Town、Vill、Address、Overflow_X、Overflow_Y、Total_Res、Res_Class、Risk。

## 建議產品化
- Address Risk Score。
- 工地 24/48/72 小時施工風險。
- 太陽能／風電發電量 weather feature。
- 物流 route weather risk。
- 農作物極端天氣 alert。
- 保險 portfolio geospatial accumulation risk。
- 歷史「某地址遇到極端降雨的頻率」。

## 商業模式
- API：每地址／每千次查詢。
- Portfolio Batch：按資產筆數收費。
- Enterprise Dashboard：NT$30萬～300萬/年。
- Alert：依工地／農場／資產數量訂閱。
- Insurance/Bank Data Feed：客製授權。

## MVP
挑一個高付費場景，例如「營造工地降雨風險」或「保險地址風險」，不要做泛用天氣 App。
