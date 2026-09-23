# 企業商機雷達 Web Prototype

這是 OpenData 專案 Top 1「企業商機雷達」的第一版可操作 Web Prototype。

## 現有功能

- 今日商機 Dashboard
- 公司名稱／統編／產業搜尋
- 異動類型、地區、產業、資本額篩選
- 商機分數排序
- 公司詳細情報 Drawer
- 「為什麼現在值得聯絡」觸發原因
- 追蹤清單（瀏覽器 LocalStorage）
- CSV 匯出
- 響應式版面

## 目前資料

目前畫面使用 **示範資料**，目的是先驗證產品體驗與商業邏輯，並非真實企業最新狀態。

下一階段預計將前端資料層替換為每日同步的政府 Open Data，包括：

1. 全國營業（稅籍）登記資料
2. 公司登記基本資料
3. 公司董監事資料
4. 公司設立查詢
5. 公司異動查詢

## GitHub Pages

Repository 內的 `.github/workflows/company-radar-pages.yml` 會將本資料夾部署到 GitHub Pages。

預計網址：

https://hub-google.github.io/OpenData/

## 後續正式化

正式 MVP 建議增加：

- 每日 ETL / Snapshot
- 真實 Company Event 差分
- 可自訂 Lead Score
- 登入與使用者篩選條件
- Email / LINE 每日商機通知
- CRM / API 整合
