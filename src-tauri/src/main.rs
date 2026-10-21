#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // No HTTP client, shell, updater, model process or filesystem-wide commands.
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("PREVIZ LAB desktop could not start");
}
