# 台灣政府標案情報中心（2026-11-03）

> 官方網站：https://hub-google.github.io/OpenData/tender-intelligence-web/
>
> 需求規格：[PRD v0.2](./PRD-台灣標案情報平台-v0.1-2026-11-03.md)
>
> **目前所有已實作的功能均免費；無付費牆，沒有啟用扣款。**「方案與帳務」尚不開放。
>
> **產品狀態：可公開測試的開發版，不是所有 PRD 項目皆已驗收完成。**請勿將部分功能程式已部署與完整商業服務畫上等號。

## 一、真實資料來源、保存與更新頻率

| 項目 | 實際方式 |
|---|---|
| 官方權威公告 | [政府電子採購網](https://web.pcc.gov.tw/) |
| 目前標案資料供應 | [OpenFun PCC API](https://pcc-api.openfun.app/) — 第三方提供之政府採購公告結構化 API |
| 取得方式 | **GET JSON API**；本專案標案資料同步**並非直接爬取**政府網頁 HTML |
| 主要路由 | `/api/getinfo`、`/api/listbydate?date=YYYYMMDD`、`/api/tender?unit_id=...&job_number=...`、`/api/searchbytitle`、`/api/searchbycompanyid`、`/api/listbyunit?unit_id=...`、`/api/unitstat` |
| 主要資料庫 | Supabase PostgreSQL（專案 `unapiwajmgqqtdkixaab`），獨立 `public.ti_*` 資料表 |
| 原始公告快照 | `ti_notices.raw_brief`（逐筆公告的來源 JSON 欄位）、`ti_notices.id`（機關＋案號＋公告日＋版本檔名） |
| 案件主表 | `ti_cases`，按機關代碼＋案號合併，區分一案與多次公告 |
| 公告詳情 | `ti_case_details`，按逐次同步容量限額補抓；不是所有案件都有完整細節 |
| 同步與來源紀錄 | `ti_ingest_runs`、`ti_sources`；失敗會保留真實 HTTP 錯誤 |
| 最新公告同步 | Supabase pg_cron：**每小時第 12 分**，台灣時間 |
| 前一天補抓 | Supabase pg_cron：**每日 02:32**，台灣時間 |
| 歷史逐日回填 | Supabase pg_cron：**每 20 分鐘一次**，台灣時間；每次成功後前進一天 |
| 來源缺口重試 | 另有每四小時一次的缺口重試；記錄於 `ti_backfill_gaps` |
| 初期歷史目標 | 自 2026/11/02 逐日回填至 2026/08/01；目前不代表已完成或涵蓋全國歷史 |
| 保護措施 | `ti_backfill_state` 控制啟用狀態、前進游標、300 MiB 資料表容量警戒 |
| 密鑰保存 | Supabase Vault 儲存排程驗證 token；服務角色金鑰僅在 Supabase Edge Function 環境，不存在公開 Git 或瀏覽器 |

**2026-11-03 實際稽核紀錄**：

- 11/03：2,350 筆公告成功入庫。
- 11/02：2,280 筆公告成功回填。
- 10/30：3,383 筆公告成功回填。
- 10/29：3,320 筆公告成功回填。
- 10/28：2,745 筆公告成功回填。
- 10/27：599 筆公告成功回填。
- 累計 **14,677 筆成功匯入的公告，12,481 件按機關與案號去重的案件**（2026-11-03 實際 SQL 稽核快照，非即時承諾）。
- 10/31 與 11/01：來源 API `/listbydate` 回傳 **HTTP 500**，被明確記錄為缺口；**沒有假裝這兩日零公告，也沒有補編任何公告**，會排程重試。
- 最新完整覆蓋日期及成功／失敗請以資料庫 `ti_ingest_runs`、`ti_backfill_days`、`ti_backfill_gaps` 和網站「資料說明」為準。

**資料授權**：公開 API 可讀取及 API 程式碼開源，**不等於政府採購公告可以任意商用、複製或再授權**。上線營利前仍需向資料提供者及主管機關確認正式商業再利用條件。部分政府開放資料集只涵蓋 GPA 案件，不能代替全國完整公告。

## 二、目前真的做了什麼

| PRD 功能 | 實作／驗收 |
|---|---|
| 公開標案搜尋，含最新公告、案名、統編、廠商、機關 | ✅ 已部署；最新案與機關名稱搜尋經真實瀏覽器驗證 |
| 官方來源連結、單案歷次公告、資料缺漏顯示 | ✅ 已部署；個別案件瀏覽測試成功 |
| 自有 Supabase 歷史查詢 | ✅ 已部署；網站與 SQL 已驗證；**只能搜尋已入庫的日期** |
| 機關／廠商情報 | ✅ 已部署；機關名稱查詢在瀏覽器驗證成功；其他資料品質仍受來源欄位限制 |
| 成交／預算比例 | ⚠️ 僅在來源明確提供兩個金額、樣本數足夠時才可算；不是全國行情 |
| 個人化商機匹配／監控規則／收藏 | ✅ 前端與 Supabase RLS 資料表已部署，單帳戶跨裝置讀寫還需登入實測 |
| 伺服器站內監控提醒 | ✅ 新公告觸發器 + 截止 T−7／T−3／T−1（可自訂 1–30 天）每日 07:50 掃描官方截止時間；保留 `ti_notifications`；新用戶通知仍需端到端測試 |
| Email 訂閱／LINE 推播 | ⚠️ 收件同意、退訂開關、佇列、15 分鐘背景任務、失敗紀錄、LINE OAuth 綁定程式已部署；**專屬金鑰尚未設定，不會寄出** |
| 投標待辦／個人追蹤管理／CSV／ICS | ✅ 已開發，未登入時使用本機資料，登入後轉 Supabase；帳戶協作仍需驗收 |
| 團隊工作區、邀請、權限、共用案件／任務 | ⚠️ 角色 RLS、一次性邀請與介面已部署；尚未用多個真實帳戶做完整驗收 |
| 私有文件保存與下載 | ⚠️ 私有 Supabase Storage、帳戶路徑 RLS 已部署；TXT/MD/PDF/DOCX/XLSX 可本機分析；尚未作實際登入上傳驗收 |
| 瀏覽器本機標單條款整理 | ✅ 可解析文字型 TXT、MD、DOCX、PDF、XLSX；新增舊版／新版原文差異，文字型 PDF 保留頁碼；掃描 PDF 不可辨識 |
| 真 AI 標單引用分析 | ⚠️ `ti-document-ai` 已部署，對原文引用做核對；沒有配置 `OPENAI_API_KEY`，未能完成正式模型呼叫 |
| 價格歷史、重購預告、完整同場競品分析 | ⏳ 需更長期間與特定欄位真資料，**不能在只有少量真實金額時製造結論** |
| 特殊採購、共同供應契約、標售、分包、審查員資料 | ⏳ 尚未全部接入合法且涵蓋範圍清楚的獨立來源 |
| 企業唯讀 API／MCP、完整工作流 AI、付款與電子發票 | ⏳ 尚未全部完成；付款因本次**不區分付費**明確不開放 |

### 2026-11-03 本輪 PRD 補齊事項

| 功能 | 真正運作及限制 |
|---|---|
| **跨日期進階搜尋 F02–F05／U02** | `ti_archive_search` Supabase RPC + `advanced.js` 真正查詢已入庫公告，AND/OR/排除詞、機關、公告狀態、履約地、招標方式、預算、日期、排序、伺服器分頁、查詢網址與 CSV；公開網站與 SQL 已驗證。登入後可由 `ti_saved_searches` RLS 私人儲存／載入完整條件並預覽已入庫近 30 天命中數，尚缺真實跨裝置帳戶驗收。 |
| **雲端履約保證金台帳 U14** | `ti_contract_obligations` 個人 RLS、押標金／履約保證金／驗收／請款／合約到期，使用者自行填日期，T−7/T−3/T−1 自動產生站內提示。未有真實用戶資料可驗證寄達。 |
| **供應商自行刊登 U13** | `ti_vendor_profiles`：自行申報、同意公開、修改／刪除、公開名錄及來源註記，未經政府或平台審核。未有任何真實刊登，不拿研究或公告樣本冒充。 |
| **Go／No-Go V6** | `ti_bid_decisions`：六項證據評估 25/25/15/15/10/10、已核對證據覆蓋率、未知不假設滿分／零分；不是得標率。 |
| **標書原文差異與健檢 V5/V7** | `proposal.js` 比對真正的兩版 PDF/DOCX/XLSX/TXT/MD 原文（本機）；`ti-proposal-check` 真 AI 兩份文件條款健檢必須有原文及頁碼，但正式 AI 金鑰尚未設定。 |
| **登入與刪帳 U01/U11** | Email magic link、Google OAuth、Email 變更、工作區轉讓、確認本人刪除會員/私有文件後端已部署；仍需真實授權帳戶端到端驗收。 |
| **Email 退訂 U11** | `ti-unsubscribe` POST 一鍵停止信件、Resend List-Unsubscribe/RFC8058 標頭、瀏覽器 GET 安全確認頁已部署；寄信供應商金鑰仍未配置，未驗證真正送達或退訂信件。 |
| **持續更新 RSS F16** | [官方來源索引 RSS](https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-rss) 限 30 筆，已從上線服務讀回真實公告標題，不是全國資料流。 |
| **官方拒絕往來公告 F18** | 工程會資料開放集 [5988](https://data.gov.tw/dataset/5988) 每日排程及查詢頁面已部署；第一次直接抓取 **HTTP 請求逾時、0 筆成功入庫**，另記錄於 `ti_external_source_runs`。不得將部分資料源部署稱為已同步成功，不能推定廠商現在仍停權。 |
| **新手指南 F15** | 網頁列出法規核對及實務流程，連回工程會/全國法規資料庫，非法律意見。 |

目前仍缺的 PRD 要求：F17 共同供應契約／財物標售／分包等完整獨立來源，F18 評選委員與最新官方拒往全量資料，F19 有法律授權的企業公開 API/MCP，V2 完整合約重購樣本、V3 完整同場投標者、V4 足夠的可比價格、V7 持久安全的跨文件知識庫。外部資料／金鑰沒有時不能造假實現。

完整逐項驗收參見：[PRD 開發驗收清單](./PRD-實作驗收-2026-11-03.md)。

## 三、外部服務配置（尚未設定）

Edge Function `ti-service-status` 僅公開「是否有設定」的布林值，不會公開密鑰內容。實際讀取為：

| 功能 | Supabase Secrets 需要的名稱 | 目前實際設定 |
|---|---|---|
| AI 文件分析 | `OPENAI_API_KEY` | **未設定** |
| Email 寄送 | `RESEND_API_KEY`、`TI_EMAIL_FROM` | **未設定** |
| LINE 登入綁定 | `TI_LINE_LOGIN_CHANNEL_ID`、`TI_LINE_LOGIN_CHANNEL_SECRET` | **未設定** |
| LINE Messaging API 推播 | `TI_LINE_CHANNEL_ACCESS_TOKEN` | **未設定** |

LINE 開發者後台需要設定 callback `https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-line-connect`。**LINE Login 與 Messaging API Channel 應在同一 LINE Provider 下，不能拿其他專案的 LINE 憑證直接代用。**

不要把私密金鑰貼到 GitHub README、前端 JS、GitHub Pages 或聊天訊息；僅設定在 Supabase Edge Function Secrets。服務未配置時前端要顯示未啟用，不顯示任何假成功。

## 四、檔案與模組

- `index.html`, `styles.css`：同一個桌機／手機響應式網站。
- `core.mjs`：公告日期解析（民國年／台北時區）、去重、金額判讀、CSV 安全性與匹配統計。
- `app.js`, `backend.js`, `delivery.js`：搜尋、會員登入、追蹤、機關／廠商、通知、團隊、文件及真實資料庫查詢。
- `supabase/functions/ti-ingest/index.ts`：每小時 API 入庫、歷史回填、缺口重試、正式公告金額補查。
- `supabase/functions/ti-notify/index.ts`：使用者同意後的 Email/LINE 傳送（缺少供應商密鑰時不得回報已送達）。
- `supabase/functions/ti-line-connect/index.ts`：LINE 官方 OAuth2 身份驗證與使用者自願綁定。
- `supabase/functions/ti-document-ai/index.ts`：需要實際 AI 金鑰與正式登入的文件檢核。
- `supabase/functions/ti-proposal-check/index.ts`：須登入、具備 AI 金鑰的雙文件真實條款引用比對。
- `supabase/functions/ti-delete-account/index.ts`、`ti-unsubscribe/index.ts`：自助刪帳、Email 退訂，只有身分驗證與明確確認後才做不可逆動作。
- `supabase/functions/ti-rss/index.ts`、`ti-debarred-ingest/index.ts`：限量公開公告 RSS、官方拒絕往來資料日同步（目前來源逾時）。
- `advanced.js`,`operations.js`,`proposal.js`,`account-privacy.js`,`debarred.js`：跨日搜尋、CRM／名錄、文件差異、帳號隱私與官方來源狀態頁。
- `supabase/functions/ti-service-status/index.ts`：僅顯示外部服務啟用狀態，不露出私密值。
- `supabase/migrations/`：資料表、角色權限、排程、通知佇列、文件桶、歷史缺口與官方截標 T−N 提醒。
- `tests/core.test.mjs`：已建立的資料解析和安全性測試。
- `.github/workflows/tender-intelligence-check.yml`：Node 語法、單元測試、Edge Function Deno 語法及網頁引用檢查。
- `.github/workflows/tender-intelligence-pages.yml`：更新標案網站至 GitHub Pages，不重建其他 OpenData 專案資料。

## 五、營運驗收必須的剩餘工作

1. 獲得可確認的資料商業使用授權，建立長期可持續的資料來源契約／官方開放資料策略。
2. 持續讓歷史回填跑到實際可用的完整範圍，查清上游 10/31、11/01 缺漏並核實每日期成功。
3. 以兩個真實 Supabase 帳戶測試 Email magic link、儲存追蹤、私人文件隔離、團隊一次性邀請及權限。
4. 在該專案的 Supabase Secrets 設定 AI／Email／LINE 真正服務憑證並完成一次真實推論／寄信／LINE 推播驗收。
5. 在具備實際同場投標、招決標完整金額、契約到期等資料前，禁止標示沒根據的「勝率」、「未公開底價預測」或「精準重購時間」。

## 六、2026-11-05 競品功能整合實作（增量版）

需求範圍以 [PRD 第 17 章](./PRD-台灣標案情報平台-v0.1-2026-11-03.md#17-2026-11-05-競品功能整合改版正式增量需求) 為準；**保留原功能與舊深連結，不啟用收費或付費牆**。以下僅陳述已提交的程式碼、實際建立的資料庫及可確認的限制；靜態語法通過不等於真人瀏覽器／跨帳號驗收已通過。

| 模組 | 實際改動 | 目前驗收界線 |
|---|---|---|
| 五大主功能區 | `nav-groups.js` 將既有 `data-view` 導航依找標案／市場情報／投標工作台／監控與通知／我的公司與設定分組，原事件及深連結保留；`styles.css` 增加手機操作 | 程式語法已檢查，真人手機驗收待補 |
| 單一案件工作區 | `case-workspace.js` 將原案件詳情整理成六分頁；投標評估更新既有 `ti_bid_decisions`，任務更新 `ti_tasks`，合約台帳更新 `ti_contract_obligations`，文件與人工資格核對依 `case_id` 查詢；原版進階功能按鈕保留 | 程式及資料表已存在，真人跨裝置寫入／權限須測 |
| 搜尋整合 | `app.js` 的跨日商機雷達改用與 `advanced.js` 相同的 `ti_archive_search_v5`，避免 v3／v5 行為分歧 | 查詢函式部署前的 JavaScript 靜態驗證完成；首頁其他查詢方式仍未全部統一 |
| 私有公司資料 | `company-workspace.js`＋`ti_company_profiles`、`ti_company_assets`：可保存公司服務、證照、實績、型錄；支援 PDF/DOCX/TXT/MD 私人附件，文件加入既有私人 Storage 與 `ti_documents`。與公開供應商名錄隔離。 | 增量 SQL 已套用、RLS 已啟用；尚無實際使用者資料，真人上傳／下載待驗收 |
| 掃描文件 OCR | `ocr-client.js` 在瀏覽器使用 Tesseract.js 繁中／英文及既有 PDF.js；圖片與掃描 PDF 最多處理前 8 頁；結果可供條款整理及原有 AI 解析流程 | 解析器為動態外部 CDN，仍須用真實掃描檔、瀏覽器與模型作實測；沒有 OCR 時不產生假文字 |
| 資格與公司證據 | `qualification-check.js` 以招標原文頁面找出資格條款，和本人已登錄證照／實績做候選比對，由本人明確標記符合／不符合／待確認；結果寫入新增 RLS `ti_qualification_checks` 並可關聯案件 | **文字候選比對非 AI 資格認證**；真人操作與引用品質待測 |
| 指定競品監控 | `competitor-tracker.js` 保存追蹤名單並可連至公開廠商紀錄；SQL `ti_private.generate_competitor_alerts` 每小時對照新公告與明確來源角色產生站內 `ti_notifications`，不把同公告提及冒充得標。 | 排程已啟用並執行返回正常，監控名單仍為 0 筆，因此尚未驗證真實通知；Email／LINE 外送另依金鑰 |
| 自動報表 | `report-dashboard.js` 建立每日／每週／每月報表排程，後端 `ti_private.generate_scheduled_reports` 每日臺灣時間 08:20 根據已入庫 `ti_cases` 或本人收藏產生私有 `ti_report_jobs` JSON 快照，前端可匯出防公式注入 CSV。 | 排程已啟用、空排程 SQL 檢查成功；目前 0 個會員排程，尚未有真人報表下載驗收；未自動寄出 Email |
| CI／部署 | GitHub 測試與 GitHub Pages 發布 workflow 納入新增 JavaScript 的語法與檔案存在檢查。 | 不能把已提交 workflow 說成已實際通過該次 Actions 及瀏覽器端到端 |

**資料庫快照（2026-11-05 本次 SQL 查核）**：78,334 件案件、157,707 筆公告、1,548 份已補詳情、35 個歷史缺口紀錄。公司輪廓、公司資產、競品監控名單、報表訂閱、資格核對目前均為 0 筆真人資料。以上為入庫樣本，**不是全台完整政府採購資料量**。

**待完成 PRD 17 章功能**：
- AI 語意／向量搜索、真正 AI 公司實績資格判讀、可編輯 AI 建議書／投標初稿及 RAG 語意知識庫（原有 AI 金鑰未完成配置，不能宣稱模型完成）。
- 民間採購、共同供應契約、評選委員、商工董監事／股東關係圖、完整價格／重購模型等**新的合法資料來源**；既有收錄與歷史回補不能冒稱全國全量。
- SMS 發送供應商、Email／LINE 真寄達、排程報表寄送、正式多人工作區與手機操作的完整端到端驗收、PWA／原生 App；目前已做站內競品通知及伺服器報表生成。
- 資料再利用授權及任何商業上線前的資安／資料品質驗收。現階段所有已實作功能保持免費，不新增支付處理。


### 2026-11-05 後續補強：案件文件上傳及市場趨勢

- 單案「文件與標書」分頁已直接共用 `app.js` 的 `saveCloudDocument(file,caseId)` 私有上傳流程；不需離開當前標案，仍沿用原 `ti_documents` 與私人 Storage。按鈕「標書條款解析／私人文件庫」亦會攜帶當前案號。
- 新增 `market-trends.js` 及 RPC `ti_market_trends_v1`，顯示本平台實際已入庫的逐月案件數、公開預算／決標金額有效樣本數、金額合計、採購類別分布，可按月份、機關及採購類別篩選並匯出 CSV。RPC 已用 SQL 查詢驗證，並非全台完整或已可證明的季節性。
- 同步比對 `main` 與 `gh-pages` 的 `index.html`、`app.js`、`case-workspace.js`、`qualification-check.js`、`market-trends.js`、`styles.css`：相同檔案 blob SHA，表示 GitHub Pages 發布分支已收到本次程式；**不等於曾以真實瀏覽器逐操作驗收**。

### 2026-11-05 使用者實測缺口修正／實際線上驗收

本節取代本頁稍早「尚未操作」的**現況**敘述；舊段落保留作歷史。所有改動均在原 GitHub Pages 網站與 Supabase 專案，不另建展示版。

- **P0 私有標書實際上傳**：用 `CASE WHEN bucket_id='wm-private-evidence' THEN wm_private.can_access_evidence(...) ELSE false END` 修改共用 Storage 中其他專案的政策，防止不同 bucket 的 RLS 過早評估不可執行函式而阻斷本系統上傳；不擴權 `wm_private`。原有 `ti-private-documents` 私有 bucket 與本人路徑政策不變。單案可上傳、同案清單查回；公司實績與文件亦支援私有儲存。匿名測試帳號的 E2E 已**確實成功**，且測試了另一帳號看不到本人文件、實績、收藏與報表。
- **P0 競品監控**：`competitor-tracker.js` 修正 `save is not a function` 的變數遮蔽及表單非預期重導。Playwright 已成功新增監控廠商；未假稱實際外送 Email／LINE 已寄達。
- **P0 官方詳情**：`ti-ingest` Supabase Edge Function **第 46 版**已上線；既有 10 分鐘細節補抓從 6 筆增到 8 筆，優先處理尚可投標案件。新增私人 `ti_detail_requests`，本人可在案件詳情按「補抓這件標案的官方詳情」，每天最多 10 件；後台記錄成功／失敗，絕不補填原始公告不存在的欄位。真實 E2E 已證實可成功排入佇列，**資料補齊仍取決於上游取得情況**。
- **P1 採購類別修復**：只以官方 `ti_notices.category` 明確的「工程類／財物類／勞務類」修復 `ti_cases.group_name`，本次來源證據可補正約 **27,630** 件，未分類案件降至約 30,091 件（會隨同步變動），並以 trigger＋pg_cron 增量持續校正。沒有官方類別證據的仍維持未知。
- **P1 搜尋一致性**：首頁「跨日全文搜尋」基於與進階搜尋單詞快查共用的 `ti_case_search_index`，由新 `ti_fast_archive_filtered` 支援全庫的公告類型、類別、最低預算、排序和真正 30 件分頁、總筆數。查「資訊系統」實際 **229 件**，不再把首批 100 件誤認全數；後端直接 SQL 和線上瀏覽器已查核，新的回歸測試仍持續。
- **P1 案件決策入口**：`case-decision-brief.js` 於原六分頁前新增「還能投嗎、資格有證據嗎、預算押標金、文件、下一步任務」與資料完整度、來源更新時間、快捷操作、官方鏈結／補抓請求；不產生無證據的合格判斷。
- **P1 報表**：`ti_generate_report_now(uuid)` 是只依 `auth.uid()` 取得自己的排程與資料的資料庫 RPC，限制每天 12 份。現在提供「立即產生一次／預覽／CSV／最近成功時間／刪除已完成報表」，同時保留原定時排程；真實測試帳號已產生並預覽 1 筆私人案件。
- **P2 監控與手機**：長頁面改四分頁（標案監控／競品追蹤／自動報表／通知設定），原按鈕事件不複製。Chromium 手機 390px 檢查 `scrollWidth=390`，沒有水平超出；公開流程操作可切換四個分頁。
- **測試**：登入操作 E2E 最新完整執行 **14/14 通過，0 個頁面腳本例外**，包含私人文件上傳查回、競品新增、私人報表預覽、人工資格核對及跨帳號 RLS；公開版 E2E 已驗證首頁全文總量、條件篩選、商機、廠商、行情、手機與監控四分頁。網站稽核資料在分支 `tender-ui-audit-results-20261105` 和 `tender-auth-audit-results-20261105`，含每步操作截圖、JSON 和 Markdown。

目前仍未完備的**外部條件**：多數歷史案件的官方截標時間、官方公告與完整資格欄位需持續合法補抓，不能憑既有摘要猜測；上游日期缺漏／歷史涵蓋期間不足；真實 AI 模型金鑰、LINE／Email 實際送達、SMS、評選委員與民間採購合法來源，以及正式多人工作區跨組織完整驗收。**這些不能視為已完成**。

### 2026-11-09 實際續修：短詞搜尋、進階入口、私人績效與來源誠實性

- **短詞卡頓（S01）**：先前已建 `ti_case_search_cjk_bigram_gin`，但 `ti_fast_archive_filtered` 漏掉使用它的條件。本次在保留精確 `LIKE` 原文比對的情況下加入 `ti_cjk_bigrams(searchable) @> ti_cjk_bigrams(needle)`。兩字詞「資安」＋勞務＋招標＋預算下限，在正式 Postgres `EXPLAIN ANALYZE` 實測約 **81ms**；「資訊系統」全庫搜尋約 **578ms**。前者前一輪相似 SQL 查詢曾要約 4.2 秒。原文不是連續中文字的搜尋維持既有正確性，不能以索引直接假稱所有輸入都等速。
- **進階搜尋空條件卡住（S01）**：新增 `ti_archive_search_recent(page,limit)`，使用既有 `ti_cases_latest_date_search` B-tree 並只 join 當頁已知詳情，避免未篩選就走耗時的 `ti_archive_search_v5`。SQL 直接驗證 82,211 件當時已入庫標案、每頁 30 件、第一二頁 ID 不重複；`EXPLAIN ANALYZE` 約 487ms。進階仍保留 AND／OR、日期、金額等需 v5 的完整查詢路徑。
- **投標紀錄成果（W08 部分）**：現有「我的投標工作台」新增使用者自行標註的階段數、參與案件、已得標與已結案勝率；只使用個人收藏中的明確「已得標／未得標」作分母，分母為 0 顯示「—」。不把公開公告視為自己的實際得標，更不稱得標機率。匿名隔離測試用戶的 Playwright **17/17 通過**，包含 100%→0%→「—」的實際畫面變化與私有文件原檔下載／刪除。
- **2026/11/09 同步資料**：當次正式資料庫查核 `ti_cases=82,211`、`ti_notices=164,314`、`ti_case_details=2,400`；已有 `deadline_at` 的案件僅 1,343，仍不可將大多數未知截標日判定為開放投標。31 個歷史日期的第三方 `/api/listbydate` 仍持續回傳 HTTP 500；重試排程正常運作，但未成功補回前必須明確標示涵蓋缺口。
- **部署與測試**：本次 `GitHub Pages` 正式發布和語法／單元測試 Actions 已成功；完整公開瀏覽器驗收由既有 `tender-intelligence-user-journey-audit`、`tender-browser-smoke` 持續核對，**僅以當次成功記錄作正式驗收**。報告及螢幕截圖仍保存在既有 `tender-ui-audit-results-20261105` 與 `tender-auth-audit-results-20261105` 分支。
- **未完成／外部阻礙**：沒有驗證真實 AI 推論、實際 Email／LINE／SMS 送達，或取得評選委員、商工關係、民間採購的合法完整來源；完整掃描檔 OCR、團隊跨組織驗收、W08 備標成本／人時統計也尚未視為通過。**不得把這些項目標為 PRD 全部完成。**

### 2026-11-09 第二輪：真實掃描檔 OCR、團隊角色與資料隔離（已部署）

- **OCR 真正接通文件流程**：`ocr-client.js` 辨識的來源文字透過同檔 `name/size/lastModified` 快取，在 `app.js parseDocument()` 被正確合併到原 PDF 頁碼；PNG/JPG/WebP 需先有本機 OCR 才允許分析。原本空白掃描檔不會再被默認為「沒有資格要求」。偵測 ISO／CNS／英文證照候選原文，結果只供人工核對，不自動判定合法資格。
- **長 PDF 分批辨識**：每批最多 8 頁，選擇起始頁、下一批累計結果；支援本機處理前 150 頁，超出需拆分 PDF。未辨識或 OCR 失敗的頁面明確顯示，文件不會在 OCR 過程自動上傳。目前已以真實無文字層 PDF、圖片、跨頁合併與換檔清快取通過 5/5 操作測試；150 頁壓力驗收尚未執行，不能當成已通過的實測。
- **團隊權限功能**：增設 owner 專用 `ti_set_workspace_member_role`，僅可設定其他成員為 admin/editor/viewer；服務端確認 `auth.uid()` 仍是該工作區擁有者，禁止自行升權或修改 owner。網站加入權限選單與移除成員，工作區專用的固定待辦表單不再因非同步刷新而消失，新增任務必須讀回資料庫 ID 才算成功。
- **登入遮罩與清理修復**：測試帳號登入時不再強制彈出客服浮層；`support.js` 修正不存在元件的 `hidden` 讀取並在 HTML 增加版本識別避開舊快取。團隊工作區刪除級聯子資料時，稽核觸發器不再重新引用已刪除的父工作區，避免外鍵錯誤。
- **正式站三帳號實測**：GitHub Actions <https://github.com/hub-google/OpenData/actions/runs/42547122923>，**6/6 PASS，頁面 JS 例外 0**：擁有者建立案件工作區及任務、一次性邀請碼加入、第三人不能讀/寫或使用已兌換邀請、viewer 只讀且不可升權、編輯者能建立任務、移除後立即不可讀、測試結束清理工作區。
- **真實 OCR 瀏覽器實測**：GitHub Actions <https://github.com/hub-google/OpenData/actions/runs/42547128273>，**5/5 PASS，頁面 JS 例外 0**；後續另有 9 頁 PDF 的「下一批」回歸測試。
- **現階段仍未完成的 PRD 項目**：AI 真實推論需有效模型金鑰；LINE／Email／SMS 真實送達需服務方金鑰、綁定及用戶同意；政府採購歷史日期上游 HTTP 500 缺口仍需補抓；評選委員、企業關係與民間標案需合法來源；跨企業多人實際營運／正式企業邀請和長文件極限負載尚未驗收。不得因前述 6/6、5/5 而宣稱整份 PRD 100% 完成。



### 2026-11-09 v0.2 第一輪：以案件為中心的操作與搜尋

已提交：任務型首頁、快速案況篩選、統一一案一列卡片、官方截標與更正狀態區分、伺服器端單層 30 件分頁、完整案件公告保留在原歷程。修正了「更正決標」錯認為「更正可投」的情形。新增核心規則回歸測試。此更新沿用原本的資料表與 Auth/RLS，沒有清除正式資料。

**資料實例**：2026-11-09 查到「116–117 年度中文圖書採購」為不同機關的三個不同案號，各有三次公告，因此應顯示三件案件，不可按同名強制合併；每件內顯示自己的無法決標及後續招標事件。

**未完成**：單案四分頁、跨機關相關標案線索、搜尋模式全量一致性、補抓優先序強化、通知實際送達與登入完整 E2E。此段只代表程式已提交；以正式 GitHub Pages 發布及當次 Actions 成功記錄判定網站驗收。
