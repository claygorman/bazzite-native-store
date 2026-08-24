//! Self-update for the Flatpak build, through the Flatpak portal.
//!
//! ⭐ **Why not `tauri-plugin-updater` here.** That plugin replaces the running binary
//! in place, which is exactly right for the AppImage route (README §4) and impossible
//! inside a Flatpak: `/app` is read-only, so there is no file to swap however well
//! signed the download is. `updates.ts` models that as `status: 'managed'`.
//!
//! ⭐ **Why the portal and not `flatpak-spawn --host flatpak update`.** Spawning needs
//! `--talk-name=org.freedesktop.Flatpak` in `finish-args`, which grants the sandbox the
//! ability to run *arbitrary* host commands — "we only update ourselves" would then be
//! a property of this file rather than of the system. `CreateUpdateMonitor` returns a
//! monitor bound to the CALLER's own ref, so updating anything else is not expressible.
//! Same reasoning as `ALLOWED_PATHS` in `steamclient.rs`: it cannot beats we promise not
//! to. It also needs no `finish-args` at all — portals are reachable from every sandbox.
//!
//! ⚠️ **This module no longer INSTALLS anything.** `Update()` cannot work in Game Mode —
//! `flatpak-portal` insists on an "Update <app>?" dialog and resolves a backend from the
//! session's portal configuration, which gamescope does not populate, so it answers
//! `NotSupported / "No portal support found"` whatever the caller does. Installing is
//! `payload.rs`'s job now. What remains here is the update CHECK, used only when the
//! version feed is unreachable, and a capability probe for the debug channel.
//!
//! ⚠️ **The check only works when the app was installed from a REMOTE.** A single-file
//! `.flatpak` bundle has no origin to pull from, so the monitor has nothing to check and
//! reports nothing forever. That is not a failure state to display; it is why the CI job
//! publishes an ostree repo.

#[cfg(target_os = "linux")]
mod imp {
    use std::collections::HashMap;
    use std::time::Duration;

    use futures_util::StreamExt;
    use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
    use zbus::{proxy, Connection};

    /// How long to wait for the portal to say something.
    ///
    /// ⚠️ The monitor is a *watcher*, not a request/response call — there is no "check
    /// now" method in the interface. It decides when to poll, so a bounded wait is the
    /// only shape available and a silent timeout means "nothing was announced", NOT "you
    /// are up to date". `updates.ts` must phrase it accordingly: a client that has not
    /// been told cannot claim currency.
    const ANNOUNCE_WAIT: Duration = Duration::from_secs(25);

    /// Installing is a download; give it room but never forever.
    const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);

    #[proxy(
        interface = "org.freedesktop.portal.Flatpak",
        default_service = "org.freedesktop.portal.Flatpak",
        default_path = "/org/freedesktop/portal/Flatpak"
    )]
    trait FlatpakPortal {
        fn create_update_monitor(
            &self,
            options: HashMap<&str, Value<'_>>,
        ) -> zbus::Result<OwnedObjectPath>;

        /// ⚠️ `name = "version"` is required. zbus capitalises property names by
        /// default, so this asked for `Version` and the portal answers
        /// `org.freedesktop.DBus.Error.InvalidArgs: No such property "Version"` — which
        /// surfaced as "portal UNAVAILABLE" and had me believing the portal was
        /// unreachable when it was answering perfectly well. The real portal failure was
        /// somewhere else entirely (no Access backend in gamescope); this only made it
        /// harder to see.
        #[zbus(property, name = "version")]
        fn version(&self) -> zbus::Result<u32>;
    }

    #[proxy(
        interface = "org.freedesktop.portal.Flatpak.UpdateMonitor",
        default_service = "org.freedesktop.portal.Flatpak"
    )]
    trait UpdateMonitor {
        fn update(
            &self,
            parent_window: &str,
            options: HashMap<&str, Value<'_>>,
        ) -> zbus::Result<()>;

        fn close(&self) -> zbus::Result<()>;

        /// `running_commit` / `local_commit` / `remote_commit`, all optional.
        #[zbus(signal)]
        fn update_available(&self, info: HashMap<String, OwnedValue>) -> zbus::Result<()>;

        /// `n_ops` `op` `progress` `status` `error` `error_message`, all optional.
        #[zbus(signal)]
        fn progress(&self, info: HashMap<String, OwnedValue>) -> zbus::Result<()>;
    }

    /// `status` values the portal reports on `Progress`.
    const STATUS_DONE: u32 = 2;
    const STATUS_FAILED: u32 = 3;

    fn as_u32(info: &HashMap<String, OwnedValue>, key: &str) -> Option<u32> {
        info.get(key).and_then(|v| u32::try_from(v).ok())
    }

    fn as_string(info: &HashMap<String, OwnedValue>, key: &str) -> Option<String> {
        info.get(key).and_then(|v| String::try_from(v.clone()).ok())
    }

    /// Open a monitor bound to this app. The caller must `close()` it.
    async fn monitor(connection: &Connection) -> zbus::Result<UpdateMonitorProxy<'static>> {
        let portal = FlatpakPortalProxy::new(connection).await?;
        let path = portal.create_update_monitor(HashMap::new()).await?;
        UpdateMonitorProxy::builder(connection)
            .path(path)?
            .build()
            .await
    }

    /// The remote commit, if the portal announces one inside `ANNOUNCE_WAIT`.
    ///
    /// `Ok(None)` means nothing was announced — which is the ordinary answer when there
    /// is no update AND the ordinary answer when the portal simply has not polled yet.
    /// The two are not distinguishable through this interface, so they must not be
    /// displayed differently.
    pub async fn check() -> Result<Option<String>, String> {
        let connection = Connection::session().await.map_err(|e| e.to_string())?;
        let monitor = monitor(&connection).await.map_err(|e| e.to_string())?;

        // ⚠️ Subscribe BEFORE awaiting. The portal may announce as soon as the monitor
        // exists, and a stream opened after that point misses the signal entirely —
        // which presents as "never any updates", the least debuggable outcome here.
        let mut announcements = monitor
            .receive_update_available()
            .await
            .map_err(|e| e.to_string())?;

        let announced = tokio::time::timeout(ANNOUNCE_WAIT, announcements.next()).await;
        let _ = monitor.close().await;

        let Ok(Some(signal)) = announced else { return Ok(None) };
        let info = signal.args().map_err(|e| e.to_string())?.info;
        // Prefer the remote commit; it is the thing we would move to.
        Ok(as_string(&info, "remote_commit").or_else(|| as_string(&info, "local_commit")))
    }

    /// Whether the portal is present, and WHY NOT when it is not.
    ///
    /// ⚠️ This returned `Option<u32>` and swallowed every error, which cost an evening:
    /// the Updates page reported "Managed by Flatpak" — its no-portal state — on a box
    /// where `gdbus` reached the same portal and got version 8 back. A missing reason
    /// made an in-app failure indistinguishable from a missing portal.
    pub async fn portal_version() -> Result<u32, String> {
        let connection = Connection::session()
            .await
            .map_err(|e| format!("session bus: {e}"))?;
        let portal = FlatpakPortalProxy::new(&connection)
            .await
            .map_err(|e| format!("portal proxy: {e}"))?;
        portal.version().await.map_err(|e| format!("portal version: {e}"))
    }
}

#[cfg(not(target_os = "linux"))]
mod imp {
    pub async fn check() -> Result<Option<String>, String> {
        Err("the Flatpak portal exists only on Linux".into())
    }
    pub async fn portal_version() -> Result<u32, String> {
        Err("the Flatpak portal exists only on Linux".into())
    }
}

/// The version feed published beside the ostree repo on GitHub Pages.
///
/// ⚠️ Why this exists when the portal already reports updates: the portal's monitor is
/// a WATCHER on its own schedule, with no way to ask it to look now. That is fine for
/// installing and useless for "tell me within fifteen minutes that I am out of date".
/// A static file we control answers that question immediately and, unlike the portal,
/// can honestly confirm the NEGATIVE — comparing two version strings proves currency in
/// a way that a signal which never arrives cannot.
const VERSION_FEED: &str = "https://claygorman.github.io/bazzite-native-store/version.json";

/// The newest version the remote advertises.
///
/// ⚠️ In Rust rather than `fetch` in the webview, like every other request this app
/// makes — the backend dodges CORS and the webview's cache both (README §2).
///
/// ⚠️ `no-cache` and a short timeout. This runs on a fifteen-minute loop behind a
/// television; a cached answer would make the check report stale news indefinitely, and
/// a slow one must never pile up.
#[tauri::command]
pub async fn published_version() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;
    let body = client
        .get(VERSION_FEED)
        .header("cache-control", "no-cache")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&body).ok()?;
    parsed.get("version")?.as_str().map(str::to_owned)
}

/// Are we running inside a Flatpak sandbox?
///
/// ⚠️ THE one definition — `lib.rs`'s `is_flatpak` command delegates here. It briefly
/// had its own, testing `FLATPAK_ID` alone, and two answers to "are we sandboxed" is
/// how a UI ends up offering the updater on one screen and refusing it on the next.
///
/// Both signals, because they fail differently: `FLATPAK_ID` is set for the app's own
/// process but is not inherited reliably by everything it spawns, while
/// `/.flatpak-info` is part of the sandbox filesystem and is always present.
pub fn in_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some() || std::path::Path::new("/.flatpak-info").exists()
}

/// What this build can do about updating itself.
///
/// Returned as a small JSON object rather than a bool, because the three states need
/// three different sentences: not sandboxed (the updater plugin's problem), sandboxed
/// with no portal (nothing we can do), sandboxed with a portal (a real button).
#[tauri::command]
pub async fn flatpak_update_supported() -> Result<serde_json::Value, String> {
    let sandboxed = in_flatpak();
    if !sandboxed {
        return Ok(serde_json::json!({ "sandboxed": false, "portalVersion": null }));
    }
    // ⚠️ The reason travels with the answer. Reporting only "no portal" is what made
    // this look like an unsupported platform rather than a bug in the probe.
    match imp::portal_version().await {
        Ok(version) => Ok(serde_json::json!({ "sandboxed": true, "portalVersion": version })),
        Err(reason) => {
            Ok(serde_json::json!({ "sandboxed": true, "portalVersion": null, "portalError": reason }))
        }
    }
}

/// ⚠️ `Ok(None)` is "nothing announced", NOT "up to date". See `ANNOUNCE_WAIT`.
#[tauri::command]
pub async fn flatpak_update_check() -> Result<Option<String>, String> {
    if !in_flatpak() {
        return Err("not running inside a Flatpak".into());
    }
    imp::check().await
}



#[cfg(test)]
mod tests {
    use super::in_flatpak;

    /// The one thing testable without a session bus and a sandbox: the detection is a
    /// filesystem check, so it must answer false on a developer machine rather than
    /// panicking or guessing from an environment variable that may be inherited.
    #[test]
    fn a_developer_machine_is_not_a_flatpak() {
        assert!(!in_flatpak());
    }

    /// The commands must REFUSE off-sandbox rather than reaching for a session bus that
    /// is not there. Guards the case where the Updates page is opened in a dev build.
    #[tokio::test]
    async fn the_commands_refuse_outside_a_sandbox() {
        assert!(super::flatpak_update_check().await.is_err());
        // Reporting capability must still succeed — it is what the UI reads to decide
        // which sentence to show, so an error there blanks the page.
        let supported = super::flatpak_update_supported().await.expect("should report");
        assert_eq!(supported["sandboxed"], serde_json::Value::Bool(false));
    }
}
