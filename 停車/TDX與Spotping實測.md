# TDX / SpotPing 停車資料實測

> 執行時間：2026-09-30T02:08:09+00:00  
> 方法：GitHub Actions Ubuntu runner，以 headless Chrome 模擬 TDX 訪客瀏覽器模式；每個縣市明確端點最多重試 3 次。  
> 本輪只測原本地方公開動態 API 未確認的 15 個縣市。

## TDX 路外 ParkingAvailability 實測

| 縣市 | TDX code | 回傳筆數(top=5) | 有 numeric availability | 更新時間樣本 | 結論 | 完整 URL |
|---|---|---:|---|---|---|---|
| 高雄市 | Kaohsiung | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/Kaohsiung?%24top=5&%24format=JSON |
| 基隆市 | Keelung | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/Keelung?%24top=5&%24format=JSON |
| 嘉義市 | Chiayi | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/Chiayi?%24top=5&%24format=JSON |
| 新竹縣 | HsinchuCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/HsinchuCounty?%24top=5&%24format=JSON |
| 苗栗縣 | MiaoliCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/MiaoliCounty?%24top=5&%24format=JSON |
| 彰化縣 | ChanghuaCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/ChanghuaCounty?%24top=5&%24format=JSON |
| 南投縣 | NantouCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/NantouCounty?%24top=5&%24format=JSON |
| 雲林縣 | YunlinCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/YunlinCounty?%24top=5&%24format=JSON |
| 嘉義縣 | ChiayiCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/ChiayiCounty?%24top=5&%24format=JSON |
| 屏東縣 | PingtungCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/PingtungCounty?%24top=5&%24format=JSON |
| 花蓮縣 | HualienCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/HualienCounty?%24top=5&%24format=JSON |
| 臺東縣 | TaitungCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/TaitungCounty?%24top=5&%24format=JSON |
| 澎湖縣 | PenghuCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/PenghuCounty?%24top=5&%24format=JSON |
| 金門縣 | KinmenCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/KinmenCounty?%24top=5&%24format=JSON |
| 連江縣 | LienchiangCounty | 0 | 否 | — | ❌ 本輪沒有拿到資料列 | https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet/ParkingAvailability/City/LienchiangCounty?%24top=5&%24format=JSON |

### 原始嘗試紀錄

#### 高雄市 / Kaohsiung

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[2092:2092:0930/020540.900563:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[2276:2276:0930/020543.440988:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[2461:2461:0930/020546.680785:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 基隆市 / Keelung

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[2647:2647:0930/020550.949911:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[2832:2832:0930/020553.157214:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[3018:3018:0930/020556.368519:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 嘉義市 / Chiayi

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[3204:3204:0930/020600.568457:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[3389:3389:0930/020602.789825:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[3575:3575:0930/020605.992630:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 新竹縣 / HsinchuCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[3761:3761:0930/020610.178464:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[3945:3945:0930/020612.403475:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[4129:4129:0930/020615.691143:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 苗栗縣 / MiaoliCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[4316:4316:0930/020619.859817:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[4503:4503:0930/020622.133996:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[4711:4711:0930/020625.379286:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 彰化縣 / ChanghuaCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[4904:4904:0930/020629.605097:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "sentation from a non-existent mailbox.\n[5125:5139:0930/020632.732157:ERROR:gpu/command_buffer/service/shared_image/shared_image_manager.cc:401] SharedImageManager::ProduceMemory: Trying to Produce a Memory representation from a non-existent mailbox.\n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[5274:5274:0930/020635.039666:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 南投縣 / NantouCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[5462:5462:0930/020639.252269:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[5647:5647:0930/020642.376996:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[5831:5831:0930/020645.819503:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 雲林縣 / YunlinCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[6018:6018:0930/020650.057094:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[6203:6203:0930/020652.299587:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[6391:6391:0930/020655.523944:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 嘉義縣 / ChiayiCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[6578:6578:0930/020659.769498:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[6764:6764:0930/020701.941577:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[6948:6948:0930/020705.222286:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 屏東縣 / PingtungCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[7134:7134:0930/020709.418556:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[7321:7321:0930/020711.724908:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[7507:7507:0930/020714.919442:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 花蓮縣 / HualienCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[7695:7695:0930/020719.111446:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[7883:7883:0930/020721.341213:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[8066:8066:0930/020724.551925:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 臺東縣 / TaitungCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[8254:8254:0930/020728.758474:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[8440:8440:0930/020730.980017:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[8623:8623:0930/020734.202485:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 澎湖縣 / PenghuCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[8806:8806:0930/020738.416264:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[8993:8993:0930/020740.665665:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[9177:9177:0930/020743.876419:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 金門縣 / KinmenCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[9363:9363:0930/020748.087386:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[9547:9547:0930/020750.378025:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[9733:9733:0930/020753.585347:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~

#### 連江縣 / LienchiangCounty

~~~json
{
  "attempts": [
    {
      "attempt": 1,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "nown address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[9919:9919:0930/020757.810306:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 2,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "wn address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[10105:10105:0930/020800.071065:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    },
    {
      "attempt": 3,
      "rc": 0,
      "json": false,
      "count": 0,
      "stderr": "wn address type (examples of valid types are \"tcp\" and on UNIX \"unix\")\n[10291:10291:0930/020803.269026:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: \n"
    }
  ],
  "sample_keys": [],
  "body_head": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3c.org/TR/1999/REC-html401-19991224/loose.dtd\"> <html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=0\"><style type=\"text/css\"> html, body { margin: 0; padding: 0; font-family: Verdana, Arial, sans-serif; font-size: 10pt; background-color: #ffffff;} h1, h2 { height: 82px; text-indent: -999em; margin: 0; padding: 0; margin: 0; } div { margin: 0; pa"
}
~~~


## SpotPing 前端來源反查

- 首頁：https://spotping.autoit.studio/
- 首頁可讀：True
- Script bundles：
  - https://spotping.autoit.studio/assets/lang-menu.js
- API / endpoint 關鍵字：