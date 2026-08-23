//! A loopback control channel, for debugging the box from a laptop over an SSH tunnel.
//!
//! ```sh
//! ssh -N -L 8555:127.0.0.1:8555 <user>@<box>
//! curl -s localhost:8555/state | jq
//! curl -s localhost:8555/log
//! curl -s -X POST localhost:8555/action -d '{"action":"down"}'
//! ```
//!
//! ⚠️ `/action` is the reason this exists. Reading state tells you what went wrong;
//! injecting input lets a script REPRODUCE it. Verifying something like "the dpad moves
//! twice" otherwise costs a human pressing buttons and describing the result, which is a
//! twenty-minute round trip per hypothesis.
//!
//! ## Rules this file must keep
//!
//! - **Loopback only.** Bound to 127.0.0.1, never 0.0.0.0. Reachable from another machine
//!   only through a tunnel someone deliberately opened.
//! - **Off unless asked.** Refuses everything until the Debug server setting is on.
//! - **Nothing that spends money.** `/action` drives the UI, and A on a store page is a
//!   `steam://` handoff — Steam still asks. No endpoint may buy, and none may be added.
//! - **No new dependency.** Three fixed routes over `tokio::net` rather than pulling a web
//!   framework into a store client whose pitch is a small binary.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// ⚠️ Not 8080: Steam's own CEF debugger listens there on Bazzite, and colliding with it
/// would break the owned/wishlist reader for a debugging convenience.
const PORT: u16 = 8555;

static ENABLED: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);
static STATE: Mutex<String> = Mutex::new(String::new());

/// The frontend publishes its view/focus state here on every transition.
#[tauri::command]
pub fn debug_state_set(state: String) {
    if let Ok(mut held) = STATE.lock() {
        *held = state;
    }
}

/// Turn the channel on or off; returns the URL to tunnel to.
///
/// ⚠️ Once bound the listener stays bound until the app exits — disabling makes it refuse
/// every request rather than releasing the port. Deliberate: tearing down a listener
/// mid-accept is fiddly for no gain when the socket is loopback-only and answering 403.
#[tauri::command]
pub fn debug_server_set(app: AppHandle, enabled: bool) -> String {
    ENABLED.store(enabled, Ordering::Relaxed);
    if enabled && !STARTED.swap(true, Ordering::Relaxed) {
        spawn(app);
    }
    format!("http://127.0.0.1:{PORT}")
}

fn json_response(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn plain_response(code: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {code}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// The actions `/action` will accept.
///
/// ⚠️ An allowlist, not a passthrough. The frontend dispatches on this string, and an
/// unknown one is at best ignored — but the list also documents, in one place, exactly
/// what this port can make the app do.
const ACTIONS: [&str; 13] = [
    "up", "down", "left", "right", "accept", "back", "secondary", "search", "menu", "shelfPrev",
    "shelfNext", "pagePrev", "pageNext",
];

fn handle(app: &AppHandle, request: &str) -> String {
    let mut lines = request.split("\r\n");
    let start = lines.next().unwrap_or_default();
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    if !ENABLED.load(Ordering::Relaxed) {
        return plain_response("403 Forbidden", "debug server is off\n");
    }

    match (method, path) {
        ("GET", "/state") => {
            let held = STATE.lock().map(|s| s.clone()).unwrap_or_default();
            json_response(if held.is_empty() { "{}" } else { &held })
        }
        ("GET", "/log") => {
            let body = crate::debuglog::tail(app, 400).unwrap_or_else(|e| format!("({e})"));
            plain_response("200 OK", &body)
        }
        ("POST", "/action") => {
            // The body is whatever follows the blank line. Small and fixed-shape, so it is
            // scanned rather than parsed — this is a debug port, not an API.
            let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
            let Some(action) = ACTIONS.iter().find(|a| body.contains(*a)) else {
                return plain_response("400 Bad Request", "no known action in body\n");
            };
            /*
             * ⚠️ Press AND release, always. A press with no release latches the action's
             * repeat timer down forever and the UI runs away on its own — the same edge
             * detector that makes real input work turns a half-injected press into a stuck
             * key. This has bitten this project before with synthetic keyboard events.
             */
            let _ = app.emit(
                "input://action",
                serde_json::json!({ "action": action, "pressed": true }),
            );
            let _ = app.emit(
                "input://action",
                serde_json::json!({ "action": action, "pressed": false }),
            );
            json_response(&format!("{{\"sent\":\"{action}\"}}"))
        }
        _ => plain_response("404 Not Found", "try /state, /log or POST /action\n"),
    }
}

fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // ⚠️ 127.0.0.1, never 0.0.0.0. This must not be reachable from the LAN; a tunnel
        // is how it reaches another machine, and that is a deliberate act.
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", PORT)).await {
            Ok(l) => l,
            Err(err) => {
                eprintln!("[debug] control channel could not bind {PORT}: {err}");
                return;
            }
        };
        eprintln!("[debug] control channel on http://127.0.0.1:{PORT}");

        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                continue;
            };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let read = socket.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..read]).to_string();
                let response = handle(&app, &request);
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });
}
