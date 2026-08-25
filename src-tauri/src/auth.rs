//! Steam OpenID 2.0 sign-in for the Tauri build.
//!
//! Steam runs an OpenID 2.0 provider — the only account integration Valve actually
//! sanctions. The user authenticates on Steam's own page and **we never see a
//! password**.
//!
//! ⚠️ What this gets you is a SteamID64 and nothing else. It is *authentication*,
//! not *authorization*: it proves who someone is and grants no ability to act on
//! their behalf. SteamDB's own site is the proof — signed in with this same flow,
//! its Wishlist button is still disabled, because wishlisting needs an authenticated
//! web session their extension borrows from the browser. We do the desktop
//! equivalent by handing off to the already-signed-in Steam client via `steam://`.
//! See private/AUTH-AND-CART.md.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const OPENID_ENDPOINT: &str = "https://steamcommunity.com/openid/login";
const OPENID_NS: &str = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT: &str = "http://specs.openid.net/auth/2.0/identifier_select";

#[derive(Serialize, Deserialize, Default)]
pub struct Session {
    pub steamid: Option<String>,
}

fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

pub fn read_session(app: &tauri::AppHandle) -> Session {
    session_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_session(app: &tauri::AppHandle, session: &Session) -> Result<(), String> {
    let path = session_path(app)?;
    let body = serde_json::to_string(session).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| e.to_string())
}

/// Steam only ever returns this shape; anything else is not a Steam identity.
fn steamid_from_claimed_id(claimed_id: &str) -> Option<String> {
    let rest = claimed_id.strip_prefix("https://steamcommunity.com/openid/id/")?;
    (rest.len() == 17 && rest.chars().all(|c| c.is_ascii_digit())).then(|| rest.to_string())
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(&input[i + 1..i + 3], 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Block until Steam redirects the browser back to us, and return the query pairs.
///
/// The listener binds port 0 so the OS picks a free port — a fixed port collides
/// with whatever else the user is running and fails at the worst moment.
fn await_redirect(listener: TcpListener) -> Result<Vec<(String, String)>, String> {
    /*
     * ⚠️ **Bounded.** `accept()` blocks forever by default, and a sign-in is abandoned all
     * the time — the user closes the tab, cannot remember the password, gets a Steam Guard
     * prompt on a phone that is upstairs. Without a deadline that leaves a blocked thread
     * and an unresolved promise for the life of the process, and the UI can never say the
     * attempt is over because nothing ever tells it.
     *
     * Five minutes is generous on purpose: it has to cover reading an email, finding an
     * authenticator, and a slow typist. It is a leak stopper, not a UX timer.
     */
    const GIVE_UP: std::time::Duration = std::time::Duration::from_secs(300);
    const PAUSE: std::time::Duration = std::time::Duration::from_millis(120);

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + GIVE_UP;
    let stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            // Nothing yet. Not an error — the browser is still with the user.
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err("Timed out waiting for Steam to send you back.".into());
                }
                std::thread::sleep(PAUSE);
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    // ⚠️ Back to blocking for the READ. The socket inherits the listener's non-blocking
    // mode on some platforms, and a non-blocking `read_line` returns WouldBlock instead of
    // waiting for the request line — which would fail every sign-in that got this far.
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|e| e.to_string())?;

    // "GET /?openid.ns=... HTTP/1.1"
    let target = request_line.split_whitespace().nth(1).unwrap_or("/");
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");

    let pairs = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (percent_decode(k), percent_decode(v)))
        .collect();

    let body = "<!doctype html><meta charset=utf-8><title>Signed in</title>\
        <body style=\"background:#080d16;color:#f4f7f9;font:600 18px system-ui;\
        display:grid;place-items:center;height:100vh;margin:0\">\
        <p>Signed in to Steam. You can close this tab and return to the store.</p>";
    let mut stream = stream;
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.flush();

    Ok(pairs)
}

/// Verify the assertion with Steam before believing any of it.
///
/// ⚠️ NOT optional. Without this step a caller can simply assert any SteamID it
/// likes and we would accept it. Confirmed against the live endpoint: replaying an
/// assertion with a forged signature answers `is_valid:false`.
async fn verify(pairs: &[(String, String)]) -> Result<bool, String> {
    let mut form: Vec<(String, String)> = pairs
        .iter()
        .filter(|(k, _)| k.starts_with("openid."))
        .cloned()
        .collect();

    for entry in form.iter_mut() {
        if entry.0 == "openid.mode" {
            entry.1 = "check_authentication".to_string();
        }
    }

    let client = reqwest::Client::new();
    let body = client
        .post(OPENID_ENDPOINT)
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    Ok(body.lines().any(|line| line.trim() == "is_valid:true"))
}

#[tauri::command]
pub async fn steam_login(app: tauri::AppHandle) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let return_to = format!("http://127.0.0.1:{port}/");

    let query = serde_urlencoded::to_string([
        ("openid.ns", OPENID_NS),
        ("openid.mode", "checkid_setup"),
        ("openid.return_to", &return_to),
        ("openid.realm", &return_to),
        ("openid.identity", IDENTIFIER_SELECT),
        ("openid.claimed_id", IDENTIFIER_SELECT),
    ])
    .map_err(|e| e.to_string())?;

    // Steam's page must open in the SYSTEM browser, not a webview we control —
    // the user needs to see the real steamcommunity.com with its own TLS padlock
    // before typing anything.
    tauri_plugin_opener::open_url(format!("{OPENID_ENDPOINT}?{query}"), None::<&str>)
        .map_err(|e| e.to_string())?;

    let pairs = tokio::task::spawn_blocking(move || await_redirect(listener))
        .await
        .map_err(|e| e.to_string())??;

    if !verify(&pairs).await? {
        return Err("Steam did not validate the sign-in response.".into());
    }

    let claimed_id = pairs
        .iter()
        .find(|(k, _)| k == "openid.claimed_id")
        .map(|(_, v)| v.as_str())
        .unwrap_or_default();

    let steamid = steamid_from_claimed_id(claimed_id)
        .ok_or_else(|| "Response did not carry a Steam identity.".to_string())?;

    write_session(&app, &Session { steamid: Some(steamid.clone()) })?;
    Ok(steamid)
}

#[tauri::command]
pub fn steam_session(app: tauri::AppHandle) -> Option<String> {
    read_session(&app).steamid
}

#[tauri::command]
pub fn steam_logout(app: tauri::AppHandle) -> Result<(), String> {
    write_session(&app, &Session::default())
}
