# Nitido — 楽譜ノイズ除去ツール

スキャンしたモノクロ楽譜 PNG の音符・五線を濃く・くっきりさせるデスクトップアプリ。

製品名「Nitido」（伊・西語で「鮮明な／くっきりした」の意）。リポジトリ名・ディレクトリ名は引き続き `score_denoiser`。

## スタック

- **Frontend**: Tauri v2, React 18, TypeScript, Vite
- **Backend**: Rust（Tauri 本体 + サイドカー管理）
- **Sidecar**: Python 3.10+, FastAPI, OpenCV, NumPy（ポート 8766 固定、PyInstaller でバンドル）

## ディレクトリ構成

```
score_denoiser/
├── src/                  # React UI
├── src-tauri/            # Tauri (Rust) + tauri.conf.json + icons + binaries
├── sidecar/              # Python サイドカー (FastAPI)
│   ├── main.py
│   ├── services/processor.py    # 画像処理コア (process_score)
│   ├── routers/{folder,preview,batch,config}.py
│   ├── build.ps1                 # PyInstaller ビルド (Windows)
│   └── build.sh                  # PyInstaller ビルド (macOS/Linux)
├── public/               # フロント静的アセット
├── legacy-python/        # Tkinter 版 v2.6 (アーカイブ)
├── .github/workflows/    # GitHub Actions (タグプッシュで自動ビルド)
└── HANDOFF.md            # 引き継ぎ・残タスク
```

## セットアップ

```powershell
# Node 依存
npm install

# Python サイドカー依存 (.venv 作成 + pip install)
cd sidecar
python -m venv .venv
.venv\Scripts\Activate.ps1   # Windows
# source .venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
cd ..

# サイドカーを PyInstaller でバンドル（初回のみ、または sidecar/ を変更したとき）
npm run build:sidecar           # Windows
# npm run build:sidecar:unix    # macOS/Linux
# → src-tauri/binaries/sidecar-<target>.exe が生成される
```

## 開発・実行

```powershell
# Tauri 開発起動（バンドルされたサイドカーを自動起動）
npm run tauri dev
```

### サイドカーをホットリロード開発したい場合

`sidecar/` 配下のコードを頻繁に変更する場合は、バンドルバイナリではなく `uvicorn --reload` で起動する方が高速です。

```powershell
# [Terminal 1] サイドカーをホットリロード起動
npm run sidecar
# → http://127.0.0.1:8766 で待機

# [Terminal 2] Tauri 起動（自動起動のサイドカーはポート 8766 衝突で
#  失敗するが、ログメッセージのみで処理は継続する）
npm run tauri dev
```

## 本番ビルド

```powershell
# サイドカーをビルドした上で
npm run build:sidecar
# Tauri 本番ビルド（インストーラー生成）
npm run tauri build
```

## リリース（自動）

`v*.*.*` 形式のタグを push すると GitHub Actions が以下を実行:

1. Python + PyInstaller でサイドカーをバンドル
2. Tauri ビルド（Windows x86_64 / macOS Intel / macOS ARM）
3. GitHub Releases にドラフトリリース作成

```powershell
git tag v0.1.0
git push origin v0.1.0
```

## アルゴリズム

```
入力: グレースケール PNG
  ↓ ① Gaussian Blur (ksize 0/3/5/7)
  ↓ ② Threshold (100〜245, 推奨 220)
  ↓ ③ Morphology Close (ksize 0/3/5/7)
出力: 二値化 PNG（「処理済み」フォルダに保存）
```

推奨パラメータ: `blur=5, threshold=220, close=5`

## 設定の永続化

`~/.nitido/config.json` に blur/threshold/close/folder 等が自動保存されます。
旧バージョン (`~/.score_denoiser/config.json`) からは初回起動時に自動マイグレートされます。

## キーボードショートカット

| キー | 動作 |
|---|---|
| Ctrl+O | フォルダ選択 |
| ↑ / ← | 前のファイル |
| ↓ / → | 次のファイル |
| F5 | プレビュー再生成 |
| Home | ビュー fit |

## ライセンス

**MIT License** — 詳細は [LICENSE](./LICENSE) を参照してください。

### 同梱ライブラリのライセンス

- OpenCV: Apache License 2.0
- FastAPI / Starlette / Pydantic / React / Tauri: MIT License
- NumPy: BSD License
- Pillow: HPND License
- PyInstaller bootloader: GPL with bootloader exception（生成バイナリは自由に配布可）

すべて MIT と互換のライセンスです。

### アイコン

アプリアイコンは [Music-score icons](https://www.flaticon.com/free-icons/music-score) by Freepik – Flaticon を使用しています（要 attribution、アプリ内の「このアプリについて」ダイアログに記載）。

## 備考

`legacy-python/` には Tkinter 版 v2.6 を保管しています（参照用）。
