# 台灣標案情報中心（實作版）

> 對應 PRD：`PRD-台灣標案情報平台-v0.1-2026-11-03.md`
>
> 入口：https://hub-google.github.io/OpenData/tender-intelligence-web/
>
> 2026-11-03：以真實公開資料取代舊版寫死 10 筆模擬資料。所有目前完成的功能不設付費牆。

## 功能現況

| 功能 | 狀態 | 真正資料／限制 |
|---|---|---|
| 最新公告 | ✅ | 公開 API `/getinfo` → `/listbydate`，沒有使用假資料 |
| 關鍵字搜尋 | ✅ | `/searchbytitle` |
| 公司名稱／統編搜尋 | ✅ | `/searchbycompanyname`、`/searchbycompanyid` |
| 機關名稱搜尋 | ✅ | `/listbyunit?unit_name=...` |
| 公告類型、類別、預算篩選 | ✅ | 只篩本次 API 取回的案件，**不假裝全國結果都已過濾** |
| 標案詳細資料與公告歷程 | ✅ | `/tender?unit_id=...&job_number=...`；官方公告 URL 只使用來源實際存在且主機為 web.pcc.gov.tw 的連結 |
| 機關年度採購統計與常見得標商 | ✅ | `/unitstat?unit_id=...` |
| 廠商案件／公告廠商名稱 | ✅ | 公開 API 查詢；不把得標商當作完整投標廠商 |
| 決標／預算比 | ✅（限樣本） | 本次查詢／已查看詳情內、可同時取得公開決標金額與預算的案件，依機關與案號去重；不足樣本則提示 |
| 公司個人化關鍵字匹配 | ✅（規則版） | 本機設定，命中理由／排除理由可見，不是得標概率，也不會推測履約地 |
| 投標收藏、階段、備註、內部期限 | ✅（本機） | 使用 localStorage；可匯出 CSV、ICS、JSON，JSON 可匯入 |
| 公告監控／新版本比較 | ✅（網頁開啟時） | 監控公開 API 第一頁最新結果；首次檢查建基準，後續比對案號、公告日、公告版本；關閉網頁不會推播 |
| 系統通知 | ✅（網頁開啟時） | 須使用者明確同意瀏覽器通知；不寄 Email 或 LINE |
| RSS | ✅（靜態下載） | 匯出當次結果為 .rss 文件，不是可長期訂閱的後端 URL |
| TXT/MD/PDF/DOCX 標書整理 | ✅（本機規則版） | 提取文字並依條款關鍵詞分類，列出 PDF 頁碼／DOCX 段落；使用 PDF.js/Mammoth CDN，掃描型 PDF 不支援 OCR |
| AI 模型分析、文件引用與評選健檢 | ⏳ | 尚未建立私有 AI 執行 API；**不得稱規則抽取是 AI** |
| Email／LINE 伺服器背景通知 | ⏳ | 尚未部署通知後端、用戶綁定及合法的金鑰 |
| 多人團隊／跨裝置同步 | ⏳ | 尚未建租戶帳戶、資料庫、身分認證與權限 |
| 完整全國歷史價比／精準重購預測 | ⏳ | 需授權完整資料、建立主資料庫、契約期限資料及可比樣本 |
| 完整官方電子領標／投標文件自動送件 | 不在範圍 | 以政府電子採購網為唯一權威 |

## 前端架構

- `index.html`：各功能頁面／抽屜及語意結構。
- `styles.css`：行動裝置、桌面版響應式設計。
- `core.mjs`：純函數資料轉換、日期、公告類別、去重、統計、條件匹配與安全 URL。
- `app.js`：即時 API、互動、下載、localStorage 與文件文字解析。
- `tests/core.test.mjs`：無外部套件的 Node.js 單元測試。

所有動態來源文字以 `textContent` 載入，避免直接把第三方標題插入未清理的 HTML。
未附任何 API 金鑰、LINE Token、付款憑證，也沒有把檔案上傳到我們的後端。

## 資料來源及商用限制

公開查詢：
- https://pcc-api.openfun.app/
- https://github.com/openfunltd/pcc.g0v.ronny.tw/blob/master/webdata/skill.md

真正權威：
- https://web.pcc.gov.tw/
- https://data.gov.tw/dataset/172020
- https://data.gov.tw/dataset/172023

OpenFun 的網站公開表示 API 開放 CORS、可以前端直接使用，但同時提醒採購網原始著作權及商業利用的不同規範。**能用 API 查詢不等於自動取得完整商用重製、再授權權利。** 本版用於產品功能測試，正式商業化前應確定資料來源、存取／留存及衍生資料利用授權。

API 匿名可能出現 429 或來源延遲。若發生，畫面顯示真實錯誤，不會返回模擬資料。長期產品應建立合法的官方資料管線、自有索引／快取和來源健康監控。

## 部署方式

- `.github/workflows/tender-intelligence-check.yml`：每次改動 JavaScript 與相關檔案，執行 Node.js 語法與單元測試。
- `.github/workflows/tender-intelligence-pages.yml`：有標案目錄變更時，通過測試後只更新 `gh-pages/tender-intelligence-web/` 子目錄；不因為標案網站更新而重跑其他資料爬蟲。
- 既有全站排程 `company-radar-pages.yml` 在執行每日其他資料更新時，仍會複製本目錄最新版本。

本機直接啟用需有能提供 ES modules 的靜態伺服器（例如 `python -m http.server`），不要直接使用 `file://`。

## 測試

```bash
node --check tender-intelligence-web/app.js
node --check tender-intelligence-web/core.mjs
node --test tender-intelligence-web/tests/*.test.mjs
```

測試涵蓋：ROC 日期、API 欄位、公告去重、缺漏金額、案件狀態、決標價比、關鍵字／預算適配、CSV 公式注入與官方來源 URL 安全限制。

## 下一步真實後端（不假裝已完成）

1. 確定商用資料來源與再利用授權；建立合法資料收錄、版本更新及監控。
2. 以真正的資料庫儲存案件、公告、廠商、機關、價格與完整來源。
3. 用戶身份管理、公司工作區、跨裝置同步；再建 Email／LINE 佇列與訂閱規則。
4. AI 文件解析改由權限隔離後端執行，引用原文／頁碼、記錄花費與失敗重試。
5. 才進一步做可比歷史價格模型、合約到期／重購預警與企業 API。
