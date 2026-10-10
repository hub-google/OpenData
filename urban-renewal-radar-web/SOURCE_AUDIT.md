# 0元土地／都更資料來源審計

更新日：2026-09-29

本專案只使用免費政府公開資料；不使用電子謄本、第二類謄本、地政電傳或其他逐筆付費資料。

## A. 已實際下載與驗證：臺北市申報地價

- 官方資料頁：https://data.taipei/dataset/detail?id=e434a75a-5692-4a41-bb29-edb97d7f624e
- 政府資料開放平臺：https://data.gov.tw/dataset/145788
- 直接下載：https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=e96325f8-7c25-4369-9ee2-04a0ad9fb551

### 2026-09-29 實跑結果

- 原始檔案：118,151 bytes
- 原始資料列：1,425
- 不同 parcel key：891
- 觀察到 >=2 筆所有權登記次序的地號：75
- 已確認欄位：行政區、段小段、地號、標示部面積、所有權登記次序、所有權持分類別、所有權持分分母、所有權持分分子、公告地價、申報地價、核定申報地價情形。

### 完整性原則

- observed_owner_records 只代表公開資料可觀察到的登記筆數，不是地主總數。
- 即使 observed_share_sum = 100%，也只能說這份資料內部持分合計一致，不能單靠此來源證明目前登記簿完整。
- 持分合計明顯不足 100% 時，max/top3/HHI 只展示觀察值，不當成完整所有權結構。

## B. 地籍圖資網路便民服務系統 / 國土測繪中心

- EasyMap：https://easymap.land.moi.gov.tw/Index
- NLSC API 清單：https://maps.nlsc.gov.tw/S09SOA/pro/Api_ajax_list.jsp
- 官方確實有 CadasMapPosition、CadasAttrQuery、AddressQueryLand 等地籍 API。
- 但 NLSC 官方說明把地籍圖資 WMS / WMTS / API 列為限制申請服務，不是一般民間可直接匿名大量使用的免費 Open API。
- 因此目前只當人工交叉驗證來源；不暴力爬蟲。

## C. 可用地號 JOIN 的免費補強資料

### 臺北市土地使用分區
- https://data.gov.tw/dataset/145623
- 有地號：是。可補 land_use_zone；沒有共有人數、持分或登記次序。

### 臺北市土地使用內容與使用管制彙整表
- https://data.gov.tw/dataset/136124
- 無單筆地號；可用行政區＋分區補建蔽率與容積率上限。只是規則層級，不是單筆土地最終可建量。

### 臺北市公有土地資料
- https://data.taipei/dataset/detail?id=ca644935-035e-4ecf-bd93-3d8df351bdb7
- 有地號、面積、公告現值、公告地價、土地權屬情形、權屬比例、管理機關。
- 可補 public_land_flag / public_ownership_ratio / public_land_manager。
- 官方明載部分敏感或特殊資料不開放，所以仍不是全體所有權母表。

### 地籍清理公告標售土地清冊
- https://data.gov.tw/dataset/145830
- 有地號、面積、使用分區/使用地類別、權利範圍等。
- 可補 cadastral_cleanup_flag / cadastral_cleanup_share。

### 地籍清理公告開標結果
- https://data.taipei/dataset/detail?id=460ff255-8900-40e9-899d-a581115bc421
- 有地號與權利範圍，可補特殊權屬風險旗標。

### 地籍清理囑託登記國有公告
- https://data.gov.tw/dataset/121514
- 有地/建號、面積、權利範圍，可補 cadastral_cleanup_to_state_flag。

## D. 都更／危老

### 市有土地參與都市更新案件進度表
- https://data.taipei/dataset/detail?id=560b633f-4ca7-4e37-957a-53879eccf5ea
- 有市有土地地號，可補部分 urban_renewal_flag，但不是全臺北都更案件全集。

### 市有土地參與都市更新完工或結案
- https://data.taipei/dataset/detail?id=377f9ac7-521d-4247-b552-0075012d10fe
- 有更新前/後市有土地地號，可補部分完成旗標。

### 自行劃定更新單元
- https://data.taipei/dataset/detail?id=09774ee0-4754-41e7-aff7-40c20c7817a2
- 開放資料主要是查詢入口與案件資訊，沒有直接把每筆地號拆成穩定結構化欄位；目前不當 parcel master。

### 危老
- 官方案例、公報與統計可找到個案地號，但目前未找到完整『全臺北核准危老案件＋地號』結構化 Open Data。
- dangerous_old_building_flag 目前預設 unknown。

## E. 未辦繼承

- https://data.taipei/dataset/detail?id=6ffe3345-8f05-42ec-b559-6db6d3f234e4
- 此 Open Data 是統計表，沒有地號，不能直接回填 parcel-level unclaimed_inheritance_flag。
- 各地政機關依法會公告清冊，但目前尚未驗證出全臺北長期穩定的地號級結構化 Open Data 母表。

## F. 土地法34條之1

- 目前能找到法規、公報與個案文件，但尚未找到全臺北地號級結構化免費 Open Data 母表。
- land_act_34_1_flag 目前預設 unknown。

## G. 地上權

- https://data.taipei/dataset/detail?id=547b4eb7-acd2-4eac-983e-bf0eae5d6b93
- 有地號、基地面積、管理機關、存續期間等。
- 可補 superficies_flag，但只涵蓋特定市有非公用土地案件。

## H. 建物／屋齡

- https://data.gov.tw/dataset/128203
- 使用執照有地址、地段號、戶數、樓層、竣工日期、基地相關面積，可補 building_age / household_count 等。
- 老使照地段號可能遇後續分合筆，需做現行地號標準化與交叉核對。

## 結論

免費資料可以做出很有價值的前期雷達，但目前不能宣稱取得：真實地主總數、完整有效所有權登記、完整抵押／限制登記、全市危老地號、全市34-1地號。這些一律標 partial / unknown。