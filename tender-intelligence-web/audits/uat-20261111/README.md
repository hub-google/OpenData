# 標案平台 145 情境｜真實瀏覽器執行證據

- 執行時間 UTC：2026-11-11T08:49:32.863Z
- 目標正式網站：https://hub-google.github.io/OpenData/tender-intelligence-web/
- 環境：GitHub Actions Linux／Playwright Chromium，匿名瀏覽器，不使用正式客戶資料
- 狀態解讀：PASS＝完整驗收；PARTIAL＝已實際操作部分 UI，但未完成全部 UAT；BLOCKED＝未具備安全授權或外部服務；FAIL＝已測步驟失敗
- **每個 UAT 都有一張由真實瀏覽器擷取的截圖（若 screenshot_ok=false 則需補拍），但有截圖不代表整個操作流程成功。**
- 結果數量：{"PARTIAL":63,"PASS":2,"BLOCKED":73,"FAIL":7}
- 已有逐功能截圖：145/145；跨功能流程截圖：8/8

| 案例 | 優先 | 狀態 | 實際操作／阻礙 | 截圖 |
|---|---|---|---|---|
| UAT-001 新訪客直接使用 | P0 | PARTIAL | 搜尋畫面回應：從已同步的政府採購公告資料庫查詢，不使用模擬案件 | [截圖](screenshots/UAT-001.png) |
| UAT-002 六大主選單 | P1 | PASS | 六大主功能區已逐一點擊 | [截圖](screenshots/UAT-002.png) |
| UAT-003 手機與返回定位 | P1 | PARTIAL | 手機寬度下水平溢出=false；已用手機漢堡選單進入搜尋區 | [截圖](screenshots/UAT-003.png) |
| UAT-004 瀏覽器重整與離線 | P1 | PARTIAL | 重整後網站可載入 | [截圖](screenshots/UAT-004.png) |
| UAT-005 正式帳號登入與同步 | P1 | BLOCKED | 已檢查對應頁面；完整寫入／權限測試需要獨立授權條件 | [截圖](screenshots/UAT-005.png) |
| UAT-006 變更信箱與刪除帳號 | P1 | BLOCKED | 已檢查對應頁面；完整寫入／權限測試需要獨立授權條件 | [截圖](screenshots/UAT-006.png) |
| UAT-007 Demo 入口隔離 | P2 | PASS | 一般入口測試捷徑顯示=false；demo=1 測試捷徑顯示=false | [截圖](screenshots/UAT-007.png) |
| UAT-008 關鍵字搜尋 | P0 | PARTIAL | 搜尋畫面回應：最新標案｜本頁 0 件（每個案件僅顯示一筆，依機關與案號去重；非全國完整資料）｜全部篩選與排序先在資料庫完成 | [截圖](screenshots/UAT-008.png) |
| UAT-009 一案多公告去重 | P0 | PARTIAL | 當頁案件卡=0,重複摘要=0 | [截圖](screenshots/UAT-009.png) |
| UAT-010 官方截止未到 | P0 | PARTIAL | 情境切換：從已同步的政府採購公告資料庫查詢，不使用模擬案件 | [截圖](screenshots/UAT-010.png) |
| UAT-011 三日內截止 | P0 | PARTIAL | 情境切換：從已同步的政府採購公告資料庫查詢，不使用模擬案件 | [截圖](screenshots/UAT-011.png) |
| UAT-012 百萬以下預算 | P0 | PARTIAL | 情境切換：從已同步的政府採購公告資料庫查詢，不使用模擬案件 | [截圖](screenshots/UAT-012.png) |
| UAT-013 無法決標及近期更正 | P0 | PARTIAL | 情境切換：從已同步的政府採購公告資料庫查詢，不使用模擬案件 | [截圖](screenshots/UAT-013.png) |
| UAT-014 多軸綜合條件 | P1 | FAIL | locator.fill: Timeout 6500ms exceeded. Call log: - waiting for locator('#budgetFilter') - locator resolved to <input min="0" step="10000" type="number" placeholder="不限" i | [截圖](screenshots/UAT-014.png) |
| UAT-015 台／臺同義與搜尋穩定性 | P1 | PARTIAL | 台北：從已同步的政府採購公告資料庫查詢，不使用模擬案件；臺北：從已同步的政府採購公告資料庫查詢，不使用模擬案件 | [截圖](screenshots/UAT-015.png) |
| UAT-016 可重現普通搜尋 URL | P1 | PARTIAL | 重整後可分享的網址：https://hub-google.github.io/OpenData/tender-intelligence-web/?mode=title&q=%E8%B3%87%E5%AE%89 | [截圖](screenshots/UAT-016.png) |
| UAT-017 匯出 CSV、RSS、重整 | P1 | PARTIAL | CSV 下載：標案查詢-2026-11-11.csv | [截圖](screenshots/UAT-017.png) |
| UAT-018 布林運算優先順序 | P0 | FAIL | locator.click: Timeout 4500ms exceeded. Call log: - waiting for locator('#advSubmit').first() - locator resolved to <button disabled type="submit" id="advSubmit" class="p | [截圖](screenshots/UAT-018.png) |
| UAT-019 片語及額外排除 | P1 | FAIL | locator.click: Timeout 4500ms exceeded. Call log: - waiting for locator('#advSubmit').first() - locator resolved to <button disabled type="submit" id="advSubmit" class="p | [截圖](screenshots/UAT-019.png) |
| UAT-020 官方與公開預算篩選 | P0 | FAIL | locator.click: Timeout 4500ms exceeded. Call log: - waiting for locator('#advSubmit').first() - locator resolved to <button disabled type="submit" id="advSubmit" class="p | [截圖](screenshots/UAT-020.png) |
| UAT-021 清除與分享搜尋 | P1 | PARTIAL | 清除條件後詞= | [截圖](screenshots/UAT-021.png) |
| UAT-022 儲存並載入條件 | P1 | PARTIAL | 儲存／預覽規則入口存在=true/true（匿名寫入未執行） | [截圖](screenshots/UAT-022.png) |
| UAT-023 30 日命中預覽與刪除 | P1 | PARTIAL | 儲存／預覽規則入口存在=true/true（匿名寫入未執行） | [截圖](screenshots/UAT-023.png) |
| UAT-024 伺服器分頁及匯出本頁 | P2 | FAIL | locator.click: Timeout 4500ms exceeded. Call log: - waiting for locator('#advSubmit').first() - locator resolved to <button disabled type="submit" id="advSubmit" class="p | [截圖](screenshots/UAT-024.png) |
| UAT-025 四大案件主分頁 | P0 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-025.png) |
| UAT-026 最新公告與修正沿革 | P0 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-026.png) |
| UAT-027 缺失欄位處理 | P0 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-027.png) |
| UAT-028 正式官方來源連結 | P0 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-028.png) |
| UAT-029 發起詳情補抓 | P1 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-029.png) |
| UAT-030 同公告廠商與資料脈絡 | P1 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-030.png) |
| UAT-031 案件詳情快速工具 | P1 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-031.png) |
| UAT-032 詳情關閉與鍵盤操作 | P2 | BLOCKED | 目前尚無可開啟的正式案件 | [截圖](screenshots/UAT-032.png) |
| UAT-033 自然語意找相似採購 | P1 | BLOCKED |  | [截圖](screenshots/UAT-033.png) |
| UAT-034 無模型金鑰安全退場 | P0 | PARTIAL | AI 結果： | [截圖](screenshots/UAT-034.png) |
| UAT-035 30 次用量限制 | P1 | BLOCKED |  | [截圖](screenshots/UAT-035.png) |
| UAT-036 私人問答引用驗證 | P0 | BLOCKED |  | [截圖](screenshots/UAT-036.png) |
| UAT-037 建立個人業務輪廓 | P1 | PARTIAL | 商機雷達：請儲存關鍵字，再點「查詢資料庫跨日商機」。只看已入庫資料，未知預算與截止日會顯示待核對。 | [截圖](screenshots/UAT-037.png) |
| UAT-038 跨日全庫商機查詢 | P0 | PARTIAL | 商機雷達：正在自有資料庫跨日搜尋實際已入庫招標公告（不包含更正或決標），並排序關鍵字關聯性… | [截圖](screenshots/UAT-038.png) |
| UAT-039 期望履約區域處理 | P1 | PARTIAL | 商機雷達：正在自有資料庫跨日搜尋實際已入庫招標公告（不包含更正或決標），並排序關鍵字關聯性… | [截圖](screenshots/UAT-039.png) |
| UAT-040 輪廓編輯與排除 | P1 | PARTIAL | 商機雷達：正在自有資料庫跨日搜尋實際已入庫招標公告（不包含更正或決標），並排序關鍵字關聯性… | [截圖](screenshots/UAT-040.png) |
| UAT-041 商機匹配解釋 | P2 | PARTIAL | 商機雷達：正在自有資料庫跨日搜尋實際已入庫招標公告（不包含更正或決標），並排序關鍵字關聯性… | [截圖](screenshots/UAT-041.png) |
| UAT-042 以機關代碼查年度資料 | P1 | PARTIAL | 機關輸出：正在讀取機關已入庫統計… | [截圖](screenshots/UAT-042.png) |
| UAT-043 從案件跳機關 | P1 | PARTIAL | 機關輸出：正在讀取機關已入庫統計… | [截圖](screenshots/UAT-043.png) |
| UAT-044 月別採購與去重 | P0 | PARTIAL | 機關輸出：正在讀取機關已入庫統計… | [截圖](screenshots/UAT-044.png) |
| UAT-045 疑似週期性重購 | P1 | PARTIAL | 機關輸出：正在讀取機關已入庫統計… | [截圖](screenshots/UAT-045.png) |
| UAT-046 得標商排行樣本集中度 | P1 | PARTIAL | 機關輸出：正在讀取機關已入庫統計… | [截圖](screenshots/UAT-046.png) |
| UAT-047 公司名稱及統編查詢 | P1 | PARTIAL | 廠商查詢：載入中 | [截圖](screenshots/UAT-047.png) |
| UAT-048 廠商別名證據 | P0 | PARTIAL | 廠商查詢：載入中 | [截圖](screenshots/UAT-048.png) |
| UAT-049 同公告其他公司 | P0 | PARTIAL | 廠商查詢：載入中 | [截圖](screenshots/UAT-049.png) |
| UAT-050 已核對投標／得標角色 | P1 | PARTIAL | 廠商查詢：載入中 | [截圖](screenshots/UAT-050.png) |
| UAT-051 空資料與來源缺漏 | P1 | PARTIAL | 廠商查詢：載入中 | [截圖](screenshots/UAT-051.png) |
| UAT-052 無法決標狀態清單 | P0 | FAIL | locator.click: Timeout 4500ms exceeded. Call log: - waiting for locator('#issueSubmit').first() - locator resolved to <button disabled type="submit" id="issueSubmit" clas | [截圖](screenshots/UAT-052.png) |
| UAT-053 官方快截止 | P0 | PARTIAL | 無法決標／快截止狀態：在已入庫資料中找到 5,159 案；依該案最近已入庫的公告類型為「無法決標」，不推定後續一定重招。 | [截圖](screenshots/UAT-053.png) |
| UAT-054 只用有效決標金額比 | P0 | PARTIAL | 行情樣本：正在讀取跨日真實價格樣本… | [截圖](screenshots/UAT-054.png) |
| UAT-055 行情條件分層 | P1 | PARTIAL | 行情樣本：正在讀取跨日真實價格樣本… | [截圖](screenshots/UAT-055.png) |
| UAT-056 分位數及樣本門檻 | P1 | PARTIAL | 行情樣本：正在讀取跨日真實價格樣本… | [截圖](screenshots/UAT-056.png) |
| UAT-057 跨年度市場趨勢 | P1 | PARTIAL | 行情樣本：正在讀取跨日真實價格樣本… | [截圖](screenshots/UAT-057.png) |
| UAT-058 收藏與去重 | P0 | PARTIAL | 追蹤待辦入口=true；私人測試寫入未執行 | [截圖](screenshots/UAT-058.png) |
| UAT-059 編輯投標階段與備註 | P1 | PARTIAL | 追蹤待辦入口=true；私人測試寫入未執行 | [截圖](screenshots/UAT-059.png) |
| UAT-060 新增、完成、刪除待辦 | P1 | BLOCKED | 追蹤待辦入口=true；私人測試寫入未執行 | [截圖](screenshots/UAT-060.png) |
| UAT-061 個人投標成果 | P0 | PARTIAL | 追蹤待辦入口=true；私人測試寫入未執行 | [截圖](screenshots/UAT-061.png) |
| UAT-062 CSV／Excel／ICS 匯出 | P1 | PARTIAL | 匯出：page.waitForEvent: Timeout 4500ms exceeded while waiting for event "download" ======================；追蹤待辦入口=true；私人測試寫入未執行 | [截圖](screenshots/UAT-062.png) |
| UAT-063 JSON 備份與匯入 | P1 | BLOCKED | 追蹤待辦入口=true；私人測試寫入未執行 | [截圖](screenshots/UAT-063.png) |
| UAT-064 兩帳號私人隔離 | P0 | BLOCKED | 追蹤待辦入口=true；私人測試寫入未執行 | [截圖](screenshots/UAT-064.png) |
| UAT-065 六項決策證據 | P0 | BLOCKED | 決策頁：證據覆蓋率 0／100 權重 已核對條件中的符合權重：0／0；未核對 100 權重。這不是得標率，也不是在所有權重均有資料前的完整適配分數。 仍須人工確認：產品類別及文本相符、法定資格與實績已核實、履約地點與承作規模、準備時間與交件條件、具有可比的歷史競爭證據、有證據支持的公司毛利／商業考量 | [截圖](screenshots/UAT-065.png) |
| UAT-066 Go／No-Go 紀錄 | P1 | BLOCKED | 決策頁：請選擇已收藏的真實標案。 | [截圖](screenshots/UAT-066.png) |
| UAT-067 公司承接適配重新評估 | P1 | BLOCKED | 決策頁：請選擇已收藏的真實標案。 | [截圖](screenshots/UAT-067.png) |
| UAT-068 修改資料後結果更新 | P1 | BLOCKED | 決策頁：請選擇已收藏的真實標案。 | [截圖](screenshots/UAT-068.png) |
| UAT-069 兩案獨立決策 | P0 | BLOCKED | 決策頁：請選擇已收藏的真實標案。 | [截圖](screenshots/UAT-069.png) |
| UAT-070 純文字與 Office 文件檢核 | P1 | PARTIAL | TXT 本機整理結果： | [截圖](screenshots/UAT-070.png) |
| UAT-071 PDF 文字層解析 | P1 | PARTIAL |  | [截圖](screenshots/UAT-071.png) |
| UAT-072 掃描 PDF OCR 分批 | P1 | BLOCKED |  | [截圖](screenshots/UAT-072.png) |
| UAT-073 未選檔與 15MB 限制 | P0 | PARTIAL | 檔案欄= | [截圖](screenshots/UAT-073.png) |
| UAT-074 本機處理與雲端上傳分界 | P0 | BLOCKED |  | [截圖](screenshots/UAT-074.png) |
| UAT-075 私人知識庫全文檢索 | P1 | BLOCKED |  | [截圖](screenshots/UAT-075.png) |
| UAT-076 私人文件權限與刪除 | P0 | BLOCKED |  | [截圖](screenshots/UAT-076.png) |
| UAT-077 資格／實績跨文件比對 | P1 | BLOCKED |  | [截圖](screenshots/UAT-077.png) |
| UAT-078 AI 標單分析未啟用退場 | P0 | PARTIAL | AI 整理入口 | [截圖](screenshots/UAT-078.png) |
| UAT-079 AI 24 小時額度、快取與歷程 | P1 | BLOCKED |  | [截圖](screenshots/UAT-079.png) |
| UAT-080 舊版與新版標書差異 | P1 | PARTIAL | 建議書／標書檢查入口 | [截圖](screenshots/UAT-080.png) |
| UAT-081 AI 投標書逐條覆核 | P0 | BLOCKED | 建議書／標書檢查入口 | [截圖](screenshots/UAT-081.png) |
| UAT-082 依原文建立服務建議書 | P1 | BLOCKED | 尚無可開啟案例；建議書／標書檢查入口 | [截圖](screenshots/UAT-082.png) |
| UAT-083 草稿編輯、保存與重載 | P1 | BLOCKED | 尚無可開啟案例；建議書／標書檢查入口 | [截圖](screenshots/UAT-083.png) |
| UAT-084 人工核對失效規則 | P1 | BLOCKED | 尚無可開啟案例；建議書／標書檢查入口 | [截圖](screenshots/UAT-084.png) |
| UAT-085 AI 輔助撰稿權限 | P1 | BLOCKED | 尚無可開啟案例；建議書／標書檢查入口 | [截圖](screenshots/UAT-085.png) |
| UAT-086 Markdown 草稿匯出 | P2 | BLOCKED | 尚無可開啟案例；建議書／標書檢查入口 | [截圖](screenshots/UAT-086.png) |
| UAT-087 私人公司服務輪廓 | P1 | BLOCKED | 公司欄位及私人附件入口（不寫入） | [截圖](screenshots/UAT-087.png) |
| UAT-088 帶入商機雷達 | P1 | BLOCKED | 公司欄位及私人附件入口（不寫入） | [截圖](screenshots/UAT-088.png) |
| UAT-089 新增證照／實績／產品資料 | P1 | BLOCKED | 公司欄位及私人附件入口（不寫入） | [截圖](screenshots/UAT-089.png) |
| UAT-090 私人證明附件隔離 | P0 | BLOCKED | 公司欄位及私人附件入口（不寫入） | [截圖](screenshots/UAT-090.png) |
| UAT-091 過期與空證據處理 | P1 | BLOCKED | 公司欄位及私人附件入口（不寫入） | [截圖](screenshots/UAT-091.png) |
| UAT-092 建立工作區及切換 | P1 | BLOCKED | 團隊協作入口（未登入專用團隊，未寫入） | [截圖](screenshots/UAT-092.png) |
| UAT-093 邀請碼一次性 | P0 | BLOCKED | 團隊協作入口（未登入專用團隊，未寫入） | [截圖](screenshots/UAT-093.png) |
| UAT-094 指派團隊待辦 | P1 | BLOCKED | 團隊協作入口（未登入專用團隊，未寫入） | [截圖](screenshots/UAT-094.png) |
| UAT-095 非成員存取隔離 | P0 | BLOCKED | 團隊協作入口（未登入專用團隊，未寫入） | [截圖](screenshots/UAT-095.png) |
| UAT-096 邀請與權限變更 | P1 | BLOCKED | 團隊協作入口（未登入專用團隊，未寫入） | [截圖](screenshots/UAT-096.png) |
| UAT-097 同一會員多工作區 | P1 | BLOCKED | 團隊協作入口（未登入專用團隊，未寫入） | [截圖](screenshots/UAT-097.png) |
| UAT-098 監控關鍵字建立與觸發 | P1 | PARTIAL | 監控標籤及通知入口可見 | [截圖](screenshots/UAT-098.png) |
| UAT-099 站內通知確實來源 | P0 | PARTIAL | 監控標籤及通知入口可見 | [截圖](screenshots/UAT-099.png) |
| UAT-100 裝置通知權限 | P1 | PARTIAL | 裝置通知權限=denied；監控標籤及通知入口可見 | [截圖](screenshots/UAT-100.png) |
| UAT-101 截標前提醒 | P1 | FAIL | locator.fill: Timeout 6500ms exceeded. Call log: - waiting for locator('#reminderDays') - locator resolved to <input type="text" value="7,3,1" maxlength="24" id="reminder | [截圖](screenshots/UAT-101.png) |
| UAT-102 取消監控與通知切換 | P1 | PARTIAL | 監控標籤及通知入口可見 | [截圖](screenshots/UAT-102.png) |
| UAT-103 競爭廠商追蹤 | P1 | BLOCKED | 當前子頁=競品追蹤 | [截圖](screenshots/UAT-103.png) |
| UAT-104 指定廠商跳查與取消 | P1 | BLOCKED | 當前子頁=競品追蹤 | [截圖](screenshots/UAT-104.png) |
| UAT-105 建立每日／週／月報表 | P1 | BLOCKED | 當前子頁=自動報表 | [截圖](screenshots/UAT-105.png) |
| UAT-106 即時生成、預覽、下載 | P1 | BLOCKED | 當前子頁=自動報表 | [截圖](screenshots/UAT-106.png) |
| UAT-107 暫停、啟用與刪除排程 | P1 | BLOCKED | 當前子頁=自動報表 | [截圖](screenshots/UAT-107.png) |
| UAT-108 Email／LINE 未配置狀態 | P0 | PARTIAL | 當前子頁=通知設定；Email/LINE 外送說明：Email：此專案尚未配置 Email 發送服務（不會寄信）｜LINE：尚未綁定 LINE，LINE 專案金鑰未完整配置（不會推播）｜AI 文件模型：沒有設定模型金鑰 | [截圖](screenshots/UAT-108.png) |
| UAT-109 實際送達與失敗重試 | P1 | BLOCKED | 當前子頁=通知設定 | [截圖](screenshots/UAT-109.png) |
| UAT-110 建立履保／請款事項 | P1 | BLOCKED | 履約事項表單存在=true | [截圖](screenshots/UAT-110.png) |
| UAT-111 修改與完成履約事項 | P1 | BLOCKED | 履約事項表單存在=true | [截圖](screenshots/UAT-111.png) |
| UAT-112 到期提醒 | P1 | BLOCKED | 履約事項表單存在=true | [截圖](screenshots/UAT-112.png) |
| UAT-113 台帳 CSV | P1 | PARTIAL | 履約事項表單存在=true | [截圖](screenshots/UAT-113.png) |
| UAT-114 自願公開供應商名錄 | P1 | BLOCKED | 自行刊登／查詢入口（不向公眾刊登假資料） | [截圖](screenshots/UAT-114.png) |
| UAT-115 公開查詢及刪除刊登 | P1 | BLOCKED | 自行刊登／查詢入口（不向公眾刊登假資料） | [截圖](screenshots/UAT-115.png) |
| UAT-116 拒絕往來官方紀錄 | P0 | PARTIAL | 拒往來源同步：來源：政府資料開放平臺第 5988 號（行政院公共工程委員會，公告每日更新）；實際已入庫 1,050 筆官方公開紀錄。最近一次同步：失敗，2026/11/11 上午8:24:03；官方來源錯誤：Error: database 500 ti_debarred_vendor_notices {"code":"21000","de | [截圖](screenshots/UAT-116.png) |
| UAT-117 拒往與同名問題 | P0 | PARTIAL | 拒往來源同步：來源：政府資料開放平臺第 5988 號（行政院公共工程委員會，公告每日更新）；實際已入庫 1,050 筆官方公開紀錄。最近一次同步：失敗，2026/11/11 上午8:24:03；官方來源錯誤：Error: database 500 ti_debarred_vendor_notices {"code":"21000","de | [截圖](screenshots/UAT-117.png) |
| UAT-118 政府採購新手指南 | P2 | PARTIAL | 官方新手指南：新手從找案到投標的核對流程 招標、決標及更正公告 一案可能公告多次。先核對機關、案號、公告類型及最新截止時間；網站列出的是來源實際可取得的公告，不能把所有招標都稱尚可投。 查看政府官方入口／最新法規 投標資格及投標文件 依原公告與招標文件核對營業項目、資格證明、實績、保險、服務建議書、截止收件時間。文件未揭露的條件必須標示未 | [截圖](screenshots/UAT-118.png) |
| UAT-119 目前免費狀態與付款入口 | P0 | BLOCKED | 正式版的「方案與帳務」選單為隱藏狀態 | [截圖](screenshots/UAT-119.png) |
| UAT-120 付款方式與同意選項 | P1 | BLOCKED | 正式版的「方案與帳務」選單為隱藏狀態 | [截圖](screenshots/UAT-120.png) |
| UAT-121 最近訂單及重新整理 | P1 | BLOCKED | 正式版的「方案與帳務」選單為隱藏狀態 | [截圖](screenshots/UAT-121.png) |
| UAT-122 取消自動續扣 | P1 | BLOCKED | 正式版的「方案與帳務」選單為隱藏狀態 | [截圖](screenshots/UAT-122.png) |
| UAT-123 API Key 身分門檻 | P0 | PARTIAL | API／MCP 安全入口： | [截圖](screenshots/UAT-123.png) |
| UAT-124 Key 只顯示一次 | P1 | BLOCKED | API／MCP 安全入口： | [截圖](screenshots/UAT-124.png) |
| UAT-125 REST 只查本人資料 | P0 | BLOCKED | API／MCP 安全入口： | [截圖](screenshots/UAT-125.png) |
| UAT-126 額度與效期 | P1 | BLOCKED | API／MCP 安全入口： | [截圖](screenshots/UAT-126.png) |
| UAT-127 MCP 協定與撤銷 | P1 | BLOCKED | API／MCP 安全入口： | [截圖](screenshots/UAT-127.png) |
| UAT-128 AI 客服入口 | P1 | PARTIAL | 客服現在分頁=chat；不建立真實測試工單 | [截圖](screenshots/UAT-128.png) |
| UAT-129 新對話與歷史 | P1 | BLOCKED | 客服現在分頁=history；不建立真實測試工單 | [截圖](screenshots/UAT-129.png) |
| UAT-130 問卷型問題回報 | P1 | BLOCKED | 客服現在分頁=form；不建立真實測試工單 | [截圖](screenshots/UAT-130.png) |
| UAT-131 AI 轉真人 | P1 | BLOCKED | 客服現在分頁=form；不建立真實測試工單 | [截圖](screenshots/UAT-131.png) |
| UAT-132 使用者補充與回覆 | P1 | BLOCKED | 客服現在分頁=chat；不建立真實測試工單 | [截圖](screenshots/UAT-132.png) |
| UAT-133 客服管理者權限 | P0 | BLOCKED | 客服現在分頁=admin；不建立真實測試工單 | [截圖](screenshots/UAT-133.png) |
| UAT-134 客服處理與狀態 | P1 | BLOCKED | 客服現在分頁=admin；不建立真實測試工單 | [截圖](screenshots/UAT-134.png) |
| UAT-135 客服限額與防濫用 | P1 | BLOCKED | 客服現在分頁=chat；不建立真實測試工單 | [截圖](screenshots/UAT-135.png) |
| UAT-136 來源同步失敗不可造假 | P0 | PARTIAL | 資料說明與同步來源顯示 | [截圖](screenshots/UAT-136.png) |
| UAT-137 官方預算與業務價值 | P0 | PARTIAL | 真實預算展示：從已同步的政府採購公告資料庫查詢，不使用模擬案件 | [截圖](screenshots/UAT-137.png) |
| UAT-138 跨租戶讀寫防護 | P0 | BLOCKED | 已檢查對應頁面；完整寫入／權限測試需要獨立授權條件 | [截圖](screenshots/UAT-138.png) |
| UAT-139 輸入污染及 XSS | P0 | PARTIAL | 搜尋輸入的惡意文字不得被執行 | [截圖](screenshots/UAT-139.png) |
| UAT-140 API 錯誤與重試 | P1 | PARTIAL | 已恢復網路 | [截圖](screenshots/UAT-140.png) |
| UAT-141 大量資料／分頁效能 | P1 | PARTIAL | 互動耗時 968ms，非 p95 壓測 | [截圖](screenshots/UAT-141.png) |
| UAT-142 桌面／手機視覺回歸 | P1 | PARTIAL | 手機寬度下水平溢出=false | [截圖](screenshots/UAT-142.png) |
| UAT-143 同時操作資料競態 | P1 | BLOCKED | 已檢查對應頁面；完整寫入／權限測試需要獨立授權條件 | [截圖](screenshots/UAT-143.png) |
| UAT-144 文件隔離與私密資訊 | P1 | BLOCKED | 已檢查對應頁面；完整寫入／權限測試需要獨立授權條件 | [截圖](screenshots/UAT-144.png) |
| UAT-145 無資料／空狀態一致 | P2 | PARTIAL | 空查詢：標案名稱：不可能存在之測試案號 ZZ-987654321｜全庫篩選｜符合 0 件案件｜本頁 0 件（每個案件僅顯示一筆，依機關與案號去重；非全國完整資料）｜全部篩選與排序先在資料庫完成 | [截圖](screenshots/UAT-145.png) |

## 8 條跨功能流程截圖

以下僅代表已實際操作公開介面與截圖，不代表完成整條端到端故事。

| 流程 | 狀態 | 備註 | 截圖 |
|---|---|---|---|
| E2E-01 個人設計師找案與決策 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-01.png) |
| E2E-02 資訊公司機關重購商機 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-02.png) |
| E2E-03 標書資格解析與截止待辦 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-03.png) |
| E2E-04 主管比較備標成本 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-04.png) |
| E2E-05 財務履約與保證金 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-05.png) |
| E2E-06 三人投標團隊 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-06.png) |
| E2E-07 競品報表與提醒 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-07.png) |
| E2E-08 來源資料錯誤到客服 | PARTIAL | /完/成/公/開/介/面/可/安/全/操/作/部/分/；/未/使/用/真/人/帳/戶/與/私/人/／/金/流/寫/入/ | [截圖](screenshots/E2E-08.png) |

## 不能宣稱完成的事項

此輪沒有經授權的兩個正式會員、真實付款憑證、真 AI API 回執或真實寄送回執；相應情境不得標通過。
頁面 JS 例外：0（可參閱 results.json）。