//! ProtonDB's open report dump, indexed for one-appid lookups.
//!
//! The live summaries endpoint (`src/platform/protondb.ts`) stays the source of truth
//! for a game's TIER. This module supplies only what that endpoint does not have and
//! the dump states outright: individual reports, their hardware, and whether anti-cheat
//! was cited.
//!
//! ⚠️ **We do not compute tiers here, and must not start.** Since the February 2022
//! schema change the dump carries no tier or rating field — ProtonDB derives it from the
//! fault responses. Re-deriving it would mean our grade and protondb.com's could
//! disagree, and a compatibility number nobody can reproduce upstream is worse than no
//! number. See docs and `bdefore/protondb-data`.
//!
//! ⚠️ The archives are **cumulative snapshots**, not increments. Exactly one needs
//! downloading — the newest — which is ~66 MB gzipped and roughly half a gigabyte of
//! JSON once expanded. That is why this builds an on-disk index instead of parsing on
//! demand: the UI reads one game's reports by seeking, and never touches the bulk.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/* ─────────────────────────── limits ─────────────────────────── */

/*
 * ⚠️ Every one of these is a bound on data we did not write and cannot vouch for. The
 * dump is user-submitted free text from the public internet, mirrored through a
 * third-party repo, and it lands in a file this app later trusts. Nothing below is
 * theoretical politeness — each caps a way one bad row can spoil the whole index.
 */

/// Free-text note. Long enough for a real bug report, short enough that one pasted
/// crash log cannot dominate a game's span.
const MAX_NOTE: usize = 2_000;
/// Hardware and version strings. These are labels, not prose.
const MAX_FIELD: usize = 200;
/// Reports kept per game, newest first. The busiest titles have tens of thousands and
/// the tab shows a page of them; keeping all of them would bloat one span into
/// megabytes for no visible benefit.
const MAX_REPORTS_PER_GAME: usize = 500;
/// ⚠️ Decompression bomb guard. gzip happily expands a small archive into an
/// unbounded stream, and this one is fetched over the network. The real 2026 snapshot
/// is ~500 MB expanded, so 2 GiB is generous headroom and still a stop.
const MAX_EXPANDED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Steam appids are far below this. Guards against a parsed integer that is merely
/// numeric rather than plausible.
const MAX_APPID: u32 = 30_000_000;
/// 2010-01-01. Steam Play did not exist before this; anything older is corrupt.
const MIN_TIMESTAMP: i64 = 1_262_304_000;
/// 2100-01-01. Far-future stamps would sort to the top forever.
const MAX_TIMESTAMP: i64 = 4_102_444_800;

/// Make one untrusted string safe to store and to render.
///
/// ⚠️ Control characters are stripped rather than escaped. These strings end up in a
/// JSON blob and then in the DOM, and a stray ESC or a lone surrogate-adjacent control
/// byte has no legitimate meaning in "GPU model" or "what I changed to get it running".
/// Newlines and tabs collapse to spaces so a report cannot smuggle in layout.
fn clean(raw: String, max: usize) -> String {
    let collapsed: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let mut out = collapsed.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.chars().count() > max {
        // Truncate on a CHARACTER boundary — byte slicing splits UTF-8 and produces a
        // string serde will refuse to write.
        out = out.chars().take(max).collect::<String>();
        out.push('…');
    }
    out
}

/// One report, reduced to the fields the ProtonDB tab actually draws.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Report {
    /// Unix seconds. The UI formats it; the backend does not guess a locale.
    pub timestamp: i64,
    pub gpu: String,
    pub cpu: String,
    /// Distribution string, e.g. "Linux Mint 22.3".
    pub os: String,
    pub kernel: String,
    /// The Proton build, where the reporter named one.
    pub proton: String,
    /// `official` | `experimental` | `ge` | `native` | `notListed` | `older`.
    pub variant: String,
    pub note: String,
    /// ⚠️ `None` means NOT ASKED, not "no". The question only appears for games where
    /// ProtonDB thinks it is relevant, so absent and false are different facts and the
    /// UI must not merge them.
    pub anticheat: Option<bool>,

    /*
     * The questionnaire answers a tier is derived FROM.
     *
     * ⚠️ Kept so a reconstruction of ProtonDB's tier rule can be VALIDATED against the
     * live summaries endpoint rather than guessed at. Nothing may display a tier
     * computed from these until that validation says the reconstruction agrees with
     * upstream — a grade nobody can reproduce on protondb.com is worse than none.
     * Every one is `Option`: unanswered is not "no".
     */
    pub installs: Option<bool>,
    pub opens: Option<bool>,
    pub starts_play: Option<bool>,
    pub verdict: Option<bool>,
    pub significant_bugs: Option<bool>,
    /// `type` upstream: `tinker` means they changed something to get there.
    pub tinkered: Option<bool>,
    /// How many of the seven fault questions were answered "yes".
    pub faults: Option<u8>,
}

/* ─────────────────────────── parsing ─────────────────────────── */

/// Pull a nested string out without building a whole `Value` tree for it.
fn s(v: &serde_json::Value, path: &[&str]) -> String {
    let mut cur = v;
    for key in path {
        match cur.get(key) {
            Some(next) => cur = next,
            None => return String::new(),
        }
    }
    cur.as_str().unwrap_or_default().to_string()
}

/// The seven fault questions, counted.
///
/// ⚠️ `None` when the block is absent entirely — a report that never reached the fault
/// questions (because it did not run at all) is different from one that answered "no" to
/// all seven, and collapsing them would turn a Borked report into a Platinum one.
fn fault_count(v: &serde_json::Value) -> Option<u8> {
    const FAULTS: [&str; 7] = [
        "audioFaults",
        "graphicalFaults",
        "performanceFaults",
        "stabilityFaults",
        "inputFaults",
        "saveGameFaults",
        "windowingFaults",
    ];
    let responses = v.get("responses")?;
    if !FAULTS.iter().any(|f| responses.get(f).is_some()) {
        return None;
    }
    Some(
        FAULTS
            .iter()
            .filter(|f| responses.get(*f).and_then(|x| x.as_str()) == Some("yes"))
            .count() as u8,
    )
}

/// `yes`/`no` → bool. Anything else (including absent) stays `None`.
fn yes_no(v: &serde_json::Value, path: &[&str]) -> Option<bool> {
    match s(v, path).as_str() {
        "yes" => Some(true),
        "no" => Some(false),
        _ => None,
    }
}

/// One raw record → `(appid, Report)`.
///
/// ⚠️ Two schemas, and a cumulative snapshot can hold both. Before February 2022 the
/// fields were flat (`appId`, `os`, `specs`, `protonVersion`, `notes`); after, they are
/// nested under `app` / `responses` / `systemInfo`. Reading only the modern shape
/// silently drops every historical report — no error, just a thinner list.
fn parse_record(v: &serde_json::Value) -> Option<(u32, Report)> {
    let nested = v.get("app").is_some();

    let appid_raw = if nested {
        s(v, &["app", "steam", "appId"])
    } else {
        // The flat schema sometimes typed appId as a number.
        match v.get("appId") {
            Some(serde_json::Value::String(x)) => x.clone(),
            Some(serde_json::Value::Number(n)) => n.to_string(),
            _ => String::new(),
        }
    };
    let appid: u32 = appid_raw.parse().ok()?;
    // 0 is not a game, and a merely-numeric value is not necessarily an appid.
    if appid == 0 || appid > MAX_APPID {
        return None;
    }

    let report = if nested {
        Report {
            timestamp: v.get("timestamp").and_then(serde_json::Value::as_i64)?,
            gpu: s(v, &["systemInfo", "gpu"]),
            cpu: s(v, &["systemInfo", "cpu"]),
            os: s(v, &["systemInfo", "os"]),
            kernel: s(v, &["systemInfo", "kernel"]),
            // `protonVersion` is only present when the reporter picked `older`; the
            // custom build otherwise names itself.
            proton: {
                let custom = s(v, &["responses", "customProtonVersion"]);
                if custom.is_empty() {
                    s(v, &["responses", "protonVersion"])
                } else {
                    custom
                }
            },
            variant: s(v, &["responses", "variant"]),
            note: {
                // The free-text lives in two places and either may be blank.
                let concluding = s(v, &["responses", "notes", "concludingNotes"]);
                if concluding.is_empty() {
                    s(v, &["responses", "notes", "verdict"])
                } else {
                    concluding
                }
            },
            anticheat: yes_no(v, &["responses", "isImpactedByAntiCheat"]),
            installs: yes_no(v, &["responses", "installs"]),
            opens: yes_no(v, &["responses", "opens"]),
            starts_play: yes_no(v, &["responses", "startsPlay"]),
            verdict: yes_no(v, &["responses", "verdict"]),
            significant_bugs: yes_no(v, &["responses", "significantBugs"]),
            tinkered: match s(v, &["responses", "type"]).as_str() {
                "tinker" => Some(true),
                "steamPlay" => Some(false),
                _ => None,
            },
            faults: fault_count(v),
        }
    } else {
        Report {
            timestamp: v.get("timestamp").and_then(serde_json::Value::as_i64)?,
            // Pre-2022 reported one "specs" blob rather than split cpu/gpu.
            gpu: s(v, &["gpu"]),
            cpu: {
                let cpu = s(v, &["cpu"]);
                if cpu.is_empty() {
                    s(v, &["specs"])
                } else {
                    cpu
                }
            },
            os: s(v, &["os"]),
            kernel: s(v, &["kernel"]),
            proton: s(v, &["protonVersion"]),
            variant: String::new(),
            note: s(v, &["notes"]),
            anticheat: None,
            // The pre-2022 questionnaire did not ask any of these. Absent, not false.
            installs: None,
            opens: None,
            starts_play: None,
            verdict: None,
            significant_bugs: None,
            tinkered: None,
            faults: None,
        }
    };

    // ⚠️ Rejected AFTER building, so both schema branches are covered by one check.
    // A zero or far-future stamp sorts to the top of a game's list forever.
    if report.timestamp < MIN_TIMESTAMP || report.timestamp > MAX_TIMESTAMP {
        return None;
    }

    Some((
        appid,
        Report {
            note: clean(report.note, MAX_NOTE),
            gpu: clean(report.gpu, MAX_FIELD),
            cpu: clean(report.cpu, MAX_FIELD),
            os: clean(report.os, MAX_FIELD),
            kernel: clean(report.kernel, MAX_FIELD),
            proton: clean(report.proton, MAX_FIELD),
            variant: clean(report.variant, MAX_FIELD),
            ..report
        },
    ))
}

/* ─────────────────────────── storage ─────────────────────────── */

/*
 * SQLite, one row per report.
 *
 * ⚠️ This replaced a hand-rolled `appid -> (offset, len)` map over a JSON blob, plus an
 * atomic-rename dance, plus a length check for torn writes, plus an in-memory cache of
 * the index. That was, badly, a key-value store. Measured against the real 326,212
 * reports the swap won on every axis: 68 MB instead of 94 MB, 49µs lookups instead of
 * 253µs and with no cache to hold, transactions instead of rename-and-hope, and it is
 * readable by the demo server through Node's built-in `node:sqlite` with no npm
 * dependency — so there is one store rather than one per runtime.
 *
 * It also makes the query the live API cannot answer merely easy: ProtonDB serves one
 * appid per request with no aggregation, which is why a per-tag compatibility breakdown
 * was written off as impossible. Across the whole set that is now a GROUP BY in ~40ms.
 */

fn db_path(dir: &Path) -> PathBuf {
    dir.join("protondb.sqlite3")
}

fn open_db(dir: &Path) -> rusqlite::Result<rusqlite::Connection> {
    let conn = rusqlite::Connection::open(db_path(dir))?;
    /*
     * ⚠️ WAL plus `synchronous = NORMAL` is the pairing that makes the bulk load
     * tolerable. The default (rollback journal, FULL) fsyncs per transaction, which for
     * a 326k-row import is the difference between half a second and minutes. NORMAL can
     * lose the last commit on a power cut — acceptable for a cache that can be rebuilt
     * from a URL, and not acceptable for anything that is the only copy.
     */
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

fn create_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reports (
             appid     INTEGER NOT NULL,
             ts        INTEGER NOT NULL,
             gpu       TEXT NOT NULL,
             cpu       TEXT NOT NULL,
             os        TEXT NOT NULL,
             kernel    TEXT NOT NULL,
             proton    TEXT NOT NULL,
             variant   TEXT NOT NULL,
             note      TEXT NOT NULL,
             -- ⚠️ Every column below is NULLABLE and must stay so. Absent means the
             -- question was never asked, which is a different fact from a reported
             -- 'no' — and collapsing the two turns a Borked report into a Platinum one.
             anticheat        INTEGER,
             installs         INTEGER,
             opens            INTEGER,
             starts_play      INTEGER,
             verdict          INTEGER,
             significant_bugs INTEGER,
             tinkered         INTEGER,
             faults           INTEGER
         );
         -- (appid, ts DESC) so one game's newest page is a range scan, not a sort.
         CREATE INDEX IF NOT EXISTS ix_reports_appid ON reports(appid, ts DESC);
         CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
}

/// Write every record, replacing whatever was there.
pub fn build_index(
    records: impl IntoIterator<Item = (u32, Report)>,
    dir: &Path,
    snapshot: &str,
) -> rusqlite::Result<usize> {
    fs::create_dir_all(dir).ok();
    let mut conn = open_db(dir)?;
    create_schema(&conn)?;

    /*
     * ⚠️ ONE transaction around the whole import, and it is not an optimisation. In
     * autocommit every insert is its own transaction — 326,212 of them — which is the
     * usual reason people conclude SQLite is slow. It also makes the swap ATOMIC: a
     * crash mid-import rolls back to the previous snapshot rather than leaving a
     * half-replaced table, which is exactly the failure the old rename dance existed to
     * prevent and had to be hand-written to get right.
     */
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM reports", [])?;

    let mut inserted = 0usize;
    let mut per_game: BTreeMap<u32, usize> = BTreeMap::new();
    {
        let mut stmt = tx.prepare(
            "INSERT INTO reports (appid, ts, gpu, cpu, os, kernel, proton, variant, note,
                                  anticheat, installs, opens, starts_play, verdict,
                                  significant_bugs, tinkered, faults)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        )?;
        for (appid, r) in records {
            // The per-game cap still applies — it bounds one game's page, and the
            // busiest titles have tens of thousands of reports nobody scrolls to.
            let seen = per_game.entry(appid).or_default();
            if *seen >= MAX_REPORTS_PER_GAME {
                continue;
            }
            *seen += 1;
            stmt.execute(rusqlite::params![
                appid,
                r.timestamp,
                r.gpu,
                r.cpu,
                r.os,
                r.kernel,
                r.proton,
                r.variant,
                r.note,
                r.anticheat,
                r.installs,
                r.opens,
                r.starts_play,
                r.verdict,
                r.significant_bugs,
                r.tinkered,
                r.faults,
            ])?;
            inserted += 1;
        }
    }
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('snapshot', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [snapshot],
    )?;
    tx.commit()?;
    Ok(inserted)
}

/// One game's reports, newest first.
pub fn reports_for(dir: &Path, appid: u32) -> Vec<Report> {
    let Ok(conn) = open_db(dir) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT ts, gpu, cpu, os, kernel, proton, variant, note, anticheat,
                installs, opens, starts_play, verdict, significant_bugs, tinkered, faults
         FROM reports WHERE appid = ?1 ORDER BY ts DESC",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([appid], |row| {
        Ok(Report {
            timestamp: row.get(0)?,
            gpu: row.get(1)?,
            cpu: row.get(2)?,
            os: row.get(3)?,
            kernel: row.get(4)?,
            proton: row.get(5)?,
            variant: row.get(6)?,
            note: row.get(7)?,
            anticheat: row.get(8)?,
            installs: row.get(9)?,
            opens: row.get(10)?,
            starts_play: row.get(11)?,
            verdict: row.get(12)?,
            significant_bugs: row.get(13)?,
            tinkered: row.get(14)?,
            faults: row.get(15)?,
        })
    });
    match rows {
        Ok(iter) => iter.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

/// Which snapshot the database was built from, if any.
fn stored_snapshot(dir: &Path) -> Option<String> {
    if !db_path(dir).exists() {
        return None;
    }
    let conn = open_db(dir).ok()?;
    conn.query_row("SELECT value FROM meta WHERE key = 'snapshot'", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

/* ─────────────────────────── snapshots ─────────────────────────── */

/// Rank `reports_aug4_2026.tar.gz` so the newest wins.
///
/// ⚠️ Sorting these names as strings puts `apr` before `aug` before `dec`, i.e.
/// alphabetically, which is not chronological and would pick December of the earliest
/// year as "newest". The year has to lead and the month has to be a number.
pub fn snapshot_rank(name: &str) -> Option<(u32, u32, u32)> {
    let stem = name.strip_prefix("reports_")?.strip_suffix(".tar.gz")?;
    let (monthday, year) = stem.rsplit_once('_')?;
    let month = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ]
    .iter()
    .position(|m| monthday.starts_with(m))? as u32
        + 1;
    let day: u32 = monthday[3..].parse().unwrap_or(1);
    Some((year.parse().ok()?, month, day))
}

/// Newest snapshot filename from a listing.
pub fn newest_snapshot<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<String> {
    names
        .into_iter()
        .filter_map(|n| snapshot_rank(n).map(|r| (r, n.to_string())))
        .max_by_key(|(r, _)| *r)
        .map(|(_, n)| n)
}

/// Walk a JSON array of records from a reader, handing each one over and DROPPING it.
///
/// ⚠️ This is a `SeqAccess` visitor rather than `from_str::<Vec<Value>>` for one
/// measured reason: the array is 491 MB and the DOM form of it peaked at **3.55 GB
/// resident**. Deserializing element-by-element holds one record at a time, so peak
/// memory is the OUTPUT rather than the input — and the output is the part we already
/// bounded. Same correctness, an order of magnitude less memory.
fn for_each_record<R: std::io::Read>(
    reader: R,
    mut sink: impl FnMut(u32, Report),
) -> Result<(), serde_json::Error> {
    struct Seq<F>(F);

    impl<'de, F: FnMut(u32, Report)> serde::de::Visitor<'de> for Seq<F> {
        type Value = ();

        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("an array of ProtonDB reports")
        }

        fn visit_seq<A: serde::de::SeqAccess<'de>>(
            mut self,
            mut seq: A,
        ) -> Result<(), A::Error> {
            // One element in flight at a time; it is dropped before the next is read.
            while let Some(value) = seq.next_element::<serde_json::Value>()? {
                if let Some((appid, report)) = parse_record(&value) {
                    (self.0)(appid, report);
                }
            }
            Ok(())
        }
    }

    let mut de = serde_json::Deserializer::from_reader(reader);
    serde::Deserializer::deserialize_seq(&mut de, Seq(&mut sink))
}

/// Expand a downloaded `.tar.gz` and parse every record inside it.
pub fn parse_archive(bytes: &[u8]) -> std::io::Result<Vec<(u32, Report)>> {
    /*
     * ⚠️ `.take()` is the decompression-bomb guard, and it is not optional: this is a
     * network-fetched gzip stream, and gzip will expand a few megabytes into an
     * unbounded one. Without a ceiling a hostile or corrupt archive fills the disk or
     * the heap before anything downstream gets a say. The real snapshot is ~491 MB
     * expanded, so this stops well clear of legitimate data.
     */
    let decoder = flate2::read::GzDecoder::new(bytes).take(MAX_EXPANDED_BYTES);
    let mut archive = tar::Archive::new(decoder);
    let mut out = Vec::new();
    for entry in archive.entries()? {
        let entry = entry?;
        if !entry.path()?.to_string_lossy().ends_with(".json") {
            continue;
        }
        // ⚠️ Streamed straight from the tar entry. Reading it to a String first would
        // materialise the whole 491 MB before parsing even began — and would be an
        // outright error in any runtime with a string length cap.
        // ⚠️ `BufReader`, and it is worth 3x. `serde_json::from_reader` issues many
        // small reads, and each one here travels through the tar layer and then the
        // gzip decoder. Unbuffered this took 25s; buffered, 8s — for the same bytes and
        // the same peak memory.
        let entry = std::io::BufReader::with_capacity(1 << 20, entry);
        if let Err(e) = for_each_record(entry, |appid, report| out.push((appid, report))) {
            // A malformed member should not cost the rest of the archive.
            eprintln!("protondb: skipping unreadable archive member: {e}");
        }
    }
    Ok(out)
}

/* ─────────────────────────── refresh ─────────────────────────── */

const REPO: &str = "bdefore/protondb-data";

/// What the UI needs to tell "no reports" apart from "no data yet".
pub fn index_status(dir: &Path) -> serde_json::Value {
    match stored_snapshot(dir) {
        Some(snapshot) => {
            // Cheap: the index makes this a scan of distinct appids, not of rows.
            let games: i64 = open_db(dir)
                .and_then(|c| {
                    c.query_row("SELECT COUNT(DISTINCT appid) FROM reports", [], |r| r.get(0))
                })
                .unwrap_or(0);
            serde_json::json!({
                "ready": true,
                "snapshot": snapshot,
                "publishedOn": snapshot_date(&snapshot),
                "games": games,
            })
        }
        None => serde_json::json!({ "ready": false, "snapshot": null, "games": 0 }),
    }
}

/// Ask GitHub what the newest snapshot is, without downloading it.
///
/// ⚠️ Deliberately separate from `refresh` so the UI can offer "there is a newer dump,
/// 66 MB, fetch it?" instead of spending someone's bandwidth to find out. One small
/// JSON listing; the archives themselves are untouched.
pub async fn check(dir: PathBuf, timeout_ms: u64) -> Result<serde_json::Value, String> {
    let installed = stored_snapshot(&dir);
    let latest = latest_snapshot_name(timeout_ms).await?;
    Ok(serde_json::json!({
        "installed": installed,
        "latest": latest,
        // Snapshots are immutable once published, so "different" IS "newer".
        "updateAvailable": installed.as_deref() != Some(latest.as_str()),
        "publishedOn": snapshot_date(&latest),
    }))
}

/// The `YYYY-MM-DD` a snapshot filename encodes, for showing a date rather than a
/// filename to a person.
pub fn snapshot_date(name: &str) -> Option<String> {
    let (y, m, d) = snapshot_rank(name)?;
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

async fn latest_snapshot_name(timeout_ms: u64) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.clamp(2_000, 60_000)))
        .user_agent("bazzite-native-store")
        .build()
        .map_err(|e| e.to_string())?;
    let body = client
        .get(format!("https://api.github.com/repos/{REPO}/contents/reports"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let listing: Vec<serde_json::Value> =
        serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let names: Vec<String> = listing
        .iter()
        .filter_map(|e| e.get("name")?.as_str().map(str::to_string))
        .collect();
    newest_snapshot(names.iter().map(String::as_str))
        .ok_or_else(|| "no snapshot archives found in the listing".to_string())
}

/// Fetch the newest snapshot and rebuild the index, skipping the work if we already
/// have that exact snapshot.
pub async fn refresh(dir: PathBuf, timeout_ms: u64) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        // ⚠️ Generous, and it has to be: this is a ~66 MB body. The Network page's
        // Request timeout is tuned for a JSON endpoint answering in milliseconds, so
        // applying it here would abort the download every time.
        .timeout(std::time::Duration::from_millis(
            timeout_ms.clamp(60_000, 1_800_000),
        ))
        .user_agent("bazzite-native-store")
        .build()
        .map_err(|e| e.to_string())?;

    // ⚠️ `.text()` then parse, rather than `.json()`. This crate builds reqwest with
    // `default-features = false` so the `json` feature is absent — calling `.json()`
    // fails to compile with "no method named `json`", which reads like a version
    // problem rather than a missing feature.
    let body = client
        .get(format!(
            "https://api.github.com/repos/{REPO}/contents/reports"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let listing: Vec<serde_json::Value> = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let names: Vec<String> = listing
        .iter()
        .filter_map(|e| e.get("name")?.as_str().map(str::to_string))
        .collect();
    let newest = newest_snapshot(names.iter().map(String::as_str))
        .ok_or_else(|| "no snapshot archives found in the listing".to_string())?;

    // Already have it — the archives are immutable once published, so the only reason
    // to redownload is a NEWER one.
    if stored_snapshot(&dir).as_deref() == Some(newest.as_str()) {
        let mut status = index_status(&dir);
        status["downloaded"] = serde_json::json!(false);
        return Ok(status);
    }

    let bytes = client
        .get(format!(
            "https://github.com/{REPO}/raw/master/reports/{newest}"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let records = parse_archive(&bytes).map_err(|e| e.to_string())?;
    let inserted = build_index(records, &dir, &newest).map_err(|e| e.to_string())?;
    let mut status = index_status(&dir);
    status["downloaded"] = serde_json::json!(true);
    status["reports"] = serde_json::json!(inserted);
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_snapshot_is_chronological_not_alphabetical() {
        // The trap: sorted as text, "dec1_2018" beats "aug4_2026".
        let names = [
            "reports_dec1_2018.tar.gz",
            "reports_aug4_2026.tar.gz",
            "reports_apr1_2026.tar.gz",
            "README.md",
        ];
        assert_eq!(
            newest_snapshot(names).as_deref(),
            Some("reports_aug4_2026.tar.gz")
        );
    }

    #[test]
    fn parses_the_modern_nested_schema() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"app":{"steam":{"appId":"368080"},"title":"T"},
                "timestamp":1648798906,
                "responses":{"variant":"official","protonVersion":"7.0",
                             "isImpactedByAntiCheat":"yes",
                             "notes":{"concludingNotes":"needs XNA","verdict":"stops"}},
                "systemInfo":{"cpu":"Ryzen 7","gpu":"RX 6600","kernel":"6.1","os":"Arch"}}"#,
        )
        .unwrap();
        let (appid, r) = parse_record(&v).expect("should parse");
        assert_eq!(appid, 368080);
        assert_eq!(r.gpu, "RX 6600");
        assert_eq!(r.note, "needs XNA");
        assert_eq!(r.anticheat, Some(true));
    }

    #[test]
    fn parses_the_pre_2022_flat_schema_too() {
        // A cumulative snapshot holds both shapes; dropping this one loses every
        // historical report silently.
        let v: serde_json::Value = serde_json::from_str(
            r#"{"appId":"578850","timestamp":1535957267,"rating":"Borked",
                "notes":"Crashes","os":"Arch (4.18.5)","protonVersion":"3.7",
                "specs":"i7-7700HQ / GTX 1050"}"#,
        )
        .unwrap();
        let (appid, r) = parse_record(&v).expect("should parse");
        assert_eq!(appid, 578850);
        assert_eq!(r.note, "Crashes");
        assert_eq!(r.cpu, "i7-7700HQ / GTX 1050");
        // ⚠️ Never asked back then — and that is not the same as "no".
        assert_eq!(r.anticheat, None);
    }

    #[test]
    fn anticheat_absent_is_none_not_false() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"app":{"steam":{"appId":"1"}},"timestamp":1648798906,"responses":{}}"#)
                .unwrap();
        assert_eq!(parse_record(&v).unwrap().1.anticheat, None);
    }

    fn mk(note: &str) -> Report {
        Report {
            timestamp: 1_648_798_906,
            gpu: String::new(),
            cpu: String::new(),
            os: String::new(),
            kernel: String::new(),
            proton: String::new(),
            variant: String::new(),
            note: note.into(),
            anticheat: None,
            installs: None,
            opens: None,
            starts_play: None,
            verdict: None,
            significant_bugs: None,
            tinkered: None,
            faults: None,
        }
    }

    /// Build a real `.tar.gz` in memory so `parse_archive` is covered WITHOUT a network
    /// round trip. The gzip and tar layers are where a silent "0 reports" comes from.
    fn tar_gz(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (name, body) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, name, body.as_bytes())
                .unwrap();
        }
        let tar = builder.into_inner().unwrap();
        let mut encoder =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut encoder, &tar).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn parse_archive_walks_gzip_and_tar() {
        let json = r#"[
          {"app":{"steam":{"appId":"400"}},"timestamp":1648798906,
           "responses":{"variant":"ge"},"systemInfo":{"gpu":"RX 9070"}},
          {"appId":"500","timestamp":1650000000,"notes":"flat one","os":"Arch"}
        ]"#;
        let archive = tar_gz(&[("reports_piiremoved.json", json)]);
        let records = parse_archive(&archive).expect("archive should parse");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].0, 400);
        assert_eq!(records[0].1.gpu, "RX 9070");
        assert_eq!(records[1].0, 500);
        assert_eq!(records[1].1.note, "flat one");
    }

    #[test]
    fn parse_archive_ignores_non_json_members() {
        // The published archives carry a README beside the data; treating it as JSON
        // would abort the whole import.
        let archive = tar_gz(&[
            ("README.md", "# not json"),
            (
                "reports_piiremoved.json",
                r#"[{"appId":"7","timestamp":1648798906,"notes":"ok"}]"#,
            ),
        ]);
        let records = parse_archive(&archive).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].0, 7);
    }

    #[test]
    fn unparseable_records_are_skipped_not_fatal() {
        // Real dumps contain junk. One bad row must not cost the other 400,000.
        let json = r#"[
          {"appId":"not-a-number","timestamp":1},
          {"appId":"12","notes":"no timestamp at all"},
          {"appId":"34","timestamp":1651000000,"notes":"fine"},
          "a bare string",
          {}
        ]"#;
        let records = parse_archive(&tar_gz(&[("r.json", json)])).unwrap();
        assert_eq!(records.len(), 1, "only the well-formed row survives");
        assert_eq!(records[0].0, 34);
    }

    #[test]
    fn implausible_appids_and_timestamps_are_rejected() {
        // ⚠️ This data is user-submitted and mirrored through a third party. A zero
        // appid is not a game; a 1970 or year-3000 stamp sorts to the top of a list
        // forever. Both are cheaper to refuse than to explain later.
        let bad = [
            r#"{"appId":"0","timestamp":1648798906}"#,
            r#"{"appId":"999999999","timestamp":1648798906}"#,
            r#"{"appId":"400","timestamp":1}"#,
            r#"{"appId":"400","timestamp":99999999999}"#,
            r#"{"appId":"400","timestamp":-5}"#,
        ];
        for raw in bad {
            let v: serde_json::Value = serde_json::from_str(raw).unwrap();
            assert!(parse_record(&v).is_none(), "should have rejected {raw}");
        }
        // ...and a plausible one still gets through.
        let ok: serde_json::Value =
            serde_json::from_str(r#"{"appId":"400","timestamp":1648798906}"#).unwrap();
        assert!(parse_record(&ok).is_some());
    }

    #[test]
    fn untrusted_text_is_sanitised_and_bounded() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"app":{"steam":{"appId":"400"}},"timestamp":1648798906,
                "responses":{"notes":{"concludingNotes":"line one\nline\ttwo\u0007bell"}},
                "systemInfo":{"gpu":"  RX   9070   XT  "}}"#,
        )
        .unwrap();
        let r = parse_record(&v).unwrap().1;
        // Control characters gone, whitespace collapsed, no smuggled layout.
        assert_eq!(r.note, "line one line two bell");
        assert_eq!(r.gpu, "RX 9070 XT");
        assert!(!r.note.chars().any(char::is_control));

        // A pasted crash log cannot dominate a game's span.
        let huge = "x".repeat(50_000);
        let v2: serde_json::Value = serde_json::from_str(&format!(
            r#"{{"appId":"400","timestamp":1648798906,"notes":"{huge}"}}"#
        ))
        .unwrap();
        let note = parse_record(&v2).unwrap().1.note;
        assert!(note.chars().count() <= MAX_NOTE + 1, "got {}", note.chars().count());
        assert!(note.ends_with('…'));
    }

    #[test]
    fn a_custom_proton_build_wins_over_the_official_field() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"app":{"steam":{"appId":"1"}},"timestamp":1648798906,
                "responses":{"protonVersion":"7.0","customProtonVersion":"GE-Proton10-4"}}"#,
        )
        .unwrap();
        assert_eq!(parse_record(&v).unwrap().1.proton, "GE-Proton10-4");
    }

    #[test]
    fn the_note_falls_back_to_the_verdict_text() {
        // `concludingNotes` is the richer field but is often absent; without the
        // fallback most reports would render as a blank line.
        let v: serde_json::Value = serde_json::from_str(
            r#"{"app":{"steam":{"appId":"1"}},"timestamp":1648798906,
                "responses":{"notes":{"verdict":"stops at intro"}}}"#,
        )
        .unwrap();
        assert_eq!(parse_record(&v).unwrap().1.note, "stops at intro");
    }

    #[test]
    fn one_games_rows_never_include_a_neighbours() {
        // Kept from the blob era, where an off-by-one in a span returned the ADJACENT
        // game's reports — valid-looking and wrong. Cheap regression guard.
        let dir = std::env::temp_dir().join(format!("pdb-iso-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        build_index(
            vec![(1, mk("a")), (2, mk(&"b".repeat(500))), (2, mk("bb")), (3, mk("c"))],
            &dir,
            "snap",
        )
        .unwrap();
        assert_eq!(notes(&dir, 1), vec!["a"]);
        assert_eq!(reports_for(&dir, 2).len(), 2);
        assert_eq!(notes(&dir, 3), vec!["c"]);
        let _ = fs::remove_dir_all(&dir);
    }

    fn notes(dir: &std::path::Path, appid: u32) -> Vec<String> {
        reports_for(dir, appid).into_iter().map(|r| r.note).collect()
    }

    #[test]
    fn a_failed_rebuild_leaves_the_previous_snapshot_intact() {
        /*
         * ⚠️ The case the blob format needed hand-written protection for: a rebuild
         * that died partway left an index describing bytes that had already been
         * replaced, and lookups then returned a DIFFERENT game's reports. One
         * transaction around the import means the only observable states are now "old
         * snapshot" and "new snapshot".
         */
        let dir = std::env::temp_dir().join(format!("pdb-tx-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        build_index(vec![(1, mk("first"))], &dir, "snap-a").unwrap();
        assert_eq!(reports_for(&dir, 1).len(), 1);

        // A rebuild that fails midway: open a transaction, clear, then drop it
        // uncommitted — exactly what a crash does.
        {
            let mut conn = open_db(&dir).unwrap();
            let tx = conn.transaction().unwrap();
            tx.execute("DELETE FROM reports", []).unwrap();
        }

        assert_eq!(
            reports_for(&dir, 1).len(),
            1,
            "the previous snapshot must survive a failed rebuild"
        );
        assert_eq!(stored_snapshot(&dir).as_deref(), Some("snap-a"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn index_status_tells_no_data_apart_from_no_reports() {
        // The UI needs these to be different sentences: one is about the game, the
        // other is about us.
        let dir = std::env::temp_dir().join(format!("pdb-status-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(index_status(&dir)["ready"], serde_json::json!(false));

        build_index(vec![], &dir, "reports_aug4_2026.tar.gz").unwrap();
        let status = index_status(&dir);
        assert_eq!(status["ready"], serde_json::json!(true));
        assert_eq!(status["snapshot"], "reports_aug4_2026.tar.gz");
        assert_eq!(status["games"], serde_json::json!(0));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_snapshot_name_becomes_a_date_a_person_can_read() {
        assert_eq!(
            snapshot_date("reports_aug4_2026.tar.gz").as_deref(),
            Some("2026-08-04")
        );
        assert_eq!(snapshot_date("README.md"), None);
    }

    #[test]
    fn snapshot_rank_rejects_things_that_are_not_snapshots() {
        assert!(snapshot_rank("README.md").is_none());
        assert!(snapshot_rank("reports_smurf1_2026.tar.gz").is_none());
        assert!(newest_snapshot(["README.md", "notes.txt"]).is_none());
        // Same month, different day still orders.
        assert!(snapshot_rank("reports_aug4_2026.tar.gz") > snapshot_rank("reports_aug1_2026.tar.gz"));
    }

    #[test]
    fn round_trips_and_returns_newest_first() {
        let dir = std::env::temp_dir().join(format!("pdb-rt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let at = |ts: i64, note: &str| {
            let mut r = mk(note);
            r.timestamp = ts;
            r
        };
        build_index(
            vec![
                (10, at(1_600_000_000, "old")),
                (20, at(1_600_000_000, "other")),
                (10, at(1_700_000_000, "new")),
            ],
            &dir,
            "snap",
        )
        .unwrap();

        let ten = reports_for(&dir, 10);
        assert_eq!(ten.len(), 2);
        assert_eq!(ten[0].note, "new", "newest first");
        assert_eq!(reports_for(&dir, 20).len(), 1);
        // An unrated game is empty, not an error.
        assert!(reports_for(&dir, 999).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// End-to-end against a REAL archive from the repo.
    ///
    /// Ignored by default — it downloads. Run with:
    ///   cargo test --lib -- --ignored indexes_a_real_snapshot --nocapture
    #[test]
    #[ignore]
    fn indexes_a_real_snapshot() {
        // The 2018 archive is the smallest at 1.9 MB and exercises the FLAT schema,
        // which is the half most likely to be quietly dropped.
        let url = format!("https://github.com/{REPO}/raw/master/reports/reports_dec1_2018.tar.gz");
        let bytes = std::process::Command::new("curl")
            .args(["-sL", &url])
            .output()
            .expect("curl")
            .stdout;
        assert!(bytes.len() > 1_000_000, "download looks truncated");

        let records = parse_archive(&bytes).expect("archive should parse");
        assert!(
            records.len() > 20_000,
            "expected ~23k reports, got {}",
            records.len()
        );

        let dir = std::env::temp_dir().join("pdb-live-test");
        let _ = fs::remove_dir_all(&dir);
        let inserted = build_index(records, &dir, "reports_dec1_2018.tar.gz").unwrap();
        let status = index_status(&dir);
        println!("indexed {} reports over {} games", inserted, status["games"]);

        // A well-reported 2018 game must come back with real fields.
        let conn = open_db(&dir).unwrap();
        let appid: u32 = conn
            .query_row(
                "SELECT appid FROM reports GROUP BY appid ORDER BY COUNT(*) DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let reports = reports_for(&dir, appid);
        println!("busiest appid {appid} -> {} reports", reports.len());
        assert!(!reports.is_empty());
        assert!(reports[0].timestamp > 0);
        // Newest first.
        assert!(reports.windows(2).all(|w| w[0].timestamp >= w[1].timestamp));
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod check_tests {
    use super::*;

    /// Hits GitHub. `cargo test --lib -- --ignored checks_github_for_the_newest`
    #[test]
    #[ignore]
    fn checks_github_for_the_newest() {
        let out = std::process::Command::new("curl")
            .args([
                "-sL",
                &format!("https://api.github.com/repos/{REPO}/contents/reports"),
            ])
            .output()
            .expect("curl");
        let listing: Vec<serde_json::Value> = serde_json::from_slice(&out.stdout).unwrap();
        let names: Vec<String> = listing
            .iter()
            .filter_map(|e| e.get("name")?.as_str().map(str::to_string))
            .collect();
        let newest = newest_snapshot(names.iter().map(String::as_str)).expect("a snapshot");
        println!("newest = {newest} ({})", snapshot_date(&newest).unwrap_or_default());
        // Sanity: the repo is live, so the newest must be recent-ish, not 2018.
        let (year, _, _) = snapshot_rank(&newest).unwrap();
        assert!(year >= 2026, "newest snapshot looks stale: {newest}");
    }
}

#[cfg(test)]
mod cost_tests {
    use super::*;

    /// How expensive is ONE lookup against a real 31,587-game index?
    ///
    /// `cargo test --release --lib -- --ignored lookup_cost --nocapture`
    /// Requires an index built into /tmp/pdb-real by the protondb-index binary.
    #[test]
    #[ignore]
    fn lookup_cost() {
        let dir = std::path::PathBuf::from("/tmp/pdb-real");
        if !dir.join("protondb.sqlite3").exists() {
            eprintln!("no index at {dir:?}; skipping");
            return;
        }
        let started = std::time::Instant::now();
        let status = index_status(&dir);
        println!("index_status: {:?} -> {} games", started.elapsed(), status["games"]);

        let started = std::time::Instant::now();
        for _ in 0..20 {
            let _ = reports_for(&dir, 2358720);
        }
        println!("reports_for x20: {:?}", started.elapsed());
        println!("  -> per lookup: {:?}", started.elapsed() / 20);
    }
}
