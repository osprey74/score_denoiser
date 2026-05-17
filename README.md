# 楽譜ノイズ除去ツール (score_denoiser)

スキャンしたモノクロ楽譜 PNG の音符・五線を濃く・くっきりさせるデスクトップアプリ。

## スタック

- **Frontend**: Tauri v2, React 18, TypeScript, Vite
- **Backend**: Rust（Tauri 本体のみ）
- **Sidecar**: Python 3.10+, FastAPI, OpenCV, NumPy（ポート 8766 固定）

## ディレクトリ構成

```
score_denoiser/
├── src/              # React UI
├── src-tauri/        # Tauri (Rust) + tauri.conf.json + icons
├── sidecar/          # Python サイドカー (FastAPI)
│   ├── main.py
│   ├── services/processor.py    # 画像処理コア (process_score)
│   └── routers/{folder,preview,batch,config}.py
├── public/           # フロント静的アセット
├── legacy-python/    # Tkinter 版 v2.6 (アーカイブ)
└── HANDOFF.md        # 引き継ぎ・残タスク
```

## 開発コマンド

```bash
# Node 依存ライブラリ
npm install

# Python サイドカー依存
cd sidecar
python -m venv .venv
.venv\Scripts\Activate.ps1   # Windows
# source .venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
cd ..

# フロント + Tauri 開発起動（サイドカーも自動起動）
npm run tauri dev

# サイドカー単体起動（デバッグ用）
cd sidecar && uvicorn main:app --port 8766 --reload
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

`~/.score_denoiser/config.json` に blur/threshold/close/folder 等が自動保存されます。

## キーボードショートカット

| キー | 動作 |
|---|---|
| ↑ / ← | 前のファイル |
| ↓ / → | 次のファイル |
| F5 | プレビュー再生成 |

## ライセンス・備考

個人利用ツール。`legacy-python/` には Tkinter 版 v2.6 を保管しています（参照用）。
