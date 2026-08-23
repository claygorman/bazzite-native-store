import { forgetSteam, steamGet } from './transport'
import { logEmpty } from './debugLog'
import { isAdultContent } from './contentFilter'
import { controllerSupportFrom, deckCompatFrom, linuxNativeFrom } from './storeCategories'
import type { AppDetails, ReviewSummary, StoreItem, StoreRow, StoreTag } from '../types/steam'

/**
 * Steam data facade. Raw shapes are parsed here and nowhere else.
 *
 * Parse defensively: these endpoints are undocumented and unversioned, and one of
 * them (/api/featured) already went from working to returning an empty shape. A row
 * that cannot be parsed is dropped, never thrown — a dead endpoint must not blank
 * the UI (private/STEAM-ENDPOINTS.md, rule 3).
 */

/** Pinned explicitly — defaults follow the caller's IP and will drift (rule 4). */
/**
 * The country code every price, currency and release date is read against.
 *
 * ⚠️ MUTABLE, and set from Settings — this is the one piece of global state the data
 * layer owns. Threading a region through the twelve call sites that send `cc` would
 * mean every one of them taking a parameter it never varies, and the `steamGet` cache
 * already keys on the full query string, so changing it invalidates exactly the
 * responses whose prices are now wrong and nothing else.
 *
 * `l` stays English: the app's own copy is English, and a store page in one language
 * inside a UI in another is worse than either.
 */
export const STORE_LOCALE: { cc: string; l: string } = { cc: 'US', l: 'en' }

export const setStoreRegion = (cc: string): void => {
  STORE_LOCALE.cc = cc
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined

const normalizeItem = (raw: unknown, comingSoon: boolean): StoreItem | undefined => {
  const o = asRecord(raw)
  if (!o) return undefined

  const appid = asNumber(o.id)
  const name = asString(o.name)
  if (appid === undefined || !name) return undefined

  // Steam is inconsistent about which capsule fields it populates per row, so walk
  // the variants rather than trusting any single one.
  const capsuleUrl =
    asString(o.large_capsule_image) ?? asString(o.header_image) ?? asString(o.small_capsule_image)
  if (!capsuleUrl) return undefined

  return {
    appid,
    name,
    capsuleUrl,
    headerUrl: asString(o.header_image),
    discounted: o.discounted === true,
    discountPercent: asNumber(o.discount_percent) ?? 0,
    originalPriceCents: asNumber(o.original_price),
    finalPriceCents: asNumber(o.final_price),
    currency: asString(o.currency),
    // ⚠️ Unreleased titles report `final_price: 0` and carry NO per-item flag, so by
    // fields alone they are indistinguishable from a genuinely free game. The row
    // they arrived in is the only signal. Verified 2026-08-20.
    comingSoon,
    linuxAvailable: o.linux_available === true,
  }
}

/**
 * Shelves in display order, labelled the way the Steam site labels them — the goal
 * is the same content as store.steampowered.com, presented differently.
 *
 * ⚠️ Two of these are APPROXIMATIONS, because `featuredcategories` has no matching
 * section and we have no verified endpoint for them yet:
 *   - "Featured & Recommended" is really top_sellers.
 *   - "Under $10" is derived client-side from the items we already hold.
 * Both are tracked in private/TASKS.md. Everything else is a direct mapping.
 */
const FEATURED_ROWS: ReadonlyArray<{
  key: string
  title: string
  comingSoon?: boolean
}> = [
  { key: 'top_sellers', title: 'Featured & Recommended' },
  { key: 'specials', title: 'Discounts & Events' },
  { key: 'new_releases', title: 'Popular New Releases' },
  { key: 'coming_soon', title: 'Coming Soon', comingSoon: true },
]

/** Ceiling for the "Under $10" shelf, in cents. */
const BUDGET_CEILING_CENTS = 1000

/**
 * Build the "Under $10" shelf from items already fetched.
 *
 * No extra request, so no rate-limit cost. It is genuinely the cheap end of what the
 * home rows returned rather than a true store-wide price query — `search/results`
 * with a price filter would be the real source, but its `json=1` mode returns only
 * name and logo (private/STEAM-ENDPOINTS.md), which is not enough to render a tile.
 */
const buildBudgetRow = (rows: StoreRow[]): StoreRow | undefined => {
  const seen = new Set<number>()
  const items: StoreItem[] = []

  for (const row of rows) {
    for (const item of row.items) {
      const price = item.finalPriceCents
      if (item.comingSoon || price === undefined || price === 0) continue
      if (price > BUDGET_CEILING_CENTS || seen.has(item.appid)) continue
      seen.add(item.appid)
      items.push(item)
    }
  }

  return items.length > 0 ? { id: 'under_10', title: 'Under $10', items } : undefined
}

/**
 * GET /api/featuredcategories — the home rows.
 *
 * Use this and NOT /api/featured, which is degraded: it still returns its shape but
 * `large_capsules` is empty (verified 2026-08-20).
 */
/**
 * How long a store answer stays good.
 *
 * ⚠️ Sized for a living-room store, not a live website. Clay's call, and it is the right
 * one: nothing here changes more than once or twice a day, and the thing being optimised
 * is not freshness — it is not re-spending the rate limit every time someone opens the app.
 * A session lasts 15-45 minutes; the cache that matters is the one on DISK, which survives
 * between launches.
 *
 * ⚠️ The homepage was FIVE MINUTES, which meant a second visit an hour later paid for the
 * entire shelf set again. That is the single most-requested surface in the app.
 *
 * Prices ride along inside these payloads and are therefore up to `STORE_HOURS` stale.
 * Accepted deliberately: Steam discounts change on sale boundaries, not continuously, and
 * a stale price is corrected by the refresh the next launch performs anyway. Anything
 * where being wrong actually costs money goes through a live call at the point of sale —
 * which for this app is Steam itself, since checkout always happens there.
 */
const STORE_HOURS = 4 * 3_600

export const fetchFeaturedRows = async (): Promise<StoreRow[]> => {
  const json = await steamGet({
    host: 'store',
    path: '/api/featuredcategories',
    query: { ...STORE_LOCALE },
    ttlSeconds: STORE_HOURS,
  })

  const root = asRecord(json)
  if (!root) return []

  const rows: StoreRow[] = []
  for (const { key, title, comingSoon } of FEATURED_ROWS) {
    const section = asRecord(root[key])
    const items = Array.isArray(section?.items) ? section.items : []
    // ⚠️ Steam ships exact duplicates inside a row. Verified 2026-08-20: top_sellers
    // returned 10 items with only 8 unique appids — 4435490 and 1675200 each appeared
    // twice, byte-identical. Dedupe WITHIN a row; do NOT dedupe across rows, because a
    // game legitimately appearing in both Specials and Top Sellers matches the real
    // store and removing it would break content parity.
    const seenInRow = new Set<number>()
    const normalized = items
      .map((item) => normalizeItem(item, comingSoon === true))
      .filter((i): i is StoreItem => i !== undefined)
      .filter((item) => {
        if (seenInRow.has(item.appid)) return false
        seenInRow.add(item.appid)
        return true
      })
    // Drop empty rows rather than rendering an empty shelf.
    if (normalized.length > 0) rows.push({ id: key, title, items: normalized })
  }

  const budget = buildBudgetRow(rows)
  if (budget) rows.push(budget)

  return rows
}

/**
 * Hand off to the Steam client. We never reimplement cart or purchase — this is an
 * architectural line, not a v1 shortcut (README §3, private/AUTH-AND-CART.md).
 */
export const openInSteam = async (appid: number): Promise<void> =>
  openExternal(`steam://store/${appid}`)

/**
 * Hand a URL to the system.
 *
 * ⚠️ The one route out of this app, and it is deliberately the only one. Everything
 * the client cannot do itself — buying, wishlisting, installing, reading Bazzite's
 * docs — is handed off rather than reimplemented (README §3), so there is exactly one
 * function to audit for where the app can send someone.
 */
export const openExternal = async (url: string): Promise<void> => {
  const { isTauri } = await import('./index')
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }
  // In a browser a `steam://` link still works when Steam is installed and has
  // registered the scheme; if it hasn't, the navigation is simply ignored.
  if (url.startsWith('steam:')) {
    console.info('[deep-link]', url)
    window.location.href = url
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * A game's trailer, in both forms Steam offers.
 *
 * There is NO microtrailer field in any Steam response. It is derived: the clip
 * lives in the same directory as the adaptive manifest, so you strip the query,
 * take the dirname, and append the filename. Verified live 2026-08-20 against
 * ELDEN RING — 206, video/webm.
 *
 * Progressive VP9, so a plain <video> plays it with no MSE involved — which is the
 * whole reason tile previews can live in the webview while full trailers go to
 * libmpv (private/VIDEO-TRAILERS.md).
 *
 * ⚠️ Derived, therefore fallible. Any non-200 must degrade to the thumbnail still;
 * a missing preview must never blank a tile.
 */
export type TrailerPreview = {
  /** Silent ~6s VP9 loop. Progressive, so a plain <video> plays it. Tile previews. */
  microUrl?: string
  /**
   * Full-length trailer WITH audio, as an HLS manifest.
   *
   * ⚠️ Needs hls.js — `<video src="….m3u8">` fails in WebKitGTK with error 4
   * (`canPlayType` returns ''). MSE is what does the work, and it is verified
   * working on the target: 1080p, real-time, no errors. See VIDEO-TRAILERS.md.
   */
  hlsUrl?: string
  thumbnail?: string
}

/**
 * Trailer assets already fetched by a `GetItems` hydration, keyed by appid.
 *
 * ⚠️ A plain module-level map rather than a cache with a TTL, because it holds no facts
 * that expire: a trailer URL is content-addressed — the path carries a hash and a
 * timestamp — so it either resolves forever or the app has published a new one, and a new
 * one arrives with the next hydration anyway.
 */
const trailerByAppid = new Map<number, TrailerPreview>()

/**
 * The microtrailer, preferring what hydration already paid for.
 *
 * ⚠️ This function used to call `/api/appdetails` once per tile the user rested on. That
 * is the single largest source of traffic this app generates, aimed at the one endpoint
 * with a hard ~200 requests / 5 minutes per IP ceiling — and the shelf hydration was
 * ALREADY asking `GetItems` about those same appids. The trailer now rides that batch.
 *
 * The `appdetails` path stays as a fallback for an appid nothing hydrated — opening a game
 * straight from search or a bundle, where no shelf ever saw it.
 */
export const fetchMicrotrailer = async (appid: number): Promise<TrailerPreview> => {
  const hydrated = trailerByAppid.get(appid)
  // ⚠️ Only when it actually carries a video. An entry with just a thumbnail means the
  // game has no trailer, which is worth honouring — but an EMPTY entry means we asked
  // without `include_trailers`, and falling through to appdetails is right there.
  if (hydrated && (hydrated.microUrl !== undefined || hydrated.hlsUrl !== undefined)) {
    return hydrated
  }

  const json = await steamGet({
    host: 'store',
    path: '/api/appdetails',
    query: { appids: appid, ...STORE_LOCALE },
    ttlSeconds: 21_600, // app details are stable for hours
  })

  const entry = asRecord(asRecord(json)?.[String(appid)])
  // `success: false` is not an error — age-gated and delisted apps both return it,
  // and you cannot tell which from here (private/STEAM-URL-REFERENCE.md §2).
  if (!entry || entry.success !== true) return {}

  const data = asRecord(entry.data)
  const movies = Array.isArray(data?.movies) ? data.movies : []
  if (movies.length === 0) return {}

  const movie = asRecord(movies.find((m) => asRecord(m)?.highlight === true) ?? movies[0])
  if (!movie) return {}

  const thumbnail = asString(movie.thumbnail)
  const hlsUrl = asString(movie.hls_h264)
  const manifest = hlsUrl ?? asString(movie.dash_h264) ?? asString(movie.dash_av1)
  if (!manifest) return { thumbnail }

  const dir = manifest.split('?')[0].split('/').slice(0, -1).join('/')
  return { microUrl: `${dir}/microtrailer.webm`, hlsUrl, thumbnail }
}

const asStringArray = (value: unknown, key: string): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => asString(asRecord(entry)?.[key]))
        .filter((s): s is string => s !== undefined)
    : []

/**
 * GET /api/appdetails — the full store payload for one app (design 6a).
 *
 * ⚠️ `success: false` is not an error. Age-gated adult titles return it with no
 * data, and so does a delisted app — you cannot tell which from here
 * (private/STEAM-URL-REFERENCE.md §2). Both surface as `undefined`.
 */
/**
 * How recently `/api/appdetails` refused us, and why that matters.
 *
 * ⚠️ `fetchMicrotrailer` calls the SAME endpoint, once per tile you rest on while
 * browsing. Steam allows roughly 200 requests per five minutes per IP, so a few minutes
 * of scrolling shelves can spend the budget — and then the details page's own call is
 * refused with `success: false` at HTTP 200, which we were rendering as "age-gated or no
 * longer listed" on games that are neither.
 *
 * ⚠️ Recording it does not fix it; the app still needs to stop spending the budget so
 * freely. What it buys is an honest message and a log line that names the real suspect,
 * instead of a confident accusation against the game.
 */
let lastRefusalAt = 0

const noteAppDetailsRefusal = (): void => {
  lastRefusalAt = Date.now()
}

/** True while a refusal is recent enough that throttling is the better explanation. */
export const appDetailsLikelyThrottled = (): boolean => Date.now() - lastRefusalAt < 300_000

export const fetchAppDetails = async (appid: number): Promise<AppDetails | undefined> => {
  const request = {
    host: 'store' as const,
    path: '/api/appdetails',
    query: { appids: appid, ...STORE_LOCALE },
    ttlSeconds: 21_600,
  }
  const json = await steamGet(request)

  const entry = asRecord(asRecord(json)?.[String(appid)])
  if (!entry || entry.success !== true) {
    /*
     * ⚠️ `success: false` is NOT only "age-gated or delisted". Steam answers exactly
     * this when it is rate-limiting — roughly 200 requests per five minutes per IP — and
     * it does so with HTTP 200, so nothing below the parser can tell the two apart.
     *
     * ⚠️ Which makes caching it actively harmful. On a six-hour TTL one throttled moment
     * renders an ordinary game as permanently unavailable, and reloading does not help
     * because the Tauri backend kept its own copy on disk. Stray, a game on the front
     * page of the store, read "age-gated or no longer listed" for exactly this reason.
     *
     * So forget it and let the next visit ask again.
     */
    forgetSteam(request)
    logEmpty('appdetails', {
      appid,
      success: entry?.success ?? null,
      cached: 'evicted',
      // ⚠️ The most likely cause, and the one the UI used to hide. See noteAppDetailsRefusal.
      likely: 'rate-limited or age-gated — Steam does not say which',
    })
    noteAppDetailsRefusal()
    return undefined
  }

  const data = asRecord(entry.data)
  if (!data) return undefined

  const price = asRecord(data.price_overview)
  const release = asRecord(data.release_date)

  // Category IDs are undocumented and have shifted before, so match on the label
  // rather than trusting id 28 to keep meaning "Full controller support".
  const categories = Array.isArray(data.categories) ? data.categories : []
  const labels = categories
    .map((c) => asString(asRecord(c)?.description)?.toLowerCase() ?? '')
    .filter(Boolean)
  const controllerSupport = labels.some((l) => l.includes('full controller'))
    ? ('full' as const)
    : labels.some((l) => l.includes('partial controller'))
      ? ('partial' as const)
      : undefined

  return {
    appid,
    name: asString(data.name) ?? `App ${appid}`,
    shortDescription: asString(data.short_description) ?? '',
    headerUrl: asString(data.header_image),
    screenshots: Array.isArray(data.screenshots)
      ? data.screenshots
          .map((s) => asString(asRecord(s)?.path_full))
          .filter((s): s is string => s !== undefined)
      : [],
    screenshotThumbs: Array.isArray(data.screenshots)
      ? data.screenshots
          .map((s) => asString(asRecord(s)?.path_thumbnail) ?? asString(asRecord(s)?.path_full))
          .filter((s): s is string => s !== undefined)
      : [],
    genres: asStringArray(data.genres, 'description'),
    developers: Array.isArray(data.developers)
      ? data.developers.filter((d): d is string => typeof d === 'string')
      : [],
    publishers: Array.isArray(data.publishers)
      ? data.publishers.filter((p): p is string => typeof p === 'string')
      : [],
    releaseDate: asString(release?.date) ?? '',
    comingSoon: release?.coming_soon === true,
    isFree: data.is_free === true,
    priceCents: asNumber(price?.final),
    originalPriceCents: asNumber(price?.initial),
    discountPercent: asNumber(price?.discount_percent) ?? 0,
    currency: asString(price?.currency),
    controllerSupport,
    metacritic: asNumber(asRecord(data.metacritic)?.score),
    about: htmlToText(asString(data.about_the_game) ?? asString(data.detailed_description) ?? ''),
    requirementsMinimum: htmlToLines(asString(asRecord(data.pc_requirements)?.minimum)),
    requirementsRecommended: htmlToLines(asString(asRecord(data.pc_requirements)?.recommended)),
    matureNote: asString(asRecord(data.content_descriptors)?.notes),
    // First line only: Steam appends a "*languages with full audio support" footnote
    // that is noise on a tile-sized panel.
    languages: asString(data.supported_languages)
      ? htmlToText(asString(data.supported_languages) as string).split('\n')[0]
      : undefined,
    hasDemo: Array.isArray(data.demos) && data.demos.length > 0,
    achievementsTotal: asNumber(asRecord(data.achievements)?.total) ?? 0,
    achievementsHighlighted: (() => {
      const list = asRecord(data.achievements)?.highlighted
      if (!Array.isArray(list)) return []
      return list
        .map((entry) => {
          const record = asRecord(entry)
          const name = asString(record?.name)
          const icon = asString(record?.path)
          return name && icon ? { name, icon } : undefined
        })
        .filter((a): a is { name: string; icon: string } => a !== undefined)
        .slice(0, 8)
    })(),
    // Steam has no tagline field. The first sentence of the short description is
    // the closest honest equivalent; the design's big pull-quote needs something.
    tagline: (asString(data.short_description) ?? '').split(/(?<=[.!?])\s/)[0]?.trim() || undefined,
  }
}

/**
 * GET /appreviews/<id> — the "Mostly Positive (94,037)" line.
 *
 * `num_per_page=0` returns the rollup without any review bodies. ⚠️ `language=all`
 * matters and must stay consistent: one title reads 35,875 reviews English-only vs
 * 94,037 across all languages, and mixing them makes our numbers disagree with
 * Steam's own UI (private/STEAM-ENDPOINTS.md rule 5).
 */
export const fetchReviewSummary = async (appid: number): Promise<ReviewSummary | undefined> => {
  const json = await steamGet({
    host: 'store',
    path: `/appreviews/${appid}`,
    query: { json: 1, language: 'all', purchase_type: 'all', num_per_page: 0 },
    ttlSeconds: 21_600,
  })

  const summary = asRecord(asRecord(json)?.query_summary)
  const total = asNumber(summary?.total_reviews)
  const description = asString(summary?.review_score_desc)
  if (total === undefined || total === 0 || !description) return undefined

  return {
    scoreDescription: description,
    total,
    positive: asNumber(summary?.total_positive) ?? 0,
  }
}

/**
 * Typeahead search — `steamcommunity.com/actions/SearchApps/<term>`.
 *
 * Returns at most ~10 results carrying appid, name, icon and logo. That is all it
 * carries: no price, no review score, no capsule art. The richer
 * `store/search/results?json=1` is not a substitute — its `json=1` mode returns only
 * name and logo, and does not even include the appid as a field
 * (private/STEAM-URL-REFERENCE.md §2). Good enough to find a game and open its page.
 */
export const searchApps = async (term: string): Promise<StoreItem[]> => {
  const query = term.trim()
  if (query.length === 0) return []

  const json = await steamGet({
    host: 'community',
    path: `/actions/SearchApps/${encodeURIComponent(query)}`,
    // Typing re-issues this per keystroke-pause; a long TTL is what makes backspacing free.
    ttlSeconds: STORE_HOURS,
  })

  if (!Array.isArray(json)) return []

  const results = json
    .map((raw): StoreItem | undefined => {
      const entry = asRecord(raw)
      const appid = Number(asString(entry?.appid) ?? asNumber(entry?.appid))
      const name = asString(entry?.name)
      if (!Number.isFinite(appid) || appid === 0 || !name) return undefined

      const art = asString(entry?.logo) ?? asString(entry?.icon)
      return {
        appid,
        name,
        capsuleUrl: art ?? '',
        headerUrl: art,
        discounted: false,
        discountPercent: 0,
        comingSoon: false,
        linuxAvailable: false,
      }
    })
    .filter((item): item is StoreItem => item !== undefined)

  // ⚠️ `SearchApps` returns name and icon only — no content descriptors, no prices —
  // so search would happily surface the adult titles the home rows now filter out.
  // One batched GetItems over the results is the same request the shelves already make,
  // and it is cached, so a repeated search costs nothing.
  const facts = await fetchStoreItems(results.map((item) => item.appid))

  // ...and having paid for that request, MERGE it rather than reading one field out of
  // it. This used to filter and discard, which was invisible while a result row showed
  // only a name — the moment results became real cards, every one of them said "No
  // reviews" and no price, about games with tens of thousands of reviews.
  return results
    .filter((item) => !isAdultContent(facts.get(item.appid)?.contentDescriptors))
    .map((item) => {
      const extra = facts.get(item.appid)
      if (!extra) return item
      return {
        ...item,
        // `logo`/`icon` from SearchApps is a small list thumbnail; GetItems has the
        // real 2x header.
        headerUrl: extra.headerUrl ?? item.headerUrl,
        capsuleUrl: extra.headerUrl ?? item.capsuleUrl,
        reviewPercent: extra.reviewPercent,
        reviewLabel: extra.reviewLabel,
        releaseDate: extra.releaseDate,
        dealFlag: extra.dealFlag,
        contentDescriptors: extra.contentDescriptors,
        controllerSupport: extra.controllerSupport,
        deckCompat: extra.deckCompat,
        // `SearchApps` has no notion of unreleased, so GetItems is the only source
        // here — without it a search result for an unannounced game reads "Free".
        comingSoon: extra.comingSoon,
        discounted: extra.discounted,
        discountPercent: extra.discountPercent,
        originalPriceCents: extra.originalPriceCents,
        finalPriceCents: extra.finalPriceCents,
      }
    })
}

/**
 * Steam returns several fields as HTML blobs (`about_the_game`, `pc_requirements`,
 * `supported_languages`). We extract TEXT ONLY and never render it as markup —
 * `dangerouslySetInnerHTML` on third-party store content is not a trade worth making.
 */
const htmlToText = (html: string): string => {
  // <br> and </p> carry real separation. Collapsing them away glues sentences to
  // whatever followed — Steam's language list ends "...Ukrainian<br>*languages with
  // full audio support", which without this reads as one nonsense word.
  const withBreaks = html.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
  return (doc.body.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** `pc_requirements` is an HTML `<ul>`; recover the individual lines. */
const htmlToLines = (html: string | undefined): string[] => {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const items = [...doc.querySelectorAll('li')]
    .map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (items.length > 0) return items
  // Some apps ship a bare paragraph instead of a list.
  const text = htmlToText(html).replace(/^(Minimum|Recommended):\s*/i, '')
  return text ? text.split('\n').filter(Boolean) : []
}

/**
 * Steam's own localization tokens for discount presets -> the design's flag copy.
 *
 * `active_discounts[].discount_description` is a token like
 * `#discount_desc_preset_special`, NOT display text. Only tokens actually observed
 * are mapped; anything else gets the neutral fallback rather than invented wording,
 * because a flag that confidently says "WEEKEND DEAL" on a Tuesday is worse than one
 * that says "SPECIAL OFFER" always.
 */
const DEAL_FLAG_LABELS: Record<string, string> = {
  '#discount_desc_preset_weekend_deal': 'WEEKEND DEAL',
  '#discount_desc_preset_daily_deal': "TODAY'S DEAL",
  '#discount_desc_preset_midweek_madness': 'MIDWEEK DEAL',
  '#discount_desc_preset_free_weekend': 'FREE WEEKEND',
}

const DEAL_FLAG_FALLBACK = 'SPECIAL OFFER'

/** Gradients lifted from the design (which lifted them from Steam's own store). */
export const DEAL_FLAG_GRADIENTS: Record<string, string> = {
  'WEEKEND DEAL':
    'linear-gradient(315deg, rgb(183,37,90) 5%, rgb(140,28,95) 50%, rgb(97,14,93) 95%)',
  "TODAY'S DEAL":
    'linear-gradient(315deg, rgb(16,124,101) 5%, rgb(46,121,159) 50%, rgb(55,73,132) 95%)',
  'MIDWEEK DEAL':
    'linear-gradient(315deg, rgb(16,124,101) 5%, rgb(46,121,159) 50%, rgb(55,73,132) 95%)',
  'FREE WEEKEND':
    'linear-gradient(315deg, rgb(150,40,165) 5%, rgb(110,32,150) 50%, rgb(74,24,130) 95%)',
  [DEAL_FLAG_FALLBACK]:
    'linear-gradient(315deg, rgb(16,124,101) 5%, rgb(46,121,159) 50%, rgb(55,73,132) 95%)',
}

const STORE_ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/'

/**
 * GetItems returns asset FILENAMES plus a template, not whole URLs:
 * `asset_url_format: "steam/apps/1643320/${FILENAME}?t=…"`.
 */
const assetUrl = (
  assets: Record<string, unknown> | undefined,
  ...fields: string[]
): string | undefined => {
  const format = asString(assets?.asset_url_format)
  if (!format) return undefined
  for (const field of fields) {
    const file = asString(assets?.[field])
    if (file) return `${STORE_ASSET_BASE}${format.split('${FILENAME}').join(file)}`
  }
  return undefined
}

/**
 * Trailer assets live on a DIFFERENT CDN than store art.
 *
 * ⚠️ Store assets are `shared.akamai.steamstatic.com/store_item_assets/`; trailers are
 * `video.akamai.steamstatic.com/store_trailers/`. Building a trailer URL on the asset base
 * returns a 404 HTML page, not an error — verified 2026-08-23 by doing exactly that. The
 * thumbnail is the exception and DOES live on the asset base, because it is a still.
 *
 * ⚠️ The PATH always comes from the response, never from the appid. Steam's asset paths
 * carry a content hash and a timestamp (`1332010/480740/52e229bc…/1750673003/…`) and there
 * is no rule that derives them — anything built as `/<appid>/<name>.jpg` is guessing and
 * will be wrong for some apps. Only the BASE is ours, because `GetItems` hands back a
 * relative `filename`/`cdn_path` for trailers with no base to go with it.
 *
 * ⚠️ Which makes the base the fragile part. If Valve moves the video CDN this returns 404s,
 * so a failed load must degrade to the still — never to a blank tile. That rule already
 * governs `TrailerPreview` and it is what keeps this safe to depend on.
 */
const TRAILER_BASE = 'https://video.akamai.steamstatic.com/store_trailers/'

/** Record what a hydration learned, so the trailer never costs a second request. */
const rememberTrailers = (appid: number, preview: TrailerPreview): TrailerPreview => {
  if (preview.microUrl !== undefined || preview.hlsUrl !== undefined) {
    trailerByAppid.set(appid, preview)
  }
  return preview
}

/**
 * Pull the trailer set out of a `GetItems` item.
 *
 * ⚠️ This is what lets the microtrailer stop costing a request. `fetchMicrotrailer` used to
 * call `/api/appdetails` once per tile the user rested on — the single largest source of
 * traffic this app generates, against the one endpoint with a ~200 req / 5 min ceiling —
 * while the shelf hydration was ALREADY calling `GetItems` for those same appids. The
 * trailer now rides a batch that was happening anyway.
 *
 * Verified 2026-08-23: all three URLs resolve (206 video/webm, 206 mpegurl, 206 image/jpeg).
 */
const trailersFrom = (item: Record<string, unknown> | undefined): TrailerPreview => {
  const highlights = asRecord(item?.trailers)?.highlights
  const first = Array.isArray(highlights) ? asRecord(highlights[0]) : undefined
  if (!first) return {}

  // ⚠️ webm specifically. The array also carries an mp4, but the VP9 webm is the one a
  // plain <video> plays progressively in WebKitGTK with no MSE involved.
  const micro = Array.isArray(first.microtrailer)
    ? asRecord(first.microtrailer.find((m) => asRecord(m)?.type === 'video/webm'))
    : undefined

  const adaptive = Array.isArray(first.adaptive_trailers) ? first.adaptive_trailers : []
  // hls_h264 rather than dash: WebKitGTK plays it through hls.js, verified on the box.
  const hls = asRecord(adaptive.find((a) => asRecord(a)?.encoding === 'hls_h264'))

  const microFile = asString(micro?.filename)
  const hlsPath = asString(hls?.cdn_path)
  const still = asString(first.screenshot_medium)
  const format = asString(first.trailer_url_format)

  return {
    microUrl: microFile ? `${TRAILER_BASE}${microFile}` : undefined,
    hlsUrl: hlsPath ? `${TRAILER_BASE}${hlsPath}` : undefined,
    // The still is a store asset, not a trailer asset — different base, same as art.
    thumbnail:
      still && format ? `${STORE_ASSET_BASE}${format.split('${FILENAME}').join(still)}` : undefined,
  }
}

/** The subset of `GetItems` we actually consume, already normalized. */
export type StoreItemFacts = Pick<
  StoreItem,
  | 'name'
  | 'headerUrl'
  | 'reviewPercent'
  | 'reviewLabel'
  | 'shortDescription'
  | 'releaseDate'
  | 'comingSoon'
  | 'discountEndsAt'
  | 'dealFlag'
  | 'contentDescriptors'
  | 'discounted'
  | 'discountPercent'
  | 'originalPriceCents'
  | 'finalPriceCents'
  | 'controllerSupport'
  | 'deckCompat'
  | 'linuxAvailable'
> & {
  /**
   * Trailer assets, carried on the hydration that was already happening.
   *
   * ⚠️ Optional because `include_trailers` is only asked for where it is wanted; a caller
   * that does not request it gets `undefined`, not an empty object pretending there is no
   * trailer.
   */
  trailers?: TrailerPreview
}

export const fetchStoreItems = async (
  appids: readonly number[],
): Promise<Map<number, StoreItemFacts>> => {
  const out = new Map<number, StoreItemFacts>()
  const unique = [...new Set(appids)]
  if (unique.length === 0) return out

  try {
    const json = await steamGet({
      host: 'api',
      path: '/IStoreBrowseService/GetItems/v1/',
      query: {
        input_json: JSON.stringify({
          ids: unique.map((appid) => ({ appid })),
          context: {
            language: 'english',
            country_code: STORE_LOCALE.cc,
            steam_realm: 1,
          },
          data_request: {
            include_assets: true,
            include_release: true,
            include_platforms: true,
            include_basic_info: true,
            include_reviews: true,
            /*
             * ⚠️ The change that takes the microtrailer off `/api/appdetails`. It costs
             * nothing here — the shelf already batches this call for these appids — and it
             * removes one appdetails request per tile the user rests on, against the one
             * endpoint with a hard ~200 req / 5 min ceiling.
             */
            include_trailers: true,
          },
        }),
      },
      ttlSeconds: 21600, // app facts are stable for hours, like appdetails
    })

    const items = asRecord(asRecord(json)?.response)?.store_items
    if (!Array.isArray(items)) return out

    for (const raw of items) {
      const o = asRecord(raw)
      const appid = asNumber(o?.appid)
      if (!o || appid === undefined) continue

      // `summary_filtered` is what the store itself shows. `summary_unfiltered` and
      // `summary_language_specific` also exist and disagree by a few points; picking
      // one and staying with it matters more than which.
      const reviews = asRecord(asRecord(o.reviews)?.summary_filtered)
      // ⚠️ A game with no reviews still comes back with `percent_positive: 0`, which
      // renders as a confident "0% 👎" — the worst possible reading of "we don't
      // know". The count is the only field that distinguishes them.
      const reviewCount = asNumber(reviews?.review_count) ?? 0
      const purchase = asRecord(o.best_purchase_option)
      /*
       * ⚠️ A free-to-play app has NO `best_purchase_option` at all — the field is
       * simply absent, which is indistinguishable from "we could not read a price"
       * unless `is_free` is consulted. Without this, The WereCleaner and Counter-Strike
       * 2 rendered with a blank where the price goes, on every surface.
       *
       * ⚠️ And `is_free` does NOT imply released. CRAWLER (3859880) is `is_free: true`
       * AND `is_coming_soon: true` on the same response, so every call site must resolve
       * `comingSoon` BEFORE formatting a price — `formatPrice(0)` says "Free" and would
       * advertise an unreleased game as playable today. See Tile.tsx.
       */
      const isFree = o.is_free === true
      const release = asRecord(o.release)
      const discounts = purchase?.active_discounts
      const firstDiscount = Array.isArray(discounts) ? asRecord(discounts[0]) : undefined
      const token = asString(firstDiscount?.discount_description)

      const discountPercent = asNumber(purchase?.discount_pct) ?? 0

      out.set(appid, {
        name: asString(o.name) ?? '',
        // ⚠️ 2x art. `featuredcategories` only ever hands back the 460x215 header, and
        // this app renders tiles up to 672 CSS px wide at 4K — a 1x asset is upscaled
        // by ~1.5 and reads as soft at couch distance. header_2x is 920x430.
        //
        // ⚠️ ...but plenty of apps ship NO 2x header at all. Hades has `header`,
        // `hero_capsule`, `library_capsule` and `library_capsule_2x` and neither
        // `header_2x` nor `main_capsule_2x`. This went unnoticed for as long as
        // hydration only ever UPGRADED a url `featuredcategories` had already supplied
        // — `extra.headerUrl ?? item.headerUrl` quietly kept the 1x. Tag browsing has
        // no such base, so those apps rendered as blank plates. A soft header beats no
        // header, so plain `header` is the last resort.
        headerUrl: assetUrl(
          asRecord(o.assets),
          'header_2x',
          'main_capsule_2x',
          'hero_capsule_2x',
          'header',
        ),
        reviewPercent: reviewCount > 0 ? asNumber(reviews?.percent_positive) : undefined,
        reviewLabel: reviewCount > 0 ? asString(reviews?.review_score_label) : undefined,
        shortDescription: asString(asRecord(o.basic_info)?.short_description),
        releaseDate: asNumber(release?.steam_release_date),
        // Valve's own flag, not a date comparison. An unreleased app can carry a
        // placeholder `steam_release_date` in the past, and "release date is a Tuesday
        // that already happened" is not the same claim as "it is out".
        comingSoon: release?.is_coming_soon === true,
        discountEndsAt: asNumber(firstDiscount?.discount_end_date),
        // A flag is only meaningful alongside an actual discount.
        // ⚠️ The endpoints do NO content filtering — that happens in Steam's web
        // frontend from account preferences we do not have. This is the only signal
        // we get, and without it adult titles land on a living-room TV.
        contentDescriptors: Array.isArray(o.content_descriptorids)
          ? o.content_descriptorids.filter((id): id is number => typeof id === 'number')
          : undefined,
        dealFlag:
          discountPercent > 0
            ? ((token ? DEAL_FLAG_LABELS[token] : undefined) ?? DEAL_FLAG_FALLBACK)
            : undefined,
        discounted: discountPercent > 0,
        discountPercent,
        // Prices arrive as STRINGS here ("4199"), unlike featuredcategories' numbers.
        originalPriceCents: numericString(purchase?.original_price_in_cents),
        // `?? (isFree ? 0 : undefined)` and not `isFree ? 0 : …`: if Steam ever ships
        // both, the real number wins. 0 is the codebase's word for free (formatPrice).
        finalPriceCents: numericString(purchase?.final_price_in_cents) ?? (isFree ? 0 : undefined),
        // Both of these were already in this response and were being discarded — the
        // request below is unchanged, so they cost nothing. `controllerSupport` is
        // what fills the design's "Full controller support" badge, and `deckCompat`
        // closes the gap the design's own notes record as "no verified endpoint yet".
        controllerSupport: controllerSupportFrom(o.categories),
        deckCompat: deckCompatFrom(o.platforms),
        trailers: rememberTrailers(appid, trailersFrom(o)),
        // ⚠️ Was declared on StoreItem and hardcoded `false` at every call site since
        // the first commit — the field existed, nothing ever filled it. `platforms`
        // was already in this response.
        linuxAvailable: linuxNativeFrom(o.platforms),
      })
    }
  } catch {
    // Hydration is additive: a failure leaves tiles showing what the shelf already
    // knew rather than blanking them.
  }

  return out
}

/** GetItems reports money as decimal strings; featuredcategories reports numbers. */
const numericString = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string' || v.length === 0) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Concurrent players, right now — `GetNumberOfCurrentPlayers`.
 *
 * Notably needs **no API key** (private/STEAM-URL-REFERENCE.md §1). Point-in-time only:
 * there is no history behind it, so never draw a trend from a single call.
 */
export const fetchPlayerCount = async (appid: number): Promise<number | undefined> => {
  try {
    const json = await steamGet({
      host: 'api',
      path: '/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',
      query: { appid },
      /*
       * ⚠️ The ONE thing here that is genuinely live, and the only short TTL left on a
       * details page. The card says "right now", so an hours-old figure would be a lie
       * rather than merely stale — and unlike a price, nobody spends money on it.
       *
       * 15 minutes rather than 10: reopening the same game twice in a browsing session
       * must cost nothing, and 15 covers a session comfortably. Everything else on this
       * page is on the four-hour store TTL, so a second visit within that window makes
       * NO external request at all.
       */
      ttlSeconds: 900,
    })
    const count = asNumber(asRecord(asRecord(json)?.response)?.player_count)
    return count
  } catch {
    return undefined
  }
}

/**
 * Human names for store tag ids — `IStoreService/GetLocalizedNameForTags`.
 *
 * ⚠️ private/STEAM-ENDPOINTS.md says this one needs an API key. **It does not.**
 * Verified 2026-08-21: HTTP 200 with full data, no key and no session, e.g.
 * `input_json={"tagids":[1695,1663],"language":"english"}` →
 * `{"response":{"tags":[{"tagid":1695,"english_name":"Open World","name":"Open World",…}]}}`.
 * The catalog entry is stale; this is the sample that corrects it.
 *
 * Batched, and tag names are effectively immutable — a day's TTL (the same one the
 * ProtonDB ratings use) keeps this off the rate-limit budget entirely.
 */
export const fetchTagNames = async (tagids: number[]): Promise<Map<number, string>> => {
  const names = new Map<number, string>()
  if (tagids.length === 0) return names

  const json = await steamGet({
    host: 'api',
    path: '/IStoreService/GetLocalizedNameForTags/v1/',
    // The whole argument list goes as ONE url-encoded JSON blob; this service does
    // not accept repeated `tagids[0]=` parameters.
    query: { input_json: JSON.stringify({ tagids, language: 'english' }) },
    ttlSeconds: 86_400,
  })

  const list = asRecord(asRecord(json)?.response)?.tags
  if (!Array.isArray(list)) return names

  for (const raw of list) {
    const o = asRecord(raw)
    const tagid = asNumber(o?.tagid)
    // `name` is the localized one and `english_name` the fallback; with
    // language=english they agree, but the shape allows them not to.
    const name = asString(o?.name) ?? asString(o?.english_name)
    if (tagid !== undefined && name) names.set(tagid, name)
  }

  return names
}

/** What the design's "Popular user-defined tags" row shows (6b). */
const POPULAR_TAG_COUNT = 7

/**
 * The tags Steam shows under a store listing, most-voted first.
 *
 * Two requests, both cached hard: `GetItems` for this app's tagids and weights, then
 * one `GetLocalizedNameForTags` to name them. It does NOT ride along with
 * `fetchStoreItems` — that call is shelf hydration for many apps and asks for no
 * tags, and widening it would put a tag lookup behind every visible tile.
 *
 * ⚠️ Weight is the only ordering signal; `tags` itself arrives unordered. A tag we
 * cannot name is dropped rather than shown as a number, and any failure returns an
 * empty list so the caller can omit the section entirely.
 */
export const fetchPopularTags = async (
  appid: number,
  limit = POPULAR_TAG_COUNT,
): Promise<string[]> => {
  try {
    const json = await steamGet({
      host: 'api',
      path: '/IStoreBrowseService/GetItems/v1/',
      query: {
        input_json: JSON.stringify({
          ids: [{ appid }],
          context: {
            language: 'english',
            country_code: STORE_LOCALE.cc,
            steam_realm: 1,
          },
          // Ask for more than we show: the response is already paid for, and the
          // extras cost nothing once a tag turns out to be unnameable.
          data_request: { include_tag_count: 20 },
        }),
      },
      ttlSeconds: 21_600, // tags move about as fast as the rest of the listing
    })

    const items = asRecord(asRecord(json)?.response)?.store_items
    const item = Array.isArray(items) ? asRecord(items[0]) : undefined
    const raw = Array.isArray(item?.tags) ? item.tags : []

    const ranked = raw
      .map((entry): StoreTag | undefined => {
        const o = asRecord(entry)
        const tagid = asNumber(o?.tagid)
        return tagid === undefined ? undefined : { tagid, weight: asNumber(o?.weight) ?? 0 }
      })
      .filter((tag): tag is StoreTag => tag !== undefined)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)

    if (ranked.length === 0) return []

    const names = await fetchTagNames(ranked.map((tag) => tag.tagid))
    return ranked
      .map((tag) => names.get(tag.tagid))
      .filter((name): name is string => name !== undefined)
  } catch {
    return []
  }
}

/* ─────────────────────────── Editions and bundles ─────────────────────────── */

/**
 * Design turn 14 — the ways to buy a game, and the thing Steam will not let you do:
 * walk INTO a bundle rather than treating it as one opaque purchase.
 *
 * ⚠️ Verified live 2026-08-22, recorded in private/STEAM-ENDPOINTS.md. Nothing here is
 * scraped. `IStoreBrowseService/GetItems` — the same endpoint `fetchStoreItems` already
 * uses — returns `purchase_options[]` when asked, and that array carries BOTH
 * `packageid` editions and `bundleid` bundles. The same endpoint resolves a bundle by
 * id, which is what makes `/bundle/<id>` renderable in this client at all.
 *
 * ⚠️ `actions/ajaxresolvebundles` also works and is NOT used, for a reason worth
 * recording: on bundle 232 it returned `final_price: 0` alongside
 * `formatted_final_price: "$116.84"`, and `initial_price: 12984` alongside
 * `formatted_orig_price: "$116.86"`. Its numeric fields disagree with its own formatted
 * ones. A price that is silently zero is the worst failure this app could ship, so the
 * endpoint whose numbers are self-consistent wins.
 */

/** One way to buy this game: the base package, a fancier edition, or a bundle. */
export type PurchaseOption = {
  /** Exactly one of these is set — it is what distinguishes an edition from a bundle. */
  packageid?: number
  bundleid?: number
  name: string
  /** How many games are in it. 1 for a plain edition. */
  gameCount: number
  formattedFinalPrice?: string
  /** Pre-sale price. Absent when there is no sale. */
  formattedOriginalPrice?: string
  /** The sale discount, INCLUDING the bundle's own. */
  discountPercent?: number
  /**
   * The bundle's standing discount for buying the items together.
   *
   * ⚠️ Different from `discountPercent`, and the design draws both: 14a strikes this
   * one through and prints the combined figure in green. On Stray's Soundtrack Edition
   * they are 4% and 53% — the bundle saves 4%, the sale does the rest. Showing only one
   * of them misstates what the offer actually is.
   */
  bundleDiscountPercent?: number
  /** What the items cost together before the bundle discount. */
  formattedPriceBeforeBundleDiscount?: string
}

/** A bundle's own page — design 14b. */
export type BundleDetails = {
  bundleid: number
  name: string
  headerUrl?: string
  /** The apps inside, in the order Steam lists them. */
  appids: number[]
  formattedFinalPrice?: string
  formattedOriginalPrice?: string
  discountPercent?: number
  bundleDiscountPercent?: number
}

const purchaseOptionFrom = (raw: unknown): PurchaseOption | undefined => {
  const o = asRecord(raw)
  if (!o) return undefined
  const packageid = asNumber(o.packageid)
  const bundleid = asNumber(o.bundleid)
  // Neither id means we cannot route anywhere from it, which makes it undrawable —
  // every row on 14a is something you can press A on.
  if (packageid === undefined && bundleid === undefined) return undefined
  return {
    packageid,
    bundleid,
    name: asString(o.purchase_option_name) ?? '',
    gameCount: asNumber(o.included_game_count) ?? 1,
    formattedFinalPrice: asString(o.formatted_final_price),
    formattedOriginalPrice: asString(o.formatted_original_price),
    discountPercent: asNumber(o.discount_pct),
    bundleDiscountPercent: asNumber(o.bundle_discount_pct),
    formattedPriceBeforeBundleDiscount: asString(o.formatted_price_before_bundle_discount),
  }
}

/**
 * Every way to buy one game — the base package, its editions, and every bundle it is in.
 *
 * Returns `[]` on any failure, and an empty list is a normal answer: plenty of games
 * are in no bundle at all. ⚠️ 14a must then draw the base row ALONE rather than an
 * empty frame — a heading with nothing under it reads as a load that failed.
 */
export const fetchPurchaseOptions = async (appid: number): Promise<PurchaseOption[]> => {
  try {
    const json = await steamGet({
      host: 'api',
      path: '/IStoreBrowseService/GetItems/v1/',
      query: {
        input_json: JSON.stringify({
          ids: [{ appid }],
          context: { language: 'english', country_code: STORE_LOCALE.cc, steam_realm: 1 },
          data_request: { include_all_purchase_options: true, include_basic_info: true },
        }),
      },
      // Same six hours as the rest of the app-fact hydration. Prices move on sale
      // boundaries, not minute to minute.
      ttlSeconds: 21600,
    })

    const items = asRecord(asRecord(json)?.response)?.store_items
    const item = Array.isArray(items) ? asRecord(items[0]) : undefined
    const options = item?.purchase_options
    if (!Array.isArray(options)) return []
    return options
      .map(purchaseOptionFrom)
      .filter((option): option is PurchaseOption => option !== undefined)
  } catch {
    return []
  }
}

/**
 * One bundle, with the appids inside it — design 14b.
 *
 * ⚠️ The included apps come back WITHOUT reviews: `include_reviews` is honoured for the
 * bundle itself and the per-app `reviews` object arrives empty (verified on bundle 234).
 * So the drill-in page hydrates the returned appids through `fetchStoreItems`, which is
 * a second call and cannot be avoided — the design's cards carry a review score each.
 */
export const fetchBundle = async (bundleid: number): Promise<BundleDetails | undefined> => {
  try {
    const json = await steamGet({
      host: 'api',
      path: '/IStoreBrowseService/GetItems/v1/',
      query: {
        input_json: JSON.stringify({
          ids: [{ bundleid }],
          context: { language: 'english', country_code: STORE_LOCALE.cc, steam_realm: 1 },
          data_request: {
            include_included_items: true,
            include_basic_info: true,
            include_assets: true,
            include_all_purchase_options: true,
          },
        }),
      },
      ttlSeconds: 21600,
    })

    const items = asRecord(asRecord(json)?.response)?.store_items
    const item = Array.isArray(items) ? asRecord(items[0]) : undefined
    if (!item || item.success !== 1) return undefined

    const included = asRecord(item.included_items)?.included_apps
    const appids = Array.isArray(included)
      ? included
          .map((entry) => asNumber(asRecord(entry)?.appid))
          .filter((id): id is number => id !== undefined)
      : []

    const best = asRecord(item.best_purchase_option)
    return {
      bundleid,
      name: asString(item.name) ?? '',
      headerUrl: assetUrl(asRecord(item.assets), 'header_2x', 'main_capsule_2x', 'header'),
      appids,
      formattedFinalPrice: asString(best?.formatted_final_price),
      formattedOriginalPrice: asString(best?.formatted_original_price),
      discountPercent: asNumber(best?.discount_pct),
      bundleDiscountPercent: asNumber(best?.bundle_discount_pct),
    }
  } catch {
    return undefined
  }
}

/**
 * Hand a bundle off to the Steam client — the one step that leaves, per design 14b.
 *
 * ⚠️ `steam://store/<id>` takes an APPID only; there is no bundle form of it. The
 * `openurl` verb is the documented way to hand the client an arbitrary store page, and
 * it opens in Steam's own browser rather than the system one, which is what keeps a
 * purchase inside Steam. ⚠️ Unverified on the box — it cannot be tested from a
 * development machine, and it is the single most important link on the bundle page.
 */
export const openBundleInSteam = async (bundleid: number): Promise<void> =>
  openExternal(`steam://openurl/https://store.steampowered.com/bundle/${bundleid}/`)
