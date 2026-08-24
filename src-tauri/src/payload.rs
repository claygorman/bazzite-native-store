//! The app-in-an-app updater: a payload this Flatpak can replace by itself.
//!
//! ⭐ **Why this exists.** `/app` is read-only, so `tauri-plugin-updater` has nothing to
//! swap. The Flatpak portal's `Update()` is the sanctioned route and is genuinely
//! unusable here: it wants to show an "Update <app>?" dialog, resolves a backend from
//! the session's portal configuration, and the gamescope session registers none — so it
//! answers `org.freedesktop.DBus.Error.NotSupported / "No portal support found"` no
//! matter what the caller does. Verified on the box, 2026-08-23. The remaining route
//! that needs no new sandbox permission is to update a file we are allowed to write.
//!
//! `~/.var/app/<id>/data/` IS writable from inside the sandbox. So the Flatpak becomes a
//! shell: `/app/bin/bazzite-store` is the version it shipped with, and a newer, verified
//! binary may live beside it in the data directory. `flatpak/launch.sh` picks between
//! them.
//!
//! ⚠️ **The binary is only interchangeable because it is built against the same
//! runtime.** The flatpak job compiles it inside `org.gnome.Platform//50` and it runs
//! inside `org.gnome.Platform//50`, linking the runtime's WebKitGTK exactly as the
//! shipped one does. This is emphatically NOT the AppImage route that bundled its own
//! WebKit and died with `EGL_BAD_PARAMETER` (docs/PACKAGING.md) — nothing is bundled.
//!
//! ⚠️ **We now own the trust decision**, which Flatpak used to own. Everything below is
//! arranged around that: verify before installing, never after; refuse anything not
//! strictly newer; and never leave a half-written file where the launcher can find it.

use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::Manager;

/// Where the swappable binary lives, inside the sandbox's writable data directory.
const PAYLOAD_DIR: &str = "payload";
const BINARY_NAME: &str = "bazzite-store";
const VERSION_FILE: &str = "VERSION";

/// ⚠️ **The safety net, and the most important file here.**
///
/// Written before the launcher hands control to a payload and deleted once the app is up
/// (`payload_started`). If it is still present at the next launch, that payload did not
/// survive its own startup, so the launcher ignores it and runs `/app` instead.
///
/// Without this, one bad payload means the store never opens again — and the only way
/// back is SSH, which is the exact failure this whole feature exists to remove.
const MARKER_FILE: &str = "LAUNCHING";

/// Where the release assets live. Derived from the version rather than carried in the
/// feed, so the feed stays a single field and cannot disagree with itself.
fn asset_base(version: &str) -> String {
    format!("https://github.com/claygorman/bazzite-native-store/releases/download/{version}")
}

pub fn payload_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(PAYLOAD_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The signing key Tauri already uses, read from the app config so there is ONE copy.
///
/// ⚠️ Not duplicated into a Rust constant. Two copies of a public key is how you get a
/// build that verifies against a key nobody is signing with any more, and the symptom
/// would be "every update is corrupt" — which reads like a network problem.
///
/// Tauri stores it base64-wrapped around a whole minisign `.pub` FILE, so it has to be
/// decoded and then have its comment line stripped before it is a key.
fn public_key(app: &tauri::AppHandle) -> Result<minisign_verify::PublicKey, String> {
    let raw = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .ok_or("no updater pubkey in tauri.conf.json")?;
    let decoded = decode_base64(raw)?;
    let text = String::from_utf8(decoded).map_err(|_| "pubkey is not text".to_string())?;
    let line = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("untrusted comment:"))
        .next_back()
        .ok_or("pubkey file has no key line")?;
    minisign_verify::PublicKey::from_base64(line).map_err(|e| e.to_string())
}

/// Standard base64 decode. `base64` is already compiled into this binary as a transitive
/// dependency; this only names the use.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input.trim())
        .map_err(|e| format!("base64: {e}"))
}

/// Semantic-ish compare, matching `src/platform/version.ts`.
///
/// ⚠️ Strictly greater, never "different" — a stale feed must not be able to move a box
/// backwards, and a dev build ahead of the feed must not be told to downgrade itself.
pub fn is_newer(candidate: &str, installed: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split('-')
            .next()
            .unwrap_or("")
            .split('+')
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parse(candidate), parse(installed));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// The payload version currently installed, if any.
pub fn installed_version(dir: &Path) -> Option<String> {
    let version = std::fs::read_to_string(dir.join(VERSION_FILE)).ok()?;
    let version = version.trim().to_string();
    // A VERSION with no binary beside it is not an install; it is debris.
    dir.join(BINARY_NAME).exists().then_some(version)
}

/// Clear the launch marker — the app is up, so the payload works.
///
/// ⚠️ Called once the webview has actually rendered, not at process start. A payload
/// that starts and then dies before drawing anything is still a broken payload, and
/// clearing the marker too eagerly would let it fail forever instead of once.
#[tauri::command]
pub fn payload_started(app: tauri::AppHandle) {
    if let Ok(dir) = payload_dir(&app) {
        let _ = std::fs::remove_file(dir.join(MARKER_FILE));
    }
}

/// The Flatpak's entry point — the script that chooses between shell and payload.
///
/// ⚠️ Restarting must go through THIS, not through the payload binary directly, or the
/// "was launching" marker is never written and the new payload runs with no safety net.
const LAUNCHER: &str = "/app/bin/bazzite-store-launch";

/// Restart into whatever the launcher would now choose.
///
/// ⭐ **Why this exists, and why `tauri-plugin-process`'s `relaunch()` cannot do it.**
/// That plugin re-spawns `std::env::current_exe()`. On Linux that is
/// `readlink("/proc/self/exe")` — and installing a payload REPLACES the running binary by
/// rename, which unlinks the inode the process is still executing. The kernel then answers
/// that readlink with the original path plus a literal `" (deleted)"` suffix, which Rust
/// documents and which was measured on the box 2026-08-24:
///
/// ```text
/// pid 211594 -> /…/payload/bazzite-store (deleted)
/// ```
///
/// So `relaunch()` tries to spawn a path that cannot exist, fails, and `relaunchApp`'s
/// catch swallows it. The symptom is a Restart button that does nothing at all, forever,
/// with the app still executing a binary that is no longer on disk. **The payload updater
/// and `relaunch()` are incompatible by construction** — replacing the running executable
/// is the entire point of one and fatal to the other.
///
/// ⚠️ Even with a working path, re-execing the PAYLOAD would be wrong: it would skip
/// `launch.sh`, so no marker would be written and a payload that fails to start would have
/// no way back. Restart has to re-enter through the launcher.
///
/// ⚠️ `exec` REPLACES this process rather than spawning a child. That is deliberate: the
/// app is started by Steam through a `reaper` wrapper which owns the process, and a child
/// spawned from a dying parent is exactly what that reaper cleans up. Keeping the same PID
/// keeps Steam's bookkeeping intact.
///
/// Returns only on failure — on success this function never returns.
#[cfg(unix)]
#[tauri::command]
pub fn payload_relaunch() -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    if !Path::new(LAUNCHER).exists() {
        // Not a Flatpak — the caller falls back to the plugin, which is correct off-box
        // where nothing is replacing the running binary.
        return Err(format!("{LAUNCHER} not present"));
    }
    let error = std::process::Command::new(LAUNCHER).exec();
    Err(format!("exec {LAUNCHER}: {error}"))
}

#[cfg(not(unix))]
#[tauri::command]
pub fn payload_relaunch() -> Result<(), String> {
    Err("the payload launcher exists only on Linux".into())
}

/// What the launcher would choose, for the About page and the debug channel.
#[tauri::command]
pub fn payload_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = payload_dir(&app)?;
    Ok(serde_json::json!({
        "dir": dir.to_string_lossy(),
        "installed": installed_version(&dir),
        // True only between a launcher handover and a successful start — so if you ever
        // see it in a report, the previous payload did not come up.
        "pendingMarker": dir.join(MARKER_FILE).exists(),
    }))
}

/// Download, verify and install a payload. Returns once it is staged for next launch.
///
/// ⚠️ Ordering is the whole security argument, so it is spelled out:
///   1. download the binary to a `.part` file — never to its final name
///   2. download the signature
///   3. verify the SIGNATURE against the bytes on disk
///   4. only then make it executable and rename it into place
///   5. write VERSION last
///
/// Step 4 before step 3 would leave a window where the launcher could pick up an
/// unverified binary. Step 5 last means a crash mid-install leaves a stale VERSION, so
/// the launcher prefers `/app` — the safe direction.
#[tauri::command]
pub async fn payload_install(app: tauri::AppHandle, version: String) -> Result<(), String> {
    let current = env!("CARGO_PKG_VERSION");
    if !is_newer(&version, current) {
        return Err(format!("{version} is not newer than {current}"));
    }
    let dir = payload_dir(&app)?;
    if let Some(installed) = installed_version(&dir) {
        if !is_newer(&version, &installed) {
            return Err(format!("{version} is not newer than the staged {installed}"));
        }
    }

    let key = public_key(&app)?;
    let base = asset_base(&version);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let binary = client
        .get(format!("{base}/{BINARY_NAME}-linux-x86_64"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let signature_text = client
        .get(format!("{base}/{BINARY_NAME}-linux-x86_64.sig"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // ⚠️ Tauri writes its `.sig` as base64 around a whole minisign file.
    let minisig = String::from_utf8(decode_base64(&signature_text)?)
        .map_err(|_| "signature is not text".to_string())?;
    let signature =
        minisign_verify::Signature::decode(&minisig).map_err(|e| format!("signature: {e}"))?;

    // THE check. Everything before this is untrusted bytes off the internet.
    key.verify(&binary, &signature, false).map_err(|e| format!("verify: {e}"))?;

    let part = dir.join(format!("{BINARY_NAME}.part"));
    let final_path = dir.join(BINARY_NAME);
    {
        let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        file.write_all(&binary).map_err(|e| e.to_string())?;
        // ⚠️ fsync before rename. A rename is atomic with respect to the directory, not
        // to the file's contents — without this a power cut can leave a correctly-named
        // file full of zeroes, which is the one thing the signature cannot protect
        // against because it was checked before the crash.
        file.sync_all().map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    std::fs::rename(&part, &final_path).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(VERSION_FILE), &version).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{installed_version, is_newer};

    #[test]
    fn only_a_strictly_newer_version_installs() {
        assert!(is_newer("0.12.0", "0.11.0"));
        assert!(is_newer("0.11.1", "0.11.0"));
        assert!(!is_newer("0.11.0", "0.11.0"));
        // The property that stops a stale feed walking a box backwards.
        assert!(!is_newer("0.10.0", "0.11.0"));
    }

    /// 10 > 9 numerically but "10" < "9" as text — the classic way to get this wrong,
    /// and it has to match `src/platform/version.ts` exactly or the two layers disagree
    /// about whether an update exists.
    #[test]
    fn segments_compare_as_numbers() {
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(!is_newer("0.9.0", "0.10.0"));
    }

    #[test]
    fn a_prerelease_is_not_newer_than_its_release() {
        assert!(!is_newer("0.12.0-rc.1", "0.12.0"));
    }

    /// ⚠️ A VERSION file with no binary beside it must not count as an install, or the
    /// launcher would try to exec something that is not there and the app would simply
    /// fail to start.
    #[test]
    fn a_version_without_a_binary_is_not_an_install() {
        let dir = std::env::temp_dir().join(format!("payload-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("VERSION"), "9.9.9").unwrap();
        assert_eq!(installed_version(&dir), None);
        std::fs::write(dir.join("bazzite-store"), b"x").unwrap();
        assert_eq!(installed_version(&dir).as_deref(), Some("9.9.9"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
