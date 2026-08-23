#!/usr/bin/env node
/**
 * Emit ONE platform's fragment of the update manifest.
 *
 * `latest.json` is the update feed: `plugins.updater.endpoints` points at
 * `releases/latest/download/latest.json`, which GitHub always resolves to the newest
 * release — so publishing a release publishes the update.
 *
 * ⚠️ It is written in two passes because the platforms are built on different runners
 * and none of them can see the others' signatures. Each build job writes a fragment
 * (this script); a final job merges them (`merge-latest-json.mjs`). A manifest written
 * by one runner would silently omit every other platform, and the symptom on those is
 * `TargetsNotFound` — which reads like a network error.
 *
 * Usage: write-latest-json.mjs <version> <target> <bundle-dir> <archive-glob-suffix>
 *   e.g.  0.2.0 darwin-aarch64 src-tauri/target/release/bundle/macos .app.tar.gz
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [version, target, bundleDir, suffix] = process.argv.slice(2)
if (!version || !target || !bundleDir || !suffix) {
  console.error('usage: write-latest-json.mjs <version> <target> <bundle-dir> <archive-suffix>')
  process.exit(1)
}

const repo = process.env.GITHUB_REPOSITORY ?? 'claygorman/bazzite-native-store'

let files
try {
  files = readdirSync(bundleDir)
} catch {
  console.error(`write-latest-json: no such directory ${bundleDir}`)
  process.exit(1)
}

const archive = files.find((f) => f.endsWith(suffix))
const sig = files.find((f) => f.endsWith(`${suffix}.sig`))

if (!archive) {
  console.error(
    `write-latest-json: nothing ending in ${suffix} under ${bundleDir}\nfound: ${files.join(', ')}`,
  )
  process.exit(1)
}
if (!sig) {
  /*
   * ⚠️ Fail loudly rather than emit an unsigned fragment. Without the signing secrets
   * the bundler still produces the archive, and a manifest carrying an empty signature
   * is rejected by every client as "no update available" — a silent failure that looks
   * exactly like having nothing to release. Verified locally: a build with no
   * TAURI_SIGNING_PRIVATE_KEY produces the .tar.gz and no .sig beside it.
   */
  console.error(
    `write-latest-json: no .sig beside ${archive}.\n` +
      'The signing key is missing — set TAURI_SIGNING_PRIVATE_KEY and\n' +
      'TAURI_SIGNING_PRIVATE_KEY_PASSWORD as repository secrets.',
  )
  process.exit(1)
}

/*
 * ⚠️ `target` may be a COMMA-SEPARATED LIST, and macOS is why.
 *
 * There is no free Intel macOS runner left — GitHub retired `macos-13` and every
 * current image is Apple silicon — so the mac job builds
 * `--target universal-apple-darwin`, one archive containing both slices. The updater
 * still looks itself up by `darwin-aarch64` or `darwin-x86_64`, so that single archive
 * has to be registered under both keys, with the same url and the same signature.
 */
const entry = {
  // ⚠️ The CONTENTS of the .sig file, not a path or a URL. A path here fails
  // signature verification on the client with no useful message.
  signature: readFileSync(join(bundleDir, sig), 'utf8').trim(),
  url: `https://github.com/${repo}/releases/download/${version}/${encodeURIComponent(archive)}`,
}

const keys = target
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
const fragment = Object.fromEntries(keys.map((k) => [k, entry]))

// A comma is legal in a filename but miserable in a glob and an artifact name, so the
// fragment is named after the FIRST key rather than the raw list.
const out = `latest-${keys[0]}.json`
writeFileSync(out, `${JSON.stringify(fragment, null, 2)}\n`)
console.log(`write-latest-json: ${keys.join(' + ')} -> ${archive}`)
