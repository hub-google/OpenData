# 0 元土地／都更雷達：免費政府資料來源驗證表

> 原則：只有實際具有地號或可可靠還原地號的資料，才進 parcel-level 主表。  
> 所有權資料若無法證明涵蓋完整權利人母體，一律使用 **observed / partial / unknown**，不稱「地主總數」。

## 主鍵

目前臺北市版本統一採：

```
parcel_id = 行政區 | 段小段 | 8碼地號
```

例：`北投區|關渡段一小段|05400000`

其中 `05400000` = 540 地號；`01800012` = 180-12 地號。

## 資料來源矩陣

| 資料來源 | 免費 | 可取得地號 | 面積 | 登記次序 / 持分 | 可做什麼 | 完整性 / 注意事項 | 專案狀態 |
|---|---|---|---|---|---|---|---|
| 臺北市申報地價 | 是 | 是 | 是 | **是：登記次序、類別、分子、分母** | observed_owner_records、max/top2/top3、HHI | **不是完整所有權母體**；不論持分合計是否 100%，來源本身只標 partial | **已實際下載、解析、聚合** |
| 臺北市土地公告現值及公告地價 | 是 | **是，全市 parcel grain** | 否 | 否 | parcel master、official_land_value、announced_land_price | 產製後仍可能因分割/合併變動 | 已接入 master builder |
| 臺北市土地使用分區 | 是 | **是：大段＋小段＋母號＋子號** | 否 | 否 | land_use_zone | 官方說明為都市計畫地籍套繪參考 | 已接入 master builder |
| 土地使用內容與使用管制彙整表 | 是 | 否；行政區＋分區 | 分區統計 | 否 | building_coverage_ratio、floor_area_ratio proxy | 分區層級，不是個案最終法定可建量 | 已接入 master builder |
| 臺北市公有土地 | 是 | 是 | 是 | **公有權屬情形＋比例** | public_land_flag、public_ownership_ratio、管理機關 | 只揭露公有部分，不能代表私人全部持分 | 已接入 master builder |
| 地籍清理公告標售土地清冊 | 是 | 是 | 是 | **權利範圍** | cadastral_cleanup_flag、特殊權利風險 | 只涵蓋地籍清理案件 | 已接入 master builder |
| 市有土地參與都市更新案件進度 | 是 | 有「市有土地地號」 | 有更新單元面積 | 否 | 部分 urban_renewal_flag | 只涵蓋有市有土地參與的案件，不是全市都更全集 | 已確認來源；解析規則待實測 |
| 市有土地參與都更完工/結案 | 是 | 更新前/後市有地號 | 是 | 否 | 歷史都更旗標 | 同上，只是市有地子集 | 已確認來源 |
| 自行劃定更新單元查詢 | 是 | 入口描述稱可查更新單元地號 | — | — | 潛在完整度較高的都更標記 | Open Data 本身只有查詢 URL，需再驗證查詢服務資料結構 | 研究中 |
| 歷年使用執照摘要 | 是 | 有「地段號」 | 基地相關面積 | 否 | building_age、building_count、household_count | XML 約 65MB；地段號欄仍須拆成 parcel keys | 已確認來源；大型檔 parser 研究中 |
| 歷年建造執照摘要 | 是 | 有「地段號」 | 基地相關面積 | 否 | 新建/重建訊號 | XML 約 87MB | 已確認來源 |
| 未辦繼承列冊管理 | 官方免費查詢/公告 | 查詢服務可查 | — | 可形成風險訊號 | unclaimed_inheritance_flag | data.taipei 開放資料目前找到的是統計總量，**不是 parcel 清冊**；年度公告存在但尚未找到穩定結構化批次檔 | **不亂填，暫 unknown** |
| 土地法 34 條之 1 | 公告/法規公開 | 個案公告常有地號 | — | 個案可見持分 | land_act_34_1_flag | 尚未找到全市、地號級、穩定免費母表 | **暫 unknown** |
| 危老核准案件 | 公開案例/統計 | 個案可見地號 | 個案可見 | 否 | dangerous_old_building_flag | 尚未驗證完整地號級免費核准清冊 | **暫 unknown** |
| 國土測繪中心地籍 API | 有服務，但相關地籍 API **需申請** | 是 | 可查土地標示資料 | CAD_011 另有權利人類別 | 地址↔地號、地號屬性 | 官方明列地籍 API / 有地號地籍圖為需申請服務；不納入「免申請 0 元自動管線」 | 排除自動管線；可作未來選配 |
| NLSC WMS | **免申請**的一般 WMS | 地段外圍可視覺化 | 否 | 否 | GIS 背景、區界、地段外圍 | 有地號地籍圖磚 DMAPS 為需申請項目 | 可做地圖層，不當資料庫主源 |
| 司法院法拍 | 公開查詢存在 | 個案公告可見 | 個案 | 個案 | auction flag | 過去「法拍屋拍定資料集」已下架，尚未找到穩定現行批次 Open Data | 研究中 |

## 已實測：臺北市申報地價

2026-09-29 實際由官方 CSV 下載並執行：

- raw rows：1,425
- 可 GROUP BY 成 parcel：891
- 觀察到 >= 2 個不同所有權登記次序的 parcel：75
- 產出：
  - `data/parcel_ownership.json`
  - `data/parcel_ownership.csv`
  - `data/ownership_validation.json`

### 重要資料品質規則

1. `observed_owner_records` 不等於真正地主人數。
2. `observed_share_sum < 98%`：max/top3/HHI 只展示，不用來推論完整集中度。
3. `observed_share_sum > 102%` 或含公同共有 B 類：標為 `special_or_overlapping`，不把分數當完整結構。
4. 約 98%～102% 且無特殊共有時，標 `internally_complete`，只代表「這批觀察列在算術上接近完整」，來源本身仍是 `partial`，不是法律上的 confirmed。
5. 所有分數保留可解釋 reasons，不用黑箱模型。

## 官方連結

- 臺北市申報地價  
  https://data.taipei/dataset/detail?id=e434a75a-5692-4a41-bb29-edb97d7f624e
- 臺北市土地公告現值及公告地價  
  https://data.taipei/dataset/detail?id=7ac6eac3-a998-43ff-a289-6a4e3203c2c3
- 臺北市土地使用分區  
  https://data.taipei/dataset/detail?id=a132a433-db7c-4387-8085-83e6a093b17f
- 土地使用內容與使用管制彙整表  
  https://data.taipei/dataset/detail?id=d61ca24b-7b2b-4e75-8004-c568902e6300
- 臺北市公有土地  
  https://data.taipei/dataset/detail?id=ca644935-035e-4ecf-bd93-3d8df351bdb7
- 臺北市地籍清理公告標售土地清冊  
  https://data.gov.tw/dataset/145830
- 臺北市市有土地參與都市更新案件進度表  
  https://data.taipei/dataset/detail?id=560b633f-4ca7-4e37-957a-53879eccf5ea
- 臺北市自行劃定更新單元查詢  
  https://data.taipei/dataset/detail?id=09774ee0-4754-41e7-aff7-40c20c7817a2
- 臺北市歷年使用執照摘要  
  https://data.taipei/dataset/detail?id=c876ff02-af2e-4eb8-bd33-d444f5052733
- 臺北市歷年建造執照摘要  
  https://data.taipei/dataset/detail?id=e20ea68e-c79d-4882-a2f9-2f3eeb45384b
- 臺北市地政局未辦繼承說明  
  https://land.gov.taipei/News_Content.aspx?n=26F3F58329CF6BDE&s=4DF804F29A383D24
- 國土測繪圖資服務雲 API 列表  
  https://maps.nlsc.gov.tw/S09SOA/pro/Api_ajax_list.jsp
- 國土測繪圖資服務雲服務簡介  
  https://maps.nlsc.gov.tw/S09SOA/pro/intro.jsp
