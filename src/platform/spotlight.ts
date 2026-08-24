/**
 * The real "Featured & Recommended" — Steam's own personalised home row.
 *
 * ⭐ **Why this exists.** That shelf has been `top_sellers` wearing a different label since
 * the beginning, and `StoreRow.approximate` says so out loud in the F2 HUD. This is the
 * actual source, found 2026-08-24:
 *
 *     GET /default/home_spotlight_recommendations/?v=2
 *
 * ⚠️ **Cookie-gated, and it fails SILENTLY.** Called without a session it answers
 * **HTTP 200** with valid JSON and every array empty — no status, no exception, nothing a
 * normal fetch wrapper notices. So an empty result here means *"we were not recognised"*,
 * never *"you have no recommendations"*, and this module returns `undefined` for it so the
 * caller falls back to the approximation rather than drawing an empty shelf. That is the
 * project's standing rule — "we have not asked" ≠ "the answer is no" — applied to a
 * transport that is built to blur exactly that line.
 *
 * ⚠️ **We do not send `u=<accountid>`.** Steam's own client does. It is not an
 * authorization bypass — verified 2026-08-24 by calling it with a real account id and no
 * cookies, which returns the same empty payload, so the cookie is the authority. Sending it
 * anyway would add a caller-supplied identity to a privileged call for no gain, and a
 * parameter that looks like it selects a user is worth attacking whether or not it works.
 *
 * ## ⚠️ We deliberately read only the APPIDS from this endpoint
 *
 * The populated response shape has never been seen — only the empty one. Rather than guess
 * at field names inside `spotlight_recommendations[]` and ship a parser that silently yields
 * nothing when a guess is wrong, this takes the one thing that is unambiguous (appids) and
 * hydrates them with `GetItems`, which is already trusted, already batched and already
 * cached. The feature then works the moment the ids parse, whatever else is in there.
 *
 * When the real shape IS known on hardware, richer fields can be lifted — but not before,
 * and `docs`/tests should be updated from a real sample rather than from a guess.
 */

// ⚠️ TYPE-only import: erased at runtime, so `spotlight.test.ts` still loads under plain
// `node --experimental-strip-types`. A value import from `../types/steam` would be fine too
// (it has no runtime deps), but keeping it type-only makes the constraint explicit.
import type { StoreItem } from '../types/steam'

/** Field names that plausibly hold an appid, in the order we prefer them. */
const APPID_KEYS = ['appid', 'appID', 'app_id', 'id'] as const

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A Steam appid, if this looks like one.
 *
 * ⚠️ Steam hands appids as numbers in some payloads and decimal strings in others — the
 * page bootstrap keys `rgApps` by string. Both are accepted; anything else is not.
 * Bounded above 0 because `0` is the "no app" sentinel and would render as a broken tile.
 */
const asAppid = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * Walk a payload of unknown shape for appids, keeping the order they appear in.
 *
 * ⚠️ Order is the product here, not a detail: this is a *ranked* row, and Steam decided
 * the ranking. Sorting or de-ordering it would quietly replace their recommendation with
 * ours. Duplicates are dropped, keeping the FIRST occurrence, so a game that appears in
 * both a recommendation and a panel stays where it was first ranked.
 *
 * Depth-bounded because this parses a payload we do not control and whose shape we have
 * not seen populated — an unbounded walk over a cyclic or pathological structure is a hang
 * on the user's television, which is worse than a missing shelf.
 */
export const appidsWithin = (node: unknown, depth = 0, out: number[] = []): number[] => {
  if (depth > 6 || out.length >= 200) return out
  if (Array.isArray(node)) {
    for (const child of node) appidsWithin(child, depth + 1, out)
    return out
  }
  if (!isRecord(node)) return out
  for (const key of APPID_KEYS) {
    const appid = asAppid(node[key])
    if (appid !== undefined) {
      if (!out.includes(appid)) out.push(appid)
      // ⚠️ Do NOT return early. An entry may nest included items (a bundle's contents),
      // and those are part of the row too — the same reasoning as `useOffers`.
      break
    }
  }
  for (const value of Object.values(node)) appidsWithin(value, depth + 1, out)
  return out
}

/**
 * The appid keys of `item_data.rgApps`.
 *
 * ⚠️ **Empty serialises as `[]`, populated as `{}`.** Steam's backend renders an empty
 * associative array as a JSON *array* and a populated one as a JSON *object* — the observed
 * anonymous response is `"rgApps":[]` while the page bootstrap carries `"rgApps":{"1631270":…}`.
 * A parser that assumes either one alone is correct exactly half the time, and the half it
 * gets wrong is the half with data in it. This is the single most likely way this module
 * breaks, so it is handled explicitly rather than by a permissive cast.
 *
 * ⚠️ **The order you get back is NOT Steam's — it is ascending appid, and nothing can
 * change that.** Integer-index-like object keys are enumerated in ascending numeric order by
 * every conforming JS engine, whatever order they arrived in (ECMAScript
 * OrdinaryOwnPropertyKeys). Measured: `{892970, 252490, 1631270}` enumerates as
 * `252490, 892970, 1631270`. So a row built from this bag holds the RIGHT GAMES in an
 * ARBITRARY ORDER, which is why `spotlightRow` reports it as unranked and the caller marks
 * the shelf approximate. Re-parsing the raw JSON text to recover key order would work and is
 * not worth it — see the note on `spotlightRow`.
 */
export const rgAppsAppids = (itemData: unknown): number[] => {
  const rgApps = isRecord(itemData) ? itemData.rgApps : undefined
  if (Array.isArray(rgApps)) return appidsWithin(rgApps)
  if (!isRecord(rgApps)) return []
  return Object.keys(rgApps).flatMap((k) => {
    const appid = asAppid(k)
    return appid === undefined ? [] : [appid]
  })
}

/**
 * The personalised row, or `undefined` when there is no session.
 *
 * ⚠️ `ranked` is the honest half of the answer and the caller must not ignore it:
 *
 * - `ranked: true`  — the appids came from `spotlight_recommendations` / `spotlight_panels`
 *   in the order Steam put them. This is the real row; the shelf is exact.
 * - `ranked: false` — the ranked lists were shaped in a way this walk did not recognise, so
 *   the ids came from the `rgApps` bag instead. **Right games, arbitrary order** (ascending
 *   appid — see `rgAppsAppids`). Still far better than `top_sellers` wearing the label, but
 *   it is an approximation and the shelf must say so.
 *
 * ⚠️ This never returns an empty list. There is no state in which "Steam recognised us and
 * recommends nothing" is worth drawing, and it is indistinguishable from the unrecognised
 * case anyway, so both collapse to `undefined` and the caller falls back.
 *
 * ⚠️ Recovering the true order from the `rgApps` bag WOULD be possible by regexing appid
 * keys out of the raw JSON text before `JSON.parse` reorders them. Deliberately not done:
 * it means a second, text-level parser for one undocumented shape, to salvage an ordering
 * we can already tell the user we do not have. Saying so is cheaper and more honest.
 */
export type SpotlightRow = {
  appids: number[]
  ranked: boolean
}

export const spotlightRow = (payload: unknown): SpotlightRow | undefined => {
  if (!isRecord(payload)) return undefined
  // Prefer the ranked lists; they carry Steam's ordering.
  const found = [
    ...appidsWithin(payload.spotlight_recommendations),
    ...appidsWithin(payload.spotlight_panels),
  ]
  const ordered = found.filter((id, i) => found.indexOf(id) === i)
  if (ordered.length > 0) return { appids: ordered, ranked: true }

  const bag = rgAppsAppids(payload.item_data)
  return bag.length > 0 ? { appids: bag, ranked: false } : undefined
}

/**
 * Fetch the personalised row and hydrate it into a renderable shelf.
 *
 * ⚠️ Lazy imports, both of them. `spotlight.test.ts` runs under plain
 * `node --experimental-strip-types`, and a static import of `./steam` or `./steamSession`
 * would drag Tauri and the transport into a module whose parsing half must stay testable
 * without a runtime. Same trick and same reason as `calendar.ts`.
 *
 * ⚠️ Enhancement layer. `undefined` in the browser, off Bazzite, without Steam running,
 * with its debugger closed, or when Steam does not recognise the session — and the caller
 * must render the approximation in every one of those cases rather than an empty shelf.
 */
export const fetchSpotlightRow = async (): Promise<
  { items: StoreItem[]; ranked: boolean } | undefined
> => {
  const { steamSessionGet } = await import('./steamSession')
  /*
   * ⚠️ `v=2` is Steam's own; `u=<accountid>` is deliberately NOT sent — see the header.
   * No other parameters are known, and guessing at them on a privileged call is how you
   * turn a read into something else.
   */
  const payload = await steamSessionGet('/default/home_spotlight_recommendations/', { v: 2 })
  const row = spotlightRow(payload)
  if (!row) return undefined

  const { fetchStoreItems, storeItemFromFacts } = await import('./steam')
  const facts = await fetchStoreItems(row.appids)
  /*
   * ⚠️ Mapped over `row.appids`, NOT over the facts map — the ranking lives in the appid
   * order and a Map does not preserve it. Iterating the map here would silently reorder
   * Steam's recommendation into hash order, which looks fine and is wrong.
   */
  const items = row.appids.flatMap((appid) => {
    const item = storeItemFromFacts(appid, facts.get(appid))
    return item ? [item] : []
  })
  // Every id dropped (unnamed, or filtered as adult) leaves nothing to draw.
  return items.length > 0 ? { items, ranked: row.ranked } : undefined
}
