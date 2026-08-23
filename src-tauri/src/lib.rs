mod auth;
mod debuglog;
mod debugserver;
mod display;
mod input;
pub mod protondb;
mod steam;
mod steamclient;
mod sysinfo;

use std::collections::HashMap;
use std::path::PathBuf;

use tauri::{Emitter, Manager};

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

/// Ask GitHub whether a newer dump exists, WITHOUT downloading it.
#[tauri::command]
async fn proton_check(app: tauri::AppHandle, timeout_ms: u64) -> Result<serde_json::Value, String> {
    protondb::check(proton_dir(&app)?, timeout_ms).await
}

/// Download the newest snapshot and rebuild the index.
///
/// ⚠️ Long — a ~66 MB download and roughly half a gigabyte of JSON to walk. The caller
/// is expected to treat this as a background job and not block a screen on it.
///
/// ⚠️ Uses `refresh_with_progress`, NOT `refresh`. The plain one passes a no-op
/// callback, so nothing ever reaches `protondb://progress` — which the frontend
/// listens for in `platform/protonDump.ts`. The bar then sits at zero for a minute and
/// the state machine never crosses to `indexing`, because that transition is driven by
/// `downloaded >= total` arriving. Throttling is the callee's job: it already reports
/// at most once per MB.
#[tauri::command]
async fn proton_refresh(
    app: tauri::AppHandle,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    let emitter = app.clone();
    protondb::refresh_with_progress(proton_dir(&app)?, timeout_ms, move |downloaded, total| {
        // A failed emit is not worth aborting a 66 MB download over — the window can
        // be gone while the job finishes. The bar stops moving; the result still lands.
        let _ = emitter.emit(
            "protondb://progress",
            serde_json::json!({ "downloaded": downloaded, "total": total }),
        );
    })
    .await
    .map_err(|e| e.to_string())
}

/// What runtimes a set of games' reports were filed against — turn 13c's second bar.
///
/// ⚠️ This is a RUNTIME question, not a graded one. It says how many reports ran under
/// a native build, official Proton, GE-Proton or Experimental; it says nothing about
/// how well any of them went. Tiers stay with the live summaries endpoint, per
/// `protondb.rs`'s header.
///
/// ⚠️ Local only. There is no aggregate endpoint upstream — one appid per HTTP request
/// — so this is answerable at all only because the dump is already a SQLite table. The
/// browser build therefore has no source for it and renders nothing; see
/// `src/platform/protonVariants.ts`.
#[tauri::command]
async fn proton_variant_split(
    app: tauri::AppHandle,
    appids: Vec<u32>,
) -> Result<protondb::VariantSplit, String> {
    Ok(protondb::variant_split(&proton_dir(&app)?, &appids))
}

/// Whether this process is running inside a Flatpak sandbox.
///
/// ⚠️ Read here rather than in the webview, which has no `process.env` to consult —
/// there is no Node in a Tauri frontend, and the obvious `globalThis.process` check
/// silently evaluates to `false` everywhere rather than failing loudly.
///
/// `FLATPAK_ID` is exported by flatpak for every app it launches, so this reflects how
/// the app was actually started rather than how it was built — which matters, because
/// the same binary ships in the Flatpak and (for now) in the AppImage.
#[tauri::command]
fn is_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some()
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
        /*
         * ⚠️ Pad input is gated on window focus, and it has to be gated HERE because
         * `gilrs` reads /dev/input directly and never learns about focus at all. The
         * keyboard stops on its own — those events come through the compositor — but the
         * dpad kept driving the store underneath Steam's Quick Access Menu, so you came
         * back to a different screen than the one you left.
         *
         * ⚠️ Measured on the box: with the QAM open a USB keyboard's arrows no longer
         * reach the app, while the dpad still drives it. Keyboard input is focus-mediated
         * and stops; /dev/input is not and does not. So gamescope really is moving focus,
         * which is what makes WindowEvent::Focused the right signal rather than a guess.
         */
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                input::FOCUSED.store(*focused, std::sync::atomic::Ordering::Relaxed);
            }
        })
        .invoke_handler(tauri::generate_handler![
            steam_get,
            cache_stats,
            cache_clear,
            updater_configured,
            is_flatpak,
            auth::steam_login,
            auth::steam_session,
            auth::steam_logout,
            display::steam_ui_scale,
            input::pad_info,
            input::pad_focus,
            debuglog::debug_log,
            debuglog::debug_log_set,
            debuglog::debug_log_path,
            debugserver::debug_server_set,
            debugserver::debug_state_set,
            sysinfo::host_info,
            steamclient::steam_session_get,
            proton_reports,
            proton_index_status,
            proton_refresh,
            proton_check,
            proton_variant_split
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
