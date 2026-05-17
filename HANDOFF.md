# HANDOFF: 楽譜ノイズ除去ツール (Tauri v2 移植)

> 作成日: 2026-05-17
> Phase 1 (bootstrap) 完了時点

---

## 1. プロジェクト経緯

- **v2.6 (Tkinter Python)**: `legacy-python/score_denoiser.py` に保管
- **v0.1.0 (Tauri 移植)**: 本リポジトリのルート。caelum / Specula と同パターンで構成

## 2. 構成サマリー

| レイヤー | 技術 | 役割 |
|---|---|---|
| UI | React 18 + TypeScript + Vite | ファイル選択・パラメータ操作・プレビュー表示 |
| Native | Tauri v2 (Rust) | ウィンドウ・ダイアログ・サイドカー管理 |
| Logic | Python 3.10+ FastAPI (port 8766) | OpenCV による画像処理 |

サイドカーは `src-tauri/src/lib.rs` で `app.shell().sidecar("sidecar")` 経由で自動起動。本番ビルドでは PyInstaller でバイナリ化して `src-tauri/binaries/sidecar-<target>.exe` に配置する想定（Phase 3）。

## 3. Phase 1 完了項目

- ✅ Tauri scaffold (`package.json` / `vite.config.ts` / `tsconfig.json` / `index.html`)
- ✅ src-tauri (`Cargo.toml` / `tauri.conf.json` / `build.rs` / `src/main.rs` / `src/lib.rs` / `capabilities/default.json`)
- ✅ Tauri アイコン (`src-tauri/icons/{32x32, 128x128, 128x128@2x, icon.ico, icon.png}`)
- ✅ Python サイドカー (`sidecar/main.py` + `services/processor.py` + `routers/{folder,preview,batch,config}.py`)
- ✅ React UI (`src/{App.tsx, api.ts, main.tsx, styles.css}`)
- ✅ Tkinter 版 v2.6 を `legacy-python/` にアーカイブ
- ✅ 設定の永続化（`~/.score_denoiser/config.json`、debounced save）
- ✅ キーボードショートカット（↑↓←→ で前後ファイル、F5 で再生成）
- ✅ 左右分割プレビュー（処理前 / 処理後）
- ✅ 一括処理 SSE 進捗ストリーミング
- ✅ 既存ファイルスキップオプション

## 4. 動作確認手順（初回セットアップ）

```bash
# 1. Node 依存
npm install

# 2. Python サイドカー依存
cd sidecar
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..

# 3. サイドカー単独起動でAPI動作確認
cd sidecar && uvicorn main:app --port 8766
# 別ターミナル
curl http://127.0.0.1:8766/health

# 4. Tauri 開発起動（サイドカーは Rust から自動起動するが、
#    開発時は手動起動推奨：lib.rs の sidecar() は本番バイナリ前提）
npm run tauri dev
```

## 5. Phase 2: UI 充実（残タスク）

### 高優先度
- [ ] **キャンバスズーム・パン・ミニマップ** — Tkinter版 v2.6 と同等の操作感
  - 現状: `<img>` で全体表示のみ。大画像（5653×8000）では細部が見えない
  - 実装案: HTML5 Canvas + ホイールズーム、ドラッグパン、右上ミニマップオーバーレイ
- [ ] **スピナー UI** — プレビュー生成中の視覚的フィードバック
  - 現状: 「処理中…」テキストオーバーレイのみ
- [ ] **エラー表示の改善** — トースト＋詳細ダイアログ

### 中優先度
- [ ] **処理結果サマリー CSV エクスポート** — 全ファイルの変化率
- [ ] **ファイル検索ボックス** — ファイルリスト上部のフィルタ
- [ ] **バッチキャンセルボタン** — 一括処理中の中断
- [ ] **キーボードショートカット拡充** — Ctrl+O (フォルダ選択), Enter (一括実行) 等

## 6. Phase 3: 配布 & CI/CD（残タスク）

### PyInstaller サイドカーバンドル
caelum を参考に `build_sidecar.sh` / `build_sidecar.ps1` を作成：

```bash
cd sidecar
pyinstaller --onefile --name sidecar main.py \
  --hidden-import cv2 \
  --collect-all cv2
# → dist/sidecar.exe (Windows) または dist/sidecar (macOS/Linux)
cp dist/sidecar* ../src-tauri/binaries/sidecar-<target-triple>
```

ターゲットトリプル例:
- Windows x86_64: `sidecar-x86_64-pc-windows-msvc.exe`
- macOS ARM64: `sidecar-aarch64-apple-darwin`
- macOS Intel: `sidecar-x86_64-apple-darwin`

### GitHub Actions
- caelum の `.github/workflows/release.yml` を参考に作成
- タグプッシュ (`v*.*.*`) で Windows x86_64 + macOS universal を自動ビルド
- バージョン更新対象: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- `Cargo.lock` は `cargo generate-lockfile` で自動更新

### macOS アイコン
- `src-tauri/icons/icon.icns` を生成（Mac 上で `iconutil` を使用）
- `tauri.conf.json` の `bundle.icon` 配列に追加

## 7. 既知の注意点

### サイドカー起動失敗時
`src-tauri/src/lib.rs` の `kill_sidecar()` は port 8766 へ POST /shutdown を送る二段構え。  
開発中にサイドカーが孤児プロセスとして残った場合は `netstat -ano | findstr 8766` で PID 確認 → `taskkill /F /PID <pid>`。

### 日本語パス
`sidecar/services/processor.py` の `imread_u()` / `imwrite_u()` で対応済み（v2.6 と同実装）。

### config.json の場所
Windows: `C:\Users\<user>\.score_denoiser\config.json`  
macOS: `~/.score_denoiser/config.json`

開発時に設定をリセットしたい場合はこのファイルを削除。

## 8. アルゴリズム検証

v2.6 と完全同一の `process_score()` を `sidecar/services/processor.py` に移植済み。  
Phase 2 以降で UI 変更を加える際も、アルゴリズム本体は無改修を推奨。

## 9. バージョン管理対象

新バージョンリリース時に更新するファイル:

- `package.json` (`"version"`)
- `src-tauri/Cargo.toml` (`version = "..."`)
- `src-tauri/tauri.conf.json` (`"version"`)
- `Cargo.lock` (`cargo generate-lockfile` で再生成)
