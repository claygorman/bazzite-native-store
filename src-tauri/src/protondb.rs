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

    Some((appid, report))
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
    fs::write(blob_path(dir), &blob)?;
    let index = Index {
        snapshot: snapshot.to_string(),
        spans,
    };
    fs::write(
        index_path(dir),
        serde_json::to_vec(&index).unwrap_or_else(|_| b"{}".to_vec()),
    )?;
    Ok(index)
}

/// One game's reports, by seeking rather than reading the blob.
pub fn reports_for(dir: &Path, appid: u32) -> Vec<Report> {
    let Ok(raw) = fs::read(index_path(dir)) else {
        return Vec::new();
    };
    let Ok(index) = serde_json::from_slice::<Index>(&raw) else {
        return Vec::new();
    };
    let Some(span) = index.spans.get(&appid) else {
        return Vec::new();
    };
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

/// Expand a downloaded `.tar.gz` and parse every record inside it.
pub fn parse_archive(bytes: &[u8]) -> std::io::Result<Vec<(u32, Report)>> {
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    let mut out = Vec::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        if !entry.path()?.to_string_lossy().ends_with(".json") {
            continue;
        }
        let mut raw = String::new();
        entry.read_to_string(&mut raw)?;
        let Ok(values) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) else {
            continue;
        };
        out.extend(values.iter().filter_map(parse_record));
    }
    Ok(out)
}

/* ─────────────────────────── refresh ─────────────────────────── */

const REPO: &str = "bdefore/protondb-data";

/// What the UI needs to tell "no reports" apart from "no data yet".
pub fn index_status(dir: &Path) -> serde_json::Value {
    match fs::read(index_path(dir))
        .ok()
        .and_then(|raw| serde_json::from_slice::<Index>(&raw).ok())
    {
        Some(index) => serde_json::json!({
            "ready": true,
            "snapshot": index.snapshot,
            "games": index.spans.len(),
        }),
        None => serde_json::json!({ "ready": false, "snapshot": null, "games": 0 }),
    }
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
    if let Some(current) = fs::read(index_path(&dir))
        .ok()
        .and_then(|raw| serde_json::from_slice::<Index>(&raw).ok())
    {
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
            serde_json::from_str(r#"{"app":{"steam":{"appId":"1"}},"timestamp":1,"responses":{}}"#)
                .unwrap();
        assert_eq!(parse_record(&v).unwrap().1.anticheat, None);
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
