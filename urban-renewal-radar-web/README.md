# 0元土地／都更價值評估雷達

## 2026-09-30 商業價值重評

- **商業價值：84/100**
- **主要分類：高價資產商機雷達**
- **主要變現：專業會員、都更／土地整合 Lead、顧問、仲介、融資與開發商導流。**

| 評估項目 | 分數 |
|---|---:|
| 直接付費能力 | 24 |
| 流量規模與使用頻率 | 4 |
| 交易／商機導流能力 | 15 |
| 痛點與決策價值 | 15 |
| 競爭與替代品 | 8 |
| 護城河 | 10 |
| 資料解題能力 | 4 |
| 維運與資料持續性 | 4 |
| **合計** | **84** |

**判斷：** 流量不會大，但單一有效標的價值極高。最大限制是免費資料無法完整取得真實所有權母體；因此它適合做前期雷達，而不是宣稱取代謄本。

> 統一權重：直接付費 25、流量頻率 15、交易／商機導流 15、痛點決策 15、競爭 10、護城河 10、資料解題 5、維運持續性 5。


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