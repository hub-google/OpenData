# 標案網站測試帳號實際操作報告

時間：2026-11-06T00:57:06.136Z
使用獨立匿名測試帳號；資料為非真實公司測試資訊。

| 測試 | 結果 | 資料庫或網頁回應 |
|---|---|---|
| 使用網站的一鍵測試帳號登入 | PASS | {"account_button":"測試帳號已登入","screen":"11-login.png"} |
| 建立私人公司資料並儲存 | PASS | {"status":"已儲存私人公司資料。","screen":"12-company-save.png"} |
| 新增公司實績並查回清單 | PASS | {"status":"已載入自己的公司資料與 1 筆能力紀錄。這些資料由本人填寫，未經官方查證。","visible":"【稽核測試-20261105-6583025】模擬維護實績\n履約實績\n核發／客戶：測試來源（非真實） · 說明：這筆資料僅驗證表單與資料庫寫入，不表示真實資格。\n刪除","screen":"13-company-asset.png"} |
| 從真實標案詳情加入私人追蹤 | PASS | {"button":"移除追蹤 機關統計 複製此案專屬連結 資料 API ↗ 官方原始公告 ↗","screen":"14-save-case.png"} |
| 官方資料缺漏補抓請求 | PASS | {"status":"投標前先確認這五件事 ① 還能投嗎？ 尚未到官方截止時間 2026/12/8 下午5:00 ② 資格符合嗎？ 資格要求尚未取得 不能自動判定符合 ③ 金額與擔保 31,450,000 元 押標金原文：1572500 ④ 該準備什麼？ 招標文件與附件須人工核對 標書解析會記錄原文頁碼 ⑤ 下一步誰負責？ 建立投標待辦並指派 可在工作區追蹤期限 已送入定時官方資料補抓佇列。請稍後重新打開案件檢查；仍無資料時會顯示來源缺值。 核對資格與標書 評估是否投標 建立待辦 已加入補抓佇列 開啟官方公告"} |
| 案件詳情：儲存投標評估 | PASS | {"status":"決策已保存到此案件，其他頁面可繼續編輯。 案件投標決策 決策狀態 評估中 建議追蹤 準備投標 不投 決策依據／待確認事項 儲存案件決策 完整六項證據評估","screen":"15-decision.png"} |
| 案件詳情：新增待辦事項 | PASS | {"content":"案件待辦與任務 任務名稱 截止日期 新增任務 【稽核測試-20261105-6583025】核對招標資格 未設定期限","screen":"16-task.png"} |
| 案件詳情：直接上傳私人文件 | PASS | {"content":"已同步 1 份本案件私人文件。 此案的私有標書與 AI 文件 可繼續使用原本的標書解析與兩版原文比較；已有雲端文件會依案件編號顯示。AI 需要正式可用的模型服務。 標書差異與 AI 健檢 標書條款解析／私人文件庫 選擇本案文件（PDF、DOCX、TXT、MD，15MB 以內） 上傳至此案文件庫 tender-audit-check.txt｜uploaded 下載文件 刪除文件 此案已保存的資格核對","toast":"已保存私有文件至 Supabase Storage。","screen":"17-document.png"} |
| 下載單案私有文件並確認原始位元內容 | PASS | {"filename":"tender-audit-check.txt","bytes":163} |
| 標書條款：公司實績候選比對並保存 | PASS | {"check_count":1,"status":"比對結果已保存至私人資料庫並關聯此標案；「本人核對」由你自行負責確認。","screen":"18-qualification.png"} |
| 監控：新增測試用競品條件 | PASS | {"status":"已保存 1 個指定廠商。可直接查詢其真實公告；自動異動推播仍需來源事件與通知服務驗收。","url":"https://hub-google.github.io/OpenData/tender-intelligence-web/?case_unit=3.1.1&case_no=UT-11601","screen":"19-competitor.png"} |
| 報表：建立每日測試排程 | PASS | {"status":"已立即產生報表，可在下方預覽與下載 CSV。","preview":"case_id title agency stage internal_deadline added_at 3.1.1::UT-11601 116年資安設備維護及技術服務委託案 內政部警政署 評估中 尚無資料 2026-11-06T00:56:35.746592+00:00 僅預覽前 1 筆；匯出時保留這份報表全部 1 筆／組。","download":"標案報表_my_pipeline_2026-11-06.csv","bytes":209,"screen":"20-report.png"} |
| 私人資料跨帳號隔離測試 | PASS | {"docs":0,"assets":0,"cases":0,"reports":0,"errors":[]} |
| 返回頁面：確認私人公司資料跨頁保存 | PASS | {"company":"【稽核測試-20261105-6583025】模擬資安服務公司","asset":"【稽核測試-20261105-6583025】模擬維護實績 履約實績 核發／客戶：測試來源（非真實） · 說明：這筆資料僅驗證表單與資料庫寫入，不表示真實資格。 刪除","screen":"21-readback.png"} |
| 刪除單案私人文件並確認已從資料庫移除 | PASS | {"remaining":0} |
| 清理本次測試帳號下的私人測試資料 | PASS | {"cleanup":{"ti_detail_requests":"delete requested","ti_qualification_checks":"delete requested","ti_report_jobs":"delete requested","ti_report_schedules":"delete requested","ti_competitor_watches":"delete requested","ti_company_assets":"delete requested","ti_company_profiles":"delete requested","ti_bid_decisions":"delete requested","ti_tasks":"del |

頁面 JS 例外：0
未實測 Email/LINE 對外寄達，也沒有建立真實採購契約。