# PPSTRQ 全國動產擔保公示資料抓取

## 2026-09-30 商業價值重評

- **商業價值：82/100**
- **主要分類：金融／高價商機訊號**
- **主要變現：租賃、設備、融資、企業金融高價 Lead，授信／企業風險資料服務。**

| 評估項目 | 分數 |
|---|---:|
| 直接付費能力 | 24 |
| 流量規模與使用頻率 | 3 |
| 交易／商機導流能力 | 15 |
| 痛點與決策價值 | 15 |
| 競爭與替代品 | 8 |
| 護城河 | 10 |
| 資料解題能力 | 4 |
| 維運與資料持續性 | 3 |
| **合計** | **82** |

**判斷：** 使用者少但單筆 Lead 可能很值錢。主要風險不是需求，而是官方沒有穩定 bulk API，抓取成本、更新完整性與來源持續性會限制規模化。

> 統一權重：直接付費 25、流量頻率 15、交易／商機導流 15、痛點決策 15、競爭 10、護城河 10、資料解題 5、維運持續性 5。


驗證日期：2026-09-29

## 已驗證

來源：經濟部「動產擔保交易線上登記及公示查詢」

- 查詢入口：`/pps/pubQuery/PropertyQuery/propertyQuery.do`
- 查詢方式：POST + session + Struts token
- 公司／商號查詢：
  - `debtorType=1`
  - `debtorTypeRadio=1`
  - `queryDebtorName` 或 `queryDebtorNo`
- 分頁：
  - `method=query`
  - `currentPage=N`
  - 每頁 10 筆
- 明細：
  - POST `/pps/pubQuery/PropertyQuery/propertyDetail.do`
  - 關鍵欄位為 `regUnitCode` + `certificateAppNoWord`
- 結果清單中的 JavaScript：
  - `gotoPage(page)`
  - `goDetail(regUnitCode, certificateAppNoWord)`

## 100 筆實測

目前已實際取得 100 筆明確公司／商號類案件，並逐筆進入 Detail 頁。

輸出：
- `ppstrq/data/sample_100_company_records.csv`
- `ppstrq/data/sample_100_company_records.json`

本次搜尋索引「杰」在 PPSTRQ 共命中 440 筆、44 頁；掃完 44 頁後，名稱明確符合公司／商號標記的案件共有 203 筆，本次取前 100 筆做 Detail 驗證。

100 筆中有 95 筆能從 Detail 解析出擔保債權金額；其餘 5 筆為較舊且「已過效期未註銷」案件，PPSTRQ Detail 本身的金額欄就是空白。

## 為什麼不能直接空白列出全國

已直接繞過前端 JavaScript，向後端送出「公司／商號類別、名稱與統編皆空白」的 POST。

後端在 45 秒內沒有回應，request read timeout。這表示空條件不是實用的 bulk export 路徑，也不應反覆用這種重查詢壓政府網站。

## 全量企業資料的可靠做法

若目標是「全國公司／商號目前仍在 PPSTRQ 公示的案件」，可靠做法是先取得官方企業母體，再對 PPSTRQ 做可恢復的批次查詢：

1. 以財政部「全國營業(稅籍)登記資料集」取得營業主體名稱／統編。
2. 視完整性需求加入停業與非營業中資料集。
3. PPSTRQ 以公司／商號條件查詢。
4. 結果依 `regUnitCode + certificateAppNoWord` 去重。
5. 僅對新案件抓 Detail。
6. 保存 checkpoint、cache、retry/backoff，避免重複查詢。
7. 之後只做增量更新，不重掃整個母體。

本專案的批次抓取只處理明確公司／商號類案件，不建立自然人的財務／擔保資料庫。

## 目前限制

- PPSTRQ 沒有公開 bulk download / OpenAPI。
- 公示頁只反映目前仍可公示查詢的登記狀態，不等同完整歷史資料庫。
- 部分舊案件 Detail 的擔保金額欄位本身為空白。
- 公路局資料可能比來源系統晚一天。
