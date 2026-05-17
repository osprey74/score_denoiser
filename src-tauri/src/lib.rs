use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const SIDECAR_PORT: u16 = 8766;

struct SidecarState(Mutex<Option<CommandChild>>);

fn kill_sidecar(state: &SidecarState) {
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

    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
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
                        "Sidecar not found: {e}. Run manually: cd sidecar && uvicorn main:app --port {SIDECAR_PORT}"
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
