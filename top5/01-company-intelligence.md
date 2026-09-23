# 01｜Taiwan Company Intelligence

## 商業價值
- 評分：95/100
- 台灣單一產品 ARR 潛力：NT$5,000萬～2.5億+
- 主要客戶：銀行、保險、租賃、B2B SaaS、供應鏈管理、會計師、徵信、業務團隊。
- 核心問題：台灣企業資料分散在不同政府系統，企業要做 KYB、找客戶、判斷公司異動或 enrich CRM 時，要重複查多個來源。

## 核心資料來源

### A. 全國營業（稅籍）登記資料集
- 官方頁：https://data.gov.tw/dataset/9400
- CSV：https://eip.fia.gov.tw/data/BGMOPEN1.csv
- ZIP：https://eip.fia.gov.tw/data/BGMOPEN1.zip
- 更新：每日
- 關鍵欄位：統一編號、總機構統一編號、營業人名稱、營業地址、資本額、設立日期、組織別名稱、使用統一發票、行業代號、名稱、行業代號1～3、名稱1～3。
- Primary Key：統一編號

### B. 公司登記基本資料－應用一
- 官方頁：https://data.gov.tw/dataset/22197
- 商工 API Swagger：https://data.gcis.nat.gov.tw/resources/swagger/index.html
- Swagger JSON：http://data.gcis.nat.gov.tw/resources/swagger/swagger.json
- 關鍵欄位：Business_Accounting_NO、Company_Status_Desc、Company_Name、Capital_Stock_Amount、Paid_In_Capital_Amount、Share_Val、Equity_Amt、Responsible_Name、Company_Location、Register_Organization_Desc、Company_Setup_Date、Change_Of_Approval_Data、Revoke_App_Date、Case_Status、Case_Status_Desc、Sus_App_Date、Sus_Beg_Date、Sus_End_Date。

### C. 公司登記董監事資料
- 官方頁：https://data.gov.tw/dataset/13863
- API 文件：https://data.gcis.nat.gov.tw/resources/swagger/index.html
- 關鍵欄位：Person_Position_Name、Person_Name、Juristic_Person_Name、Person_Shareholding。
- JOIN：公司統編。

### D. 公司資料異動查詢
- 官方頁：https://data.gov.tw/dataset/84880
- 關鍵欄位：Business_Accounting_NO、Company_Name；以最後核准變更日期查詢。
- 用途：Daily Change Feed。

### E. 公司資料設立查詢
- 官方頁：https://data.gov.tw/dataset/152280
- 關鍵欄位：Business_Accounting_NO、Company_Name。
- 用途：新設公司名單／Sales Trigger。

### F. 商業登記基本資料
- 官方頁：https://data.gov.tw/dataset/108339
- 關鍵欄位：President_No、Business_Name、Business_Current_Status、Business_Current_Status_Desc、Business_Setup_Approve_Date、Business_Organization_Type_Desc、Agency、Agency_Desc、Business_Address、Business_Item、Business_Item_Desc。

## 建議資料模型
company_master：統編、名稱、狀態、地址、資本額、設立日、負責人、產業。  
company_director：統編、姓名、職稱、法人、持股。  
company_tax_profile：統編、稅籍地址、發票、行業代碼。  
company_event：統編、event_type、event_date、before、after。  
company_relation：source_company、target_entity、relation_type。

## 可以賣什麼
1. Company Search：單家公司完整 Profile。
2. KYB API：輸入統編回傳公司狀態、登記、稅籍、董監、風險。
3. CRM Enrichment：客戶公司自動補齊產業、規模、地址、成立日。
4. Sales Trigger：每天通知「新設立、增資、搬遷、董監異動」企業。
5. Company Graph：關係人／法人董事／地址／關係企業網路。
6. Company Change History：政府來源只給當下資料時，自行保存每日 snapshot 形成歷史。

## 商業模式
- SaaS：NT$1,500～15,000/月/席。
- API：按每千次 request 計價。
- Enterprise Data Feed：NT$30萬～300萬/年。
- CRM Plugin：依公司名單數或席次計價。
- Premium Trigger Pack：新公司、增資、搬遷、特定產業事件訂閱。

## MVP
先做「每天新增／異動企業雷達」：使用者選產業、縣市、資本額門檻，每天收到最值得聯絡的 20 家公司。這比單純公司查詢更容易直接量化 ROI。
