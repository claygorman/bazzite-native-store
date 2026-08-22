use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// Steam's CEF debugger. Enabled by `~/.steam/steam/.cef-enable-remote-debugging`,
/// which is present on Bazzite because Decky Loader requires it.
///
/// Overridable by `STEAM_CEF_DEBUGGER` so this can be pointed at another machine's
/// client through an SSH tunnel. Not a convenience — the target box is an immutable
/// ostree with no Rust toolchain and no webkit headers, so tunnelling is the only way
/// to exercise this against a real, logged-in Steam without building there. Unset in
/// every normal run.
fn debugger() -> String {
    std::env::var("STEAM_CEF_DEBUGGER").unwrap_or_else(|_| "http://127.0.0.1:8080".into())
}

/// ⚠️ Port 8080 is a common one. Something else being there is the normal case on a
/// developer machine, not an edge case, so the identity of whatever answers is checked
/// before a single byte of its response is believed.
const STEAM_UA_MARKER: &str = "Valve Steam Client";

/// Every step is bounded. A hung socket must never leave the UI waiting.
const TIMEOUT: Duration = Duration::from_secs(8);

/// ⚠️ **The safety mechanism, and the reason this is a list rather than a free path.**
///
/// Evaluating a `fetch` inside Steam's logged-in browser can reach anything that
/// session can reach — including cart and wishlist MUTATIONS. This project never
/// reimplements those (README §3), and "we promise not to" is a weaker guarantee than
/// "it cannot". So the primitive takes a path from an allowlist and nothing else.
///
/// Every entry must be a **read**. Adding one is a deliberate act: check the endpoint
/// has no side effects, and record it in private/STEAM-ENDPOINTS.md.
const ALLOWED_PATHS: &[&str] = &[
    // owned + wishlist + cart count, one call
    "/dynamicstore/userdata/",
    // ~300 upcoming releases with per-item bIsOwned / bIsWishlisted / eReviewScore
    "/personalcalendardata",
];

/// One read, performed inside the Steam client's own logged-in browser.
///
/// ⭐ Why this exists: it needs **no Web API key and no public-profile requirement**.
/// The key route needs both, and a private profile answers 200 with an empty list — so
/// "owns nothing" and "profile is private" are indistinguishable, which is a bad thing
/// to render on a television.
///
/// Steam ships its own browser, already signed in, and on Bazzite its debugger is open.
/// A `fetch` evaluated in the store target runs on the `store.steampowered.com` origin
/// **with the session cookie already attached**.
///
/// **We never handle a credential.** We borrow a session the user established in a
/// client they already trust — the browser-extension pattern, for the desktop. See
/// private/AUTH-AND-CART.md, which draws exactly this distinction.
///
/// ⚠️ Returns the **raw body**, unparsed. The Rust side is a fetcher and deliberately
/// does not know Steam's shapes — normalization happens exactly once, in TypeScript.
/// One parser, not two.
///
/// ⚠️ Enhancement layer. `None` off Bazzite, without Steam running, without the
/// debugging marker, if something else owns the port, on timeout, or for a path that is
/// not on the allowlist. Nothing may depend on it.
#[tauri::command]
pub async fn steam_session_get(path: String, query: HashMap<String, String>) -> Option<String> {
    if !ALLOWED_PATHS.contains(&path.as_str()) {
        return None;
    }
    // Deliberately silent on failure. On a dev machine it fails constantly and by
    // design, and a log line per launch trains people to ignore the log.
    session_get(&path, &query).await.ok()
}

async fn session_get(
    path: &str,
    query: &HashMap<String, String>,
) -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder().timeout(TIMEOUT).build()?;
    let base = debugger();

    // 1. Is this actually Steam?
    //
    // ⚠️ `.text()` + `serde_json`, not `.json()`. reqwest is configured
    // `default-features = false` so one fewer system library has to be satisfied inside
    // the Flatpak sandbox (README §4), which leaves its `json` feature off.
    let version: Value = serde_json::from_str(
        &client.get(format!("{base}/json/version")).send().await?.text().await?,
    )?;
    if !version
        .get("User-Agent")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .contains(STEAM_UA_MARKER)
    {
        return Err("that debugger is not the Steam client".into());
    }

    // 2. Find the store tab.
    //
    // ⚠️ Selected by ORIGIN, not by title. Steam also exposes a `SharedJSContext` on
    // `steamloopback.host` and several `about:blank` popups; a relative fetch in any of
    // those carries no store cookies and quietly returns anonymous data — which for
    // this family of endpoints means HTTP 200 with empty arrays rather than an error.
    let targets: Value = serde_json::from_str(
        &client.get(format!("{base}/json/list")).send().await?.text().await?,
    )?;
    let socket_url = targets
        .as_array()
        .and_then(|list| {
            list.iter().find(|t| {
                t.get("url")
                    .and_then(Value::as_str)
                    .is_some_and(|u| u.starts_with("https://store.steampowered.com"))
            })
        })
        .and_then(|t| t.get("webSocketDebuggerUrl"))
        .and_then(Value::as_str)
        .ok_or("no store target attached")?
        .to_owned();

    // 3. Evaluate the read there.
    let (mut socket, _) =
        tokio::time::timeout(TIMEOUT, tokio_tungstenite::connect_async(socket_url)).await??;

    // `awaitPromise` is what makes `fetch` usable here — without it the evaluation
    // returns the pending Promise itself. `returnByValue` serialises the string rather
    // than handing back a remote object handle.
    let expression = format!(
        "fetch({}, {{ credentials: 'include' }}).then(r => r.text())",
        serde_json::to_string(&build_url(path, query))?
    );
    let request = serde_json::json!({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": { "expression": expression, "awaitPromise": true, "returnByValue": true }
    });
    socket.send(Message::Text(request.to_string().into())).await?;

    // CDP interleaves unsolicited events with replies, so read until our id comes back
    // rather than trusting the first frame.
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    loop {
        let frame = tokio::time::timeout_at(deadline, socket.next())
            .await?
            .ok_or("socket closed")??;
        let Message::Text(text) = frame else { continue };
        let message: Value = serde_json::from_str(&text)?;
        if message.get("id").and_then(Value::as_u64) != Some(1) {
            continue;
        }
        return message
            .pointer("/result/result/value")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "no string body in evaluate result".into());
    }
}

/// ⚠️ Relative, so the fetch inherits the store origin — and its cookies. An absolute
/// URL would work only by accident of being the same origin; a relative one cannot
/// drift off it.
fn build_url(path: &str, query: &HashMap<String, String>) -> String {
    if query.is_empty() {
        return path.to_owned();
    }
    // Sorted so the string is stable: the browser cache keys on it.
    let mut pairs: Vec<_> = query.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    let encoded = pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{path}?{encoded}")
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{build_url, session_get, steam_session_get};
    use std::collections::HashMap;

    fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn builds_a_relative_url_with_sorted_query() {
        assert_eq!(build_url("/personalcalendardata", &HashMap::new()), "/personalcalendardata");
        assert_eq!(
            build_url("/personalcalendardata", &query(&[("tag", "0"), ("days_forward", "8")])),
            "/personalcalendardata?days_forward=8&tag=0"
        );
    }

    #[test]
    fn encodes_values_that_would_otherwise_break_the_query() {
        assert_eq!(build_url("/x", &query(&[("q", "a b&c=d")])), "/x?q=a%20b%26c%3Dd");
    }

    /// The safety property: a path off the allowlist never reaches the network, whatever
    /// else is true. Guards the cart and wishlist mutation endpoints this session could
    /// otherwise reach.
    #[tokio::test]
    async fn a_path_off_the_allowlist_is_refused_outright() {
        for path in ["/cart/addtocart", "/api/addtowishlist", "/dynamicstore/userdata/../evil"] {
            assert!(steam_session_get(path.into(), HashMap::new()).await.is_none());
        }
    }

    /// The contract the feature rests on: every failure is `None`, never a panic. Points
    /// at a closed port — what a dev machine and any box without Decky's marker look like.
    #[tokio::test]
    async fn an_unreachable_debugger_is_none_not_an_error() {
        // SAFETY: single-threaded test, read once by the call below.
        unsafe { std::env::set_var("STEAM_CEF_DEBUGGER", "http://127.0.0.1:9") }
        assert!(steam_session_get("/dynamicstore/userdata/".into(), HashMap::new())
            .await
            .is_none());
        unsafe { std::env::remove_var("STEAM_CEF_DEBUGGER") }
    }

    /// Against a REAL Steam client. Ignored by default because it needs one.
    ///
    /// ```sh
    /// ssh -N -L 8081:127.0.0.1:8080 <user>@<box-1> &
    /// STEAM_CEF_DEBUGGER=http://127.0.0.1:8081 \
    ///   cargo test --lib live_session -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "needs a running Steam client with its CEF debugger open"]
    async fn live_session_reads_userdata_and_calendar() {
        let userdata = session_get("/dynamicstore/userdata/", &HashMap::new())
            .await
            .expect("userdata read failed");
        assert!(userdata.contains("rgOwnedApps"), "not the userdata shape");

        let calendar = session_get(
            "/personalcalendardata",
            &query(&[("tag", "0"), ("days_backward", "3"), ("days_forward", "8")]),
        )
        .await
        .expect("calendar read failed");
        // The only honest signal this endpoint gives — it answers 200 either way.
        assert!(calendar.contains("\"success\""), "no session: {calendar:.160}");
        println!("userdata {} bytes · calendar {} bytes", userdata.len(), calendar.len());
    }
}
