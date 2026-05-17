# HANDOFF: Nitido (楽譜ノイズ除去ツール) Tauri v2 移植

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

Phase 3 以降は PyInstaller でバンドルしたサイドカーを Tauri が自動起動します。

```powershell
# 1. Node 依存
npm install

# 2. Python サイドカー依存
cd sidecar
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..

# 3. サイドカーを PyInstaller でバンドル（初回 + sidecar/ 変更時）
npm run build:sidecar
# → src-tauri/binaries/sidecar-x86_64-pc-windows-msvc.exe (~62MB) が生成

# 4. Tauri 開発起動（サイドカー自動起動）
npm run tauri dev
```

ホットリロードで sidecar を開発する場合は、バンドルではなく `npm run sidecar` で uvicorn を別ターミナル起動（Tauri の自動起動はポート衝突で失敗するがログ出力のみで継続）。

## 5. Phase 2: UI 充実

### 高優先度
- [x] **キャンバスズーム・パン・ミニマップ** — Tkinter版 v2.6 と同等の操作感
  - `src/components/PreviewCanvas.tsx` で実装
  - HTML5 Canvas + DPR 対応、ホイールズーム（マウス位置中心）、ドラッグパン、右上ミニマップ
  - ミニマップクリックでビューポートジャンプ、左下 fit ボタン
  - 分割モードでは独立した2つの canvas（同期は今後検討）
- [x] **スピナー UI** — CSS アニメーション（border 回転）、`.spinner` クラス
- [x] **エラー表示** — トースト + プレビューオーバーレイ（詳細ダイアログは未実装、必要に応じて追加）

### 中優先度
- [x] **処理結果サマリー CSV エクスポート** — バッチ完了後にダウンロードボタン表示、UTF-8 BOM 付き
- [x] **ファイル検索ボックス** — ファイルリスト上部の絞り込み（含む検索）
- [x] **バッチキャンセルボタン** — `AbortController` で SSE 中断
- [x] **キーボードショートカット拡充**
  - `Ctrl+O` フォルダ選択
  - `↑↓←→` ファイル前後移動
  - `F5` プレビュー再生成
  - `Home` ビュー fit

### 未実装（Phase 2.5 候補）
- [ ] 分割モードのビューポート同期（左右 canvas の zoom/pan を連動）
- [ ] 詳細エラーダイアログ（スタックトレース付き）

## 6. Phase 3: 配布 & CI/CD

### PyInstaller サイドカーバンドル [完了]
- [x] `sidecar/build.ps1` (Windows) / `sidecar/build.sh` (macOS/Linux) 作成
- [x] `npm run build:sidecar` / `npm run build:sidecar:unix` で実行可能
- [x] `--collect-all cv2 --collect-submodules uvicorn` 含む
- [x] Windows でビルド検証済み（出力 ~62MB、`/health` 応答確認）
- [x] `src-tauri/binaries/sidecar-<target>` に配置（`.gitignore` 対象）

### Tauri サイドカー統合 [完了]
- [x] `Cargo.toml` に `tauri-plugin-shell = "2"` 復活
- [x] `tauri.conf.json` に `externalBin: ["binaries/sidecar"]` 復活
- [x] `capabilities/default.json` に `shell:default` + `shell:allow-execute` + `shell:allow-spawn` 復活
- [x] `lib.rs` に `app.shell().sidecar("sidecar")` 自動起動 + `kill_sidecar()` (HTTP shutdown → process kill 二段構え) 復活

### GitHub Actions [完了]
- [x] `.github/workflows/release.yml` 作成（caelum を参考）
- [x] タグプッシュ `v*.*.*` でトリガ
- [x] マトリクス: Windows x86_64 / macOS aarch64 / macOS x86_64
- [x] PyInstaller でサイドカーバンドル → Tauri ビルド → ドラフトリリース作成
- バージョン更新対象: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- `Cargo.lock` は `cargo generate-lockfile` で再生成

### 未実装
- [ ] **macOS `.icns` アイコン** — Mac 上で `iconutil` で生成し `src-tauri/icons/icon.icns` に配置、`tauri.conf.json` の `bundle.icon` に追加
- [ ] **コード署名** — Windows: Code Signing Certificate、macOS: Developer ID Application certificate
- [ ] **自動アップデート** — Tauri Updater プラグイン

## 7. 既知の注意点

### サイドカー起動失敗時
`src-tauri/src/lib.rs` の `kill_sidecar()` は port 8766 へ POST /shutdown を送る二段構え。  
開発中にサイドカーが孤児プロセスとして残った場合は `netstat -ano | findstr 8766` で PID 確認 → `taskkill /F /PID <pid>`。

### 日本語パス
`sidecar/services/processor.py` の `imread_u()` / `imwrite_u()` で対応済み（v2.6 と同実装）。

### config.json の場所
Windows: `C:\Users\<user>\.nitido\config.json`  
macOS: `~/.nitido/config.json`

旧 `~/.score_denoiser/` からは初回起動時に自動マイグレート。
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
