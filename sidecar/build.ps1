# PyInstaller でサイドカーを単一実行ファイルにバンドルする (Windows)
# 出力: ../src-tauri/binaries/sidecar-<target-triple>.exe

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot

try {
    # ── 仮想環境の python を特定 ──
    $py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path $py)) {
        Write-Host "Creating .venv (one-time)..."
        python -m venv .venv
        & $py -m pip install --upgrade pip
        & $py -m pip install -r requirements.txt
    }

    # ── target triple を rustc から取得（無ければハードコード） ──
    $target = "x86_64-pc-windows-msvc"
    try {
        $rustOut = & rustc -vV 2>$null
        $hostLine = $rustOut | Where-Object { $_ -match '^host:\s*(.+)$' }
        if ($hostLine -and $matches[1]) { $target = $matches[1] }
    } catch { }
    Write-Host "Target triple: $target"

    # ── PyInstaller 実行 ──
    & $py -m PyInstaller --noconfirm --onefile --name sidecar `
        --collect-all cv2 `
        --collect-submodules uvicorn `
        --hidden-import uvicorn.lifespan.on `
        --hidden-import uvicorn.lifespan.off `
        --hidden-import uvicorn.protocols.http.auto `
        --hidden-import uvicorn.protocols.http.h11_impl `
        --hidden-import uvicorn.protocols.websockets.auto `
        --hidden-import uvicorn.loops.auto `
        --hidden-import uvicorn.loops.asyncio `
        main.py

    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed (exit $LASTEXITCODE)" }

    # ── 配置 ──
    $destDir = Join-Path $PSScriptRoot "..\src-tauri\binaries"
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    $dest = Join-Path $destDir "sidecar-$target.exe"
    Copy-Item -Path "dist\sidecar.exe" -Destination $dest -Force
    Write-Host "OK -> $dest"
    Write-Host "Size: $((Get-Item $dest).Length / 1MB) MB"
}
finally {
    Pop-Location
}
