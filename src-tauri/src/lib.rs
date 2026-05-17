// Phase 1: サイドカーは別ターミナルで手動起動する想定
// （`npm run sidecar` または `cd sidecar && uvicorn main:app --port 8766`）
// Phase 3 で PyInstaller バンドル後に externalBin 経由の自動起動を復活させる予定。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
