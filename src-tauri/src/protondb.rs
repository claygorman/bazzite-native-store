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

/* ─────────────────────────── index ─────────────────────────── */

/// Where one game's reports live inside `reports.jsonl`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Span {
    pub offset: u64,
    pub len: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Index {
    /// Which snapshot this was built from, so a newer one can supersede it.
    pub snapshot: String,
    /// ⚠️ The size of the blob these spans were computed against. This is the guard
    /// against a TORN WRITE: if the process dies, the disk fills, or the machine loses
    /// power between writing the blob and writing the index, the two disagree and every
    /// span points into the wrong bytes — reads then return a different game's reports,
    /// which look perfectly valid. Cheap to check, and it turns silent corruption into
    /// an honest "not ready".
    #[serde(default)]
    pub blob_len: u64,
    pub spans: BTreeMap<u32, Span>,
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("protondb-index.json")
}
fn blob_path(dir: &Path) -> PathBuf {
    dir.join("protondb-reports.jsonl")
}

/// Group parsed records by appid and write the blob plus its index.
///
/// ⚠️ Sorted by appid and written contiguously ON PURPOSE — that is what makes a lookup
/// one seek and one read instead of a scan. A `BTreeMap` rather than a `HashMap` for the
/// same reason: iteration order IS the file order.
pub fn build_index(
    records: impl IntoIterator<Item = (u32, Report)>,
    dir: &Path,
    snapshot: &str,
) -> std::io::Result<Index> {
    let mut grouped: BTreeMap<u32, Vec<Report>> = BTreeMap::new();
    for (appid, report) in records {
        grouped.entry(appid).or_default().push(report);
    }

    let mut blob = Vec::<u8>::new();
    let mut spans = BTreeMap::new();
    for (appid, mut reports) in grouped {
        // Newest first — the UI shows recent reports and never asks for the tail.
        reports.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        reports.truncate(MAX_REPORTS_PER_GAME);
        let offset = blob.len() as u64;
        let line = serde_json::to_vec(&reports).unwrap_or_else(|_| b"[]".to_vec());
        blob.extend_from_slice(&line);
        blob.push(b'\n');
        spans.insert(
            appid,
            Span {
                offset,
                len: line.len() as u64,
            },
        );
    }

    fs::create_dir_all(dir)?;
    let index = Index {
        snapshot: snapshot.to_string(),
        blob_len: blob.len() as u64,
        spans,
    };

    /*
     * ⚠️ Write to temporaries and RENAME, and rename the index LAST.
     *
     * `fs::write` truncates its target before it writes. Writing the blob in place
     * means that from the moment it is opened until the moment it finishes, the
     * existing index describes a file that no longer holds those bytes — and a crash
     * anywhere in that window leaves a permanently corrupt pair on disk that still
     * looks complete. A rename is atomic on every platform this ships to, so the
     * observable states are only "old pair" and "new pair".
     *
     * The index goes last because it is the POINTER. A new blob with an old index is
     * caught by the `blob_len` check on read; the reverse would not be.
     */
    let blob_tmp = dir.join("protondb-reports.jsonl.tmp");
    let index_tmp = dir.join("protondb-index.json.tmp");
    fs::write(&blob_tmp, &blob)?;
    fs::write(
        &index_tmp,
        serde_json::to_vec(&index).unwrap_or_else(|_| b"{}".to_vec()),
    )?;
    fs::rename(&blob_tmp, blob_path(dir))?;
    fs::rename(&index_tmp, index_path(dir))?;
    Ok(index)
}

/// Read the index only if it actually describes the blob sitting next to it.
fn load_index(dir: &Path) -> Option<Index> {
    let index: Index = serde_json::from_slice(&fs::read(index_path(dir)).ok()?).ok()?;
    let actual = fs::metadata(blob_path(dir)).ok()?.len();
    // A zero means an index written before this check existed — accept it rather than
    // forcing a redownload, since the spans are still self-consistent.
    if index.blob_len != 0 && index.blob_len != actual {
        return None;
    }
    Some(index)
}

/// One game's reports, by seeking rather than reading the blob.
pub fn reports_for(dir: &Path, appid: u32) -> Vec<Report> {
    let Some(index) = load_index(dir) else {
        return Vec::new();
    };
    let Some(span) = index.spans.get(&appid) else {
        return Vec::new();
    };
    // Belt and braces: a span must lie inside the blob even if the length matched.
    if span.offset.saturating_add(span.len) > index.blob_len && index.blob_len != 0 {
        return Vec::new();
    }
    let Ok(mut file) = fs::File::open(blob_path(dir)) else {
        return Vec::new();
    };
    if file.seek(SeekFrom::Start(span.offset)).is_err() {
        return Vec::new();
    }
    let mut buf = vec![0u8; span.len as usize];
    if file.read_exact(&mut buf).is_err() {
        return Vec::new();
    }
    serde_json::from_slice(&buf).unwrap_or_default()
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
    // ⚠️ Through `load_index`, which validates the blob — NOT a bare read. Reporting
    // "ready" off a mismatched pair is how a torn write becomes silent wrong data.
    match load_index(dir) {
        Some(index) => serde_json::json!({
            "ready": true,
            "snapshot": index.snapshot,
            "publishedOn": snapshot_date(&index.snapshot),
            "games": index.spans.len(),
        }),
        None => serde_json::json!({ "ready": false, "snapshot": null, "games": 0 }),
    }
}

/// Ask GitHub what the newest snapshot is, without downloading it.
///
/// ⚠️ Deliberately separate from `refresh` so the UI can offer "there is a newer dump,
/// 66 MB, fetch it?" instead of spending someone's bandwidth to find out. One small
/// JSON listing; the archives themselves are untouched.
pub async fn check(dir: PathBuf, timeout_ms: u64) -> Result<serde_json::Value, String> {
    let installed = load_index(&dir).map(|i| i.snapshot);
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
    if let Some(current) = load_index(&dir) {
        if current.snapshot == newest {
            return Ok(serde_json::json!({
                "ready": true, "snapshot": newest,
                "games": current.spans.len(), "downloaded": false
            }));
        }
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
    let index = build_index(records, &dir, &newest).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "ready": true, "snapshot": newest,
        "games": index.spans.len(), "downloaded": true
    }))
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
    fn spans_do_not_bleed_into_the_neighbouring_game() {
        // ⚠️ The failure this guards is nasty and quiet: an off-by-one in the offset or
        // length returns a NEIGHBOUR's reports, which look perfectly valid and are
        // simply the wrong game's. Deliberately uneven sizes so a wrong span cannot
        // coincidentally produce the right answer.
        let dir = std::env::temp_dir().join(format!("pdb-span-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mk = |note: &str| Report {
            timestamp: 1,
            gpu: String::new(),
            cpu: String::new(),
            os: String::new(),
            kernel: String::new(),
            proton: String::new(),
            variant: String::new(),
            note: note.into(),
            anticheat: None,
        };
        build_index(
            vec![
                (1, mk("a")),
                (2, mk(&"b".repeat(500))),
                (2, mk("bb")),
                (3, mk("c")),
            ],
            &dir,
            "snap",
        )
        .unwrap();

        assert_eq!(
            reports_for(&dir, 1).iter().map(|r| r.note.clone()).collect::<Vec<_>>(),
            vec!["a"]
        );
        assert_eq!(reports_for(&dir, 2).len(), 2);
        assert_eq!(
            reports_for(&dir, 3).iter().map(|r| r.note.clone()).collect::<Vec<_>>(),
            vec!["c"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_torn_write_reads_as_not_ready_rather_than_wrong_data() {
        // ⚠️ The scenario: the blob is replaced but the index is not (crash, full disk,
        // power cut). Every span then points into the wrong bytes and the reports that
        // come back look completely valid — they are just a different game's. The
        // blob_len check has to turn that into an honest "no data".
        let dir = std::env::temp_dir().join(format!("pdb-torn-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mk = |note: &str| Report {
            timestamp: 1648798906,
            gpu: String::new(),
            cpu: String::new(),
            os: String::new(),
            kernel: String::new(),
            proton: String::new(),
            variant: String::new(),
            note: note.into(),
            anticheat: None,
        };
        build_index(vec![(1, mk("real"))], &dir, "snap").unwrap();
        assert_eq!(reports_for(&dir, 1).len(), 1, "sanity: reads before tearing");

        // Simulate the blob being rewritten without its index.
        fs::write(blob_path(&dir), b"a completely different and shorter blob").unwrap();

        assert!(
            reports_for(&dir, 1).is_empty(),
            "must refuse to read against a mismatched blob"
        );
        assert_eq!(
            index_status(&dir)["ready"],
            serde_json::json!(false),
            "and must report itself as not ready so the UI can offer a rebuild"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_index_leaves_no_temporaries_behind() {
        let dir = std::env::temp_dir().join(format!("pdb-tmp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        build_index(vec![], &dir, "snap").unwrap();
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "stray temp files: {leftovers:?}");
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
    fn index_round_trips_and_seeks_the_right_game() {
        let dir = std::env::temp_dir().join(format!("pdb-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mk = |ts: i64, gpu: &str| Report {
            timestamp: ts,
            gpu: gpu.into(),
            cpu: String::new(),
            os: String::new(),
            kernel: String::new(),
            proton: String::new(),
            variant: String::new(),
            note: String::new(),
            anticheat: None,
        };
        build_index(
            vec![
                (10, mk(100, "old")),
                (20, mk(200, "other")),
                (10, mk(300, "new")),
            ],
            &dir,
            "reports_aug4_2026.tar.gz",
        )
        .unwrap();

        let ten = reports_for(&dir, 10);
        assert_eq!(ten.len(), 2);
        // Newest first.
        assert_eq!(ten[0].gpu, "new");
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
        let index = build_index(records, &dir, "reports_dec1_2018.tar.gz").unwrap();
        println!("indexed {} games", index.spans.len());

        // A well-reported 2018 game must come back with real fields.
        let (appid, span) = index.spans.iter().max_by_key(|(_, s)| s.len).unwrap();
        let reports = reports_for(&dir, *appid);
        println!(
            "busiest appid {appid} -> {} reports ({} bytes)",
            reports.len(),
            span.len
        );
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
