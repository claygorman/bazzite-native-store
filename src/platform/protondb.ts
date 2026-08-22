import { steamGet } from './transport'

/**
 * ProtonDB — Linux/Proton compatibility ratings.
 *
 * A SECOND UPSTREAM, not Steam. The design's compatibility badge has no Steam
 * equivalent, and on this platform it is arguably the most important fact on the
 * screen, so it is worth the extra dependency.
 *
 * Two things to know about this endpoint:
 *
 * 1. `access-control-allow-origin` is pinned to `https://www.protondb.com`, so a
 *    browser tab cannot call it directly. Both builds go through a proxy — the Vite
 *    dev server in the browser, the Rust client in Tauri.
 * 2. ⚠️ A game with no reports returns **an HTML 404 page, not JSON**. Any parse
 *    here must tolerate that rather than throwing into the UI. Verified 2026-08-20:
 *    appid 1245620 -> 200 JSON, appid 4001890 -> 404 HTML.
 */

/** ProtonDB's ladder, worst to best. `pending` means too few reports to rate. */
export type ProtonTier = 'borked' | 'pending' | 'bronze' | 'silver' | 'gold' | 'platinum'

export type ProtonRating = {
  tier: ProtonTier
  /** Number of user reports behind the tier. Low counts deserve less prominence. */
  total: number
  confidence?: string
}

const TIERS: ReadonlySet<string> = new Set([
  'borked',
  'pending',
  'bronze',
  'silver',
  'gold',
  'platinum',
])

/**
 * The Compatibility page's two ProtonDB rows, held here rather than passed in.
 *
 * ⚠️ `enabled: false` means we do not ASK, not that we hide the answer. Turning the
 * source off has to stop the requests or the setting is cosmetic — and ProtonDB is
 * one request per appid with no batching, so it is the single largest source of
 * traffic this app generates.
 */
const protonPolicy = { enabled: true, ttlSeconds: 86_400 }

export const setProtonPolicy = (next: { enabled: boolean; ttlSeconds: number }): void => {
  protonPolicy.enabled = next.enabled
  protonPolicy.ttlSeconds = next.ttlSeconds
}

export const fetchProtonRating = async (appid: number): Promise<ProtonRating | undefined> => {
  if (!protonPolicy.enabled) return undefined
  try {
    const json = await steamGet({
      host: 'protondb',
      path: `/api/v1/reports/summaries/${appid}.json`,
      // Compatibility ratings move slowly. The default is a day, per the Refresh
      // cadence row, which is also what keeps us off their API.
      ttlSeconds: protonPolicy.ttlSeconds,
    })

    if (typeof json !== 'object' || json === null) return undefined
    const record = json as Record<string, unknown>
    const tier = record.tier
    if (typeof tier !== 'string' || !TIERS.has(tier)) return undefined

    return {
      tier: tier as ProtonTier,
      total: typeof record.total === 'number' ? record.total : 0,
      confidence: typeof record.confidence === 'string' ? record.confidence : undefined,
    }
  } catch {
    // Unrated games 404 with an HTML body. That is a normal outcome, not an error —
    // the badge simply does not render.
    return undefined
  }
}

/** ProtonDB's own tier colours, so the badge reads the way users expect. */
export const TIER_STYLE: Record<ProtonTier, { dot: string; text: string; label: string }> = {
  platinum: { dot: '#b4c7dc', text: '#dce6f0', label: 'Platinum' },
  gold: { dot: '#cfb53b', text: '#e4cf7a', label: 'Gold' },
  silver: { dot: '#a6a6a6', text: '#cccccc', label: 'Silver' },
  bronze: { dot: '#cd7f32', text: '#e0a877', label: 'Bronze' },
  borked: { dot: '#ff4444', text: '#ff9a9a', label: 'Borked' },
  pending: { dot: '#8a8a8a', text: '#b5b5b5', label: 'Unrated' },
}
