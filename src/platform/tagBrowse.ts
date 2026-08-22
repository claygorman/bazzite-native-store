import { steamGet } from './transport'
import { STORE_LOCALE } from './steam'
import { parseSearchResults, type SearchPage } from './searchResults.ts'

/**
 * Browse by tag — the third way in, alongside the home shelves and search.
 *
 * ⚠️ Read `private/STEAM-ENDPOINTS.md` § "Tag browsing" before changing anything here.
 * Three things about this corner of Steam are counter-intuitive enough to undo by
 * accident:
 *
 * 1. **Steam publishes no tag taxonomy.** `GetTagList` returns `tagid` and `name` and
 *    nothing else — no parents, no categories, no counts. The groups below are ours.
 * 2. **The sort is also a filter.** Asking for the same tag with a different sort
 *    returns a different TOTAL, not just a different order. Roguelike is 5,214 games
 *    sorted by reviews and 20,054 by relevance, because sorting by reviews silently
 *    drops everything with none. Any count on screen must come from the query that
 *    produced the list beside it.
 * 3. **Nothing here filters adult content.** We pass `ignore_preferences=1`, and Steam
 *    would not filter for an anonymous caller anyway. Callers MUST run results through
 *    `contentFilter.ts` after hydration.
 */

/* ─────────────────────────── tags ─────────────────────────── */

export type StoreTagInfo = { tagid: number; name: string }

/**
 * Every store tag Steam knows about — 446 of them as of 2026-08-21.
 *
 * Keyless, verified. The response carries a `version_hash` that changes when the list
 * does; tags essentially never change, so a day is a conservative TTL.
 */
export const fetchAllTags = async (): Promise<StoreTagInfo[]> => {
  try {
    const json = await steamGet({
      host: 'api',
      path: '/IStoreService/GetTagList/v1/',
      query: { language: 'english' },
      ttlSeconds: 86_400,
    })
    const list = (json as { response?: { tags?: unknown } } | null)?.response?.tags
    if (!Array.isArray(list)) return []
    return list.flatMap((raw) => {
      const o = raw as Record<string, unknown> | null
      const tagid = typeof o?.tagid === 'number' ? o.tagid : undefined
      const name = typeof o?.name === 'string' && o.name.length > 0 ? o.name : undefined
      return tagid !== undefined && name !== undefined ? [{ tagid, name }] : []
    })
  } catch {
    return []
  }
}

/**
 * Tags Steam declines to put in front of anyone browsing a living room television.
 *
 * ⚠️ This is a floor, not a ceiling. Individual results are still filtered on
 * `content_descriptorids` after hydration — this only stops the PICKER offering
 * "Sexual Content" as a browsable category, which it otherwise would, because
 * `GetTagList` hands back the whole vocabulary with no marking of any kind.
 */
const HIDDEN_TAGS: ReadonlySet<string> = new Set([
  'Nudity',
  'Sexual Content',
  'Sexual Themes',
  'NSFW',
  'Hentai',
  'Mature',
])

export const isBrowsableTag = (tag: StoreTagInfo): boolean => !HIDDEN_TAGS.has(tag.name)

/**
 * The picker's groups.
 *
 * ⚠️ Hand-curated, and it has to be: `GetTagList` returns a flat list of 446 names with
 * no grouping field, and `GetMostPopularTags` only reorders the same flat list. The
 * design asks for "groups across the top, 16 tags to a group", so this is content, not
 * data — which also means a tag renamed upstream silently drops out of its group. Names
 * are resolved against the live list at load and anything unmatched is skipped rather
 * than rendered as a dead tile.
 *
 * Seeded from `GetMostPopularTags` order so the first group is genuinely what people
 * browse most, rather than what we happen to like.
 */
export const TAG_GROUPS: ReadonlyArray<{ label: string; tags: readonly string[] }> = [
  {
    label: 'Popular',
    tags: [
      'Indie', 'Action', 'Adventure', 'Casual', 'Singleplayer', 'Simulation', 'RPG',
      'Strategy', '2D', 'Early Access', '3D', 'Free to Play', 'Atmospheric', 'Story Rich',
      'Colorful', 'Exploration',
    ],
  },
  {
    label: 'Genre',
    tags: [
      'Roguelike', 'Metroidvania', 'Platformer', 'Shooter', 'FPS', 'Puzzle', 'Racing',
      'Sports', 'Fighting', 'Horror', 'Survival', 'Visual Novel', 'Point & Click',
      'Turn-Based Strategy', 'City Builder', 'Tower Defense',
    ],
  },
  {
    label: 'Multiplayer',
    tags: [
      'Multiplayer', 'Co-op', 'Local Co-Op', 'Online Co-Op', 'Split Screen', 'PvP',
      'Team-Based', 'MMORPG', 'Massively Multiplayer', 'Local Multiplayer', 'Competitive',
      '4 Player Local', 'Asynchronous Multiplayer', 'Party Game', 'Co-op Campaign', 'MOBA',
    ],
  },
  {
    label: 'Setting',
    tags: [
      'Fantasy', 'Sci-fi', 'Post-apocalyptic', 'Cyberpunk', 'Space', 'Medieval',
      'Historical', 'Mystery', 'Detective', 'Western', 'Military', 'War', 'Aliens',
      'Zombies', 'Dark Fantasy', 'Lovecraftian',
    ],
  },
  {
    label: 'Feel',
    tags: [
      'Relaxing', 'Difficult', 'Funny', 'Comedy', 'Emotional', 'Cute', 'Dark', 'Psychological',
      'Sandbox', 'Open World', 'Choices Matter', 'Great Soundtrack', 'Replay Value',
      'Short', 'Family Friendly', 'Cozy',
    ],
  },
  {
    label: 'Look',
    tags: [
      'Pixel Graphics', 'Anime', 'Retro', 'Stylized', 'Realistic', 'Hand-drawn',
      'Cartoony', 'Low-poly', 'Isometric', 'Top-Down', 'Side Scroller', 'First-Person',
      'Third Person', 'Voxel', 'Minimalist', 'Cartoon',
    ],
  },
]

/* ─────────────────────────── sorting ─────────────────────────── */

/**
 * ⚠️ Only sorts VERIFIED to order by what they claim, 2026-08-21.
 *
 * `IStoreQueryService/Query` would be the tidier backend — pure JSON, one call, fully
 * hydrated — but it effectively cannot sort: of its nine values only two order by
 * anything (name, and release oldest-first), and its default leads a Roguelike search
 * with a 48%-rated game while never surfacing Hades. So browsing goes through
 * `search/results`, which sorts correctly.
 *
 * `totalMovesWithSort` is the trap. These are not pure orderings — Steam applies each
 * as a filter too, so the result COUNT changes with the sort. Callers must re-read the
 * total on every sort change and never cache it against the tag alone.
 */
export type TagSort = {
  id: string
  label: string
  /** Query params. `filter` and `sort_by` are different mechanisms upstream. */
  params: Record<string, string>
}

export const TAG_SORTS: readonly TagSort[] = [
  { id: 'topsellers', label: 'Top sellers', params: { filter: 'globaltopsellers' } },
  { id: 'reviews', label: 'Most reviewed', params: { sort_by: 'Reviews_DESC' } },
  { id: 'newest', label: 'Newest', params: { sort_by: 'Released_DESC' } },
  { id: 'price', label: 'Price: low to high', params: { sort_by: 'Price_ASC' } },
  { id: 'name', label: 'Name A–Z', params: { sort_by: 'Name_ASC' } },
]

/* ─────────────────────────── browsing ─────────────────────────── */

/** Shared so an empty result is one object, not a new Map per failure. */
const EMPTY_PAGE: SearchPage = { total: 0, appids: [], descriptorsByAppid: new Map() }

export type TagBrowseRequest = {
  /** ANDed together. Steam takes them comma-separated. */
  tagids: readonly number[]
  sort: TagSort
  start: number
  count: number
}

/**
 * One page of a tag browse: an ordered list of appids and the size of the whole result.
 *
 * ⚠️ This returns appids ONLY. Hydrate with `fetchStoreItems` — the same batched
 * `GetItems` the shelves use — which is also where content descriptors come from, so
 * filtering cannot happen before that second call.
 *
 * ⚠️ The response is JSON, but the ids arrive inside an HTML fragment in `results_html`.
 * That is a deliberate, Clay-approved exception to the project's no-scraping rule: this
 * is the storefront's own pagination endpoint rather than the storefront page, and it
 * is the only source that sorts by top sellers or review count. It is also the most
 * fragile thing in this file, so `parseSearchResults` degrades to an empty page rather
 * than throwing (endpoint rule 3: a dead endpoint must never blank the UI).
 */
export const browseByTag = async (req: TagBrowseRequest): Promise<SearchPage> => {
  if (req.tagids.length === 0) return EMPTY_PAGE
  try {
    const json = await steamGet({
      host: 'store',
      path: '/search/results/',
      query: {
        infinite: 1,
        tags: req.tagids.join(','),
        start: req.start,
        count: req.count,
        // Without this Steam applies the *caller's* store preferences, which for an
        // anonymous request means an inconsistent, silently-filtered result set.
        ignore_preferences: 1,
        cc: STORE_LOCALE.cc,
        l: 'english',
        ...req.sort.params,
      },
      // Short: these lists are ranked and move. Long enough that paging back and forth
      // through a tag does not re-spend the rate limit.
      ttlSeconds: 900,
    })
    return parseSearchResults(json)
  } catch {
    return EMPTY_PAGE
  }
}
