//! Per-app facts, keyed by appid — the store's own index of what it has already learned.
//!
//! ⭐ **Why this exists when `steam.rs` already caches HTTP.** That cache keys on a hash of
//! the whole REQUEST (`cache_key` — host, path, and sorted query). `GetItems` takes a batch
//! of ids, so `ids:[730,570]` and `ids:[730]` are different keys holding overlapping data.
//! A game on the home shelf, then in a search, then on its own details page is three
//! requests and three stored copies of the same facts. Keying on the APPID is the only
//! shape that can dedupe across requests, and the URL cache structurally cannot.
//!
//! ⚠️ **Blob per SOURCE, never one merged blob.** `GetItems`, `appdetails` and `appreviews`
//! disagree — about prices, about whether something is released, about review counts — and
//! merging at write time throws away which one said what. Keeping them apart means a
//! disagreement is inspectable later instead of being silently resolved by whoever wrote
//! last, and it means a new field never needs a migration: it is already in the blob.
//!
//! ⚠️ **This module WRITES ONLY.** Nothing reads it back yet, and that is deliberate: the
//! plan calls for write-through first and read-through as a separate change, because a bug
//! in either looks exactly like a bug in the other. Landing them together would mean
//! debugging "the shelf shows stale prices" without knowing whether the row was written
//! wrong or read wrong.
//!
//! Follows `protondb.rs` — same directory convention, same `rusqlite`, same WAL pragmas —
//! rather than inventing a second database style in one app.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

fn db_path(dir: &Path) -> PathBuf {
    dir.join("apps.sqlite3")
}

/// ⚠️ WAL + `synchronous = NORMAL`, the same pairing and the same trade as `protondb.rs`:
/// NORMAL can lose the last commit on a power cut, which is acceptable for a cache that
/// can be refetched from Steam and would not be for anything that is the only copy.
fn open_db(dir: &Path) -> rusqlite::Result<rusqlite::Connection> {
    std::fs::create_dir_all(dir).ok();
    let conn = rusqlite::Connection::open(db_path(dir))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    create_schema(&conn)?;
    Ok(conn)
}

/// ⚠️ Every scalar below is NULLABLE and must stay so. They are a convenience index over
/// the blobs — enough to draw a tile without parsing JSON — and NULL means "this source
/// did not say", which is a different fact from a zero. `review_pct = 0` is a game nobody
/// likes; `review_pct IS NULL` is a game nobody has told us about. The codebase already
/// had to learn this the hard way: `percent_positive: 0` on an unreviewed game rendered as
/// a confident "0% 👎".
fn create_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS apps (
             appid           INTEGER PRIMARY KEY,
             name            TEXT,
             type            TEXT,
             header_url      TEXT,
             is_free         INTEGER,
             review_pct      INTEGER,
             deck_compat     TEXT,
             -- One blob and one timestamp per SOURCE. `_at` is unix seconds and is what a
             -- future read-through compares against a TTL; a blob with no timestamp has
             -- never been written and must not be trusted.
             getitems_json   TEXT,
             getitems_at     INTEGER,
             appdetails_json TEXT,
             appdetails_at   INTEGER,
             reviews_json    TEXT,
             reviews_at      INTEGER
         );
         CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
}

/// Which upstream a blob came from. The set is closed on purpose — adding a source means
/// adding a column, and a string parameter would let a caller invent one that goes nowhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    GetItems,
    AppDetails,
    Reviews,
}

impl Source {
    fn columns(self) -> (&'static str, &'static str) {
        match self {
            Source::GetItems => ("getitems_json", "getitems_at"),
            Source::AppDetails => ("appdetails_json", "appdetails_at"),
            Source::Reviews => ("reviews_json", "reviews_at"),
        }
    }
}

/// One app's facts as a caller hands them over.
///
/// ⚠️ Every scalar is `Option`. A source that does not carry a field must leave it `None`
/// rather than substituting a default, or the write below will overwrite a good value from
/// another source with an invented one — see `upsert`'s COALESCE note.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppRecord {
    pub appid: u32,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub header_url: Option<String>,
    #[serde(default)]
    pub is_free: Option<bool>,
    #[serde(default)]
    pub review_pct: Option<u32>,
    #[serde(default)]
    pub deck_compat: Option<String>,
    /// The source payload for this app, verbatim, as a JSON string.
    #[serde(default)]
    pub blob: Option<String>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Write a batch, one transaction.
///
/// ⚠️ **Scalars are COALESCEd, blobs are replaced.** `appdetails` knows a game's type and
/// `GetItems` does not; if the second writer set `type = NULL` because its source is silent
/// on the question, it would erase what the first one knew. `COALESCE(?, type)` means a
/// source can only ever ADD a scalar, never blank one. The blob is different — it is that
/// source's own answer, so a newer one replaces it wholesale.
///
/// ⚠️ One transaction for the batch, not one per row. A shelf hydration is ~80 apps, and
/// 80 implicit transactions is 80 fsyncs — the same lesson `protondb.rs` records for its
/// bulk import, at a smaller scale.
pub fn upsert(dir: &Path, source: Source, records: &[AppRecord]) -> rusqlite::Result<usize> {
    if records.is_empty() {
        return Ok(0);
    }
    let mut conn = open_db(dir)?;
    let (blob_col, at_col) = source.columns();
    let tx = conn.transaction()?;
    let sql = format!(
        "INSERT INTO apps (appid, name, type, header_url, is_free, review_pct, deck_compat,
                           {blob_col}, {at_col})
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(appid) DO UPDATE SET
             name        = COALESCE(excluded.name,        apps.name),
             type        = COALESCE(excluded.type,        apps.type),
             header_url  = COALESCE(excluded.header_url,  apps.header_url),
             is_free     = COALESCE(excluded.is_free,     apps.is_free),
             review_pct  = COALESCE(excluded.review_pct,  apps.review_pct),
             deck_compat = COALESCE(excluded.deck_compat, apps.deck_compat),
             {blob_col}  = COALESCE(excluded.{blob_col},  apps.{blob_col}),
             {at_col}    = COALESCE(excluded.{at_col},    apps.{at_col})"
    );
    let written = {
        let mut stmt = tx.prepare(&sql)?;
        let mut n = 0;
        for r in records {
            // A record with no appid is not addressable; skip rather than store a row
            // nothing can ever look up.
            if r.appid == 0 {
                continue;
            }
            let at = r.blob.as_ref().map(|_| now_secs());
            n += stmt.execute(rusqlite::params![
                r.appid,
                r.name,
                r.kind,
                r.header_url,
                r.is_free.map(|b| b as i64),
                r.review_pct,
                r.deck_compat,
                r.blob,
                at,
            ])?;
        }
        n
    };
    tx.commit()?;
    Ok(written)
}

/// What the table holds, for the debug channel and for judging whether this is worth
/// reading from at all.
///
/// ⚠️ Counts and bytes, never names or ids. This is surfaced through `/state`, and a list
/// of what someone has been browsing is not something to put on a debug endpoint.
pub fn stats(dir: &Path) -> serde_json::Value {
    let Ok(conn) = open_db(dir) else {
        return serde_json::json!({ "available": false });
    };
    let count = |sql: &str| -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap_or(0)
    };
    serde_json::json!({
        "available": true,
        "apps": count("SELECT COUNT(*) FROM apps"),
        "withGetItems": count("SELECT COUNT(*) FROM apps WHERE getitems_at IS NOT NULL"),
        "withAppDetails": count("SELECT COUNT(*) FROM apps WHERE appdetails_at IS NOT NULL"),
        "withReviews": count("SELECT COUNT(*) FROM apps WHERE reviews_at IS NOT NULL"),
        "bytes": std::fs::metadata(db_path(dir)).map(|m| m.len()).unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("apps-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn rec(appid: u32) -> AppRecord {
        AppRecord { appid, ..Default::default() }
    }

    /// ⚠️ The wire format between `platform/appsIndex.ts` and this module, pinned.
    ///
    /// Two renames make this worth a test rather than an assumption: `Source` is a Rust
    /// enum serialised lowercase, and `kind` is `#[serde(rename = "type")]` because `type`
    /// is a keyword here and a plain field name over there. A mismatch in either would
    /// present as "the table never fills" with no error anywhere, because the write path
    /// is deliberately fire-and-forget.
    #[test]
    fn the_json_the_typescript_side_sends_deserialises() {
        let source: Source = serde_json::from_str("\"getitems\"").expect("source enum");
        assert_eq!(source, Source::GetItems);
        assert_eq!(
            serde_json::from_str::<Source>("\"appdetails\"").unwrap(),
            Source::AppDetails
        );

        // Exactly the object shape `putApps` builds, including the optional fields it
        // omits entirely rather than sending as null.
        let r: AppRecord = serde_json::from_str(
            r#"{"appid":730,"name":"CS2","type":"game","header_url":"https://x/h.jpg",
                "is_free":false,"review_pct":94,"deck_compat":"verified","blob":"{}"}"#,
        )
        .expect("full record");
        assert_eq!(r.appid, 730);
        assert_eq!(r.kind.as_deref(), Some("game"));
        assert_eq!(r.header_url.as_deref(), Some("https://x/h.jpg"));
        assert_eq!(r.review_pct, Some(94));
        assert_eq!(r.is_free, Some(false));

        // A minimal record — every optional field absent, which is what a source that
        // knows only an appid sends. It must not fail to parse.
        let bare: AppRecord = serde_json::from_str(r#"{"appid":1}"#).expect("bare record");
        assert_eq!(bare.appid, 1);
        assert!(bare.name.is_none() && bare.blob.is_none());
    }

    #[test]
    fn a_row_survives_a_reopen() {
        let dir = tmp("roundtrip");
        let r = AppRecord {
            appid: 730,
            name: Some("Counter-Strike 2".into()),
            blob: Some(r#"{"appid":730}"#.into()),
            ..Default::default()
        };
        assert_eq!(upsert(&dir, Source::GetItems, &[r]).unwrap(), 1);
        let s = stats(&dir);
        assert_eq!(s["apps"], 1);
        assert_eq!(s["withGetItems"], 1);
        assert_eq!(s["withAppDetails"], 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ⚠️ THE property this schema exists for. `appdetails` knows a game's type and
    /// `GetItems` does not; a second writer that is silent on a field must not erase what
    /// the first one knew, or two sources racing means the last one wins and the other's
    /// facts vanish.
    #[test]
    fn a_later_source_adds_scalars_and_never_blanks_them() {
        let dir = tmp("coalesce");
        upsert(
            &dir,
            Source::GetItems,
            &[AppRecord {
                appid: 730,
                name: Some("Counter-Strike 2".into()),
                review_pct: Some(94),
                blob: Some("{\"a\":1}".into()),
                ..Default::default()
            }],
        )
        .unwrap();
        // A second source that knows the TYPE but nothing about the name or reviews.
        upsert(
            &dir,
            Source::AppDetails,
            &[AppRecord {
                appid: 730,
                kind: Some("game".into()),
                blob: Some("{\"b\":2}".into()),
                ..Default::default()
            }],
        )
        .unwrap();

        let conn = open_db(&dir).unwrap();
        let (name, kind, pct): (Option<String>, Option<String>, Option<i64>) = conn
            .query_row("SELECT name, type, review_pct FROM apps WHERE appid = 730", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(name.as_deref(), Some("Counter-Strike 2"), "name must survive");
        assert_eq!(pct, Some(94), "review score must survive");
        assert_eq!(kind.as_deref(), Some("game"), "the new scalar must land");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The blobs are per-source and must not overwrite each other — that is the entire
    /// argument for not merging them into one.
    #[test]
    fn each_source_keeps_its_own_blob() {
        let dir = tmp("blobs");
        let with = |s: Source, body: &str| {
            upsert(&dir, s, &[AppRecord { appid: 1, blob: Some(body.into()), ..Default::default() }])
                .unwrap();
        };
        with(Source::GetItems, r#"{"from":"getitems"}"#);
        with(Source::AppDetails, r#"{"from":"appdetails"}"#);
        with(Source::Reviews, r#"{"from":"reviews"}"#);

        let conn = open_db(&dir).unwrap();
        let (a, b, c): (String, String, String) = conn
            .query_row(
                "SELECT getitems_json, appdetails_json, reviews_json FROM apps WHERE appid = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert!(a.contains("getitems"));
        assert!(b.contains("appdetails"));
        assert!(c.contains("reviews"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A fresher blob from the SAME source replaces it, unlike the scalars.
    #[test]
    fn the_same_source_replaces_its_own_blob() {
        let dir = tmp("replace");
        upsert(&dir, Source::GetItems, &[AppRecord { appid: 1, blob: Some("old".into()), ..Default::default() }]).unwrap();
        upsert(&dir, Source::GetItems, &[AppRecord { appid: 1, blob: Some("new".into()), ..Default::default() }]).unwrap();
        let conn = open_db(&dir).unwrap();
        let blob: String = conn
            .query_row("SELECT getitems_json FROM apps WHERE appid = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(blob, "new");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_batch_and_a_zero_appid_are_both_no_ops() {
        let dir = tmp("empty");
        assert_eq!(upsert(&dir, Source::GetItems, &[]).unwrap(), 0);
        assert_eq!(upsert(&dir, Source::GetItems, &[rec(0)]).unwrap(), 0);
        assert_eq!(stats(&dir)["apps"], 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ⚠️ `stats` is surfaced on the debug channel, so it must never carry what someone has
    /// been looking at.
    #[test]
    fn stats_reports_counts_and_never_names() {
        let dir = tmp("stats");
        upsert(
            &dir,
            Source::GetItems,
            &[AppRecord {
                appid: 730,
                name: Some("Counter-Strike 2".into()),
                blob: Some("{}".into()),
                ..Default::default()
            }],
        )
        .unwrap();
        let text = stats(&dir).to_string();
        assert!(!text.contains("Counter-Strike"), "no names: {text}");
        assert!(!text.contains("730"), "no appids: {text}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
