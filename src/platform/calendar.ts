/**
 * "Your Personal Calendar" — the day-column band (design 5c).
 *
 * The design shows a genuinely personalized calendar, and Steam has an endpoint for
 * exactly that. It is session-gated, so this module runs TWO paths behind one shape:
 *
 *   personalized  /personalcalendardata            needs a store COOKIE, not a key
 *   anonymous     featuredcategories + GetItems    always available, the dev default
 *
 * ⭐ The personalized path went live 2026-08-21. It is not key-gated — it is cookie-
 * gated — and the cookie comes from the Steam client's own logged-in browser
 * (src-tauri/src/steamclient.rs). Anonymously the band reaches about six hours; through
 * the session it reaches -1 to +55 days, 299 entries.
 *
 * ⚠️ The personalized endpoint LIES QUIETLY. Anonymously it answers **HTTP 200** with
 * its full JSON shape and `strResultMessage: "Not logged in"` — no status code, no
 * exception, nothing a normal fetch wrapper would notice. It is the one endpoint in
 * the personalization family that says so out loud, so we check that field and treat
 * anything other than `"success"` as "no session" (private/STEAM-ENDPOINTS.md, "The
 * personalization trap"). Never infer success from 200; never infer failure from an
 * empty array.
 *
 * Both paths converge on `IStoreBrowseService/GetItems` for hydration: keyless,
 * batched, and carrying `release.steam_release_date` as unix epoch seconds — which is
 * the field that buckets a game into a day. Verified live 2026-08-21.
 */

import type { SteamRequest } from './transport'
// ⚠️ Extension is required: this module is exercised by node --experimental-strip-types
// (src/platform/calendar.test.ts), whose resolver does not do extensionless lookups.
// The existing `import type` above never needed it because types erase at runtime.
import { isAdultContent } from './contentFilter.ts'

export type CalendarGame = {
  appid: number
  name: string
  /** 460x215 header art, built from GetItems' `assets`. */
  capsuleUrl: string
  /**
   * 600x900 portrait poster (`library_capsule`), for the opened-out day view.
   * Optional: not every app publishes one, so callers must fall back to `capsuleUrl`.
   */
  portraitUrl?: string
  /** Steam's own formatted string ("$41.99", "Free To Play"), or '' when unpriced. */
  price: string
}

export type CalendarDay = {
  /** `YYYY-MM-DD` in LOCAL time. Stable across re-fetches, so it is the React key. */
  key: string
  /** `MON` … `SUN`, or `TODAY`. */
  label: string
  /** `M/D`, and EMPTY for today — the design gives today the word, not the date. */
  date: string
  isToday: boolean
  /**
   * Every game releasing that day, not just the three the band draws. The band
   * renders three and derives its `+N More` badge from the overflow, so trimming
   * here would make that count a lie.
   */
  games: CalendarGame[]
}

/** One hydrated release, before it is bucketed. Exported for the day-bucketing tests. */
export type CalendarEntry = { game: CalendarGame; releaseEpoch: number }

/** The band renders today plus three days either side — "Day 4 / 7" in the artboard. */
export const DAYS_BACKWARD = 3
export const DAYS_FORWARD = 3
/** Columns on screen at once; the rest are reached with LT/RT. */
export const VISIBLE_DAYS = 5

/*
 * ── Pure day math ────────────────────────────────────────────────────────────────
 * Everything below this line is a pure function of (entries, now). `now` is a
 * parameter and not `new Date()` so the tests are not a bet on what day it is.
 */

const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

/**
 * Local calendar day, not UTC. A 7pm Pacific release is *that* day to the person on
 * the couch even though it is already tomorrow in UTC, and `toISOString()` would
 * silently file it under the wrong column.
 */
export const localDayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Midnight local, `offset` days from `date`. Handles month/year/DST rollover. */
const addLocalDays = (date: Date, offset: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)

/** The `YYYY-MM-DD` keys the band covers, earliest first. */
export const calendarWindowKeys = (now: Date): string[] => {
  const keys: string[] = []
  for (let offset = -DAYS_BACKWARD; offset <= DAYS_FORWARD; offset++) {
    keys.push(localDayKey(addLocalDays(now, offset)))
  }
  return keys
}

/**
 * Cheap pre-filter for the personalized path, which returns 300 entries spanning more
 * days than we draw. A day of slack either side absorbs the gap between the release
 * timestamp Steam sorts by and the one it later reports.
 */
export const isWithinCalendarWindow = (releaseEpoch: number, now: Date): boolean => {
  if (!Number.isFinite(releaseEpoch) || releaseEpoch <= 0) return false
  const first = addLocalDays(now, -DAYS_BACKWARD - 1).getTime()
  const last = addLocalDays(now, DAYS_FORWARD + 2).getTime()
  const at = releaseEpoch * 1000
  return at >= first && at < last
}

/**
 * Bucket hydrated releases into the seven day-columns.
 *
 * Entries outside the window are dropped, and an appid is only ever filed once — the
 * anonymous path unions two shelves that legitimately overlap.
 */
export const buildCalendarDays = (entries: readonly CalendarEntry[], now: Date): CalendarDay[] => {
  const todayKey = localDayKey(now)

  const byDay = new Map<string, CalendarEntry[]>()
  const seen = new Set<number>()
  for (const entry of entries) {
    // A release date of 0 means "no date announced". Those games are real, but they
    // belong to no day, and the band is a calendar.
    if (!Number.isFinite(entry.releaseEpoch) || entry.releaseEpoch <= 0) continue
    if (seen.has(entry.game.appid)) continue
    seen.add(entry.game.appid)
    const key = localDayKey(new Date(entry.releaseEpoch * 1000))
    const bucket = byDay.get(key)
    if (bucket) bucket.push(entry)
    else byDay.set(key, [entry])
  }

  return calendarWindowKeys(now).map((key, index) => {
    const date = addLocalDays(now, index - DAYS_BACKWARD)
    const isToday = key === todayKey
    // Earliest release first, appid breaking ties, so the same response always draws
    // the same column — otherwise the top capsule shuffles between fetches.
    const games = (byDay.get(key) ?? [])
      .slice()
      .sort((a, b) => a.releaseEpoch - b.releaseEpoch || a.game.appid - b.game.appid)
      .map((entry) => entry.game)

    return {
      key,
      label: isToday ? 'TODAY' : WEEKDAY_LABELS[date.getDay()],
      date: isToday ? '' : `${date.getMonth() + 1}/${date.getDate()}`,
      isToday,
      games,
    }
  })
}

/*
 * ── Network ──────────────────────────────────────────────────────────────────────
 */

/**
 * The transport is imported lazily, at the call, so the pure day math above can be
 * exercised by `node --experimental-strip-types` (calendar.test.ts). `transport.ts`
 * reaches `./index` through an extension-less specifier that Vite resolves and bare
 * Node does not; a static import here would pull that into the test process. The
 * same reason applies to every other `await import()` in this file.
 */
const steamGet = async (request: SteamRequest): Promise<unknown> =>
  (await import('./transport')).steamGet(request)

/**
 * The same lazy-import trick as `steamGet` above, for the Steam-session route.
 *
 * ⚠️ Static imports would pull Tauri into this module, and `calendar.test.ts` runs it
 * under plain `node --experimental-strip-types`. The day-bucketing functions have to
 * stay importable without a runtime.
 */
const sessionGet = async (path: string, query: Record<string, string | number>) =>
  (await import('./steamSession')).steamSessionGet(path, query)

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined

/** Locale pinned, matching steam.ts — defaults follow the caller's IP and drift. */
const STORE_COUNTRY = 'US'

/** GetItems answers relative paths; this is the host they hang off. */
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/'

/**
 * GetItems art is a two-part construction, unlike `featuredcategories` which hands
 * back whole URLs: `assets.asset_url_format` is a template
 * (`steam/apps/1643320/${FILENAME}?t=1787314871`) and each art field is the filename
 * to drop into it. Verified live 2026-08-21.
 *
 * `split/join` rather than `replace` because the replacement is Steam-controlled and
 * `$` sequences in a `replace` replacement string are magic.
 */
const assetUrl = (assets: Record<string, unknown> | undefined, ...fields: string[]): string | undefined => {
  const format = asString(assets?.asset_url_format)
  if (!format) return undefined
  for (const field of fields) {
    const file = asString(assets?.[field])
    if (file) return `${ASSET_BASE}${format.split('${FILENAME}').join(file)}`
  }
  return undefined
}

const normalizeStoreItem = (raw: unknown): CalendarEntry | undefined => {
  const item = asRecord(raw)
  if (!item) return undefined
  // Per-item success, not per-response: a batch of 100 happily returns 99 good items
  // and one delisted appid.
  if (item.success !== undefined && item.success !== 1) return undefined
  if (item.visible === false) return undefined

  const appid = asNumber(item.appid) ?? asNumber(item.id)
  const name = asString(item.name)
  if (appid === undefined || !name) return undefined

  // ⚠️ Drop adult titles here, at the single point every calendar item passes through.
  // `coming_soon` is where they are most concentrated — the endpoints apply no content
  // filtering of their own (src/platform/contentFilter.ts).
  const descriptors = Array.isArray(item.content_descriptorids)
    ? item.content_descriptorids.filter((id): id is number => typeof id === 'number')
    : undefined
  if (isAdultContent(descriptors)) return undefined

  // ⚠️ Prefer the _2x assets. This app renders at 4K, where a tile is up to 672 CSS px
  // wide and a poster 416 — a 460x215 header or a 300x450 capsule gets upscaled and
  // reads as soft at couch distance. The 2x variants are 920x430 and 600x900.
  const capsuleUrl = assetUrl(
    asRecord(item.assets),
    'header_2x',
    'header',
    'main_capsule_2x',
    'main_capsule',
  )
  if (!capsuleUrl) return undefined

  // Unreleased titles carry no `best_purchase_option` at all, which is fine — the
  // day columns show art only. The recommended row is where price is read.
  const purchase = asRecord(item.best_purchase_option)
  const price =
    asString(purchase?.formatted_final_price) ?? (item.is_free === true ? 'Free To Play' : '')

  return {
    game: {
      appid,
      name,
      capsuleUrl,
      portraitUrl: assetUrl(asRecord(item.assets), 'library_capsule_2x', 'library_capsule'),
      price,
    },
    releaseEpoch: asNumber(asRecord(item.release)?.steam_release_date) ?? 0,
  }
}

/**
 * One GET per 100 appids, not one per game.
 *
 * Steam rate-limits to ~200 requests / 5 min per IP, and this band would otherwise be
 * the single greediest screen in the app. The chunk exists only because `input_json`
 * travels in the query string and 300 ids is a long URL; Steam's own homepage batches
 * the same way (3 calls per load).
 */
const GET_ITEMS_CHUNK = 100

const fetchStoreItems = async (
  appids: readonly number[],
  ttlSeconds: number,
): Promise<Map<number, CalendarEntry>> => {
  const hydrated = new Map<number, CalendarEntry>()
  if (appids.length === 0) return hydrated

  const chunks: number[][] = []
  for (let i = 0; i < appids.length; i += GET_ITEMS_CHUNK) {
    chunks.push(appids.slice(i, i + GET_ITEMS_CHUNK))
  }

  const responses = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return await steamGet({
          host: 'api',
          path: '/IStoreBrowseService/GetItems/v1/',
          query: {
            input_json: JSON.stringify({
              ids: chunk.map((appid) => ({ appid })),
              context: { language: 'english', country_code: STORE_COUNTRY, steam_realm: 1 },
              data_request: {
                include_assets: true,
                include_release: true,
                include_basic_info: true,
                include_reviews: true,
              },
            }),
          },
          ttlSeconds,
        })
      } catch {
        // A dead chunk costs us some capsules, never the whole band.
        return undefined
      }
    }),
  )

  for (const json of responses) {
    const items = asRecord(asRecord(json)?.response)?.store_items
    if (!Array.isArray(items)) continue
    for (const raw of items) {
      const entry = normalizeStoreItem(raw)
      if (entry) hydrated.set(entry.game.appid, entry)
    }
  }

  return hydrated
}

/** Personalized data changes with every wishlist edit; keep it short. */
const PERSONAL_TTL_SECONDS = 600
/** The anonymous shelves move once a day at most. */
const ANONYMOUS_TTL_SECONDS = 1_800

/**
 * GET /personalcalendardata — the real thing, when we have a session.
 *
 * ⚠️ Returns HTTP 200 either way. `strResultMessage` is the ONLY honest signal:
 * `"Not logged in"` anonymously, `"success"` with a session. Returning `undefined`
 * here means "no personalized calendar", and the caller falls back.
 */
const fetchPersonalCalendarAppids = async (now: Date): Promise<number[] | undefined> => {
  const query = { tag: 0, days_backward: DAYS_BACKWARD, days_forward: DAYS_FORWARD + 1 }

  /*
   * ⚠️ Through the Steam client's session, NOT the plain fetcher.
   *
   * This path was written months before there was any way to satisfy it: `steamGet`
   * uses reqwest with no cookie jar, so it always got `"Not logged in"` and the caller
   * always fell back. The endpoint is not key-gated, it is COOKIE-gated, and the only
   * anonymous-safe cookie source is the Steam client itself
   * (src-tauri/src/steamclient.rs).
   *
   * Measured on the box 2026-08-21, and the difference is the whole point of the
   * screen: the anonymous shelves reach about six hours, this reaches **-1 to +55
   * days** — 299 entries, 48 of them inside the next week.
   */
  let json = await sessionGet('/personalcalendardata', query)

  if (json === undefined) {
    // No Steam client: try anyway. It will answer "Not logged in" and we fall back,
    // but the cost is one cached request and it keeps the browser build on the same
    // code path rather than a special case.
    try {
      json = await steamGet({
        host: 'store',
        path: '/personalcalendardata',
        query,
        ttlSeconds: PERSONAL_TTL_SECONDS,
      })
    } catch {
      return undefined
    }
  }

  const root = asRecord(json)
  if (asString(root?.strResultMessage) !== 'success') return undefined

  const infos = Array.isArray(root?.arrAppInfos) ? root.arrAppInfos : []
  const appids: number[] = []
  for (const raw of infos) {
    const info = asRecord(raw)
    const appid = asNumber(info?.nAppID)
    const releaseEpoch = asNumber(info?.nReleaseDate) ?? 0
    // Pre-filtered by the date Steam sorted on, so we hydrate ~a week rather than the
    // ~300 entries it returns. The authoritative date still comes from GetItems.
    if (appid !== undefined && isWithinCalendarWindow(releaseEpoch, now)) appids.push(appid)
  }

  // NOT an auth inference — the message already told us we are signed in. This is a
  // content check: a calendar with nothing in it is worse than the anonymous one.
  return appids.length > 0 ? appids : undefined
}

/** The design's bottom row is five cards wide. */
const RECOMMENDED_COUNT = 5

/**
 * Appids for the anonymous band, from the shelves the home screen already fetched.
 *
 * `coming_soon` fills the days after today and `new_releases` the days before it —
 * neither alone covers a seven-day window centred on today. Both come out of the one
 * `featuredcategories` response the home screen already paid for, so this adds no
 * request (transport.ts caches by URL).
 *
 * ⚠️ MEASURED 2026-08-21, and it is worse than the names suggest: both shelves are
 * roughly a SIX-HOUR window, not a weekly one. All 30 `new_releases` had released
 * within the current day (16:00–20:13 UTC) and all 10 `coming_soon` were due inside
 * the next ten hours. So anonymously the band populates today and tomorrow and leaves
 * the three past columns empty — the shape is right, the reach is not. A real
 * anonymous "next seven days" source is still open; `IStoreQueryService/Query` with
 * `coming_soon_only` answers 200 keyless with 53,535 records, but none of its sort
 * values (0-12, probed) returns them in release-date order, so it cannot page a date
 * window. Only this function needs to change when a better source turns up.
 */
const fetchAnonymousAppids = async (): Promise<{ calendar: number[]; recommended: number[] }> => {
  const { fetchFeaturedRows } = await import('./steam')
  let rows: Awaited<ReturnType<typeof fetchFeaturedRows>> = []
  try {
    rows = await fetchFeaturedRows()
  } catch {
    return { calendar: [], recommended: [] }
  }

  const idsOf = (id: string): number[] =>
    rows.find((row) => row.id === id)?.items.map((item) => item.appid) ?? []

  return {
    calendar: [...idsOf('coming_soon'), ...idsOf('new_releases')],
    // ⚠️ APPROXIMATION. "Recommended Based on the Games You Play" has no verified
    // endpoint — the closest personalized source, `home_additional`, is session-gated
    // like the calendar itself. Top sellers is what steam.ts already substitutes for
    // "Featured & Recommended"; same honest compromise, tracked in private/TASKS.md.
    recommended: idsOf('top_sellers').slice(0, RECOMMENDED_COUNT),
  }
}

export type CalendarBand = {
  days: CalendarDay[]
  recommended: CalendarGame[]
  /** True only when `/personalcalendardata` said `"success"`. Never assumed. */
  personalized: boolean
}

/**
 * Everything the band draws, in one call and one hydration batch.
 *
 * Try the personalized path, fall back to the anonymous one, hydrate whatever set of
 * appids we ended up with — calendar and recommended together, so the whole band
 * costs one GetItems round trip.
 */
export const fetchCalendarBand = async (now: Date = new Date()): Promise<CalendarBand> => {
  const personalAppids = await fetchPersonalCalendarAppids(now)
  const anonymous = await fetchAnonymousAppids()

  const personalized = personalAppids !== undefined
  const calendarAppids = personalAppids ?? anonymous.calendar
  const ttlSeconds = personalized ? PERSONAL_TTL_SECONDS : ANONYMOUS_TTL_SECONDS

  const wanted = [...new Set([...calendarAppids, ...anonymous.recommended])]
  const hydrated = await fetchStoreItems(wanted, ttlSeconds)

  const entries = calendarAppids
    .map((appid) => hydrated.get(appid))
    .filter((entry): entry is CalendarEntry => entry !== undefined)

  const recommended = anonymous.recommended
    .map((appid) => hydrated.get(appid)?.game)
    .filter((game): game is CalendarGame => game !== undefined)

  return { days: buildCalendarDays(entries, now), recommended, personalized }
}

/** The band's day columns. See `fetchCalendarBand` for the recommended row. */
export const fetchCalendarDays = async (): Promise<CalendarDay[]> => (await fetchCalendarBand()).days
