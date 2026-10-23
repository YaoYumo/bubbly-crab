#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod local_ai;
mod local_ai_limits;

fn main() {
    // Local-only commands own a fixed bundled llama.cpp process; no arbitrary URL or shell.
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(local_ai::LocalAI::default())
        .invoke_handler(tauri::generate_handler![local_ai::local_ai_status, local_ai::local_ai_open_folder, local_ai::local_ai_stop, local_ai::local_ai_chat])
        .build(tauri::generate_context!())
        .expect("PREVIZ LAB desktop could not start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                use tauri::Manager;
                app.state::<local_ai::LocalAI>().stop();
            }
        });
}
