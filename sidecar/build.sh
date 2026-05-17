#!/usr/bin/env bash
# PyInstaller でサイドカーを単一実行ファイルにバンドルする (macOS / Linux)
# 出力: ../src-tauri/binaries/sidecar-<target-triple>

set -euo pipefail
cd "$(dirname "$0")"

# ── 仮想環境の python を特定 ──
if [ ! -x ".venv/bin/python" ]; then
    echo "Creating .venv (one-time)..."
    python3 -m venv .venv
    .venv/bin/pip install --upgrade pip
    .venv/bin/pip install -r requirements.txt
fi
PY=".venv/bin/python"

# ── target triple を rustc から取得（無ければ uname ベースで推定） ──
if command -v rustc >/dev/null 2>&1; then
    TARGET=$(rustc -vV | sed -n 's|^host: ||p')
else
    case "$(uname -sm)" in
        "Darwin arm64")  TARGET="aarch64-apple-darwin" ;;
        "Darwin x86_64") TARGET="x86_64-apple-darwin" ;;
        "Linux x86_64")  TARGET="x86_64-unknown-linux-gnu" ;;
        *) echo "Unknown platform: $(uname -sm)"; exit 1 ;;
    esac
fi
echo "Target triple: $TARGET"

# ── PyInstaller 実行 ──
$PY -m PyInstaller --noconfirm --onefile --name sidecar \
    --collect-all cv2 \
    --collect-submodules uvicorn \
    --hidden-import uvicorn.lifespan.on \
    --hidden-import uvicorn.lifespan.off \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.http.h11_impl \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.loops.asyncio \
    main.py

# ── 配置 ──
DEST_DIR="../src-tauri/binaries"
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/sidecar-$TARGET"
cp dist/sidecar "$DEST"
chmod +x "$DEST"
echo "OK -> $DEST"
ls -lh "$DEST"
