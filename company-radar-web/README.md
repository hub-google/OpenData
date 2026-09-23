# 企業商機雷達

OpenData 專案 Top 1 已從「假資料 Prototype」改成每日政府 Open Data 驅動的第一版真實產品。

## 現在怎麼運作

GitHub Actions 每天台北時間約 08:20 自動執行：

1. 下載財政部「全國營業（稅籍）登記資料集」。
2. 查經濟部商業發展署「公司資料設立查詢」API。
3. 查經濟部商業發展署「公司資料異動查詢」API。
4. 將全國營業中稅籍整理成 SQLite baseline。
5. 從第二次成功執行開始，把今日 snapshot 與前次 snapshot 比較。
6. 產生可解釋的事件：新設立、增資、減資、搬遷、產業異動、名稱變更、其他公司登記異動。
7. 依事件強度與公開資本額計算透明規則式 Lead Score。
8. 輸出 `data/opportunities.json` 給網站讀取。
9. 每日事件另外保留在 `data/history/`，自動保留最近 60 天。
10. 更新 GitHub Pages。

## 為什麼第一次不會亂判斷

第一次執行沒有「昨天」可以比較，所以只建立全台 baseline，並顯示經濟部當日設立／異動 API 能直接確認的事件。

從下一次成功執行開始，系統才會真的用兩次快照的差異判定：

- 公開資本額增加 → 增資
- 公開資本額下降 → 減資
- 公開營業地址改變 → 搬遷
- 稅籍行業代號／名稱改變 → 產業異動
- 名稱改變 → 名稱變更

如果經濟部 API 明確顯示今日有核准異動，但上述公開欄位沒有差異，系統會標示「其他公司登記異動」，不會硬猜事件類型。

## 資料來源

- 財政部財政資訊中心：全國營業（稅籍）登記資料集  
  https://data.gov.tw/dataset/9400
- 經濟部商業發展署：公司資料設立查詢  
  https://data.gcis.nat.gov.tw/od/detail?oid=8D314711-6324-4CE7-A358-2FF284A9F84D
- 經濟部商業發展署：公司資料異動查詢  
  https://data.gov.tw/dataset/84880
- 商工 OAS / Swagger  
  https://data.gcis.nat.gov.tw/resources/swagger/index.html

## 網站功能

- 今日真實異動 Dashboard
- 公司名稱／統編／產業／地址搜尋
- 事件、地區、產業、資本額篩選
- 規則式商機分數排序
- 顯示「為什麼被判定為商機」
- 顯示資本額／地址／產業差分
- 追蹤清單（瀏覽器 LocalStorage）
- CSV 匯出
- 最近 60 天每日事件資料
- 響應式版面

## GitHub Pages

https://hub-google.github.io/OpenData/

## 還沒做的下一層

目前已經不是假資料 Demo，但還沒有完成原始構想的全部資料圖譜。下一層可加入：

- 公司董監事與法人關係
- 政府標案與得標紀錄
- 勞動／環境／食安裁罰
- 建照與公司地址交叉訊號
- 可自訂 Lead Score 權重
- LINE / Email 主動通知
- CRM / API 整合
