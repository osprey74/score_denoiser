use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const SIDECAR_PORT: u16 = 8766;

/// アプリ終了時にサイドカーを確実に停止するため、子プロセスハンドルを保持する
struct SidecarState(Mutex<Option<CommandChild>>);

/// サイドカーを停止する（HTTP shutdown → プロセス kill の二段構え）
fn kill_sidecar(state: &SidecarState) {
    // 1. HTTP で正常終了を要求（PyInstaller 内部の子プロセスも確実に停止）
    let _ = std::thread::Builder::new()
        .name("sidecar-shutdown".into())
        .spawn(|| {
            let _ = std::net::TcpStream::connect_timeout(
                &format!("127.0.0.1:{SIDECAR_PORT}").parse().unwrap(),
                std::time::Duration::from_secs(1),
            )
            .and_then(|mut stream| {
                use std::io::Write;
                stream.write_all(
                    format!(
                        "POST /shutdown HTTP/1.1\r\nHost: 127.0.0.1:{SIDECAR_PORT}\r\nContent-Length: 0\r\n\r\n"
                    )
                    .as_bytes(),
                )
            });
        });

    // 2. プロセスハンドル経由で強制終了（フォールバック）
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // バンドルされたサイドカーを起動
            // （開発時に手動で uvicorn を別途起動している場合、ここはポート衝突で失敗するため
            //  ログを出して継続する）
            match app.shell().sidecar("sidecar") {
                Ok(sidecar_command) => match sidecar_command.spawn() {
                    Ok((_rx, child)) => {
                        println!("Sidecar started on port {SIDECAR_PORT}");
                        let state = app.state::<SidecarState>();
                        *state.0.lock().unwrap() = Some(child);
                    }
                    Err(e) => {
                        eprintln!(
                            "Failed to spawn sidecar: {e}. Run manually: cd sidecar && uvicorn main:app --port {SIDECAR_PORT}"
                        );
                    }
                },
                Err(e) => {
                    eprintln!(
                        "Sidecar binary not found: {e}. Run `npm run build:sidecar` first, or start manually with: cd sidecar && uvicorn main:app --port {SIDECAR_PORT}"
                    );
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                kill_sidecar(app.state::<SidecarState>().inner());
            }
        });
}
