# HANDOFF: 楽譜ノイズ除去ツール (score_denoiser) v2.6

> 作成日: 2026-05-17
> 引き継ぎ元: Claude (claude.ai チャット)
> 引き継ぎ先: Claude Code

---

## 1. プロジェクト概要

### 目的
スキャンされたモノクロ楽譜の PNG 画像を処理し、音符・五線などの黒い要素を濃く・くっきりさせて印刷品質を向上させるデスクトップ GUI ツール。

### 対象画像の仕様（実測済み）
```
フォーマット : PNG グレースケール 256値
解像度      : 5653 × 8000 px（横 ~6000px 想定）
ピクセル分布 : 0〜15(黒 ~5%), 16〜239(グレーエッジ ~7.5%), 240〜255(白地 ~87%)
Otsu 自動閾値: 131（ただし推奨は 200〜230）
```

グレーエッジ（7.5%）がスキャン由来のアンチエイリアス残滓であり、これが印刷時に音符を薄く見せる原因。

### 解決アルゴリズム（3 ステップ）
```python
def process_score(gray_img, blur_ksize, threshold, close_ksize):
    # ① Gaussian Blur: 微細ノイズを均す
    src = cv2.GaussianBlur(gray_img, (blur_ksize, blur_ksize), 0.8)

    # ② Threshold: グレーエッジを黒側に取り込む（閾値を高めに設定）
    _, binary = cv2.threshold(src, threshold, 255, cv2.THRESH_BINARY)

    # ③ Morphology Close: 黒領域内の残留白穴を塗りつぶす
    inv    = cv2.bitwise_not(binary)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_ksize, close_ksize))
    binary = cv2.bitwise_not(cv2.morphologyEx(inv, cv2.MORPH_CLOSE, kernel))

    return binary
```

**検証済みパラメータ（実画像 02.png / 03.png / 06.png）**

| パラメータ | 推奨値 | 範囲 | 効果 |
|---|---|---|---|
| blur_ksize | 5 | 0/3/5/7 | ノイズを均す |
| threshold  | 220 | 100〜245 | 高いほど黒面積↑ |
| close_ksize| 5 | 0/3/5/7 | 白穴を埋める |

---

## 2. ファイル構成

```
score_denoiser/
├── score_denoiser.py   # メイン（845行, v2.6）
├── requirements.txt    # 依存ライブラリ
├── README.md           # ユーザー向け説明書
└── HANDOFF.md          # このファイル
```

---

## 3. アーキテクチャ詳細

### クラス構成

```
App(tk.Tk)
├── 状態変数（インスタンス変数）
├── _build_ui()
│   ├── フォルダ選択行（LabelFrame）
│   ├── _build_params() → 3セクション+縦区切り
│   ├── プレビュー操作バー
│   ├── _paned (ttk.PanedWindow, horizontal)
│   │   ├── 左: _build_file_list() → ttk.Treeview
│   │   └── 右: Canvas（プレビュー）
│   └── バッチ処理行
└── メソッド群（下表参照）
```

### 主要インスタンス変数

| 変数 | 型 | 説明 |
|---|---|---|
| `folder_var` | `StringVar` | フォルダパス |
| `blur_var` | `IntVar` | Blur カーネルサイズ |
| `thresh_var` | `IntVar` | 閾値 |
| `close_var` | `IntVar` | Close カーネルサイズ |
| `keep_view_var` | `BooleanVar` | ズーム維持フラグ |
| `png_files` | `list[Path]` | ソート済みPNGパス一覧 |
| `_cur_idx` | `int` | 現在選択中ファイルのインデックス（-1=未選択） |
| `_tree_ids` | `list[str]` | Treeview の iid リスト（png_files と添字対応） |
| `_before_rgb` | `np.ndarray\|None` | プレビュー用・処理前 RGB |
| `_after_rgb` | `np.ndarray\|None` | プレビュー用・処理後 RGB |
| `_last_pil` | `PIL.Image\|None` | スピナー描画の下敷き用 |
| `_vx`, `_vy` | `float` | ビューポート左上座標（元画像 px） |
| `_zoom` | `float` | 拡大率（canvas_px / orig_px） |
| `_cw`, `_ch` | `int` | キャンバス実寸（Configure で更新） |
| `_mm_rect` | `tuple\|None` | ミニマップ領域 (x0,y0,x1,y1)（canvas座標） |
| `_mm_scale` | `tuple` | (orig_px/mm_px) のスケール（ドラッグ計算用） |
| `_spinning` | `bool` | スピナー表示中フラグ |
| `_spinner_job` | `str\|None` | `after()` のジョブ ID |
| `is_busy` | `bool` | 一括処理中フラグ |

### 主要メソッド一覧

| メソッド | 役割 |
|---|---|
| `_init_sash()` | PanedWindow サッシ初期位置設定（`<Map>` イベント後） |
| `_build_params(P)` | パラメータ欄構築（inner.pack(anchor="w") で左詰め） |
| `_build_file_list()` | 左ペイン Treeview 構築 |
| `_load_folder(folder, preselect)` | フォルダ読み込み共通処理 |
| `_load_folder_from_entry()` | パス直打ち + Enter 対応 |
| `_sel_folder_dir()` | askdirectory でフォルダ選択 |
| `_sel_folder_via_file()` | askopenfilename でファイル選択 → 親フォルダ設定 |
| `_on_tree_select(event)` | リスト選択 → 自動プレビュー起動 |
| `_run_preview(idx)` | バックグラウンドスレッドでプレビュー生成 |
| `_fit_view(redraw)` | 画像全体が収まるズームにリセット |
| `_start_spinner()` | スピナー開始 |
| `_stop_spinner()` | スピナー停止・ジョブキャンセル |
| `_spinner_loop()` | 50ms ごとに PIL で回転アーク描画 |
| `_show_toast(message, bg)` | 右下トースト通知（フェードアウト付き） |
| `_redraw()` | キャンバス再描画（ビューポート切り出し+ミニマップ合成） |
| `_make_minimap(...)` | ミニマップ生成（ビューポート枠描画） |
| `_on_press/drag/release` | マウスドラッグ（メイン画像 or ミニマップ） |
| `_mm_jump(mx, my)` | ミニマップクリック → ビューポートジャンプ |
| `_on_wheel(e)` | ホイールズーム（マウス位置中心） |
| `_clamp()` | ビューポートが画像外に出ないよう制約 |
| `_reset_preview(force_reset_view)` | プレビュー状態リセット |
| `_run_batch()` | 一括処理（バックグラウンドスレッド） |

---

## 4. 重要な設計判断と既知の注意点

### 日本語パス対応
`cv2.imread/imwrite` は Windows で日本語パスを処理できない。
`np.fromfile/tofile + cv2.imdecode/imencode` で回避。

```python
def imread_u(path, flags=cv2.IMREAD_GRAYSCALE):
    buf = np.fromfile(str(path), dtype=np.uint8)
    return cv2.imdecode(buf, flags)
```

### PanedWindow サッシの初期位置
`ttk.PanedWindow.sashpos()` はウィンドウが画面に表示された後でないと機能しない。
`<Map>` イベント + 20ms の `after()` + 失敗時リトライで対処。

```python
def _on_first_show(event):
    self.unbind("<Map>")
    self.after(20, self._init_sash)
self.bind("<Map>", _on_first_show)
```

### スピナーの仕組み
- `_last_pil`（最後に描画した PIL.Image）をベースに `Image.blend(..., alpha=0.55)` で暗転
- `ImageDraw.arc()` で270°アークを `SPINNER_STEP=16°` ずつ回転
- `after(50, ...)` で再帰的に次フレームをスケジュール
- UIスレッドで描画するため `threading.Thread` を使わない

### プレビューの非同期処理
バックグラウンドスレッドで画像処理 → `self.after(0, finish)` でUIを更新。
tkinter変数（`blur_var.get()` 等）はスレッド起動前にメインスレッドで読む。

### ビューポート座標系
`_vx, _vy` は元画像 px 単位の float。
`_zoom` は `canvas_px / orig_px`。
描画時: `crop = img[vy:vy+vh, vx:vx+vw]` → `cv2.resize(crop, (dw, dh))`

### Treeview の状態管理
`_tree_ids[i]` と `png_files[i]` が常に同じ添字で対応している。
行の状態は `tag_configure` + `item(iid, tags=("done",))` で色を付ける。

```python
CLR_DOING = "#fff8e1"  # 薄黄: 処理中
CLR_DONE  = "#e8f5e9"  # 薄緑: 完了
CLR_ERROR = "#ffebee"  # 薄赤: エラー
```

### パラメータ欄の左詰めレイアウト
`f2.columnconfigure(weight=1)` を使わず、内部フレームを `inner.pack(anchor="w")` で配置。
`fill/expand` なしなので全画面でも3セクションが間延びしない。

---

## 5. 定数一覧

```python
# ミニマップ
MINIMAP_W      = 240    # 幅 (canvas px)
MINIMAP_M      = 8      # 余白
MINIMAP_MAX_H  = 180    # 最大高さ

# スピナー
SPINNER_R      = 36     # 半径
SPINNER_WIDTH  = 7      # 線幅
SPINNER_STEP   = 16     # フレームごとの回転角度 (°)
SPINNER_FPS    = 50     # ms/フレーム

# トースト
TOAST_W        = 360
TOAST_H        = 54
TOAST_MARGIN   = 16
TOAST_SHOW_MS  = 2800   # 表示時間 (ms)

# ファイルリスト
LIST_PANE_INIT = 230    # 初期サッシ位置
LIST_ROW_H     = 30     # Treeview 行高さ
LIST_FONT_SIZE = 11     # ファイル名フォント
```

---

## 6. 依存ライブラリ

```
opencv-python >= 4.8.0
Pillow        >= 10.0.0   (12.1.1 で動作確認; Image.fromstring は廃止済み→使用していない)
numpy         >= 1.24.0
tkinter                   (Python標準; macOS は brew install python-tk が必要な場合あり)
```

---

## 7. 起動方法

```bash
pip install -r requirements.txt
python score_denoiser.py
```

---

## 8. 改善候補（優先度順）

### 高優先度
- [ ] **設定の永続化**: `config.json` に blur/threshold/close/zoom/folder を保存・復元
- [ ] **キーボードショートカット**: `←/→` でファイルリスト移動、`F5` でプレビュー再生成
- [ ] **処理済みフォルダのスキップ**: 一括処理時に既存の処理済みファイルをスキップするオプション

### 中優先度
- [ ] **左右分割プレビュー**: 処理前/処理後を Canvas を縦に分割して同時表示
- [ ] **バッチ処理の非同期プログレス**: 一括処理中のキャンセルボタン追加
- [ ] **処理結果サマリー**: 全ファイルの変化率を CSV でエクスポート
- [ ] **ファイルフィルタ**: ファイルリスト上部に検索ボックスを追加

### 低優先度（将来）
- [ ] **PyInstaller 配布**: 単体 `.exe` / `.app` 化
- [ ] **グレースケール出力**: 二値化せずグレーのまま保存するオプション
- [ ] **複数フォルダ対応**: タブまたはツリーで複数フォルダを管理

---

## 9. 開発経緯サマリー（設計変更の経緯）

| バージョン | 主な変更 |
|---|---|
| v1.0 | 初版。「白い孤立領域を塗りつぶす」アルゴリズム（誤った前提） |
| v2.0 | 実画像分析でグレースケール画像と判明→アルゴリズム刷新（Blur→Threshold→Close） |
| v2.1 | 日本語パス対応、プレビュー幅バグ修正、ズーム・パン・ミニマップ追加 |
| v2.2 | デフォルト値・最大値を1.5倍に拡張、ズーム維持オプション、五線保護（後に廃止） |
| v2.3 | 五線保護廃止、プレビュー非同期化、スピナー・トースト追加 |
| v2.4 | コンボボックス廃止→左側ファイルリストペイン（Listbox）追加 |
| v2.5 | サッシ幅0バグ修正、Treeview化（行間余白・フォント拡大）、フォルダ選択改善 |
| v2.6 | パラメータ左詰め（inner.pack anchor=w）、フォルダ選択3方式（フォルダ/ファイル/直打ち） |

### 試して廃止した機能
- **五線・符幹保護** (v2.2-v2.3): 攻撃的二値化で検出した水平線/垂直線に保守的閾値を適用。ノイズが残り期待する品質が出なかったため廃止。

---

_以上。v2.6 の時点で「問題なく稼働」が確認されている。_
