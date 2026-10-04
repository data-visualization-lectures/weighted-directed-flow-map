# 重み付き有向フローマップ（Weighted Directed Flow Map）

向きのある重み付きネットワークを地図上に描く dataviz.jp の静的ツールです。A→B と B→A で値が違っても、両方を読み分けられるように描きます。

- 往復の両方が描かれるペアは、それぞれ進行方向の左へずらして二車線のように並べ、矢尻は外側半分だけにします。曲線は時計回りにそろえます。
- 向きの既定表現は「均一幅＋矢尻」です。「先細り」「先細り＋矢尻」「先細り＋中央矢印線」も選べます。
- 総流量（両方向を別々に描く）と純流量（差だけを多い向きに描く）を切り替えられます。
- 地点の色は純流入（流入超過・流出超過）で塗れます。フローの色は「往復の差」でも塗れます。

設計の方針は Jenny ら（2017）"Design principles for origin-destination flow maps"（Cartography and Geographic Information Science 45(1)）と Flox に合わせています。太さで量、矢尻で向きを表し、曲線は同じ向きにそろえ、地点の手前で止めます。

## Identity

| 項目 | 値 |
|---|---|
| `appName` / ツール id | `weighted-directed-flow-map` |
| `chartType`（保存 payload 内） | `weighted-directed-flow-map` |
| 公開ホスト | https://weighted-directed-flow-map.dataviz.jp |
| `scope` | `viz`（hub: `app.dataviz.jp`） |
| `gaId` | `G-7NYMBRBRWZ` |
| `exportName` | `weighted-directed-flow-map` |
| プロジェクト保存 | `dataviz-tool-header` の `setProjectConfig` / `?projectId=`（`projectBackend: projects`） |
| 作成画面の公開 | ヘッダーのシェア（読込・保存の右）。`setShareConfig` / `shareProject()` |
| シェアテーブル | `weighted_directed_flow_map_shares` |
| publish 関数 | `publish-weighted-directed-flow-map-share` |
| 公開 URL | `/share.html?id=<uuid>`（埋め込みは `&embed=1`） |
| サイドバー | `standard-sidebar`（DVZEditorShell + DVZSettingSidebar + `SIDEBAR_SPEC` / `SETTINGS_SPEC` / adapter） |
| 公開操作（`#dvz-controls`） | 地点の絞り込み・方向（流出／流入／両方）、表示（総量／純量）、分類・期間の切替（分類列があるときだけ）、＋／−、リセット |

書き込みは保存済みプロジェクト必須 → Edge Function → `source_project_id` 単位の upsert です。クライアントから `weighted_directed_flow_map_shares` へ直接 INSERT しません。Edge Function は `chartType` が `weighted-directed-flow-map` 以外のプロジェクトを 400 で拒否します。

## ローカル確認

build step はありません。

```bash
python3 -m http.server 8931
```

- `http://127.0.0.1:8931/?auth_debug=1`
- `http://127.0.0.1:8931/?lang=en&auth_debug=1`
- `http://127.0.0.1:8931/?data_url=<CSVのURL>&auth_debug=1`
- `http://127.0.0.1:8931/share.html?id=<share-id>`

`?auth_debug=1` は共有認証のリダイレクトを止めるための指定です（`dataviz-local-auth-debug`）。

読込の優先順位は `?projectId=` → `?data_url=` → `catalog.json`（`compatibleTools` に `weighted-directed-flow-map` を含む項目）→ `samples/` のローカル fallback です。プロジェクトの読込が始まった後は、サンプルの自動読込で上書きしません。

## データ形式

1つのファイル（CSV / TSV / JSON）を読みます。形式は自動判定し、マッピングタブで変えられます。

### エッジリスト

```csv
年,出発地,到着地,金額（千円）
2025,日本,アメリカ合衆国,20374426230
2025,アメリカ合衆国,日本,12910220950
```

- 出発・到着・値の列は、`from` / `to` / `value`、`出発地` / `到着地` / `人数` などの別名から自動で割り当てます。
- 分類・期間の列（`年`、`year`、`区分` など）があると、閲覧者が `#dvz-controls` で切り替えられます。
- 地名辞書にない地点は、`from_lat` / `from_lon` / `to_lat` / `to_lon`（`出発地緯度` なども可）で座標を与えます。

### OD 行列（移動表）

```csv
移動前の住所地,北海道,青森県,…
北海道,-,1431,…
青森県,1707,-,…
```

既定では行が出発、列が到着です。`合計` や `全国` の行・列は除外します。`-` は 0、`…` `x` `*` は欠測として扱います。

### 地名の照合

`data/gazetteer/` の辞書で、名前を完全一致で照合します。部分一致はしないので、「京都」が「東京」に当たることはありません。

| 辞書 | 内容 |
|---|---|
| `jp-prefectures.json` | 47都道府県。都道府県庁の位置。日本語名、短縮名（東京）、英語名、JIS コード（13、13000、130001、JP-13） |
| `world-countries.json` | 242の国・地域。Natural Earth の表示位置。日本語名、英語名、ISO コード、財務省貿易統計の国名 |
| `world-cities.json` | 世界の首都と人口200万以上の都市、日本の全ての市と東京23区（市区町村役場の位置） |

「自動」では、最も多くの名前を照合できた辞書を使います。候補が複数ある名前（例：府中市、Congo）は、マッピングタブの「地点の照合結果」で選べます。世界・地域の合計値（`世界`、`アジア`、`その他`）は二重計上を避けるため除外します。

## 構成

- `index.html`: 編集画面
- `share.html`: 公開共有ページ（サイドバーなし、`#dvz-controls` あり）
- `js/settings-spec.js`: `SETTINGS_SPEC`、`SIDEBAR_SPEC`、項目ごとの書き込み先
- `js/flow-model.js`: 形式判定、列の自動割り当て、集計、総量／純量、上位件数（DOM 非依存）
- `js/gazetteer.js`: 地名辞書の照合（DOM 非依存）
- `js/flow-geometry.js`: フローの輪郭、二車線、矢尻、中心経度の自動選択、ラベル配置（DOM 非依存）
- `js/basemap.js`: 基図の読込と投影、沖縄の移動
- `js/flow-renderer.js`、`js/flow-legend.js`: SVG 描画、ズーム、凡例
- `js/controls.js`: `#dvz-controls`
- `js/flow-view.js`: 編集画面と共有ページで共通の描画制御
- `js/core/runtime.js`: 編集画面（ヘッダー連携、保存・読込、サイドバー）
- `js/share-runtime.js`、`js/core/routing.js`: 共有ページ
- `lib/`、`js/dvz-share-shell.v1.js`、`css/dvz-share-shell.v1.css`: 共有ライブラリが読めないときのローカル fallback
- `css/dvz-common.css`: Data / Export タブの視覚契約の基準（parallel-sets からコピー）
- `scripts/`: 地名辞書・基図・サンプルの生成スクリプト（手動実行）
- `supabase/`: シェアテーブルの migration と publish 関数

## データの出典とライセンス

| ファイル | 出典 | ライセンス |
|---|---|---|
| `data/basemap/japan.topojson` | 国土交通省「国土数値情報（行政区域データ N03、2025年）」を都道府県単位に結合・簡略化（`scripts/build-basemap-japan.mjs`）。<br>https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html | 国土数値情報の利用約款に従い出典を明記。「出典：国土数値情報（行政区域データ）（国土交通省）を加工して作成」 |
| `data/basemap/countries-110m.json` | world-atlas@2（Natural Earth 1:110m） | ISC（`data/basemap/LICENSE-world-atlas.txt`）、Natural Earth はパブリックドメイン |
| `data/gazetteer/jp-prefectures.json` | Code for Tokyo「ndl-dataset-2016」基礎データ（元データ：地方公共団体情報システム機構）の都道府県庁の緯度経度 | 出典を明記して利用 |
| `data/gazetteer/world-countries.json` | Natural Earth 1:50m Admin 0 と、財務省貿易統計の国名による別名 | パブリックドメイン／政府標準利用規約2.0 |
| `data/gazetteer/world-cities.json` | Natural Earth 1:10m Populated Places と、Code for Tokyo「ndl-dataset-2016」の市区町村役場の緯度経度（2016年時点） | パブリックドメイン／出典を明記して利用 |
| `samples/jp-prefecture-migration-2025*.csv` | 総務省統計局「住民基本台帳人口移動報告 2025年結果」第2表 | 政府標準利用規約2.0 |
| `samples/jp-trade-by-country-2021-2025*.csv` | 財務省「貿易統計」輸出入額の推移（地域（国）別）。2025年は確々報値 | 政府標準利用規約2.0 |
| `vendor/topojson-client.min.js` | topojson-client 3.1.0 | ISC |

生データの取得元 URL と取得日は `scripts/sources/README.md` にあります。生データは git に入れません。

貿易統計の2025年確定値は2026-11-12 に公表予定です。公表後に `scripts/sources/customs/` を取り直し、`node scripts/build-samples.mjs` でサンプルを作り直してください。

## デプロイ

Netlify プロジェクト `weighted-directed-flow-map` が GitHub `data-visualization-lectures/weighted-directed-flow-map` の `main` を公開する構成です。build step はありません。`netlify.toml` の publish は `.` です。

カスタムドメインは DNS で次の CNAME を向けます。

```
weighted-directed-flow-map.dataviz.jp  CNAME  weighted-directed-flow-map.netlify.app.
```

ロールバックは Netlify の直前デプロイを restore します。サイト自体を消す場合は DNS の CNAME も削除します。

GitHub リポジトリ作成、Netlify サイト作成、DNS 設定、シェアテーブルの本番 migration、`publish-weighted-directed-flow-map-share` の function deploy は、対象・コマンド・ロールバックを示して承認を得てから行います。

```bash
supabase functions deploy publish-weighted-directed-flow-map-share --no-verify-jwt
```

## 検証

```bash
find js -name '*.js' -print0 | xargs -0 -n1 node --check
node --test tests/*.js
git diff --check
```

データを作り直すとき（手動、ネットワークが必要）:

```bash
node scripts/build-basemap-japan.mjs
node scripts/build-gazetteer.mjs
node scripts/build-samples.mjs
```

Git 運用は `Prj_DatavizJP/AGENTS.md` に従い、このツール単体では原則 `main` で作業します。
