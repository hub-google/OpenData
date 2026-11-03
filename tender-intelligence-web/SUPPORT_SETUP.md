# 政府標案情報中心｜客服功能部署與管理

## 已實作（2026-11-03）

- **所有網站頁面右下角懸浮客服**，手機／電腦響應式顯示。
- 客服入口只保留兩種：**AI 即時對話**和**問卷型問題回報／真人站內回覆**；不設 Email 客服管道。
- 第三個分頁「我的紀錄」可查看 AI 對話、工單、真人回覆並補充留言；後台客服人員登入會顯示第四個「客服管理」分頁。
- AI 轉真人會把前面的對話紀錄帶入表單；提交後建立工單編號，登入會員可以跨裝置查詢。
- 對話、固定回覆、表單與工單回覆都寫入既有 Supabase 的 `ti_support_threads`、`ti_support_messages`；客服員權限寫入 `ti_support_staff`。
- 所有資料表 RLS 已開啟，訪客／會員無法直接讀取私有表；需透過 Edge Function `ti-support` 驗證後存取。
- 每一個訪客憑證每日 AI 最多 30 則、表單最多 6 筆；AI 啟用後全站每日最多 500 次 AI 呼叫，表單每日最多 1,000 筆（資料庫原子限額）。
- 2026-11-03 已完成未登入瀏覽器的送出 AI 訊息、預設回覆、表單建立、工單查詢與 Supabase SQL 入庫驗證；測試資料已清除。新增會員隔離／管理員自動綁定／全站配額後，仍應以實際登入會員完成最終驗收。

## AI 客服金鑰

目前 **未偵測到這個 Supabase 專案可用的 Gemini 金鑰**，所以按原需求返回「AI 客服功能開發中……」，仍會保存用戶對話。

- 到 [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/unapiwajmgqqtdkixaab/settings/functions) 新增 `GEMINI_API_KEY`。
- 可支援 `GOOGLE_API_KEY` 或 `GOOGLE_GENERATIVE_AI_API_KEY` 作為替代名稱。
- 後端模型 `gemini-3.5-flash-lite`，透過 Google 官方 API 呼叫。金鑰只存於 Supabase，不得放進公開 GitHub 程式、前端 JS、對話或 README。
- 伺服器會立即讀取新 Secret；無需重新提交 GitHub。若服務不可用，告知用戶改用人工回報，**不冒充 AI 成功回覆**。
- GitHub Actions 的其他專案 Secret 無法取出明文，也不會自動共享到本專案。

## 真人客服管理員

由於客服後台會看到私人問題，不能讓所有會員擁有管理權限。

- 已在現有 Supabase 私有表 `ti_support_admin_owners` 預先保存**此 GitHub 專案擁有者帳號**所綁定信箱的 SHA-256 摘要（不公開信箱或明文）。
- 專案擁有者使用**相同且已驗證的信箱**，在 [標案情報中心](https://hub-google.github.io/OpenData/tender-intelligence-web/) 透過原有「登入／跨裝置同步」完成登入後，再開啟右下角「客服中心」，系統會自動比對私有白名單、加入 `ti_support_staff`，並顯示「客服管理」分頁。
- 目前尚無該已驗證登入工作階段，所以 `ti_support_staff` 暫無成員；**未宣稱已實際測試真人回覆**。
- 也可以由專案擁有者在 Supabase SQL Editor 手動授予其他已驗證會員客服權限：

```sql
insert into public.ti_support_staff(user_id)
select id from auth.users
where lower(email)=lower('<已驗證會員的登入信箱>')
  and email_confirmed_at is not null
on conflict (user_id) do nothing;
```

- `ti_support_admin_owners` 僅允許 service_role 讀取，`ti_support_staff` 的一般使用者權限也全部撤銷。
- 客戶匿名提問只能以同一瀏覽器的隨機憑證讀取；已驗證會員登入後，之前在該瀏覽器匿名提交的工單會歸入其會員帳號；歸屬會員的紀錄不能再被其他帳號僅憑同一瀏覽器的識別值讀取。

## 相關位置

- **前端**：`support.js`、`support.css`，由 `index.html` 引入。
- **Edge Function**：`supabase/functions/ti-support/index.ts`，`https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-support`。
- **資料表與權限**：`supabase/migrations/*ti_support*.sql`。
- **發布**：`.github/workflows/tender-intelligence-pages.yml`。
- **語法檢查**：`.github/workflows/tender-intelligence-check.yml`。
