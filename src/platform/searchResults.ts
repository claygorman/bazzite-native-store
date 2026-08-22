/**
 * The one place this project reads Steam's HTML.
 *
 * `store.steampowered.com/search/results/?infinite=1` answers with JSON — `success`,
 * `total_count`, `start`, `results_html` — where the last field is a fragment of the
 * storefront's own result list. It is the only source that sorts a tag by top sellers
 * or review count (`IStoreQueryService/Query` returns 200 and pages happily but
 * effectively cannot sort), and the totals it reports are real.
 *
 * ⚠️ This is a deliberate, approved exception to the project's "do not scrape the Steam
 * website" rule, on the grounds that `infinite=1` is the storefront's pagination API
 * rather than the storefront page. It is still the most fragile thing in the codebase,
 * so it is written to the opposite standard from everything else: **it never throws and
 * never half-parses.** Anything unexpected yields an empty page, and an empty page
 * degrades to "no results" rather than blanking the UI (private/STEAM-ENDPOINTS.md rule 3).
 *
 * ⚠️ A leaf module with no imports, so the repo's plain `node --experimental-strip-types`
 * runner can test it. Same reason as `contentFilter.ts` and `storeCategories.ts`.
 */

export type SearchPage = {
  /**
   * Size of the whole result set for THIS query.
   *
   * ⚠️ Not a property of the tag. Steam applies each sort as a filter too, so the same
   * tag reports 5,214 by review count, 13,525 by release date and 20,054 by relevance.
   * Never cache this against the tag alone, and never show it beside a list that a
   * different query produced.
   */
  total: number
  appids: number[]
  /**
   * Content descriptors Steam put on the row, where it put any.
   *
   * A cheap pre-filter only: roughly half the rows carry none, and absence has never
   * meant "safe" (see `contentFilter.ts`). The authoritative check still happens after
   * hydration, against `GetItems`.
   */
  descriptorsByAppid: Map<number, number[]>
}

const EMPTY: SearchPage = { total: 0, appids: [], descriptorsByAppid: new Map() }

/** `App_570` -> 570. `Sub_*` and `Bundle_*` are not apps and are skipped. */
const appidFromItemKey = (key: string): number | undefined => {
  if (!key.startsWith('App_')) return undefined
  const id = Number(key.slice(4))
  return Number.isInteger(id) && id > 0 ? id : undefined
}

const parseDescids = (raw: string): number[] => {
  // `[1,5]`, and occasionally `[]`. Hand-parsed rather than JSON.parse'd so a malformed
  // attribute costs one row instead of the page.
  const out: number[] = []
  for (const part of raw.replace(/[[\]\s]/g, '').split(',')) {
    if (part === '') continue
    const n = Number(part)
    if (Number.isInteger(n)) out.push(n)
  }
  return out
}

/**
 * Pull the ordered appids out of one `results_html` page.
 *
 * ⚠️ Anchored on `data-ds-itemkey`, not `data-ds-appid`. The itemkey carries the item
 * TYPE (`App_` / `Sub_` / `Bundle_`), so packages and bundles identify themselves and
 * get skipped; `data-ds-appid` alone would silently hand a bundle's first app back as
 * though it were the result.
 *
 * ⚠️ Attributes are read per anchor tag, never across the whole fragment. A global
 * regex for `itemkey.*descids` happily matches one row's key against the next row's
 * descriptors — which during development paired an adult descriptor set with an
 * innocent game and vice versa.
 */
export const parseSearchResults = (json: unknown): SearchPage => {
  const root = json as { total_count?: unknown; results_html?: unknown; start?: unknown } | null
  if (typeof root !== 'object' || root === null) return EMPTY

  const html = root.results_html
  if (typeof html !== 'string') return EMPTY

  const total = typeof root.total_count === 'number' && root.total_count >= 0 ? root.total_count : 0

  const appids: number[] = []
  const descriptorsByAppid = new Map<number, number[]>()
  const seen = new Set<number>()

  for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
    const key = /data-ds-itemkey="([^"]*)"/.exec(tag)?.[1]
    if (key === undefined) continue
    const appid = appidFromItemKey(key)
    // Steam repeats an app when it appears in more than one row (a bundle's contents,
    // say). Order is the ranking, so keep the first and drop later copies.
    if (appid === undefined || seen.has(appid)) continue
    seen.add(appid)
    appids.push(appid)

    const descids = /data-ds-descids="([^"]*)"/.exec(tag)?.[1]
    if (descids !== undefined) descriptorsByAppid.set(appid, parseDescids(descids))
  }

  /*
   * ⚠️ The shape-change detector, and the reason `start` is read at all.
   *
   * "Steam says 5,214 games" next to an empty grid is precisely the misleading number
   * this whole screen exists to avoid, and it is what a changed class name or a
   * returned error page would produce: a perfectly good `total_count` beside markup we
   * could not read.
   *
   * Row count alone cannot tell that apart from a legitimately empty page — paging past
   * the end also returns a real total and no rows. The FIRST page can: if Steam claims
   * matches and hands back nothing parseable at offset zero, the parser is wrong, not
   * the store. Later pages keep their total, because there an empty result is the truth.
   */
  const start = typeof root.start === 'number' ? root.start : 0
  if (appids.length === 0 && total > 0 && start === 0) return EMPTY

  return { total, appids, descriptorsByAppid }
}
