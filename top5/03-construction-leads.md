# 03｜Construction Leads

## 商業價值
- 評分：91/100
- 台灣單一產品 ARR 潛力：NT$3,000萬～1.5億
- 主要客戶：電梯、空調、消防、建材、磁磚、衛浴、鋁窗、保全、弱電、家具、充電樁、室內設計。
- 核心問題：業務想知道「哪個工程現在正進入採購階段」，而不是只知道有哪些建商。

## 核心資料來源（先以台北 MVP）

### A. 臺北市 115 年度建造執照摘要
- 官方頁：https://data.gov.tw/dataset/128200
- 直接資源：https://data.taipei/api/dataset/d8834353-ff8e-4a6c-9730-a4d3541f2669/resource/43624c8e-c768-4b3c-93c4-595f5af7a9cb/download
- 更新：每月
- 關鍵欄位：執照年度、執照號碼、發照日期、建造類別、構造種類、使用分區、幢數、棟數、地上層數、地下層數、戶數、地址、地段號、建築面積、建築期限、工程金額、起造人、監造人、設計人、樓層、說明。

### B. 臺北市歷年使用執照摘要
- 官方頁：https://data.gov.tw/dataset/128203
- 直接資源：https://data.taipei/api/dataset/c876ff02-af2e-4eb8-bd33-d444f5052733/resource/0f3f9675-8356-4f1a-9908-1ce8892012fa/download
- 關鍵欄位：執照年度、執照號碼、發照日期、原核發執照、設計人、監造人、承造人、建造類別、構造種類、使用分區、棟數、地上層數、地下層數、戶數、建築面積、建物高度、工程金額、竣工日期、開工日期、地址、地段號、停車空間說明。

### C. 公司／稅籍資料
- https://data.gov.tw/dataset/9400
- https://data.gov.tw/dataset/22197
- 用途：把起造人、承造人、設計人公司 entity resolution 到統編、地址、規模與產業。

## 建議衍生訊號
- Project Size Score：戶數、樓層、面積、工程金額。
- Procurement Stage：建照核發→開工→施工估算→使照。
- Product Fit：例如電梯看樓層/棟數；充電樁看停車空間；衛浴看戶數；消防看用途與面積。
- Buyer Graph：建商 × 承造商 × 設計師 × 監造。
- New Project Alert：每月新增建照。
- Completion Alert：接近竣工的軟裝／設備商機。

## 商業模式
- 每席 SaaS：NT$3,000～20,000/月。
- 高價值 Leads：按筆或點數制，NT$100～3,000/lead。
- Enterprise Feed：NT$30萬～200萬/年。
- CRM 整合：將案場自動建立成商機並指派業務。

## MVP
先只做台北，讓一個垂直產業（例如 EV 充電樁或消防設備）輸入規則，自動列出 50 個最值得拜訪的新建案。驗證付費後，再逐縣市接地方建管 Open Data。
