# 生データの取得元

`scripts/build-gazetteer.mjs` と `scripts/build-samples.mjs` が読む元ファイルです。容量が大きいため git には入れません。生成物（`data/gazetteer/*.json`、`samples/*.csv`）だけをコミットします。作り直すときは、下の URL から同じファイル名で取得してください。

取得日はすべて 2026-10-04。

| ファイル | 取得元 | ライセンス・利用条件 |
|---|---|---|
| （ワークスペース内）`_app_data/prefectures-data-parser/outputs_simplified/_rev02/*.geojson` | 国土交通省「国土数値情報（行政区域データ N03、2025年）」を市区町村単位で GeoJSON 化・50 m 簡略化したもの（同リポジトリの README 参照）。`build-basemap-japan.mjs` が都道府県単位に結合する<br>https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html | 国土数値情報の利用約款（出典明記） |
| `codefortokyo-pref-latlon.tsv` | Code for Tokyo「ndl-dataset-2016」基礎データ `緯度経度_都道府県.tsv`（元データ：地方公共団体情報システム機構）<br>https://github.com/codefortokyo/ndl-dataset-2016/tree/master/%E5%9F%BA%E7%A4%8E%E3%83%87%E3%83%BC%E3%82%BF | 出典を明記して利用 |
| `codefortokyo-city-latlon.tsv` | 同上 `緯度経度_市区町村.tsv`（2016年時点の市区町村） | 出典を明記して利用 |
| `ne_50m_admin_0_countries.geojson` | Natural Earth 1:50m Admin 0 – Countries（v5.1 系、GitHub `nvkelso/natural-earth-vector` master）<br>https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson | パブリックドメイン |
| `ne_10m_populated_places.geojson` | Natural Earth 1:10m Populated Places<br>https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson | パブリックドメイン |
| `estat-a002.xlsx` | 総務省統計局「住民基本台帳人口移動報告」2025年 年報（実数）第2表「男女、移動前の住所地別都道府県間移動者数」（2026-02-03 公開）<br>https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040407039&fileKind=4 | 政府標準利用規約（第2.0版） |
| `customs/d41ca.csv`、`customs/d42ca0NN.csv` | 財務省貿易統計「輸出入額の推移（地域（国）別）」年別推移（単位：千円。2024年以前は確定値、2025年は確々報値）<br>https://www.customs.go.jp/toukei/suii/html/time.htm | 政府標準利用規約（第2.0版） |
| `customs/a1.htm` | 財務省貿易統計「統計国名符号表」<br>https://www.customs.go.jp/toukei/sankou/dgorder/a1.htm | 政府標準利用規約（第2.0版） |

## 検算

`build-samples.mjs` は次を確認してから CSV を書き出します。

- 人口移動: 47都道府県それぞれについて、移動先別の値の合計が公表の「都道府県間移動者数」と一致すること。全体の合計は 2,515,731 人（公表値と一致）。
- 貿易: 上位30か国の国名がすべて国の地名辞書で照合できること。
