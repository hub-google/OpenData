# 停車｜Open Data 智慧找車位 PRD

## 1. 產品目標
把台灣政府公開的路外停車場、路邊停車格與即時剩餘車位整合成單一服務。使用者不必逐一查政府網站，只要輸入目的地，即可查看附近停車選項、免費/收費狀態、剩餘格數、距離與資料更新時間；未來可透過 LINE MINI App 建立「守候」，條件成立時主動通知。

## 2. 核心痛點
- 到目的地才開始繞路找車位，浪費時間與油耗。
- 各縣市停車資料分散、欄位格式不同。
- 有些資料只有停車場位置，有些有即時剩餘格，使用者難判斷可信度。
- 免費車位/非收費時段資訊散落，不容易快速篩選。
- 現有查詢通常要求使用者反覆重新整理，缺少「幫我等，有位再叫我」。

## 3. 目標使用者
開車通勤族、臨時前往陌生地點者、活動/商圈訪客、希望降低停車費的駕駛。

## 4. MVP
1. 地圖顯示附近停車場/停車格。
2. 搜尋目的地。
3. 篩選：全部、目前有位、免費/目前免費。
4. 顯示名稱、距離、總格數、剩餘格數、費率、資料更新時間。
5. 一鍵開啟 Google Maps 導航。
6. 「守候這區」互動原型：設定半徑與最低空位數。
7. 清楚標示「即時資料 / 靜態資料 / Demo 資料」。

## 5. 資料來源
### 主資料層
- 交通部 TDX 運輸資料流通服務：https://tdx.transportdata.tw/
- TDX Parking API：全國尺度路外、路邊停車動靜態資料。
- 政府資料開放平臺：https://data.gov.tw/

### 補充資料
依縣市資料品質，直接串接地方政府 Open Data，例如路邊單格狀態、停車場剩餘格、費率與收費時間。

## 6. 標準資料模型
```text
parking_id
source
city
name
type                 # off_street / on_street
latitude
longitude
total_spaces
available_spaces
realtime_available
fee_description
is_free_now
last_updated
data_freshness
source_url
```

## 7. 資料管線
政府 Open Data / TDX → ETL 正規化 → Parking DB → 即時 Cache → Nearby API → Web / LINE MINI App。

正式版建議 PostgreSQL + PostGIS 做地理距離查詢；Redis 快取高頻即時資料。排程依來源更新頻率抓取，保留 source_updated_at，避免把舊資料誤標成即時。

## 8. 守候邏輯
使用者設定 destination、radius、arrival_time、min_available_spaces。後端定時取得最新資料，找出半徑內符合條件的停車點並排序；找到後推送通知。LINE 版規劃使用 LINE MINI App Service Message，正式上線前需依 LINE 當時規範完成驗證與通知情境審核。

## 9. 推薦排序
第一版 score 可由：距離、是否有位、剩餘比例、價格、資料新鮮度組成。禁止把「未知即時狀態」當成「有位」。

## 10. MVP 技術
- GitHub Pages：靜態 Web Demo
- Leaflet + OpenStreetMap：地圖
- Vanilla JS：互動
- Demo JSON：先驗證 UX
- Phase 2：Serverless API + TDX OAuth/API
- Phase 3：PostGIS + 排程 + LINE MINI App

## 11. 成功指標
搜尋→導航點擊率、守候建立率、守候命中率、通知→導航轉換率、資料過期率、使用者找到車位平均時間。

## 12. 風險
政府資料可能延遲/中斷；不同縣市覆蓋率不一致；「免費」需同時判斷費率與收費時段；GitHub Pages 不應存放 TDX secret；LINE Service Message 有用途與次數限制。

## 13. 開發階段
- P0：GitHub Pages UX Demo（本目錄）
- P1：接一個真實縣市/TDX 即時 API
- P2：全台資料正規化
- P3：守候後端
- P4：LINE MINI App + Service Message
- P5：導航轉換與推薦排序優化
