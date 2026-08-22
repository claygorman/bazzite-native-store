#!/usr/bin/env node
/**
 * Merge every platform's fragment into the one `latest.json` the updater fetches.
 *
 * Each build runner writes `latest-<target>.json` (see `write-latest-json.mjs`); this
 * runs once, after all of them, and folds them into Tauri's manifest shape:
 *
 * ```json
 * { "version": "0.2.0", "notes": "…", "pub_date": "…",
 *   "platforms": {
 *     "linux-x86_64":   { "signature": "…", "url": "…" },
 *     "darwin-aarch64": { "signature": "…", "url": "…" }
 *   } }
 * ```
 *
 * ⚠️ Platform keys are `{os}-{arch}` — `linux-x86_64`, `darwin-aarch64`,
 * `darwin-x86_64`, `windows-x86_64`. The updater tries `{os}-{arch}-{installer}` first
 * and falls back to the bare form, so these cover both.
 *
 * Usage: merge-latest-json.mjs <version> <fragments-dir>
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [version, dir = '.'] = process.argv.slice(2)
if (!version) {
  console.error('usage: merge-latest-json.mjs <version> [fragments-dir]')
  process.exit(1)
}

const repo = process.env.GITHUB_REPOSITORY ?? 'claygorman/bazzite-native-store'

/** Fragments arrive as one directory per artifact when downloaded together. */
const findFragments = (root) => {
  const out = []
  for (const entry of readdirSync(root)) {
    const p = join(root, entry)
    if (statSync(p).isDirectory()) out.push(...findFragments(p))
    else if (/^latest-.+\.json$/.test(entry)) out.push(p)
  }
  return out
}

const fragments = findFragments(dir)
if (fragments.length === 0) {
  console.error(`merge-latest-json: no latest-*.json fragments under ${dir}`)
  process.exit(1)
}

const platforms = {}
for (const f of fragments) {
  Object.assign(platforms, JSON.parse(readFileSync(f, 'utf8')))
}

/*
 * ⚠️ Linux is the shipping target, so its absence is a failed release rather than a
 * partial one. macOS and Windows are built with `fail-fast: false` and may legitimately
 * be missing — a manifest without them simply offers those clients no update, which is
 * correct. A manifest without Linux would silently stop updating the boxes this exists
 * for.
 */
if (!platforms['linux-x86_64']) {
  console.error(
    `merge-latest-json: no linux-x86_64 fragment — got ${Object.keys(platforms).join(', ') || 'nothing'}`,
  )
  process.exit(1)
}

writeFileSync(
  'latest.json',
  `${JSON.stringify(
    {
      version,
      notes: `See https://github.com/${repo}/releases/tag/${version}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
)
console.log(`merge-latest-json: ${version} covers ${Object.keys(platforms).join(', ')}`)
