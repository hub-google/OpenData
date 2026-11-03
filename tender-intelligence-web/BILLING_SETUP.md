# 台灣標案情報中心：綠界金流開通與驗收

> 2026-11-03。已建置資料庫、收費頁、Supabase Edge Function；尚未開通真實收款。請勿把本文當作商家帳戶已審核通過的證明。

## 收款流程
1. 會員 Email 驗證登入 → 左側「方案與帳務」 → 選擇個人 NT$590／月、專業 NT$1,590／月、團隊 NT$3,990／月（均為 PRD 測試假設，正式上線前由經營者確認）。
2. 預設選擇信用卡／ATM／超商等支援通路「單次購買一個月」；**信用卡每月定期扣款只有綠界特約賣家、且取得定期定額核准後才可啟用**。一般賣家先以單次收費上線，不必為了訂閱方案先承擔特約賣家合約成本。
3. 後端以資料庫鎖定售價、產生不重複訂單並簽署表單；前端只跳轉至 ECPay 託管頁，不接觸卡號。
4. ECPay 付款成功後以伺服器 POST 回報；後端比對 MerchantID、CheckMacValue、金額、訂單及防重鍵；成功後在 ti_billing_payments 入帳並延長 ti_billing_subscriptions 1 個月。
5. 使用者返回本站「方案與帳務」，查看訂閱有效日、歷史訂單。自動扣款者可透過綠界 API 終止未來扣款，不會把停止續訂當作退款。
6. 收款款項進入綠界賣家結算帳戶，再依平台條款提領／撥款至商家驗證的銀行帳戶；本站無法代行銀行實名驗證。

## 經營者必須親自完成的事項
- 在 **https://www.ecpay.com.tw/** 註冊綠界正式賣家，完成公司／商家資料、負責人實名、結算銀行帳戶與收單審核；若要每月自動扣款，須另向綠界申請特約賣家及確認「信用卡定期定額」獲准；一般賣家通常僅有國內信用卡一次付清、ATM、超商等。
- 實際填寫商店名稱、公司／商號與統編（如適用）、客服 Email／電話、商家地址與合法營運資訊。
- 向消費者明示訂閱價格、每月扣款方式、停止續費規定、退款辦法、服務條款、隱私權、發票／收據處理方式；電子發票開立須依經營實體及稅務規定準備，**本版尚未串接自動電子發票、退款 API**。
- 確定第三方 OpenFun/PCC 政府採購來源的商業利用、重製及留存授權。此授權問題與收費系統是否能工作是不同議題。
- 將正式 MerchantID、HashKey、HashIV 安全地設於 **Supabase Edge Functions Secrets**；**不得**貼在 GitHub、Issues、網頁 JavaScript、PR 或公開文件。
- 經測試卡交易、定期扣款回傳、退款／取消確認與實際小額刷卡驗證後，才改為允許付款。

## 金鑰與開關（只放 Supabase secrets）
- `ECPAY_MERCHANT_ID`：綠界正式特店編號。
- `ECPAY_HASH_KEY`：特店 HashKey。
- `ECPAY_HASH_IV`：特店 HashIV。
- `ECPAY_ENVIRONMENT`：`stage`（測試）或 `production`（正式）。**預設實作為 production，但未取得金鑰且未明確啟用時，不可能建立付款訂單。**
- `TI_BILLING_CHECKOUT_ENABLED`：必須明確設成 `true` 才開放單次結帳；預設未設定。
- `TI_BILLING_RECURRING_ENABLED`：僅取得綠界特約賣家資格、核准定期定額且完成測試後設成 `true`；預設未設定，前台自動扣款選項停用。
- Supabase 已注入既有 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（後端專用）。
- **不使用 GitHub Actions Secrets 來代替 Supabase Edge Function Secrets**，避免金鑰存在與服務執行環境不同的地方。

正式後端：`https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-billing`

對外狀態：`GET /?mode=plans` 返回 `ready:false` 時，網站付款按鈕將停用；`supports_recurring:false` 時自動扣款選項停用。
會員 API：
- `GET ?mode=status`（須 Supabase JWT）：個人訂閱與訂單狀態。
- `POST` `{"action":"checkout","plan":"personal","kind":"recurring"}`（須 JWT）：建立並回傳 ECPay 託管付款表單。
- `POST` `{"action":"cancel"}`（須 JWT）：請綠界終止該筆定期定額未來扣款。
- `POST` application/x-www-form-urlencoded 至 Edge Function：綠界第一筆付款通知。
- `POST` application/x-www-form-urlencoded 至 Edge Function `?period=1`：綠界第二期起定期授權通知；以 TotalSuccessTimes 做防重複處理。
- 接收 `SimulatePaid=1` 時不會當作真實付款。

## 上線前測試清單
- [ ] 綠界 KYC／商家與銀行帳戶審核完成，且定期扣款已開通。
- [ ] 與綠界提供的官方測試值核對 CheckMacValue 計算。
- [ ] 測試客戶單次信用卡、ATM 與超商付款的回調、到期日與訂單狀態。
- [ ] 測試定期定額第一次授權、第二次 PeriodReturnURL、重送通知、模擬付款通知不入帳。
- [ ] 測試取消續費是否真的在綠界終止；拒付／退款要有人工處理流程。
- [ ] 跨會員帳戶查詢 RLS 權限，不得讀取別人的訂單及付款資料。
- [ ] 商品說明、付款條款、客服與退款資訊、電子發票方案、商用資料授權，全部完成後才能正式啟用 `TI_BILLING_CHECKOUT_ENABLED=true`。
- [ ] 對於 PeriodReturnURL 可能漏送的情形，應有定期與綠界對帳／補單程序；現在尚未做自動定期對帳。

## 系統現況
- 已完成：前端方案與帳務、金流訂單、資料表、付款通知簽章及冪等入帳、定期定額停止續費入口、後端部署。
- 尚未完成：綠界商家開戶／審核、真實金鑰、金流沙盒及真實刷卡端到端驗收、電子發票與退款 API、週期性自動對帳。
- **現有搜尋等既有功能仍維持免費。** 付款功能未開放不代表網站服務無法使用。

官方技術文件：
- https://support.ecpay.com.tw/25120/ （綠界賣家類型／定期定額開通資格）
- https://developers.ecpay.com.tw/2868/ （定期定額）
- https://developers.ecpay.com.tw/5631/ （定期付款結果）
- https://developers.ecpay.com.tw/2900/ （取消定期定額）
- https://developers.ecpay.com.tw/2902/ （CheckMacValue）
