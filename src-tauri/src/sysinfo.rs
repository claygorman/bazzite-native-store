//! What machine this is, read from the machine.
//!
//! Every settings page opens with a card answering "what is this box doing right
//! now", and the design fills those cards with plausible-looking constants
//! (`Radeon 780M`, `6.14.9-201.bazzite.fc42`, `12,806 reports cached`). On a
//! television the difference between a real number and a convincing one is invisible
//! until it is wrong, so nothing here is invented: every field is read, and anything
//! that cannot be read is `None` and simply does not render.
//!
//! ⚠️ Enhancement layer, like `display.rs` and `steamclient.rs`. Off Bazzite — and in
//! the browser build, which never calls this — the whole struct is empty and the
//! cards fall back to what the frontend can see for itself.
//!
//! No new dependencies. `sysinfo`-the-crate would pull a large tree into a Flatpak
//! sandbox to read four files that are already plain text.

use std::path::{Path, PathBuf};

#[derive(Default, serde::Serialize)]
pub struct HostInfo {
    /// `PRETTY_NAME` from os-release, e.g. "Bazzite 44 (FROM Fedora Linux 44)".
    pub os: Option<String>,
    /// `VERSION_ID`, which is the ostree image version on an atomic desktop.
    pub image: Option<String>,
    /// `uname -r`.
    pub kernel: Option<String>,
    pub cpu: Option<String>,
    /// The rendering GPU, as the kernel names it.
    pub gpu: Option<String>,
    pub memory_gb: Option<u64>,
}

fn read(path: &str) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// One `KEY=value` line out of an os-release style file, unquoted.
fn os_release_field(body: &str, key: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
        .map(|v| v.trim().trim_matches('"').to_string())
        .filter(|v| !v.is_empty())
}

/// `/proc/cpuinfo`'s first `model name`. Every core repeats it; one is enough.
fn cpu_model(body: &str) -> Option<String> {
    body.lines()
        .find(|l| l.starts_with("model name"))
        .and_then(|l| l.split_once(':'))
        .map(|(_, v)| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// `MemTotal` is in kB. Rounded to whole GB because the card has room for "32 GB"
/// and nobody at ten feet wants 31.27.
fn memory_gb(body: &str) -> Option<u64> {
    let kb: u64 = body
        .lines()
        .find(|l| l.starts_with("MemTotal:"))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()?;
    Some((kb as f64 / 1024.0 / 1024.0).round() as u64)
}

/// The GPU, from DRM sysfs.
///
/// ⚠️ Deliberately not `lspci` or `glxinfo`: neither is guaranteed inside a Flatpak
/// sandbox, and shelling out to a missing binary is a failure mode this does not need.
/// `/sys/class/drm/card*/device/` is always there when a card is, and its
/// `product`/`model` files carry a human name on the AMD driver. Where they do not,
/// the PCI id is still more useful on a bug report than nothing.
fn gpu_name() -> Option<String> {
    let mut cards: Vec<PathBuf> = std::fs::read_dir("/sys/class/drm")
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                // `card0`, not `card0-HDMI-A-1` — the connectors are siblings.
                .is_some_and(|n| n.starts_with("card") && !n.contains('-'))
        })
        .collect();
    cards.sort();

    for card in cards {
        let device = card.join("device");
        for field in ["product", "model", "label"] {
            if let Some(name) = read_trimmed(&device.join(field)) {
                return Some(name);
            }
        }
        if let Some(id) = read_trimmed(&device.join("device")) {
            let vendor = read_trimmed(&device.join("vendor")).unwrap_or_default();
            return Some(format!("PCI {vendor}:{id}"));
        }
    }
    None
}

fn read_trimmed(path: &Path) -> Option<String> {
    let value = std::fs::read_to_string(path).ok()?.trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[tauri::command]
pub fn host_info() -> HostInfo {
    let os_release = read("/etc/os-release").unwrap_or_default();
    HostInfo {
        os: os_release_field(&os_release, "PRETTY_NAME"),
        image: os_release_field(&os_release, "VERSION_ID"),
        kernel: read("/proc/sys/kernel/osrelease").map(|v| v.trim().to_string()),
        cpu: cpu_model(&read("/proc/cpuinfo").unwrap_or_default()),
        gpu: gpu_name(),
        memory_gb: memory_gb(&read("/proc/meminfo").unwrap_or_default()),
    }
}

#[cfg(test)]
mod tests {
    use super::{cpu_model, host_info, memory_gb, os_release_field};

    #[test]
    fn reads_os_release_fields_and_strips_quotes() {
        let body = "NAME=\"Bazzite\"\nVERSION_ID=\"44.20260820\"\nPRETTY_NAME=\"Bazzite 44\"\n";
        assert_eq!(os_release_field(body, "PRETTY_NAME").as_deref(), Some("Bazzite 44"));
        assert_eq!(os_release_field(body, "VERSION_ID").as_deref(), Some("44.20260820"));
    }

    /// ⚠️ `VERSION` and `VERSION_ID` are different keys and both exist. A prefix match
    /// that forgot the `=` would return whichever came first in the file.
    #[test]
    fn does_not_confuse_version_with_version_id() {
        let body = "VERSION=\"44 (Bazzite)\"\nVERSION_ID=\"44.20260820\"\n";
        assert_eq!(os_release_field(body, "VERSION_ID").as_deref(), Some("44.20260820"));
        assert_eq!(os_release_field(body, "VERSION").as_deref(), Some("44 (Bazzite)"));
    }

    #[test]
    fn a_missing_key_is_none_not_an_empty_string() {
        assert!(os_release_field("NAME=\"x\"\n", "PRETTY_NAME").is_none());
        assert!(os_release_field("PRETTY_NAME=\"\"\n", "PRETTY_NAME").is_none());
    }

    #[test]
    fn takes_the_first_cpu_model_and_rounds_memory() {
        let cpuinfo = "processor\t: 0\nmodel name\t: AMD Ryzen 7 8840U\nprocessor\t: 1\nmodel name\t: AMD Ryzen 7 8840U\n";
        assert_eq!(cpu_model(cpuinfo).as_deref(), Some("AMD Ryzen 7 8840U"));
        assert_eq!(memory_gb("MemTotal:       32784120 kB\n"), Some(31));
    }

    /// The contract every caller depends on: unreadable is `None`, never a panic.
    /// On macOS none of these paths exist, which is exactly the test.
    #[test]
    fn absent_files_degrade_to_none() {
        let info = host_info();
        if cfg!(not(target_os = "linux")) {
            assert!(info.cpu.is_none() && info.kernel.is_none() && info.memory_gb.is_none());
        }
    }
}
