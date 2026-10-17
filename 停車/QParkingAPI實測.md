# QParking API 實測

- URL: https://wkzshe1wa9.execute-api.ap-southeast-1.amazonaws.com/default/qpk_web_site/parking_lot?db=&asc=area_id,id,parking_lot_image.sort&disabled=false
- HTTP: 200
- root_type: dict
- root_keys: status_code, message, datas
- raw_head: {"status_code": 200, "message": "", "datas": [{"id": 19, "area_id": 1, "name": "\u5bf6\u6a4b\u7acb\u9ad4\u505c\u8eca\u5834", "address": "\u65b0\u5317\u5e02\u65b0\u5e97\u5340\u5bf6\u6a4b\u8def10\u865f", "phone_number": "02-29161742", "business_hours": "24\u5c0f\u6642", "rate": "<div><p>\u6bcf\u5c0f\u6642$30\u5143 / <span style=\"color: rgb(0, 172, 151);\">\u7576\u65e5\u7121\u6700\u9ad8\u4e0a\u9650</span></p></div>", "car_grid": "<div><p>\u5c0f\u578b\u8eca\u7e3d\u8eca\u683c - 482\u683c</p><p>\u8eab\u969c\u8eca\u683c - 10\u683c</p><p>\u5a66\u5e7c\u8eca\u683c - 15\u683c</p><p>\u96fb\u52d5\u8eca\u683c - 4\u683c</p></div>", "payment": "\u73fe\u91d1\u3001APS\u96fb\u5b50\u7968\u8b49\u652f\u4ed8\u3001\u505c\u8eca\u5927\u8072\u516cApp", "map_url": "https://maps.app.goo.gl/P78HkH5m4VzAqRZU8", "disabled": false, "area.id": 1, "area.name": "\u65b0\u5317\u5e02", "parking_lot_image": [{"id": 49, "parking_lot_id": 19, "image_src": "https://apipic.greenparking.com.tw/lot_image/34900944/LINE_ALBUM_2023926 _1_230926_128.jpg", "image_alt": "\u5bf6\u6a4b\u7acb\u9ad4\u505c\u8eca\u5834-1", "sort": 1}, {"id": 50, "parking_lot_id": 19, "image_src": "https://apipic.greenparking.com.tw/lot_image/34900944/LINE_ALBUM_2023926 _1_230926_132.jpg", "image_alt": "\u5bf6\u6a4b\u7acb\u9ad4\u505c\u8eca\u5834-2", "sort": 2}, {"id": 51, "parking_lot_id": 19, "image_src": "https://apipic.greenparking.com.tw/lot_image/34900944/LINE_ALBUM_2023926 _1_230926_133.jpg", "image_alt": "\u5bf6\u6a4b\u7acb\u9ad4\u505c\u8eca\u5834-3", "sort": 3}, {"id": 52, "parking_lot_id": 19, "image_src": "https://apipic.greenparking.com.tw/lot_image/34900944/LINE_ALBUM_2023926 _1_230926_162.jpg", "image_alt": "\u5bf6\u6a4b\u7acb\u9ad4\u505c\u8eca\u5834-4", "sort": 4}, {"id": 53, "parking_lot_id": 19, "image_src": "https://apipic.greenparking.com.tw/lot_image/34900944/LINE_ALBUM_2023926 _1_230926_163.jpg", "image_alt": "\u5bf6\u6a4b\u7acb\u9ad4\u505c\u8eca\u5834-5", "sort": 5}]}, {"id": 20, "area_id": 1, "name": "\u65b0\u5e97\u9ad8\u4e2d\u5730\u4e0b\u505c\u8eca\u5834", "address": "\u65b0\u5317\u5e02\u65b0\u5e97\u5340\u4e09\u6c11\u8def161\u865f", "phone_number": "02-86656528", "business_hours": "24\u5c0f\u6642", "rate": "<div><p>\u6bcf\u5c0f\u6642$30\u5143 / <span style='color: #00AC97'>\u7576\u65e5\u7121\u6700\u9ad8\u4e0a\u9650</span></p><div>", "car_grid": "<div><p>\u5c0f\u578b\u8eca\u7e3d\u8eca\u683c\u6578 - 295\u683c</p><p>\u8eab\u969c\u8eca\u683c - 7\u683c</p><p>\u5a66\u5e7c\u8eca\u683c - 11\u683c</p><p>\u96fb\u52d5\u8eca\u683c - 4\u683c</p><p>\u91cd\u6a5f\u8eca\u683c - 8\u683c</p><div>", "payment": "\u73fe\u91d1\u3001APS\u96fb\u5b50\u7968\u8b49\u652f\u4ed8\u3001\u505c\u8eca\u5927\u8072\u516cApp", "map_url": "https://maps.app.goo.gl/aP4azxVXY7wHr3r27", "disabled": false, "area.id": 1, "area.name": "\u65b0\u5317\u5e02", "parking_lot_image": [{"id": 54, "parking_lot_id": 20, "image_src": "https://apipic.greenparking.com.tw/lot_image/72898187/LINE_ALBUM_2023926 _1_230926_14.jpg", "image_alt": "\u65b0\u5e97\u9
- rows: 32
- keys: address, area.id, area.name, area_id, business_hours, car_grid, disabled, id, map_url, name, parking_lot_image, payment, phone_number, rate
- availability-ish keys: car_grid

## 屏東相關 rows

~~~json
{
  "id": 3,
  "area_id": 7,
  "name": "屏菸1936文化基地立體停車場",
  "address": "屏東市菸廠路3號",
  "phone_number": "08-7324313",
  "business_hours": "24小時",
  "rate": "<div><p>每小時$20元 / <span style='color: #00AC97'>當日最高上限$100元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 323格</p><p>身障車格 - 7格</p><p>婦幼車格 - 12格</p><p>電動車格 - 24格</p><div>",
  "payment": "現金、一卡通、停車大聲公App",
  "map_url": "https://maps.app.goo.gl/UdphhgvcZhXpbBLq6",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 3,
      "parking_lot_id": 3,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/89024758/LINE_ALBUM_2023926_230926_124.jpg",
      "image_alt": "屏菸1936文化基地立體停車場-1",
      "sort": 1
    },
    {
      "id": 4,
      "parking_lot_id": 3,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/89024758/LINE_ALBUM_2023926_230926_125.jpg",
      "image_alt": "屏菸1936文化基地立體停車場-2",
      "sort": 2
    },
    {
      "id": 5,
      "parking_lot_id": 3,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/89024758/LINE_ALBUM_2023926_230926_135.jpg",
      "image_alt": "屏菸1936文化基地立體停車場-3",
      "sort": 3
    },
    {
      "id": 6,
      "parking_lot_id": 3,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/89024758/LINE_ALBUM_2023926_230926_140.jpg",
      "image_alt": "屏菸1936文化基地立體停車場-4",
      "sort": 4
    },
    {
      "id": 7,
      "parking_lot_id": 3,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/89024758/LINE_ALBUM_2023926_230926_161.jpg",
      "image_alt": "屏菸1936文化基地立體停車場-5",
      "sort": 5
    },
    {
      "id": 8,
      "parking_lot_id": 3,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/89024758/LINE_ALBUM_2023926_230926_171.jpg",
      "image_alt": "屏菸1936文化基地立體停車場-6",
      "sort": 6
    }
  ]
}
~~~

~~~json
{
  "id": 4,
  "area_id": 7,
  "name": "勝利星村停車場",
  "address": "屏東市博愛路202號",
  "phone_number": "08-7327303",
  "business_hours": "24小時",
  "rate": "<div><p>平日－每次$30元 / <span style='color: #00AC97'>當日無最高上限</span></p><p>假日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$160元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 118格</p><p>身障車格 - 3格</p><p>婦幼車格 - 3格</p><div>",
  "payment": "現金、一卡通、停車大聲公App",
  "map_url": "https://maps.app.goo.gl/HsQhqH9qe7uf99Ug9",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 9,
      "parking_lot_id": 4,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-6/LINE_ALBUM_2023926_230926_200.jpg",
      "image_alt": "勝利星村停車場-1",
      "sort": 1
    },
    {
      "id": 10,
      "parking_lot_id": 4,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-6/LINE_ALBUM_2023926_230926_198.jpg",
      "image_alt": "勝利星村停車場-2",
      "sort": 2
    },
    {
      "id": 11,
      "parking_lot_id": 4,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-6/LINE_ALBUM_2023926_230926_197.jpg",
      "image_alt": "勝利星村停車場-3",
      "sort": 3
    },
    {
      "id": 12,
      "parking_lot_id": 4,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-6/LINE_ALBUM_2023926_230926_202.jpg",
      "image_alt": "勝利星村停車場-4",
      "sort": 4
    },
    {
      "id": 13,
      "parking_lot_id": 4,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-6/LINE_ALBUM_2023926_230926_204.jpg",
      "image_alt": "勝利星村停車場-5",
      "sort": 5
    }
  ]
}
~~~

~~~json
{
  "id": 5,
  "area_id": 7,
  "name": "總圖停車場",
  "address": "屏東市自由路337號",
  "phone_number": "08-7324313",
  "business_hours": "24小時",
  "rate": "<div><p>平日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$60元</span></p><p>假日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$160元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 147格</p><p>身障車格 - 4格</p><p>婦幼車格 - 6格</p><div>",
  "payment": "現金、一卡通",
  "map_url": "https://maps.app.goo.gl/UzwwrLFsZPiz9Sa87",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 78,
      "parking_lot_id": 5,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-2/LINE_ALBUM_2023926_230926_74.jpg",
      "image_alt": "總圖停車場-1",
      "sort": 1
    },
    {
      "id": 79,
      "parking_lot_id": 5,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-2/LINE_ALBUM_2023926_230926_82.jpg",
      "image_alt": "總圖停車場-2",
      "sort": 2
    },
    {
      "id": 80,
      "parking_lot_id": 5,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-2/LINE_ALBUM_2023926_230926_86.jpg",
      "image_alt": "總圖停車場-3",
      "sort": 3
    },
    {
      "id": 81,
      "parking_lot_id": 5,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-2/LINE_ALBUM_2023926_230926_81.jpg",
      "image_alt": "總圖停車場-4",
      "sort": 4
    },
    {
      "id": 82,
      "parking_lot_id": 5,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-2/LINE_ALBUM_2023926_230926_79.jpg",
      "image_alt": "總圖停車場-5",
      "sort": 5
    }
  ]
}
~~~

~~~json
{
  "id": 6,
  "area_id": 7,
  "name": "縣府立體停車場",
  "address": "屏東市勝利里忠孝路225號",
  "phone_number": "08-7324313",
  "business_hours": "24小時",
  "rate": "<div><p>平日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$60元</span></p><p>假日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$160元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 206格</p><p>身障車格 - 6格</p><p>婦幼車格 - 6格</p><div>",
  "payment": "現金、一卡通",
  "map_url": "https://maps.app.goo.gl/rzZpqana52kVTd3B6",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 14,
      "parking_lot_id": 6,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/40789073/LINE_ALBUM_2023926_230926_57.jpg",
      "image_alt": "縣府立體停車場-1",
      "sort": 1
    },
    {
      "id": 15,
      "parking_lot_id": 6,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/40789073/LINE_ALBUM_2023926_230926_29.jpg",
      "image_alt": "縣府立體停車場-2",
      "sort": 2
    },
    {
      "id": 16,
      "parking_lot_id": 6,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/40789073/LINE_ALBUM_2023926_230926_39.jpg",
      "image_alt": "縣府立體停車場-3",
      "sort": 3
    },
    {
      "id": 17,
      "parking_lot_id": 6,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/40789073/LINE_ALBUM_2023926_230926_28.jpg",
      "image_alt": "縣府立體停車場-4",
      "sort": 4
    },
    {
      "id": 18,
      "parking_lot_id": 6,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/40789073/LINE_ALBUM_2023926_230926_18.jpg",
      "image_alt": "縣府立體停車場-5",
      "sort": 5
    },
    {
      "id": 19,
      "parking_lot_id": 6,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/40789073/LINE_ALBUM_2023926_230926_23.jpg",
      "image_alt": "縣府立體停車場-6",
      "sort": 6
    }
  ]
}
~~~

~~~json
{
  "id": 7,
  "area_id": 7,
  "name": "中華路外停車場",
  "address": "屏東市中華路134號",
  "phone_number": "08-7324313",
  "business_hours": "24小時",
  "rate": "<div><p>每小時$20元 / <span style='color: #00AC97'>當日最高上限$160元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 114格</p><p>身障車格 - 3格</p><p>婦幼車格 - 3格</p><p>電動車格 - 12格</p><div>",
  "payment": "現金、一卡通",
  "map_url": "https://maps.app.goo.gl/N2amdx1rkNHrugRr8",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 112,
      "parking_lot_id": 7,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-10/LINE_ALBUM_2023926_230926_59.jpg",
      "image_alt": "中華路外停車場-1",
      "sort": 1
    },
    {
      "id": 113,
      "parking_lot_id": 7,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-10/LINE_ALBUM_2023926_230926_62.jpg",
      "image_alt": "中華路外停車場-2",
      "sort": 2
    },
    {
      "id": 114,
      "parking_lot_id": 7,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-10/LINE_ALBUM_2023926_230926_65.jpg",
      "image_alt": "中華路外停車場-3",
      "sort": 3
    },
    {
      "id": 115,
      "parking_lot_id": 7,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-10/LINE_ALBUM_2023926_230926_69.jpg",
      "image_alt": "中華路外停車場-4",
      "sort": 4
    },
    {
      "id": 116,
      "parking_lot_id": 7,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-10/LINE_ALBUM_2023926_230926_71.jpg",
      "image_alt": "中華路外停車場-5",
      "sort": 5
    },
    {
      "id": 117,
      "parking_lot_id": 7,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-10/LINE_ALBUM_2023926_230926_72.jpg",
      "image_alt": "中華路外停車場-6",
      "sort": 6
    }
  ]
}
~~~

~~~json
{
  "id": 8,
  "area_id": 7,
  "name": "第三路外停車場",
  "address": "屏東市信義路與林森路口",
  "phone_number": "08-87327303",
  "business_hours": "24小時",
  "rate": "<div><p>平日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$50元</span></p><p>假日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$160元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 131格</p><p>身障車格 - 3格</p><p>婦幼車格 - 3格</p><div>",
  "payment": "現金、一卡通",
  "map_url": "https://maps.app.goo.gl/xbcXUMR696Q41UaG6",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 20,
      "parking_lot_id": 8,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-3/LINE_ALBUM_2023926_230926_175.jpg",
      "image_alt": "第三路外停車場-1",
      "sort": 1
    },
    {
      "id": 21,
      "parking_lot_id": 8,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-3/LINE_ALBUM_2023926_230926_176.jpg",
      "image_alt": "第三路外停車場-2",
      "sort": 2
    },
    {
      "id": 22,
      "parking_lot_id": 8,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-3/LINE_ALBUM_2023926_230926_178.jpg",
      "image_alt": "第三路外停車場-3",
      "sort": 3
    },
    {
      "id": 23,
      "parking_lot_id": 8,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-3/LINE_ALBUM_2023926_230926_179.jpg",
      "image_alt": "第三路外停車場-4",
      "sort": 4
    },
    {
      "id": 24,
      "parking_lot_id": 8,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-3/LINE_ALBUM_2023926_230926_184.jpg",
      "image_alt": "第三路外停車場-5",
      "sort": 5
    },
    {
      "id": 25,
      "parking_lot_id": 8,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-3/LINE_ALBUM_2023926_230926_195.jpg",
      "image_alt": "第三路外停車場-6",
      "sort": 6
    }
  ]
}
~~~

~~~json
{
  "id": 12,
  "area_id": 7,
  "name": "機場北路路外停車場",
  "address": "屏東市新勝興段50.51.52地號",
  "phone_number": "08-7324313",
  "business_hours": "24小時",
  "rate": "<div><p>每小時$10元 / <span style='color: #00AC97'>當日最高上限$30元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 72格</p><p>身障車格 - 1格</p><p>婦幼車格 - 2格</p><div>",
  "payment": "現金、一卡通",
  "map_url": "https://maps.app.goo.gl/iHdGHVrjYd2HgTVbA",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 31,
      "parking_lot_id": 12,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-9/LINE_ALBUM_2023926_230926_5.jpg",
      "image_alt": "機場北路路外停車場-1",
      "sort": 1
    },
    {
      "id": 32,
      "parking_lot_id": 12,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-9/LINE_ALBUM_2023926_230926_6.jpg",
      "image_alt": "機場北路路外停車場-2",
      "sort": 2
    },
    {
      "id": 33,
      "parking_lot_id": 12,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-9/LINE_ALBUM_2023926_230926_7.jpg",
      "image_alt": "機場北路路外停車場-3",
      "sort": 3
    },
    {
      "id": 34,
      "parking_lot_id": 12,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-9/LINE_ALBUM_2023926_230926_12.jpg",
      "image_alt": "機場北路路外停車場-4",
      "sort": 4
    },
    {
      "id": 35,
      "parking_lot_id": 12,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-9/LINE_ALBUM_2023926_230926_14.jpg",
      "image_alt": "機場北路路外停車場-5",
      "sort": 5
    },
    {
      "id": 36,
      "parking_lot_id": 12,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/81373970-9/LINE_ALBUM_2023926_230926_15.jpg",
      "image_alt": "機場北路路外停車場-6",
      "sort": 6
    }
  ]
}
~~~

~~~json
{
  "id": 32,
  "area_id": 7,
  "name": "空翔路外停車場",
  "address": "屏東市蘭州街9號",
  "phone_number": "08-7327303",
  "business_hours": "8:00-22:00",
  "rate": "<div><p>平日－每次$30元 / <span style='color: #00AC97'>當日無最高上限</span></p><p>假日－每小時$20元 / <span style='color: #00AC97'>當日最高上限$160元</span></p><div>",
  "car_grid": "<div><p>小型車總車格數 - 82格</p><div>",
  "payment": "現金",
  "map_url": "https://maps.app.goo.gl/tDQLAZWcYzKXmHHd6",
  "disabled": false,
  "area.id": 7,
  "area.name": "屏東市",
  "parking_lot_image": [
    {
      "id": 131,
      "parking_lot_id": 32,
      "image_src": "https://apipic.greenparking.com.tw/lot_image/6971/6971_photo-1.jpg",
      "image_alt": "空翔路外停車場",
      "sort": 1
    }
  ]
}
~~~
