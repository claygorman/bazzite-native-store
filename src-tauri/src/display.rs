use std::path::PathBuf;

/// What Steam's display settings currently say.
#[derive(serde::Serialize)]
pub struct SteamUiScale {
    /// The scale actually in effect — the user's manual choice, or Steam's automatic one.
    pub scale: f64,
    /// What Steam WOULD choose automatically, for comparison.
    pub auto: Option<f64>,
    /// False when the user has turned "Automatically Scale User Interface" off and
    /// picked their own. Their choice wins either way; this only says which it is.
    pub automatic: bool,
    /// Bounds Steam's own slider enforces, so we never apply something it would refuse.
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// Steam's chosen UI scale for the display we are running on.
///
/// Game Mode's Display settings has "Automatically Scale User Interface", and it is not
/// cosmetic — Steam derives it from the panel's PHYSICAL SIZE (from EDID) and resolution,
/// then applies it to its own Big Picture UI as a device scale factor. On clay's box that
/// is 2.5596 for an 84-inch 4K panel, verified two ways: the value below, and Steam's own
/// CEF reporting `devicePixelRatio: 2.56` against a 1500x843 CSS viewport (1500 * 2.5596
/// = 3840).
///
/// ⚠️ It does NOT reach us automatically. Steam applies it to its own windows; gamescope
/// advertises nothing equivalent to other Wayland clients, so a third-party app is handed
/// the raw surface. If we want to honour the user's choice we have to read it.
///
/// Which we can: it is a plain local file. Verified 2026-08-21 at
/// `~/.local/share/Steam/config/config.vdf`:
///
/// ```text
/// "UI" { "display" { "Current" {
///     "MinScaleFactor"   "1.42302489280700684"
///     "MaxScaleFactor"   "6.81943845748901367"
///     "IsExternalDisplay" "1"
///     "name"             "External: gamescope 84\"|||Windowed"
///     "AutoScaleFactor"  "2.55962085723876953"
///     "ScaleFactor"      "2.55962085723876953"
/// } } }
/// ```
///
/// Returns `None` off Bazzite, or whenever the file or key is absent — this is an
/// enhancement layer and nothing may depend on it (private/AUTH-AND-CART.md).
#[tauri::command]
pub fn steam_ui_scale() -> Option<SteamUiScale> {
    let text = std::fs::read_to_string(config_path()?).ok()?;

    // Scope to the current display's block. Steam keeps other display entries in the
    // same file, and their scale factors are not the one in effect.
    let current = text.find("\"Current\"")?;
    let window = &text[current..];

    let auto = value_after(window, "\"AutoScaleFactor\"");
    // ⚠️ `ScaleFactor` is the one that matters: when the user turns automatic scaling
    // OFF and picks their own, this is where their choice lands while `AutoScaleFactor`
    // keeps reporting what Steam would have picked. Reading auto first would silently
    // ignore a deliberate manual setting.
    let scale = value_after(window, "\"ScaleFactor\"").or(auto)?;

    Some(SteamUiScale {
        scale,
        auto,
        // Steam keeps both keys in sync while automatic is on, so a divergence is the
        // signal that the user has taken over.
        automatic: auto.map(|a| (a - scale).abs() < 0.001).unwrap_or(false),
        min: value_after(window, "\"MinScaleFactor\""),
        max: value_after(window, "\"MaxScaleFactor\""),
    })
}

fn config_path() -> Option<PathBuf> {
    // dirs-next would be a dependency for one path; $HOME is enough on this platform.
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".local/share/Steam/config/config.vdf"))
}

/// Pull the quoted value following a quoted VDF key.
///
/// Deliberately not a full VDF parser — one key, one file, and a parser is a liability
/// for a value we must already treat as optional. Matching the key WITH its quotes is
/// what keeps `"ScaleFactor"` from also matching inside `"AutoScaleFactor"`,
/// `"MinScaleFactor"` and `"MaxScaleFactor"`.
fn value_after(text: &str, key: &str) -> Option<f64> {
    let start = text.find(key)? + key.len();
    let rest = &text[start..];
    let open = rest.find('"')? + 1;
    let close = rest[open..].find('"')? + open;
    rest[open..close].trim().parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::value_after;

    const SAMPLE: &str = r#"
        "Current"
        {
            "MinScaleFactor"    "1.42302489280700684"
            "MaxScaleFactor"    "6.81943845748901367"
            "AutoScaleFactor"   "2.55962085723876953"
            "ScaleFactor"       "3.0"
        }
    "#;

    #[test]
    fn reads_the_exact_key_not_a_suffix_match() {
        // The whole point: "ScaleFactor" must not match inside "MinScaleFactor".
        assert_eq!(value_after(SAMPLE, "\"ScaleFactor\""), Some(3.0));
        assert_eq!(value_after(SAMPLE, "\"MinScaleFactor\""), Some(1.42302489280700684));
        assert_eq!(value_after(SAMPLE, "\"AutoScaleFactor\""), Some(2.55962085723876953));
    }

    #[test]
    fn missing_key_is_none_not_a_panic() {
        assert_eq!(value_after(SAMPLE, "\"NotAKey\""), None);
    }
}
