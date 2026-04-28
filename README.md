# 県の形 (Japan Prefecture Trace)

日本地図のなぞりゲームです。県名のみが表示された白地図に、指定された県の**内陸の県境**をなぞって、実際の県境との一致度を競います。

## 遊び方

1. 画面上部に表示されたお題の県名を確認する
2. 白地図上でその県と隣接する県との境界線（海岸線は不要）をマウス／タッチで描く
3. 「判定する」を押すとスコアと正解の県境（緑色）が表示される
4. 「次の問題」で続行

### 操作

| 操作 | キーボード | ボタン |
|------|-----------|--------|
| 線を描く | マウスドラッグ／タッチ | - |
| 直前の線を取り消し | `Z` または `Backspace` | 取り消し |
| すべて消す | `C` | クリア |
| 判定 | `Enter` | 判定する |
| 次の問題 | `Enter`（判定後）| 次の問題 |

## 採点方法

ユーザーの描画と正解の県境を双方向にサンプリングし、平均最近傍距離をピクセル単位で算出。閾値60pxを上限に線形スコア化（誤差0px=100点、60px以上=0点）。

## 技術構成

- 純粋な静的サイト（HTML/CSS/JS のみ、ビルド不要）
- 地図描画: [D3.js v7](https://d3js.org/) + [topojson-client v3](https://github.com/topojson/topojson-client)
- 地図データ: [dataofjapan/land](https://github.com/dataofjapan/land) の `japan.topojson`
- 投影法: Mercator（沖縄県は別投影で左上に小窓表示）
- 描画: SVG + Pointer Events（PC・タブレット・スマホ対応）

### 内陸県境の自動抽出

TopoJSON のアーク共有を利用して、`topojson.mesh()` のフィルタで「2つの県の境界に属するアーク = 内陸境界」「自分自身が両側 = 海岸線」を分離しています。

```js
const innerBorders = topojson.mesh(topo, topo.objects.japan,
  (a, b) => a !== b && (a.properties.id === prefId || b.properties.id === prefId));
```

### 出題対象

内陸県境を持つ県のみ出題（北海道・沖縄県は陸続きの隣県がないため対象外）。

## ローカルでの実行

ローカルファイル直開きでは `fetch` がブロックされるため、簡易HTTPサーバーで起動してください。

```bash
# Python 3
python -m http.server 8080

# あるいは Node.js
npx http-server -p 8080
```

ブラウザで `http://localhost:8080/` を開く。

## GitHub Pages への公開

このリポジトリは静的ファイルのみで構成されているので、追加のビルドステップ不要で公開できます。

1. GitHub のリポジトリページ → **Settings** → **Pages**
2. **Source** を **Deploy from a branch** に設定
3. **Branch** を `main` / `/ (root)` に設定して **Save**
4. しばらくすると `https://<ユーザー名>.github.io/japan-prefecture-trace/` で公開される

`.nojekyll` を含めているので Jekyll による加工は無効化されます。

## ファイル構成

```
.
├── index.html          # エントリポイント
├── style.css           # スタイル
├── app.js              # ゲームロジック
├── data/
│   └── japan.topojson  # 都道府県の TopoJSON
├── .nojekyll           # GitHub Pages 用
└── README.md
```

## ライセンス

地図データ（`data/japan.topojson`）は [dataofjapan/land](https://github.com/dataofjapan/land) より。同リポジトリに準じます。コードは MIT 相当として自由に利用してください。
