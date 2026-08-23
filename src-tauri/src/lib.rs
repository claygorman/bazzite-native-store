mod auth;
mod display;
mod input;
mod protondb;
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
    steam::get(
        cache_dir(&app)?,
        &host,
        &path,
        query,
        ttl_seconds,
        timeout_ms,
    )
    .await
    .map_err(|e| e.to_string())
}

/// One game's ProtonDB reports, read from the local index.
///
/// Empty is a normal answer — the game may have no reports, or the index may not have
/// been built yet. The UI distinguishes those two with `proton_index_status`, because
/// "nobody has reported this" and "we have not downloaded the data" are different
/// sentences and only one of them is about the game.
#[tauri::command]
async fn proton_reports(
    app: tauri::AppHandle,
    appid: u32,
) -> Result<Vec<protondb::Report>, String> {
    Ok(protondb::reports_for(&proton_dir(&app)?, appid))
}

/// Whether the dump has been indexed, and from which snapshot.
#[tauri::command]
async fn proton_index_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = proton_dir(&app)?;
    Ok(protondb::index_status(&dir))
}

/// Download the newest snapshot and rebuild the index.
///
/// ⚠️ Long — a ~66 MB download and roughly half a gigabyte of JSON to walk. The caller
/// is expected to treat this as a background job and not block a screen on it.
#[tauri::command]
async fn proton_refresh(
    app: tauri::AppHandle,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    protondb::refresh(proton_dir(&app)?, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

fn proton_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("protondb"))
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
        .is_some_and(|list| {
            list.iter()
                .any(|e| e.as_str().is_some_and(|s| !s.is_empty()))
        });
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
            steamclient::steam_session_get,
            proton_reports,
            proton_index_status,
            proton_refresh
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
