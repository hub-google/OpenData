# 政府標案情報中心｜客服功能

## 現況（2026-11-03）

- 右下角「客服中心」已部署於所有網頁（桌面／手機共用）。
- 分頁：AI 客服、問題回報、我的紀錄；授權客服管理員登入後額外顯示「客服管理」。
- AI 訊息與固定回覆、表單工單、真人回覆／客戶補充留言均保存於現有 Supabase 專案 `unapiwajmgqqtdkixaab`。
- 無 Email 客服、Email 回覆或第三方客服網站。
- 未設定 Gemini 金鑰時，會實際保存訊息並回覆「AI 客服功能開發中」；**不會假裝模型已回答**。
- 2026-11-03 實際瀏覽器測試：訪客 AI 對話、提交工單、工單編號與歷史查閱均成功，資料經 SQL 查驗後已清除測試工單。

## AI 配置（不可在 GitHub 或前端存放 API key）

1. 到 [Supabase 專案 Edge Function Secrets](https://supabase.com/dashboard/project/unapiwajmgqqtdkixaab/settings/functions)。
2. 新增 `GEMINI_API_KEY`（或 `GOOGLE_API_KEY`），值為有效的 Gemini API Key。
3. `ti-support` Edge Function 會自動從伺服器環境讀取，不必修改前端或再次提交金鑰至 GitHub。
4. 預設使用 `gemini-3.5-flash-lite`，每個訪客識別值每 24 小時最多 30 則 AI 提問。正式商業服務前應額外評估 Turnstile、IP 速率限制、配額與成本告警。
5. 只有確實配置金鑰與 Gemini 回應成功時，才會顯示模型回答；連線錯誤會顯示錯誤轉真人引導，不會捏造答案。

注意：GitHub Actions Secrets 是不可讀回的，其他專案的金鑰不會自動傳遞到此 Supabase 函式。

## 初次開通真人客服管理員

客服管理員必須先用正式網站的「登入／跨裝置同步」完成驗證。**不能讓任意訪客自行註冊管理員。**

取得使用者已驗證的登入帳號後，從 Supabase SQL Editor 執行一次以下 SQL，將 `<你的登入信箱>` 換成該管理員實際登入信箱：

```sql
insert into public.ti_support_staff(user_id)
select id from auth.users
where lower(email)=lower('<你的登入信箱>') and email_confirmed_at is not null
on conflict (user_id) do nothing;
```

之後重新登入或重新開啟客服視窗，即可在第四個分頁「客服管理」看見真人回報的工單、修改狀態和站內回覆。未授權帳號呼叫後台 API 會遭拒絕。

## 服務 API 與資料庫

- 網址：`https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-support`
- Edge Function：`supabase/functions/ti-support/index.ts`，部署時 `verify_jwt=false`，但會在每次請求中自行驗證會員 JWT 或隨機訪客憑證，管理操作需進一步查詢客服人員名單。
- 資料表：`ti_support_threads`、`ti_support_messages`、`ti_support_staff`。
- 資料庫表均開啟 RLS 且不直接開放匿名或一般登入會員存取；應用程式須經過受控 Edge Function。
- 未登入使用者的紀錄只可用同一瀏覽器保存的隨機憑證讀取；清除本機資料、換裝置或無痕模式後可能無法再找回。建議長期會員以登入狀態提交。
- 真人問題回報每天同一瀏覽器上限 6 筆，補充訊息每筆上限 50 則、需間隔 5 秒。
- 驗收用測試工單已在 SQL 檢查寫入成功後刪除，不混入正式用戶資料。
