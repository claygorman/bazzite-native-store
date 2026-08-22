mod auth;
mod display;
mod input;
mod steam;
mod steamclient;
mod sysinfo;

use std::collections::HashMap;
use std::path::PathBuf;

use tauri::Manager;

/// Generic Steam GET. One command covers every endpoint in the catalog, so adding
/// one from private/STEAM-ENDPOINTS.md never requires touching Rust.
#[tauri::command]
async fn steam_get(
    app: tauri::AppHandle,
    host: String,
    path: String,
    query: HashMap<String, String>,
    ttl_seconds: u64,
    timeout_ms: u64,
) -> Result<String, String> {
    steam::get(cache_dir(&app)?, &host, &path, query, ttl_seconds, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("steam"))
        .map_err(|e| e.to_string())
}

/// What the disk cache weighs, for the Downloads page's status card.
#[tauri::command]
fn cache_stats(app: tauri::AppHandle) -> Result<steam::CacheStats, String> {
    Ok(steam::stats(&cache_dir(&app)?))
}

/// Empty it. Returns how many entries went, which is what the button reports back.
#[tauri::command]
fn cache_clear(app: tauri::AppHandle) -> Result<u64, String> {
    Ok(steam::clear(&cache_dir(&app)?))
}

/// Whether an update feed AND a signing key are configured.
///
/// ⚠️ Read from the live config rather than assumed, because both ship EMPTY: the
/// private signing key is not something this repo can hold, and the feed URL is
/// deployment-specific (README §4). Without this the Updates page has no way to tell
/// "asked, and you are current" apart from "never asked, because there is nowhere to
/// ask" — and the second one rendered as "Up to date" is a lie the page exists to
/// avoid. See src/platform/updates.ts.
#[tauri::command]
fn updater_configured(app: tauri::AppHandle) -> bool {
    let Some(updater) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let has_endpoint = updater
        .get("endpoints")
        .and_then(|v| v.as_array())
        .is_some_and(|list| list.iter().any(|e| e.as_str().is_some_and(|s| !s.is_empty())));
    let has_key = updater
        .get("pubkey")
        .and_then(|v| v.as_str())
        .is_some_and(|k| !k.is_empty());
    has_endpoint && has_key
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            input::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            steam_get,
            cache_stats,
            cache_clear,
            updater_configured,
            auth::steam_login,
            auth::steam_session,
            auth::steam_logout,
            display::steam_ui_scale,
            input::pad_info,
            sysinfo::host_info,
            steamclient::steam_session_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
