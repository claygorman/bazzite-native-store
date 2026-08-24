/**
 * Normalized domain types.
 *
 * Steam's raw JSON shapes are undocumented and drift (private/STEAM-ENDPOINTS.md), so
 * nothing above the transport layer touches them directly. Normalization happens
 * exactly once, in TypeScript (src/platform/steam.ts) — the Rust backend is only a
 * caching fetcher and deliberately does not know these shapes. One parser, not two.
 */

export type StoreItem = {
  appid: number
  name: string
  /** 616x353-ish capsule. Always present; we fall back through Steam's variants. */
  capsuleUrl: string
  /** 460x215 header art — the ratio the design's tiles use. */
  headerUrl?: string
  discounted: boolean
  /** 0-100 */
  discountPercent: number
  originalPriceCents?: number
  finalPriceCents?: number
  currency?: string
  /**
   * Derived from the containing row, NOT from the item — Steam sends unreleased
   * titles as `final_price: 0` with no distinguishing flag.
   */
  comingSoon: boolean
  /** Steam's own native-Linux flag. Worth surfacing on this platform. */
  linuxAvailable: boolean

  /*
   * Everything below is hydrated separately by `fetchStoreItems` (batched
   * IStoreBrowseService/GetItems), so it is absent on first paint and arrives a
   * moment later. The tile caption must render correctly with all of it missing —
   * a shelf that reflows when the second request lands is worse than one that
   * fills in quietly.
   */

  /** 0-100 positive, from `reviews.summary_filtered.percent_positive`. */
  reviewPercent?: number
  /** Steam's own wording, e.g. 'Very Positive'. */
  reviewLabel?: string
  /**
   * One-sentence store blurb, from `basic_info.short_description`.
   *
   * ⚠️ Not a marketing headline. The spotlight artboard draws a `headline` above the
   * game's name; Steam's real spotlights get that from a marketing announcement we have
   * no anonymous access to. This is the nearest true field, so it renders BELOW the
   * name where a description belongs rather than above it pretending to be a tagline.
   */
  shortDescription?: string
  /** Unix seconds. `appdetails` only offers a display string; this one is real. */
  releaseDate?: number
  /** Unix seconds — `appdetails` has no equivalent. */
  discountEndsAt?: number
  /** Display text for the corner deal flag, e.g. 'WEEKEND DEAL'. */
  dealFlag?: string
  /**
   * Steam's `content_descriptorids`. Undefined means NOT HYDRATED, not "safe" —
   * see src/platform/contentFilter.ts.
   */
  contentDescriptors?: number[]
  /**
   * Gamepad support, from Steam's own store categories.
   *
   * `'none'` is a real answer — Steam says this game has no gamepad support — while
   * `undefined` means the item has not been hydrated yet. The distinction matters on
   * a controller-only device: "we don't know" and "you cannot play this with the pad
   * in your hand" must not render the same way.
   */
  controllerSupport?: ControllerSupport
  /** Valve's own verdict for this title on Deck-class hardware. */
  deckCompat?: DeckCompat
}

/** Steam's store categories 28 (full) and 18 (partial). See `private/STEAM-ENDPOINTS.md`. */
export type ControllerSupport = 'full' | 'partial' | 'none'

/**
 * `platforms.steam_deck_compat_category`.
 *
 * Not the same claim as a ProtonDB tier and not a substitute for it: this is Valve
 * testing a build on its own hardware, ProtonDB is aggregated community reports. They
 * disagree often enough to be worth showing together.
 */
export type DeckCompat = 'unknown' | 'unsupported' | 'playable' | 'verified'

/** Display text for a Deck verdict. `unknown` has none — render nothing, not "Unknown". */
export const DECK_COMPAT_LABEL: Record<DeckCompat, string> = {
  unknown: '',
  unsupported: 'Unsupported',
  playable: 'Playable',
  verified: 'Verified',
}

export type StoreRow = {
  id: string
  title: string
  items: StoreItem[]
}

export const formatPrice = (cents: number | undefined, currency = 'USD'): string => {
  if (cents === undefined) return ''
  if (cents === 0) return 'Free'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
  } catch {
    // Unknown currency code from an unexpected `cc` — degrade rather than throw.
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

/** Normalized `appdetails`, for the game details page (design 6a). */
export type AppDetails = {
  appid: number
  name: string
  shortDescription: string
  headerUrl?: string
  /** Full-size screenshots, used for the hero panel and the ambient wash. */
  screenshots: string[]
  /** Matching thumbnails for the filmstrip — much cheaper than full frames. */
  screenshotThumbs: string[]
  genres: string[]
  developers: string[]
  publishers: string[]
  releaseDate: string
  comingSoon: boolean
  isFree: boolean
  priceCents?: number
  originalPriceCents?: number
  discountPercent: number
  currency?: string
  /** 'full' | 'partial' | undefined — from Steam's `categories`. */
  controllerSupport?: 'full' | 'partial'
  metacritic?: number
  /** Plain text, extracted from Steam's HTML `about_the_game`. Never rendered as HTML. */
  about: string
  /** Parsed out of the HTML blobs in `pc_requirements`. */
  requirementsMinimum: string[]
  requirementsRecommended: string[]
  matureNote?: string
  languages?: string
  /**
   * The demo's OWN appid, when the game has one.
   *
   * ⚠️ Not a boolean. `appdetails` answers `demos: [{appid, description}]` and this
   * used to be reduced to `hasDemo: true`, which is why the demo could only ever be a
   * sentence telling you to go and find it in Steam yourself — the one thing needed to
   * act on it was thrown away at the parse. The appid is a real store entry with its own
   * name, price and page (`type: "demo"`, `fullgame` pointing back here).
   */
  demoAppid?: number
  /** Total achievements, and a few highlighted ones with icons. */
  achievementsTotal: number
  achievementsHighlighted: Array<{ name: string; icon: string }>
  /** Short marketing line — Steam has no dedicated field, so this is derived. */
  tagline?: string
}

/** Review rollup from `/appreviews`. */
export type ReviewSummary = {
  scoreDescription: string
  total: number
  positive: number
}

/**
 * One popular user-defined tag, as `IStoreBrowseService/GetItems` reports it.
 *
 * ⚠️ Steam sends tag IDs, never names — resolving them is a second call
 * (`fetchTagNames`). The weight is the vote count behind the tag and is the only
 * thing that orders them; the array itself arrives in no meaningful order.
 */
export type StoreTag = {
  tagid: number
  weight: number
}
