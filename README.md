# Taiwan Open Data 商業價值研究

> 更新日期：2026-09-23  
> 目的：從台灣政府 Open Data 出發，找出「有真實需求、可交叉關聯、可產品化、有人願意付費」的資料機會。

## 評估方法

本研究不以「政府認定高價值」作為唯一依據，而是交叉評估：

1. **需求量**：政府資料平臺瀏覽／下載量、更新頻率、民間活化案例。
2. **付費痛點**：是否能直接幫企業增加營收、降低成本、降低風險、加快決策。
3. **資料摩擦**：原始資料是否分散、難清洗、難 JOIN、需要持續更新。
4. **可形成訊號**：能否從「資料」升級成「名單、預警、評分、預測、API」。
5. **可防禦性**：雖然原始資料人人可拿，但歷史化、實體對應、地址標準化、去重、事件偵測、模型與工作流程可以形成護城河。
6. **市場付費能力**：企業客戶單價與潛在客群數量。

### 估值口徑

以下「年商業價值／ARR 潛力」不是政府 CSV 本身的售價，而是：
**若把該資料群組產品化為 SaaS / API / Data-as-a-Service，在台灣單一垂直市場可能支撐的年營收區間。**

---

## 前五名

| 排名 | 題目 | 商業價值分數 | 台灣單一產品 ARR 潛力 | 核心付費問題 |
|---|---|---:|---:|---|
| 1 | [Taiwan Company Intelligence](top5/01-company-intelligence.md) | 95/100 | NT$5,000萬～2.5億+ | 找客戶、KYB、企業徵信、CRM enrichment、異動訊號 |
| 2 | [Taiwan Location Intelligence](top5/02-location-intelligence.md) | 94/100 | NT$5,000萬～3億+ | 展店、商圈、房產估值、授信、區域需求 |
| 3 | [Construction Leads](top5/03-construction-leads.md) | 91/100 | NT$3,000萬～1.5億 | 找「正在發生」的工程採購商機 |
| 4 | [Government Procurement Intelligence](top5/04-government-procurement.md) | 89/100 | NT$2,000萬～1億 | 標案雷達、競品、機關採購週期、續約機會 |
| 5 | [Weather & Disaster Risk Intelligence](top5/05-weather-disaster-risk.md) | 88/100 | NT$2,000萬～1.2億 | 保險、物流、工程、農業、能源風險預警 |

---

## 其他高潛力項目

| 題目 | 商業價值分數 | 台灣單一產品 ARR 潛力 | 檔案 |
|---|---:|---:|---|
| Corporate Compliance / ESG Risk | 86 | NT$1,500萬～8,000萬 | [MD](potential/06-compliance-esg-risk.md) |
| Healthcare & Pharma Intelligence | 84 | NT$2,000萬～1億 | [MD](potential/07-healthcare-pharma.md) |
| Consumer Demographic Intelligence | 83 | NT$2,000萬～1億 | [MD](potential/08-demographic-intelligence.md) |
| Traffic / Mobility Risk | 78 | NT$1,000萬～6,000萬 | [MD](potential/09-traffic-mobility.md) |
| Energy / EV Intelligence | 76 | NT$1,000萬～6,000萬 | [MD](potential/10-energy-ev.md) |
| Food Business / Food Safety Intelligence | 72 | NT$800萬～4,000萬 | [MD](potential/11-food-safety.md) |
| Agriculture Price Intelligence | 68 | NT$500萬～3,000萬 | [MD](potential/12-agriculture-price.md) |
| Labor / Job Market Intelligence | 63 | NT$500萬～3,000萬 | [MD](potential/13-labor-job-market.md) |
| Tourism / Event Demand Intelligence | 50 | NT$200萬～1,500萬 | [MD](potential/14-tourism-event-demand.md) |

---

## 最重要的架構洞察

真正有商業價值的不是單一資料集，而是能被 JOIN 的資料圖譜。

### Entity Key 1：統一編號
可串：
- 公司／商業登記
- 稅籍
- 董監事
- 公司異動
- 政府採購得標
- 勞動裁罰
- 環境裁罰
- 食品業者
- 藥品／醫材申請商

可以形成 **Taiwan Company Graph**。

### Entity Key 2：地址／經緯度
可串：
- 人口年齡
- 所得
- 實價登錄
- 建照／使照
- 公司／店家
- 交通
- 醫療
- 氣象
- 空氣品質
- 災害／事故

可以形成 **Taiwan Location Graph**。

### Entity Key 3：時間／事件
最有價值的商業訊號通常不是「現在是什麼」，而是「最近發生了什麼」：
- 新公司成立
- 公司變更
- 公司歇業
- 新建照
- 新使照
- 新標案／決標
- 新裁罰
- 新藥證
- 價格異常
- 天氣／災害事件

這類 Event Feed 最容易做成企業訂閱產品。

---

## 建議產品策略

不要做「Open Data 查詢網站」；建議把原始資料升級成：
- 搜尋與篩選
- 歷史版本
- Entity Resolution
- 地址標準化與地理編碼
- 異動偵測
- 風險分數
- 商機分數
- 預警
- API
- CRM / Slack / Email / LINE webhook
- 企業內部名單 enrichment

## 主要官方入口

- 台灣政府資料開放平臺：https://data.gov.tw/
- 政府資料開放授權條款：https://data.gov.tw/license
- 經濟部商工資料 API：https://data.gcis.nat.gov.tw/resources/swagger/index.html
- 內政部戶政 Open Data API：https://www.ris.gov.tw/rs-opendata/api/Main/docs/v1
- 交通部 TDX：https://tdx.transportdata.tw/
- 中央氣象署 Open Data：https://opendata.cwa.gov.tw/
- 食藥署 Open Data：https://data.fda.gov.tw/

## 研究限制

- 商業價值分數與 ARR 為市場機會估算，不是會計／投資估值。
- 部分資料頁會替換最新年度的直接下載檔，因此 MD 優先保留「官方資料集固定網址」，另在穩定時提供 API / 下載 endpoint。
- 真正產品化前，仍需逐一確認授權條款、資料品質、個資／公平交易／金融與醫療等特定產業規範。
