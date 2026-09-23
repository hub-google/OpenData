# 06｜Corporate Compliance / ESG Risk

## 商業價值
- 評分：86/100
- ARR 潛力：NT$1,500萬～8,000萬
- 客戶：銀行、保險、採購、供應鏈、ESG 顧問、企業法遵。

## 資料來源

### 違反勞動法令事業單位－勞動基準法
- https://data.gov.tw/dataset/109896
- 關鍵欄位：主管機關、公告日期、處分日期、處分字號、事業單位名稱或負責人、違法法規法條、違反法規內容、罰鍰金額、備註說明。

### 環境部裁罰處分
- https://data.gov.tw/dataset/10165
- JSON API：https://data.moenv.gov.tw/api/v2/doc_p_17?api_key=b7df779e-71a6-4148-8379-5afbd441d803&format=JSON&limit=1000&sort=ImportDate+desc
- 關鍵欄位：no、name、date、case、fact、low、fine、appeal、result、restricted_date、improve。

### 公司基本資料
- https://data.gov.tw/dataset/22197
- https://data.gov.tw/dataset/9400

## 關鍵技術
裁罰資料常只有公司名稱，不一定有統編；核心護城河是 company entity resolution：名稱正規化、舊名、地址、公司狀態與人工覆核。

## 產品
- Supplier Risk Score。
- ESG Due Diligence。
- 每日新裁罰 Alert。
- 客戶／供應商 Batch Screening。
- 公司風險 API。

## 商業模式
每家公司／每批名單／每年 Enterprise License 收費。高價值客戶在採購、授信與大型供應鏈。
