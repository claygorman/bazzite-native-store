import { isTauri } from './index'

/**
 * Write-through to the per-app index — phase 1 of the `apps` table.
 *
 * ⭐ **Why, when `steam.rs` already caches HTTP.** That cache keys on a hash of the whole
 * REQUEST. `GetItems` takes a batch of ids, so `ids:[730,570]` and `ids:[730]` are separate
 * entries holding overlapping data — a game on the home shelf, then in a search, then on
 * its own details page is three fetches and three stored copies. Keying on the appid is the
 * only shape that dedupes across requests, and a URL cache structurally cannot.
 *
 * ⚠️ **Nothing reads this yet.** Write-through lands first and read-through second, as
 * separate changes, because a bug in either presents identically — "the shelf shows a stale
 * price" gives you no way to tell a bad write from a bad read if both arrived together.
 *
 * ⚠️ **Fire and forget, deliberately.** No caller awaits this and no caller may start: it
 * is pure bookkeeping today, so a failure must cost nothing. The moment something awaits it
 * the hydration path acquires a new way to be slow and a new way to fail, for no benefit
 * until phase 2.
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
