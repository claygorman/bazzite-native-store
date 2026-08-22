#!/usr/bin/env node
/**
 * Push one version into the two files `@semantic-release/npm` cannot reach.
 *
 * ⚠️ A Tauri app declares its version three times — `package.json` (which the UI
 * reports via `__APP_VERSION__`), `src-tauri/tauri.conf.json` (which the bundler
 * stamps into the AppImage filename) and `src-tauri/Cargo.toml` (which the updater
 * compares against the feed). If they drift, the failure is quiet and specific: a
 * freshly installed build offers itself as an update, forever.
 *
 * Called from `release.config.js` in the `prepare` step, so the edits land in the
 * release commit rather than after it.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`sync-version: expected a semver argument, got ${JSON.stringify(version)}`)
  process.exit(1)
}

/** tauri.conf.json — rewritten through JSON so formatting stays canonical. */
const confPath = 'src-tauri/tauri.conf.json'
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
conf.version = version
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`)

/**
 * Cargo.toml — a targeted line edit, NOT a TOML round-trip.
 *
 * ⚠️ Anchored to the `[package]` table and the FIRST `version =` inside it. A blind
 * replace would also rewrite every dependency's version pin, and `cargo check` would
 * be the first thing to notice — after the release commit had already been made.
 */
const cargoPath = 'src-tauri/Cargo.toml'
const cargo = readFileSync(cargoPath, 'utf8')
let seenPackage = false
let replaced = false
const next = cargo
  .split('\n')
  .map((line) => {
    if (line.trim().startsWith('[')) seenPackage = line.trim() === '[package]'
    if (seenPackage && !replaced && /^version\s*=/.test(line)) {
      replaced = true
      return `version = "${version}"`
    }
    return line
  })
  .join('\n')

if (!replaced) {
  console.error(`sync-version: no version key found under [package] in ${cargoPath}`)
  process.exit(1)
}
writeFileSync(cargoPath, next)

console.log(`sync-version: ${version} -> package.json, ${confPath}, ${cargoPath}`)
