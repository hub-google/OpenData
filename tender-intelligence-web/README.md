# 台灣政府標案情報中心（2026-11-03）

> 官方網站：https://hub-google.github.io/OpenData/tender-intelligence-web/
>
> 需求規格：[PRD v0.1](./PRD-台灣標案情報平台-v0.1-2026-11-03.md)
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
| **跨日期進階搜尋 F02–F05** | `ti_archive_search` Supabase RPC + `advanced.js` 真正查詢已入庫公告，AND/OR/排除詞、機關、公告狀態、履約地、招標方式、預算、日期、排序、伺服器分頁、查詢網址與 CSV；以真實公開網站及 SQL 驗證。 |
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
