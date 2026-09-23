# 02｜Taiwan Location Intelligence

## 商業價值
- 評分：94/100
- 台灣單一產品 ARR 潛力：NT$5,000萬～3億+
- 主要客戶：零售、餐飲、藥局、健身房、房仲、建商、銀行、保險、加盟總部。
- 核心問題：展店、選址、房產與區域需求判斷，需要把人口、所得、房價、商家、交通與建築資料疊在一起。

## 核心資料來源

### A. 村里戶數、單一年齡人口
- 官方頁：https://data.gov.tw/dataset/77132
- API 文件：https://www.ris.gov.tw/rs-opendata/api/Main/docs/v1
- API 路徑：https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/yyymm
- 關鍵欄位：統計年月、區域別代碼、區域別、村里、戶數、人口數、人口數-男、人口數-女、0歲-男/女…100歲以上。
- JOIN：區域代碼／村里＋年月。

### B. 綜稅綜合所得總額全國各縣市鄉鎮村里統計分析表
- 官方頁：https://data.gov.tw/dataset/103066
- 關鍵欄位：鄉鎮市區、村里、納稅單位(戶)、綜合所得總額、平均數、中位數、第一分位數、第三分位數、標準差、變異係數。
- 注意：所得口徑來自綜所稅申報核定資料，不等於完整家庭可支配所得。

### C. 不動產買賣實價登錄
- 官方頁：https://data.gov.tw/dataset/25119
- CSV ZIP：https://plvr.land.moi.gov.tw/opendata/lvr_landAcsv.zip
- 官方說明：每月 1、11、21 日發布。
- 實務欄位應以 ZIP 內 schema-main.csv、schema-build.csv、schema-land.csv、schema-park.csv 為準。
- 建議使用：交易年月日、土地位置／建物門牌、交易標的、土地/建物/車位面積、都市土地使用分區、總價元、單價元/平方公尺、建物型態、主要用途、主要建材、建築完成年月、總樓層數、移轉層次、車位類別。

### D. 全國營業（稅籍）登記
- 官方頁：https://data.gov.tw/dataset/9400
- CSV：https://eip.fia.gov.tw/data/BGMOPEN1.csv
- 用途：商家密度、競爭店、產業聚落。
- 關鍵欄位：統一編號、營業地址、行業代號、營業人名稱、設立日期。

## 建議衍生欄位
- 0–6、7–12、13–18、19–29、30–39、40–49、50–64、65+ 人口。
- 家庭 proxy：戶數、平均每戶人口。
- 所得中位數／四分位距。
- 1/3/5/10 分鐘生活圈人口。
- 同業競爭密度。
- 新店／關店速度。
- 成交單價趨勢。
- 新屋比例、屋齡。
- Site Score。

## 商業模式
- Site Selection SaaS：NT$5,000～50,000/月。
- Enterprise GIS/API：NT$50萬～500萬/年。
- 單次展店報告：NT$2萬～20萬/點。
- 房產 AVM / 區域評分 API：按查詢量計價。
- Franchise Intelligence：總部依區域與加盟展店數收費。

## MVP
做「台北 12 區開店評分」：輸入店型、目標年齡、客單價、坪數，系統列出 Top 20 村里並解釋人口、所得、競品、房價/租金 proxy。
