# GitHub Pages 瀏覽器直連驗證

> Origin：https://hub-google.github.io  
> browser_direct_ok 只有在 HTTP 成功且 Access-Control-Allow-Origin 允許 GitHub Pages 時才為 true。

| 縣市 | 方法 | HTTP | ACAO | GitHub Pages 可直讀 | URL |
|---|---|---:|---|---|---|
| 臺北市 | GET | 200 | * | ✅ | https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_allavailable.json |
| 新北市 | GET | 200 | — | ❌ | https://data.ntpc.gov.tw/api/datasets/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json?page=0&size=5 |
| 桃園市 | GET | 200 | https://opendata.tycg.gov.tw | ❌ | https://opendata.tycg.gov.tw/api/dataset/f4cc0b12-86ac-40f9-8745-885bddc18f79/resource/0381e141-f7ee-450e-99da-2240208d1773/download |
| 臺南市 | GET | 200 | — | ❌ | https://parkweb.tainan.gov.tw/api/parking.php |
| 新竹市 | GET | 200 | — | ❌ | https://hispark.hccg.gov.tw/OpenData/GetParkInfo?format=json |
| 高雄市 | GET | — | — | ❌ | https://kpp.tbkc.gov.tw/ParkingLocation/GetParkingLocation |
| 彰化縣 | POST | — | — | ❌ | https://chpark.chcg.gov.tw/ParkingLocation/ParkingLotPost |
| 宜蘭縣 | GET | — | — | ❌ | https://opendataap2.e-land.gov.tw/resource/files/2023-02-12/62f4d78b604ba16b8cc1e856dd28d2c3.json |
| 臺東縣 | GET | 200 | * | ✅ | https://trafficweb.ttcpb.gov.tw/api/parking-lots |
| 澎湖縣 | GET | 200 | * | ✅ | https://zytparking.com:35170/api/external-setting/parking-lot-available-space?parkingLotCode=OWIZXZ |
