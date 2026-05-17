# Nitido v1.0.0

## English

Initial release of Nitido — a desktop app for cleaning up scanned monochrome music score PNGs by darkening and sharpening notes and staff lines.

### Features

- **Image processing pipeline**: Gaussian Blur → Threshold → Morphology Close (powered by OpenCV)
- **Interactive preview** with mouse-wheel zoom, drag-to-pan, and a minimap overlay (click to jump)
- **Side-by-side before/after view** with synchronized zoom and pan
- **Batch processing** with real-time progress (SSE) and cancellation
- **Configurable kernels**: Blur (0, 3–31, step 2), Threshold (100–245), Close (0, 3–31, step 2)
- **CSV export** of batch results (UTF-8 with BOM, Excel-friendly)
- **Configuration persistence** at `~/.nitido/config.json`
- **Keyboard shortcuts**: `Ctrl+O` (open folder), `↑↓←→` (navigate files), `F5` (regenerate preview), `Home` (fit view)
- **Japanese-path safe** I/O via `np.fromfile` / `cv2.imdecode`

### Tech Stack

- **Frontend**: Tauri v2 + React 18 + TypeScript + Vite
- **Native shell**: Rust (Tauri runtime managing the sidecar lifecycle)
- **Image processing**: Python 3.10+ FastAPI + OpenCV, bundled as a single executable via PyInstaller (port 8766)

### Platforms

- Windows x86_64
- macOS aarch64 (Apple Silicon)
- macOS x86_64 (Intel)

### Acknowledgements

- **小霞 (Kasumi)** / [@laixiaoxia.bsky.social](https://bsky.app/profile/laixiaoxia.bsky.social) — Feedback and ideas

### Credits

- App icon: [Music-score icons](https://www.flaticon.com/free-icons/music-score) created by Freepik — Flaticon

---

## 日本語

スキャンしたモノクロ楽譜 PNG の音符・五線を濃く・くっきりさせるデスクトップアプリ「Nitido」の初回リリースです。

### 機能

- **画像処理パイプライン**: Gaussian Blur → Threshold → Morphology Close（OpenCV）
- **インタラクティブプレビュー**: ホイールズーム、ドラッグパン、ミニマップ（クリックでジャンプ）
- **処理前／処理後の左右分割表示**（ズーム・パン連動）
- **一括処理**: SSE でリアルタイム進捗表示、キャンセル可能
- **調整可能パラメータ**: Blur カーネル (0, 3〜31, step 2)、Threshold (100〜245)、Close カーネル (0, 3〜31, step 2)
- **CSV エクスポート**: バッチ結果（UTF-8 BOM 付き、Excel で文字化けなし）
- **設定永続化**: `~/.nitido/config.json`
- **キーボードショートカット**: `Ctrl+O`（フォルダを開く）、`↑↓←→`（ファイル移動）、`F5`（プレビュー再生成）、`Home`（fit）
- **日本語パス対応**: `np.fromfile` / `cv2.imdecode` で実装

### 技術スタック

- **フロントエンド**: Tauri v2 + React 18 + TypeScript + Vite
- **ネイティブシェル**: Rust（Tauri ランタイム、サイドカーのライフサイクル管理）
- **画像処理**: Python 3.10+ FastAPI + OpenCV、PyInstaller で単一実行ファイル化（ポート 8766）

### 対応プラットフォーム

- Windows x86_64
- macOS aarch64（Apple Silicon）
- macOS x86_64（Intel）

### 謝辞

- **小霞 (かすみ)** さん / [@laixiaoxia.bsky.social](https://bsky.app/profile/laixiaoxia.bsky.social) — フィードバック・アイデア提供

### クレジット

- アプリアイコン: [Music-score icons](https://www.flaticon.com/free-icons/music-score) by Freepik — Flaticon
