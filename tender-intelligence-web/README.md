# 台灣標案情報中心（實作版）

> 對應 PRD：`PRD-台灣標案情報平台-v0.1-2026-11-03.md`
>
> 入口：https://hub-google.github.io/OpenData/tender-intelligence-web/
>
> 2026-11-03：以真實公開資料取代舊版寫死 10 筆模擬資料。所有目前完成的功能不設付費牆。

## 功能現況

| 功能 | 狀態 | 真正資料／限制 |
|---|---|---|
| 最新公告 | ✅（已驗證） | 公開 API `/getinfo` → `/listbydate`，沒有使用假資料 |
| 關鍵字搜尋 | ✅ | `/searchbytitle` |
| 公司名稱／統編搜尋 | ✅ | `/searchbycompanyname`、`/searchbycompanyid` |
| 機關名稱搜尋 | ✅ | `/listbyunit?unit_name=...` |
| 公告類型、類別、預算篩選 | ✅ | 只篩本次 API 取回的案件，**不假裝全國結果都已過濾** |
| 標案詳細資料與公告歷程 | ✅ | `/tender?unit_id=...&job_number=...`；官方公告 URL 只使用來源實際存在且主機為 web.pcc.gov.tw 的連結 |
| 機關年度採購統計與常見得標商 | ✅ | `/unitstat?unit_id=...` |
| 廠商案件／公告廠商名稱 | ✅ | 公開 API 查詢；不把得標商當作完整投標廠商 |
| 決標／預算比 | ✅（限樣本） | 本次查詢／已查看詳情內、可同時取得公開決標金額與預算的案件，依機關與案號去重；不足樣本則提示 |
| 公司個人化關鍵字匹配 | ✅（規則版） | 未登入時本機保存；登入後可同步至 Supabase `ti_profiles`；不是得標機率 |
| 投標收藏、階段、備註、內部期限 | ✅（登入後讀寫待驗） | 未登入時使用 localStorage；登入後讀寫 RLS 隔離的 `ti_saved_cases`，可匯出 CSV、ICS、JSON |
| 公告監控／新版本比較 | ✅（後端已部署） | 未登入時瀏覽器比對；登入後 `ti_watch_rules` 與新公告入庫觸發 `ti_notifications`，關閉網頁後仍留站內紀錄；尚無 Email／LINE 推播 |
| 系統通知 | ✅（網頁開啟時） | 須使用者明確同意瀏覽器通知；不寄 Email 或 LINE |
| RSS | ✅（靜態下載） | 匯出當次結果為 .rss 文件，不是可長期訂閱的後端 URL |
| TXT/MD/PDF/DOCX 標書整理 | ✅（本機規則版） | 提取文字並依條款關鍵詞分類，列出 PDF 頁碼／DOCX 段落；使用 PDF.js/Mammoth CDN，掃描型 PDF 不支援 OCR |
| AI 模型分析、文件引用與評選健檢 | ⚠️（後端與 UI 已部署，未驗證成功推論） | `ti-document-ai` 依原文字頁碼呼叫模型並核對引用；必須登入且 Supabase Edge Function 設定 `OPENAI_API_KEY`。若未設定會明確回 503，不使用假 AI |
| Email／LINE 伺服器背景通知 | ⏳ | 尚未部署通知後端、用戶綁定及合法的金鑰 |
| 多人團隊／跨裝置同步 | ⚠️（已開發，未經真實多人驗收） | Supabase Auth、`ti_workspaces`、成員權限、一次性邀請、共用案件及任務的程式與 RLS 已部署；需實際多帳戶驗證 |
| 完整全國歷史價比／精準重購預測 | ⏳ | 需授權完整資料、建立主資料庫、契約期限資料及可比樣本 |
| 完整官方電子領標／投標文件自動送件 | 不在範圍 | 以政府電子採購網為唯一權威 |


## 2026-11-03 真實資料管線與更新頻率（已實際部署）

| 項目 | 實際方式 |
|---|---|
| 台灣政府公開採購公告 | 透過第三方 OpenFun PCC API 的 `/getinfo`、`/listbydate` 取得，不直接自行抓政府 HTML |
| 單案詳細公告 | OpenFun `/tender?unit_id=...&job_number=...`；來源官網仍為最終依據 |
| 儲存位置 | 既有 Supabase 專案 `unapiwajmgqqtdkixaab`，獨立 `public.ti_cases`、`ti_notices`、`ti_case_details`、`ti_ingest_runs`、`ti_sources` |
| 定期最新公告 | Supabase pg_cron `ti_pcc_hourly_ingest`，**台灣時間每小時 12 分** |
| 前日補抓 | pg_cron `ti_pcc_previous_day_backfill`，**台灣時間每日 02:32** |
| 執行與錯誤 | `ti-ingest` Edge Function，使用 Vault 內的專用驗證 token；每次寫入 `ti_ingest_runs` |
| 公告去重 | `機關代碼::案號::公告日期::檔名` 對應唯一公告，原始公告簡表以 JSON 保存 |
| 詳細資料 | 每次同步嘗試補足最多 15 筆尚未快取的案件詳情；不宣稱全部案件已完整解析 |
| 首次成功入庫 | 2026-11-03 14:56（台灣時間），2,350 公告、2,217 去重案件 |
| 2026-11-03 15:12 再次同步 | 成功；2,350 公告、0 筆新增公告、補足 9 筆案件詳情（累積 18 筆） |

以上資料筆數來自實際 SQL 查詢，不是固定寫入展示頁的樣本。注意資料來源授權仍待商用確認。

### 安全與資料隔離

所有 `ti_*` 私人表格與團隊表格啟用 RLS；雲端工作台需登入。公開案件查詢與使用者私有資料的權限分開。私有文件使用 Supabase Storage 的 `ti-private-documents` 桶，依帳戶 ID 路徑限制權限。正式產線驗收仍須對不同帳戶做跨租戶測試。

## 前端架構

- `index.html`：各功能頁面／抽屜及語意結構。
- `styles.css`：行動裝置、桌面版響應式設計。
- `core.mjs`：純函數資料轉換、日期、公告類別、去重、統計、條件匹配與安全 URL。
- `app.js`：即時 API、互動、下載、localStorage 與文件文字解析。
- `tests/core.test.mjs`：無外部套件的 Node.js 單元測試。

所有動態來源文字以 `textContent` 載入，避免直接把第三方標題插入未清理的 HTML。
沒有提交任何服務角色金鑰、LINE Token、付款憑證或 AI 私密金鑰。前端 `backend.js` 只有 Supabase 的公開 publishable key；登入後可由使用者主動把文件上傳到 Supabase 私有儲存桶 `ti-private-documents`。

## 資料來源及商用限制

公開查詢：
- https://pcc-api.openfun.app/
- https://github.com/openfunltd/pcc.g0v.ronny.tw/blob/master/webdata/skill.md

真正權威：
- https://web.pcc.gov.tw/
- https://data.gov.tw/dataset/172020
- https://data.gov.tw/dataset/172023

OpenFun 的網站公開表示 API 開放 CORS、可以前端直接使用，但同時提醒採購網原始著作權及商業利用的不同規範。**能用 API 查詢不等於自動取得完整商用重製、再授權權利。** 本版用於產品功能測試，正式商業化前應確定資料來源、存取／留存及衍生資料利用授權。

API 匿名可能出現 429 或來源延遲。若發生，畫面顯示真實錯誤，不會返回模擬資料。自有 Supabase DB 目前僅保存排程已經匯入的日期，不代表有全國完整歷史。

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

## 待完成／未驗收（不假裝已完成）

1. **資料授權**：確認 OpenFun/PCC 商用使用、資料留存與衍生資料再利用權利。
2. **全國完整歷史資料**：目前僅有排程匯入日期的真資料；未完成全量回補與歷史價格可比樣本建置。
3. **登入與多人驗收**：完整 Email magic-link 寄送、帳戶登入、跨裝置同步、團隊邀請、文件權限需真實多帳戶端到端測試。
4. **Email／LINE 背景推播**：目前已完成資料庫通知紀錄，不代表已串接正式 Email／LINE 發送服務。
5. **AI 模型驗收**：Edge Function 和 UI 已部署，但必須有保管於 Supabase 的正式模型金鑰、測試文件以及成功呼叫紀錄才能算完成。
6. **深度情報**：完整同場投標資料、採購重購預測、團隊文件 AI 知識庫、企業 API/MCP 尚未完整實作。
