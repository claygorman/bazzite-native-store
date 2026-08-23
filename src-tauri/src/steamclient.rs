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

/// The origin every allowlisted read is aimed at.
const STORE_ORIGIN: &str = "https://store.steampowered.com";

/// Steam's own UI origin — where the `SharedJSContext` target lives.
///
/// ⭐ **This is the target that is actually signed in, and it is not the obvious one.**
/// Measured against a logged-in client on Bazzite 44, 2026-08-23, same account, same
/// second, calling `/dynamicstore/userdata/` from each:
///
/// | target                              | rgOwnedApps | rgWishlist |
/// |-------------------------------------|-------------|------------|
/// | a `store.steampowered.com` page      | 0           | 0          |
/// | `SharedJSContext` (this origin)      | 71          | 27         |
///
/// Big Picture's store tab is **not** a `store.steampowered.com` CEF page. It is a
/// SteamUI view whose CEF url is `about:blank`, rendered from this shared context — so
/// selecting by store origin finds nothing at all while Steam is running normally.
/// Opening a real store page (`steam://store/`) does create such a target, and it is
/// **anonymous**: it carries a `steamLoginSecure` cookie the server rejects and answers
/// 200 with empty arrays, which is indistinguishable from an account that owns nothing.
/// An earlier version of this file preferred that target and could never have worked.
///
/// ⚠️ Reads from here MUST use an absolute url — see `build_url`.
const LOOPBACK_ORIGIN: &str = "https://steamloopback.host";

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

/// The one property read this module performs, verbatim.
///
/// ⚠️ The allowlist above exists because `fetch` inside a signed-in browser can reach
/// anything that session can reach. That argument does not apply here, because this
/// takes **no caller input at all** — it is a constant. There is nothing to point
/// somewhere else, which is a stronger guarantee than validating a parameter.
///
/// ⚠️ Returns `""` rather than throwing when `App` is absent or has no user yet. A
/// thrown exception comes back as a CDP error object with no string value, which is
/// indistinguishable from a transport failure; an empty string is unambiguous.
const IDENTITY_EXPRESSION: &str = r#"(() => {
  try {
    const u = App.m_CurrentUser;
    if (!u || !u.strSteamID) return "";
    return JSON.stringify({ steamid: u.strSteamID, offline: !!u.bIsOfflineMode });
  } catch (e) {
    return "";
  }
})()"#;

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

/// Who the running Steam client is signed in as, if we can tell.
///
/// ⭐ The point of the whole module in one call: on a box where Steam is already logged
/// in, the store should know who you are without a second sign-in. `auth.rs` remains the
/// route for everywhere else — a desktop without Steam running, or a client whose
/// debugger is closed.
///
/// ⚠️ Enhancement layer, like everything else here. `None` off Bazzite, without Steam
/// running, without the debugging marker, if something else owns the port, on timeout,
/// or while the client is between users. Nothing may depend on it.
#[tauri::command]
pub async fn steam_client_identity() -> Option<String> {
    client_identity().await.ok().filter(|body| !body.is_empty())
}

async fn session_get(
    path: &str,
    query: &HashMap<String, String>,
) -> Result<String, Box<dyn std::error::Error>> {
    let targets = steam_targets().await?;
    let expression = format!(
        "fetch({}, {{ credentials: 'include' }}).then(r => r.text())",
        serde_json::to_string(&build_url(path, query))?
    );

    // ⚠️ Try every candidate origin, do not just pick the best one.
    //
    // Steam's CORS allowlist is PER ENDPOINT, which is not something you would guess.
    // Measured 2026-08-23 from `SharedJSContext`:
    //
    // | endpoint                  | from steamloopback.host        |
    // |---------------------------|--------------------------------|
    // | `/dynamicstore/userdata/` | 200, 3.2 KB, real account data |
    // | `/personalcalendardata`   | `TypeError: Failed to fetch`   |
    //
    // Steam's own UI reads userdata, so that one is allowed; the calendar is not. A
    // blocked fetch rejects rather than returning a status, so the only way to know is
    // to try — and a store-origin target, when one happens to be attached, has no CORS
    // problem at all. Shared context first because when both exist it is the signed-in
    // one; the store page is a fallback that is usually anonymous but never worse than
    // nothing.
    let mut last: Option<String> = None;
    for origin in [LOOPBACK_ORIGIN, STORE_ORIGIN] {
        let Some(socket_url) = ws_url(&targets, &[origin]) else { continue };
        match evaluate(&socket_url, &expression).await {
            Ok(body) => return Ok(body),
            // ⚠️ The MESSAGE, not the error. `Box<dyn Error>` is not `Send`, and holding
            // one across the next loop iteration's await makes this future non-`Send`,
            // which `tauri::generate_handler` rejects with an error pointing at the macro
            // rather than at this line.
            Err(e) => last = Some(e.to_string()),
        }
    }
    Err(last.unwrap_or_else(|| "no signed-in Steam target attached".into()).into())
}

/// Who the Steam client is logged in as.
///
/// ⭐ This is the piece that makes the app know you without asking you to sign in again.
/// `auth.rs` can obtain a SteamID64 by OpenID, but that is a browser round-trip for
/// something the client running three feet away already knows.
///
/// ⚠️ Only `SharedJSContext` has `App` — a store page does not — so there is no fallback
/// origin here. `None` rather than a guess when it is missing.
///
/// Returns `{"steamid": "...", "offline": bool}`, or `None`. Deliberately just the id:
/// persona name and avatar already come from `profile.ts`, and an account name read out
/// of the client would be a second source of the same truth with worse provenance.
async fn client_identity() -> Result<String, Box<dyn std::error::Error>> {
    let targets = steam_targets().await?;
    let socket_url =
        ws_url(&targets, &[LOOPBACK_ORIGIN]).ok_or("no shared js context attached")?;
    evaluate(&socket_url, IDENTITY_EXPRESSION).await
}

/// Confirm the debugger really is Steam, then list its targets.
///
/// ⚠️ Port 8080 is a common one, so the identity of whatever answers is checked before a
/// single byte of its response is believed.
async fn steam_targets() -> Result<Value, Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder().timeout(TIMEOUT).build()?;
    let base = debugger();

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

    Ok(serde_json::from_str(
        &client.get(format!("{base}/json/list")).send().await?.text().await?,
    )?)
}

/// The first attached target whose url starts with one of `origins`, in that order.
fn ws_url(targets: &Value, origins: &[&str]) -> Option<String> {
    let list = targets.as_array()?;
    origins.iter().find_map(|origin| {
        list.iter()
            .find(|t| {
                t.get("url").and_then(Value::as_str).is_some_and(|u| u.starts_with(origin))
            })
            .and_then(|t| t.get("webSocketDebuggerUrl"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    })
}

/// Run one expression in a target and return its string result.
async fn evaluate(
    socket_url: &str,
    expression: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let (mut socket, _) = tokio::time::timeout(
        TIMEOUT,
        tokio_tungstenite::connect_async(socket_url.to_owned()),
    )
    .await??;

    // `awaitPromise` is what makes `fetch` usable here — without it the evaluation
    // returns the pending Promise itself. `returnByValue` serialises the string rather
    // than handing back a remote object handle. Both are harmless for a plain expression.
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
        if let Some(body) = message.pointer("/result/result/value").and_then(Value::as_str) {
            return Ok(body.to_owned());
        }
        // ⚠️ A rejected `fetch` and a dead socket both used to arrive here as "no string
        // body", which sent a real diagnosis (Steam blocks this origin for this endpoint)
        // looking for a transport bug. The exception text is the answer, so say it.
        let reason = message
            .pointer("/result/exceptionDetails/exception/description")
            .or_else(|| message.pointer("/result/exceptionDetails/text"))
            .and_then(Value::as_str)
            .unwrap_or("no string body in evaluate result");
        return Err(reason.into());
    }
}

/// ⚠️ **Absolute, and it has to be.** The signed-in target is on `steamloopback.host`, so
/// a relative fetch resolves against Steam's own UI origin and 404s. Steam serves the
/// store's CORS headers to that origin — this is how its own UI calls these endpoints —
/// so a cross-origin `credentials: 'include'` fetch from there carries the session cookie.
fn build_url(path: &str, query: &HashMap<String, String>) -> String {
    if query.is_empty() {
        return format!("{STORE_ORIGIN}{path}");
    }
    // Sorted so the string is stable: the browser cache keys on it.
    let mut pairs: Vec<_> = query.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    let encoded = pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{STORE_ORIGIN}{path}?{encoded}")
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
    use super::{
        build_url, client_identity, session_get, steam_client_identity, steam_session_get,
        ws_url, LOOPBACK_ORIGIN, STORE_ORIGIN,
    };
    use std::collections::HashMap;

    fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// ⚠️ Absolute. A relative url resolves against `steamloopback.host` — the origin of
    /// the only target that is signed in — and 404s. This assertion is the guard on the
    /// single change that made the feature work at all.
    #[test]
    fn builds_an_absolute_store_url_with_sorted_query() {
        assert_eq!(
            build_url("/personalcalendardata", &HashMap::new()),
            "https://store.steampowered.com/personalcalendardata"
        );
        assert_eq!(
            build_url("/personalcalendardata", &query(&[("tag", "0"), ("days_forward", "8")])),
            "https://store.steampowered.com/personalcalendardata?days_forward=8&tag=0"
        );
    }

    #[test]
    fn encodes_values_that_would_otherwise_break_the_query() {
        assert_eq!(
            build_url("/x", &query(&[("q", "a b&c=d")])),
            "https://store.steampowered.com/x?q=a%20b%26c%3Dd"
        );
    }

    /// The ordering property, which is the whole bug: when a client has both an
    /// anonymous store page and the signed-in shared context attached, the shared
    /// context must win. Preferring the store page is what made this silently return
    /// "you own nothing" on a fully logged-in machine.
    #[test]
    fn the_shared_context_outranks_a_store_page() {
        let targets = serde_json::json!([
            { "url": "https://store.steampowered.com/", "webSocketDebuggerUrl": "ws://store" },
            { "url": "https://steamloopback.host/routes/steamweb", "webSocketDebuggerUrl": "ws://shared" },
        ]);
        assert_eq!(
            ws_url(&targets, &[LOOPBACK_ORIGIN, STORE_ORIGIN]).as_deref(),
            Some("ws://shared")
        );
        // ...and the store page is still usable when it is all there is.
        let only_store = serde_json::json!([
            { "url": "https://store.steampowered.com/", "webSocketDebuggerUrl": "ws://store" },
        ]);
        assert_eq!(
            ws_url(&only_store, &[LOOPBACK_ORIGIN, STORE_ORIGIN]).as_deref(),
            Some("ws://store")
        );
        // Identity has no fallback: only the shared context defines `App`.
        assert_eq!(ws_url(&only_store, &[LOOPBACK_ORIGIN]), None);
    }

    /// `about:blank` popups and notification toasts are attached at all times and would
    /// answer an evaluation perfectly happily — with anonymous data.
    #[test]
    fn unrelated_targets_are_never_selected() {
        let targets = serde_json::json!([
            { "url": "about:blank", "webSocketDebuggerUrl": "ws://toast" },
            { "url": "devtools://devtools/bundled/x.html", "webSocketDebuggerUrl": "ws://devtools" },
        ]);
        assert_eq!(ws_url(&targets, &[LOOPBACK_ORIGIN, STORE_ORIGIN]), None);
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
        assert!(steam_client_identity().await.is_none());
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

    /// The regression this module was rewritten for. A borrowed session that is not
    /// actually signed in answers 200 with empty arrays, so "it returned JSON" proves
    /// nothing — only a non-empty owned list does.
    ///
    /// ⚠️ Prints COUNTS, never ids. This repo is public and the output of an `--ignored`
    /// test run ends up pasted into issues.
    #[tokio::test]
    #[ignore = "needs a running Steam client with its CEF debugger open"]
    async fn live_session_is_signed_in_and_knows_who_it_is() {
        let userdata = session_get("/dynamicstore/userdata/", &HashMap::new())
            .await
            .expect("userdata read failed");
        let owned = userdata.matches("\"rgOwnedApps\"").count();
        assert_eq!(owned, 1, "not the userdata shape");
        assert!(
            !userdata.contains("\"rgOwnedApps\":[]"),
            "owned list is EMPTY — the borrowed session is anonymous, which is exactly \
             the bug this test exists to catch"
        );

        let identity = client_identity().await.expect("identity read failed");
        assert!(!identity.is_empty(), "client reports no signed-in user");
        let parsed: serde_json::Value = serde_json::from_str(&identity).unwrap();
        let steamid = parsed["steamid"].as_str().unwrap_or_default();
        assert_eq!(steamid.len(), 17, "not a SteamID64");
        println!("signed in: yes · steamid: {} digits · offline: {}", steamid.len(), parsed["offline"]);
    }
}
