//! An opt-in debug log, written to a file you can read over SSH.
//!
//! ⚠️ A FILE, not stdout, and that is the whole point. In Game Mode the app is launched
//! by Steam as a non-Steam shortcut, so its stdout goes somewhere nobody is watching —
//! `println!` is invisible exactly when the box is the only place a bug reproduces. Three
//! separate failures in this project were diagnosed by guesswork for want of this.
//!
//! ⚠️ Off by default. It writes on every request when enabled, and a store that is quietly
//! doing disk I/O per HTTP call forever is not what anyone asked for. It is a diagnostic
//! you turn on, reproduce with, and turn off.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Manager;

static ENABLED: AtomicBool = AtomicBool::new(false);

/// Cap the file so an enabled log left on overnight cannot fill a Steam Deck.
///
/// ⚠️ Truncate-and-restart rather than a rolling window: keeping the tail would mean
/// rewriting the file on every append, and the interesting part of a reproduction is the
/// beginning — what the app did before it went wrong — not the last few lines.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

fn log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("debug.log"))
}

/// Where the log lives, so the About page can print a path you can `tail`.
#[tauri::command]
pub fn debug_log_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(log_path(&app)?.to_string_lossy().to_string())
}

/// Turn it on or off. Called from the settings row, and once at startup.
#[tauri::command]
pub fn debug_log_set(app: tauri::AppHandle, enabled: bool) -> Result<String, String> {
    let was = ENABLED.swap(enabled, Ordering::Relaxed);
    let path = log_path(&app)?;
    // Announce the transition IN the file, so a log that starts mid-story says why.
    if enabled && !was {
        let _ = append(&path, "--- debug logging enabled ---");
    }
    Ok(path.to_string_lossy().to_string())
}

fn append(path: &PathBuf, line: &str) -> std::io::Result<()> {
    if std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        let _ = std::fs::remove_file(path);
    }
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")
}

/// Append one line. Cheap no-op when disabled — the frontend still calls it.
///
/// ⚠️ Never returns an error to the caller. A diagnostic that can itself fail a request is
/// worse than no diagnostic, and the one moment this runs is the moment something is
/// already going wrong.
#[tauri::command]
pub fn debug_log(app: tauri::AppHandle, line: String) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    if let Ok(path) = log_path(&app) {
        let _ = append(&path, &line);
    }
}
