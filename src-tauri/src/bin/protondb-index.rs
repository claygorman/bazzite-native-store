//! Build the ProtonDB report index from a snapshot archive, outside the desktop app.
//!
//! ⚠️ This exists so there is exactly ONE implementation of the parsing, sanitising and
//! indexing rules. The demo server needs the same index the desktop app does, and the
//! obvious answer — reimplement it in Node beside the server — would put the validation
//! in two places and let them drift. `protondb.rs` never depended on Tauri, so it can
//! simply be run here instead.
//!
//! There is also a hard reason not to do it in Node: the current snapshot expands to
//! **491 MB of JSON**, and V8 caps a single string at 512 MB. `JSON.parse` on the whole
//! file is already within 4% of throwing `RangeError: Invalid string length`, and the
//! archives have grown ~28% year on year. Streaming around that needs a third-party
//! parser; serde reads it directly.
//!
//! Usage:
//!   protondb-index <out-dir> [archive.tar.gz]
//!
//! With no archive it downloads the newest snapshot itself. The server then serves the
//! two files this writes; it never parses the dump.

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let Some(out) = args.next().map(PathBuf::from) else {
        eprintln!("usage: protondb-index <out-dir> [archive.tar.gz]");
        std::process::exit(2);
    };

    let (bytes, name) = match args.next() {
        Some(path) => {
            let name = PathBuf::from(&path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "local.tar.gz".into());
            (std::fs::read(&path)?, name)
        }
        None => {
            // Reuse the app's own refresh path so the download, the snapshot choice and
            // the "already have it" check behave identically in both places.
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            let status = runtime.block_on(bazzite_store_lib::protondb::refresh(
                out.clone(),
                600_000,
            ))?;
            println!("{status}");
            return Ok(());
        }
    };

    let started = std::time::Instant::now();
    let records = bazzite_store_lib::protondb::parse_archive(&bytes)?;
    let parsed = started.elapsed();
    let index = bazzite_store_lib::protondb::build_index(records, &out, &name)?;

    println!(
        "{}",
        serde_json::json!({
            "snapshot": name,
            "games": index.spans.len(),
            "blobBytes": index.blob_len,
            "parseSeconds": parsed.as_secs_f64().round(),
            "totalSeconds": started.elapsed().as_secs_f64().round(),
        })
    );
    Ok(())
}
