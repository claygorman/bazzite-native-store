//! Steam HTTP access with an on-disk cache.
//!
//! Deliberately dumb: this module fetches bytes and caches them. It does NOT know
//! any Steam response shape. Those are undocumented and drift (see
//! private/STEAM-ENDPOINTS.md), so all parsing lives in one place on the TypeScript
//! side rather than being duplicated here and there.
//!
//! Caching is not an optimization, it is a requirement — Steam rate-limits to
//! roughly 200 requests / 5 min per IP, and a controller UI can otherwise re-fetch
//! on every focus change.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum SteamError {
    #[error("http: {0}")]
    Http(String),
    #[error("steam returned HTTP {0}")]
    Status(u16),
    #[error("unsupported host: {0}")]
    UnknownHost(String),
}

fn base_url(host: &str) -> Result<&'static str, SteamError> {
    match host {
        "store" => Ok("https://store.steampowered.com"),
        "community" => Ok("https://steamcommunity.com"),
        "api" => Ok("https://api.steampowered.com"),
        // Second upstream, not Steam: Linux compatibility ratings.
        "protondb" => Ok("https://www.protondb.com"),
        other => Err(SteamError::UnknownHost(other.to_string())),
    }
}

#[derive(Serialize, Deserialize)]
struct CacheEntry {
    fetched_at: u64,
    body: String,
    /**
     * The origin's own freshness window, in seconds, when it stated one.
     *
     * ⚠️ Optional and defaulted so old cache files still parse. Without `default` every
     * entry written before this field existed fails to deserialize and the whole disk
     * cache silently empties on upgrade — a self-inflicted thundering herd against the
     * rate limit, on exactly the launch where the user notices.
     */
    #[serde(default)]
    origin_max_age: Option<u64>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Cache filename derived from the full request. Not cryptographic — it only needs
/// to be stable and filesystem-safe.
///
/// ⚠️ The host is a **filename prefix**, not just part of the hashed input. The
/// Downloads page reports what the cache weighs per upstream, and there is nowhere
/// else to recover that from: the hash is one-way and the body is opaque JSON. Costs
/// nothing and makes the status card possible.
fn cache_key(host: &str, path: &str, query: &HashMap<String, String>) -> String {
    let mut pairs: Vec<_> = query.iter().collect();
    pairs.sort(); // HashMap order is not stable; the key must be
    let mut raw = format!("{host}{path}");
    for (k, v) in pairs {
        raw.push_str(&format!("&{k}={v}"));
    }

    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in raw.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{host}-{hash:016x}.json")
}

/// Steam's endpoints are edge-cached and say so in `Cache-Control: max-age=N`.
///
/// ⚠️ That number is a FLOOR, not a target. Asking again inside it spends a request and a
/// slice of the rate limit to receive byte-identical data — measured 2026-08-23:
/// `appdetails` 3600, `GetNumberOfCurrentPlayers` 852, `featuredcategories` 300.
///
/// So the effective lifetime is the LONGER of what the caller asked for and what the
/// origin admits to. Going above the floor is a product decision and stays the caller's;
/// going below it is only ever waste, so it is quietly prevented.
///
/// ⚠️ `max-age` rather than `Expires`, and they carry the same information: `Expires`
/// needs an RFC 1123 date parser and therefore a date crate, for a value that is already
/// present as an integer. One fewer dependency in a binary whose pitch is its size.
fn effective_ttl(entry: &CacheEntry, requested: u64) -> u64 {
    requested.max(entry.origin_max_age.unwrap_or(0))
}

fn read_cache(dir: &Path, key: &str, ttl_seconds: u64) -> Option<String> {
    let raw = std::fs::read_to_string(dir.join(key)).ok()?;
    let entry: CacheEntry = serde_json::from_str(&raw).ok()?;
    let ttl = effective_ttl(&entry, ttl_seconds);
    (now_secs().saturating_sub(entry.fetched_at) < ttl).then_some(entry.body)
}

/// `max-age=N` out of a `Cache-Control` header, if it is there.
fn max_age_of(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let value = headers.get(reqwest::header::CACHE_CONTROL)?.to_str().ok()?;
    value
        .split(',')
        .filter_map(|part| part.trim().strip_prefix("max-age="))
        .find_map(|n| n.trim().parse::<u64>().ok())
}

fn write_cache(dir: &Path, key: &str, body: &str, origin_max_age: Option<u64>) {
    let entry = CacheEntry {
        fetched_at: now_secs(),
        body: body.to_string(),
        origin_max_age,
    };
    if let Ok(serialized) = serde_json::to_string(&entry) {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(dir.join(key), serialized);
    }
}

/// Fetch, preferring a fresh cache entry.
///
/// On a network failure we fall back to a STALE cache entry rather than surfacing an
/// error. Serving yesterday's store rows beats blanking the UI, which is the rule
/// these endpoints demand (private/STEAM-ENDPOINTS.md, rule 3).
pub async fn get(
    cache_dir: PathBuf,
    host: &str,
    path: &str,
    query: HashMap<String, String>,
    ttl_seconds: u64,
    // From the Network page's Request timeout row. Bounded below as well as there: a
    // value that arrived some other way must not be able to hang the UI forever.
    timeout_ms: u64,
) -> Result<String, SteamError> {
    let base = base_url(host)?;
    let key = cache_key(host, path, &query);

    if let Some(hit) = read_cache(&cache_dir, &key, ttl_seconds) {
        return Ok(hit);
    }

    // ⚠️ Browser User-Agent, deliberately. Undocumented store endpoints silently
    // STRIP FIELDS for non-browser agents — no error, no status code, the fields are
    // just absent (private/STEAM-URL-REFERENCE.md §9; appreviewhistogram is the known
    // case). Identifying honestly here costs data.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.clamp(1_000, 60_000)))
        .user_agent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/140.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|e| SteamError::Http(e.to_string()))?;

    let result = client
        .get(format!("{base}{path}"))
        .query(&query)
        .send()
        .await;

    match result {
        Ok(response) if response.status().is_success() => {
            // ⚠️ Read BEFORE `.text()`, which consumes the response.
            let origin_max_age = max_age_of(response.headers());
            let body = response.text().await.map_err(|e| SteamError::Http(e.to_string()))?;
            write_cache(&cache_dir, &key, &body, origin_max_age);
            Ok(body)
        }
        Ok(response) => {
            let status = response.status().as_u16();
            // Stale-if-error: a rate-limit or a 500 must not empty the screen.
            read_cache(&cache_dir, &key, u64::MAX).ok_or(SteamError::Status(status))
        }
        Err(err) => {
            read_cache(&cache_dir, &key, u64::MAX).ok_or(SteamError::Http(err.to_string()))
        }
    }
}

/* ─────────────────────────── the cache, as a fact ─────────────────────────── */

/// Drop one cached response.
///
/// ⚠️ Exists because Steam refuses INSIDE a 200. `appdetails` answers
/// `{"success": false}` when it is rate-limited — roughly 200 requests per five minutes
/// per IP — and that body is a perfectly cacheable HTTP success. With a six-hour TTL, one
/// throttled moment turns into "this game is age-gated or delisted" for the rest of the
/// day, on a game that is neither.
///
/// The caller is the only layer that can tell a refusal from an answer, so it gets a way
/// to say "do not keep that one".
pub fn forget(dir: &Path, host: &str, path: &str, query: &HashMap<String, String>) {
    let _ = std::fs::remove_file(dir.join(cache_key(host, path, query)));
}

/// What the cache weighs, for the Downloads page's status card.
///
/// ⚠️ Measured, not tracked. A running counter would have to survive restarts and
/// stay in step with every write and eviction; walking the directory is O(entries)
/// on a few hundred small files and cannot drift out of agreement with the disk.
#[derive(Default, serde::Serialize)]
pub struct CacheStats {
    pub entries: u64,
    pub bytes: u64,
    /// Age of the newest entry, in seconds. `None` when the cache is empty — which is
    /// a different statement from "0 seconds ago" and reads differently on the card.
    pub newest_age_seconds: Option<u64>,
    /// Bytes per upstream, keyed by the host prefix `cache_key` writes.
    pub by_host: HashMap<String, u64>,
}

pub fn stats(cache_dir: &Path) -> CacheStats {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        // No directory yet is an empty cache, not an error. It is the normal state on
        // first launch and on every machine that has not fetched anything.
        return CacheStats::default();
    };
    let now = now_secs();
    let mut out = CacheStats::default();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        out.entries += 1;
        out.bytes += meta.len();
        // Files written before the prefix existed have no `-`, and land under
        // "other" rather than being dropped from the total the bar is drawn from.
        let host = entry
            .file_name()
            .to_str()
            .and_then(|n| n.split_once('-'))
            .map(|(host, _)| host.to_string())
            .unwrap_or_else(|| "other".into());
        *out.by_host.entry(host).or_insert(0) += meta.len();
        if let Ok(modified) = meta.modified() {
            let age = modified
                .duration_since(UNIX_EPOCH)
                .map(|d| now.saturating_sub(d.as_secs()))
                .unwrap_or(0);
            out.newest_age_seconds = Some(out.newest_age_seconds.map_or(age, |n| n.min(age)));
        }
    }
    out
}

/// Empty the cache, returning how many entries went.
///
/// ⚠️ Deletes the FILES, never the directory. Removing the directory races every
/// in-flight `write_cache`, which re-creates it — leaving a half-cleared cache and a
/// count that lied. It also only ever removes plain files inside the one directory it
/// was handed: no recursion, no symlink following, nothing that could reach outside
/// the app's own cache dir if that path were ever wrong.
pub fn clear(cache_dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        // `symlink_metadata` does not follow links, so a symlink is skipped rather
        // than followed to whatever it points at.
        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_file())
            && std::fs::remove_file(&path).is_ok()
        {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::{cache_key, clear, effective_ttl, max_age_of, stats, CacheEntry};
    use std::collections::HashMap;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("bazzite-store-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The property the cache rests on: same request, same file — regardless of the
    /// order a HashMap happens to iterate its keys in.
    /// The prefix the Downloads card reads back. Losing it silently would leave every
    /// byte attributed to "other" with nothing failing.
    /// The origin's `max-age` is a FLOOR, never a ceiling.
    ///
    /// Measured against the live endpoints 2026-08-23: three requests 15s apart to
    /// `GetNumberOfCurrentPlayers` returned an identical player count and an identical
    /// `Expires`, while `max-age` counted down 755 -> 740 -> 724 toward it. So asking
    /// inside that window spends a request for byte-identical data.
    #[test]
    fn the_origin_floor_raises_a_short_ttl_and_never_lowers_a_long_one() {
        let entry = |max_age| CacheEntry {
            fetched_at: 0,
            body: String::new(),
            origin_max_age: max_age,
        };

        // Caller wants 60s, origin says it cannot change for 852. Use 852.
        assert_eq!(effective_ttl(&entry(Some(852)), 60), 852);
        // Caller deliberately wants four hours. That is a product decision; keep it.
        assert_eq!(effective_ttl(&entry(Some(3600)), 14_400), 14_400);
        // ⚠️ No header, so no opinion — the caller's TTL stands rather than collapsing
        // to zero and re-fetching everything on every read.
        assert_eq!(effective_ttl(&entry(None), 900), 900);
    }

    #[test]
    fn max_age_is_parsed_out_of_a_real_cache_control_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CACHE_CONTROL,
            "public, max-age=852".parse().unwrap(),
        );
        assert_eq!(max_age_of(&headers), Some(852));

        // The store spells it without the space; both are real, seen the same day.
        headers.insert(
            reqwest::header::CACHE_CONTROL,
            "public,max-age=3600".parse().unwrap(),
        );
        assert_eq!(max_age_of(&headers), Some(3600));

        // ⚠️ `no-cache` must not parse as zero-and-therefore-fine. It has no max-age, so
        // there is no origin opinion and the caller's TTL must survive untouched.
        headers.insert(reqwest::header::CACHE_CONTROL, "no-cache".parse().unwrap());
        assert_eq!(max_age_of(&headers), None);
    }

    #[test]
    fn the_key_is_prefixed_with_its_host() {
        let key = cache_key("protondb", "/api/v1/x.json", &HashMap::new());
        assert!(key.starts_with("protondb-"), "{key}");
        assert!(key.ends_with(".json"));
    }

    #[test]
    fn the_key_is_stable_across_query_order() {
        let a: HashMap<String, String> =
            [("b".into(), "2".into()), ("a".into(), "1".into())].into();
        let b: HashMap<String, String> =
            [("a".into(), "1".into()), ("b".into(), "2".into())].into();
        assert_eq!(cache_key("store", "/x", &a), cache_key("store", "/x", &b));
        assert_ne!(cache_key("store", "/x", &a), cache_key("api", "/x", &a));
    }

    #[test]
    fn an_absent_cache_directory_is_empty_not_an_error() {
        let missing = std::env::temp_dir().join("bazzite-store-test-nonexistent-xyz");
        let _ = std::fs::remove_dir_all(&missing);
        assert_eq!(stats(&missing).entries, 0);
        assert_eq!(clear(&missing), 0);
    }

    #[test]
    fn counts_bytes_then_clears_the_files_and_keeps_the_directory() {
        let dir = temp_dir("clear");
        std::fs::write(dir.join("store-aaaa.json"), "0123456789").unwrap();
        std::fs::write(dir.join("protondb-bbbb.json"), "01234").unwrap();
        std::fs::create_dir_all(dir.join("sub")).unwrap();

        let before = stats(&dir);
        assert_eq!(before.entries, 2, "the subdirectory must not be counted as an entry");
        assert_eq!(before.bytes, 15);
        assert!(before.newest_age_seconds.is_some());
        assert_eq!(before.by_host.get("store"), Some(&10));
        assert_eq!(before.by_host.get("protondb"), Some(&5));

        assert_eq!(clear(&dir), 2);
        assert!(dir.is_dir(), "the directory itself must survive");
        assert_eq!(stats(&dir).entries, 0);
        assert_eq!(stats(&dir).newest_age_seconds, None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
