# 0元土地／都更價值評估雷達

GitHub Pages：https://hub-google.github.io/OpenData/urban-renewal-radar-web/

## 目標

只用免費政府公開資料，找出『土地開發價值高＋所有權相對容易整合』的標的，作為都更、危老、土地整合前期雷達。

目前不使用電子謄本、第二類謄本、地政電傳或任何逐筆收費土地資料。

## 已實際驗證的 ownership layer

來源：臺北市申報地價。2026-09-29 實跑：
- 1,425 筆原始列
- 891 個不同 parcel key
- 75 個地號觀察到至少 2 筆所有權登記次序
- 已計算 observed_owner_records、max_share、top2_share、top3_share、observed_share_sum、share_hhi
- 已隨機抽出 12 筆多持分土地做 validation

輸出：
- data/parcel_ownership.csv
- data/parcel_ownership.json
- data/ownership_validation.json

## 資料誠信規則

- observed_owner_records 不是地主總數。
- 申報地價資料無法證明涵蓋該地號目前全部所有權登記。
- 觀察持分合計不到 100% 時，HHI / Top3 只展示，不當成完整所有權結構。
- 即使觀察持分剛好 100%，ownership_data_completeness 仍不直接標 confirmed。

## 詳細來源審計

見 SOURCE_AUDIT.md。

沒有官方資料證明完整的欄位，一律標 partial / unknown，不補假資料。