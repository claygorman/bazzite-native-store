import { isTauri } from './index'

/**
 * The per-app index: write-through (phase 1) and read-through (phase 2).
 *
 * ⭐ **Why, when `steam.rs` already caches HTTP.** That cache keys on a hash of the whole
 * REQUEST. `GetItems` takes a batch of ids, so `ids:[730,570]` and `ids:[730]` are separate
 * entries holding overlapping data — a game on the home shelf, then in a search, then on
 * its own details page is three fetches and three stored copies. Keying on the appid is the
 * only shape that dedupes across requests, and a URL cache structurally cannot.
 *
 * Write-through landed first and read-through second, as separate changes, because a bug in
 * either presents identically — "the shelf shows a stale price" gives you no way to tell a
 * bad write from a bad read if both arrived together. Phase 1 was watched filling on the box
 * (54 -> 203 rows in one session) before `getApps` was written.
 *
 * ⚠️ **`putApps` stays fire-and-forget even now.** A write is still pure bookkeeping, so a
 * failure must cost nothing; `getApps` is the one that a render path awaits, and it degrades
 * to a plain fetch rather than throwing.
 *
 * ⚠️ **A miss means "ask upstream", never "there is nothing".** An appid absent from
 * `getApps` may be uncached, stale, or unparseable, and the only correct response to all
 * three is to fetch it. A cache that answers "no" confidently is worse than no cache.
 */

export type AppsSource = 'getitems' | 'appdetails' | 'reviews'

/**
 * One app's facts.
 *
 * ⚠️ Every scalar is optional and `undefined` means "this source did not say" — never a
 * default. The Rust side COALESCEs, so a source that is silent about a field leaves the
 * previous writer's value alone; sending `0` or `''` instead of omitting would overwrite
 * something true with something invented.
 */
export type AppsRecord = {
  appid: number
  name?: string
  type?: string
  header_url?: string
  is_free?: boolean
  review_pct?: number
  deck_compat?: string
  /** This source's own payload for this app, verbatim, as JSON text. */
  blob?: string
}

/**
 * Record a batch. Resolves to the number of rows written, or `undefined` off Tauri.
 *
 * ⚠️ Never throws. A caller that does not await cannot catch, so an unhandled rejection
 * here would surface as a console error on a television with nobody to read it.
 */
export const putApps = async (
  source: AppsSource,
  records: readonly AppsRecord[],
): Promise<number | undefined> => {
  if (!isTauri() || records.length === 0) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<number>('apps_put', { source, records })
  } catch {
    // Bookkeeping. A failure here is invisible by design — see the header.
    return undefined
  }
}

/**
 * How long a stored `getitems` blob may be used for.
 *
 * ⚠️ **The same number the HTTP layer passes for this call** (`steam.ts`, `ttlSeconds`), and
 * exported so the two cannot drift. Two caches over one endpoint with different opinions
 * about freshness is a bug that presents as "it went stale sometimes".
 *
 * Prices ride inside these payloads and are therefore up to six hours old. Accepted, and
 * recorded: checkout happens in Steam, which always quotes live — the shelf is advertising,
 * not a quote.
 */
export const STORE_FACTS_TTL_SECONDS = 21_600

/**
 * How much of the asking this index has actually answered, since launch.
 *
 * ⚠️ **Counters, not a log, and it exists for one reason: a working read-through and a
 * broken one look identical on screen.** The shelf renders either way — that is the whole
 * design, since a miss just fetches. So "the store looks right" is NOT evidence the read
 * path runs, and this session already learned what believing that costs. `served` moving
 * is the evidence.
 *
 * ⚠️ Two counts, never appids: this reaches `/state`, and what someone has been browsing is
 * not something to put on a debug endpoint.
 */
const hitRate = { asked: 0, served: 0 }

/** `{asked, served}` since launch — see `hitRate`. */
export const appsHitRate = (): { asked: number; served: number } => ({ ...hitRate })

/**
 * Read back what a source already knows about these appids, if it is still fresh.
 *
 * ⭐ Phase 2 — the half that removes requests. Returns only present-AND-fresh rows; see the
 * header for why an absence must always be read as "ask upstream".
 *
 * ⚠️ Never throws, and never returns a partial lie. Any failure — off Tauri, IPC error, a
 * blob that will not parse — yields no entry for that appid, so the caller fetches it. The
 * degraded path is always "do what we did before this existed".
 */
export const getApps = async <T>(
  source: AppsSource,
  appids: readonly number[],
  maxAgeSeconds: number,
): Promise<Map<number, T>> => {
  const out = new Map<number, T>()
  if (!isTauri() || appids.length === 0 || maxAgeSeconds <= 0) return out
  hitRate.asked += new Set(appids).size
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const blobs = await invoke<Record<string, string>>('apps_get', {
      source,
      appids: [...new Set(appids)],
      maxAgeSecs: maxAgeSeconds,
    })
    for (const [appid, blob] of Object.entries(blobs ?? {})) {
      const id = Number(appid)
      if (!Number.isInteger(id) || id <= 0) continue
      try {
        out.set(id, JSON.parse(blob) as T)
        hitRate.served += 1
      } catch {
        // ⚠️ A blob written by an older shape may not parse into what this build expects.
        // Dropping it is a MISS, which is already a state every caller handles, so a schema
        // change degrades to "fetch it again" instead of to a crash on the home screen.
      }
    }
  } catch {
    // Fall back to fetching everything — see the header.
  }
  return out
}

/** Counts only. Names and appids are deliberately not reported — this reaches `/state`. */
export const appsStats = async (): Promise<Record<string, unknown> | undefined> => {
  if (!isTauri()) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<Record<string, unknown>>('apps_stats')
  } catch {
    return undefined
  }
}
