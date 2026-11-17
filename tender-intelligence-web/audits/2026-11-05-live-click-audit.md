# 台灣標案平台正式網站公開操作稽核

測試時間：2026-11-17T05:24:11.984Z
測試環境：GitHub Actions Playwright Chromium，未登入；實際開啟 GitHub Pages。

| 情境 | 結果 | 觀察 |
|---|---|---|
| 首頁與五大功能區 | PASS | {"http":200,"title":"台灣標案情報中心｜OpenData Lab","groups":["⌕ 找標案","◎ 我的商機","▤ 市場情報","▣ 投標管理","▧ 文件與資格","⚙ 提醒與設定"],"kpi":"自有資料庫 3,889 案；目前有明確截止時間 2,500 案（64.3%）。「確認尚未截標」與「三日內截止」只計入有原文證據者，不能據此推斷其餘案件已截止。最後成功同步（台灣時間）：2026/11/17 12:12:36。來源尚未核實 31 天（其中 31 天落在例假日或政府預期休刊日、工作日待查 0 天）；未把來源 HTTP 錯誤當作零公告。","screenshot":"01-home.png"} |
| 首頁最新公告分頁與真實資料備援 | PASS | {"cards":30,"info":"最新已收錄案件｜符合 3,889 件案件｜本頁 30 件（每個案件僅顯示一筆，依機關與案號去重；非全國完整資料）｜全部篩選與排序先在資料庫完成","pagination":"第 1 / 130 頁","screenshot":"01b-latest.png"} |
| 標案搜尋：資訊系統 | FAIL | "page.waitForFunction: Timeout 50000ms exceeded." |
| 跨頁搜尋不漏案也不重複來源頁 | FAIL | "page.waitForFunction: Timeout 50000ms exceeded." |
| 首頁全文搜尋的全庫類別與預算篩選 | FAIL | "全庫篩選有錯誤或無資料：{\"info\":\"標案名稱：資訊系統｜全庫篩選｜符合 0 件案件｜本頁 0 件（每個案件僅顯示一筆，依機關與案號去重；非全國完整資料）｜全部篩選與排序先在資料庫完成\",\"cards\":0,\"invalid\":[]}" |
| 進階搜尋無條件開啟與資料庫真實分頁 | PASS | {"status":"實際已入庫資料符合條件 3,889 件｜本頁 30 件，0 件有原公告履約地。 未完成回填或來源 API 失敗的日期不在搜尋結果內；未知金額與履約地不會被猜測。","first":"./?case_unit=02717206&case_no=NL1160008","second":"./?case_unit=3.1.21&case_no=115GA054","page":"第 2／130 頁（每頁最多 30 件）","screenshot":"02c-recent-advanced.png"} |
| 進階搜尋：資安維護最低一百萬 | PASS | {"status":"實際已入庫資料符合條件 3 件｜本頁 3 件，0 件有原公告履約地。 未完成回填或來源 API 失敗的日期不在搜尋結果內；未知金額與履約地不會被猜測。","caseCount":3,"screenshot":"03-advanced.png"} |
| 商機雷達：跨日搜尋 | PASS | {"status":"已入庫招標類公告共 18 案命中包含詞，按相關詞命中數及公告日排列；本頁 18 案。不同公告類型、未完成歷史回填、資格與截止時間皆可能影響實際可投標性，這不是得標率。","items":18,"screenshot":"04-radar.png"} |
| 市場情報：廠商查詢 | FAIL | "廠商查詢未完成：已入庫來源資料 0 筆公告；本次載入去重 0 件（第一頁）" |
| 市場行情：未分類逐月趨勢 | PASS | {"status":"目前符合 250 件已入庫案件，最新公告日期：20261117。按本站已成功入庫的每件案件最新公告日期統計。歷史尚未完整覆蓋；無公開金額不加入金額總和，部分月份可能仍有來源缺口。","bars":1,"screenshot":"06-market.png"} |
| 訪客公司資料及私人身分狀態 | PASS | {"guestAuthenticated":true,"companyFields":2,"status":"訪客也可保存私人公司資料。","screenshot":"07-company.png"} |
| 監控與自動報表入口 | PASS | {"keyword":1,"competitor":1,"report":1,"screenshot":"08-alerts.png"} |
| 指定真實標案深連結與六分頁 | PASS | {"http":200,"mainTabs":["案件重點","公告歷程","行情與競爭","投標準備"],"prepTabs":["評估與決策","資格與標書","待辦與分工","履約與保證金","成本與工時","服務建議書"],"drawer":true,"screenshot":"09-case.png"} |
| 監控與通知四分頁操作 | PASS | {"tabs":["標案監控","競品追蹤","自動報表","通知設定"],"screenshot":"11-monitor-tabs.png"} |
| 手機側欄與商機雷達 | PASS | {"radar":true,"horizontal_overflow":false,"scroll_width":390,"overflowing":[],"screenshot":"10-mobile.png"} |

頁面 JS 例外：0
網路失敗請求：9

未登入的私人資料 CRUD 與發送通知不屬於本次驗收。