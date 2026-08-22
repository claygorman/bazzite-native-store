#!/usr/bin/env node
/**
 * Emit the update manifest Tauri's updater fetches.
 *
 * This file IS the update feed. `plugins.updater.endpoints` in tauri.conf.json points
 * at `releases/latest/download/latest.json`, which GitHub always resolves to the newest
 * release's copy — so publishing a release publishes the update.
 *
 * The shape is Tauri's, verified against `RemoteRelease` in tauri-plugin-updater:
 *
 * ```json
 * { "version": "0.2.0", "notes": "…", "pub_date": "…",
 *   "platforms": { "linux-x86_64": { "signature": "…", "url": "https://…" } } }
 * ```
 *
 * ⚠️ The platform key is `{os}-{arch}` — `linux-x86_64`. The updater tries
 * `linux-x86_64-appimage` first and falls back to this, so the bare form covers both.
 * Get it wrong and `check()` fails with `TargetsNotFound`, which reads like a network
 * problem.
 *
 * ⚠️ `signature` is the **contents** of the `.sig` file, not a path or a URL. A path
 * here fails signature verification on the client with no useful message.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const version = process.argv[2]
if (!version) {
  console.error('write-latest-json: expected a version argument')
  process.exit(1)
}

const repo = process.env.GITHUB_REPOSITORY ?? 'claygorman/bazzite-native-store'
const bundleDir = 'src-tauri/target/release/bundle/appimage'

const files = readdirSync(bundleDir)
const archive = files.find((f) => f.endsWith('.AppImage.tar.gz'))
const sig = files.find((f) => f.endsWith('.AppImage.tar.gz.sig'))

if (!archive) {
  console.error(`write-latest-json: no .AppImage.tar.gz in ${bundleDir}\nfound: ${files.join(', ')}`)
  process.exit(1)
}
if (!sig) {
  /*
   * ⚠️ Fail loudly rather than emitting an unsigned manifest. Without the signing
   * secrets the bundler still produces an AppImage, and a manifest with an empty
   * signature would be rejected by every client as "no update available" — a silent
   * failure that looks exactly like having nothing to release.
   */
  console.error(
    `write-latest-json: no .sig beside ${archive}.\n` +
      'The signing key is missing — set TAURI_SIGNING_PRIVATE_KEY and\n' +
      'TAURI_SIGNING_PRIVATE_KEY_PASSWORD as repository secrets.',
  )
  process.exit(1)
}

const manifest = {
  version,
  notes: `See https://github.com/${repo}/releases/tag/${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'linux-x86_64': {
      signature: readFileSync(join(bundleDir, sig), 'utf8').trim(),
      url: `https://github.com/${repo}/releases/download/${version}/${archive}`,
    },
  },
}

writeFileSync('latest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`write-latest-json: ${version} -> ${archive}`)
