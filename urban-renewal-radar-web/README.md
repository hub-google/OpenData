# 都更價值評估雷達

網址（GitHub Pages）：
https://hub-google.github.io/OpenData/urban-renewal-radar-web/

## 第一版在做什麼

這不是「預測一定都更成功」，而是把大量老屋先排序，回答：

> 如果整合人只能挑少數基地深入研究，哪些值得先查？

目前自動讀取臺北市「歷年使用執照摘要」，從以下欄位建立第一階段分數：

- 竣工/發照年份 → 屋齡
- 地上層數 → 是否屬典型低樓層老公寓
- 戶數 → 初步整合規模
- 騎樓基地面積、其他基地面積 → 基地規模訊號
- 使用分區 → 開發強度的初篩訊號
- 地址、地段號 → 後續串地號、分區與謄本

## 最重要的限制

**不會把戶數當成地主數。**

地主數、持分破碎程度、法人地主、抵押權與限制登記，要進入第二階段後，以第二類土地/建物謄本或可核對的公開持分資料確認。

## 官方資料

- 臺北市歷年使用執照摘要  
  https://data.taipei/dataset/detail?id=c876ff02-af2e-4eb8-bd33-d444f5052733
- 臺北市土地使用分區  
  https://data.taipei/dataset/detail?id=a132a433-db7c-4387-8085-83e6a093b17f
- 臺北市申報地價  
  https://data.taipei/dataset/detail?id=e434a75a-5692-4a41-bb29-edb97d7f624e
- 全國地政電子謄本系統  
  https://epaper.land.moi.gov.tw/Home/SNEpaperKind

## 下一階段

1. 由地址/地段號轉地號並核對宗地面積。
2. 串臺北市土地使用分區，避免只依舊使照文字。
3. 串實價登錄，加入周邊新屋/老屋價差。
4. Top 候選才付費查謄本，產生 Ownership Complexity Score。
5. 再估可開發樓地板、更新後價值與整合優先順序。
