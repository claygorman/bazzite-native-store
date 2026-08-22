import { useEffect, useState } from 'react'
import { browseByTag, TAG_SORTS, type TagSort } from '../platform/tagBrowse'
import { fetchStoreItems } from '../platform/steam'
import { isAdultContent } from '../platform/contentFilter'
import { applyCompatFilter } from '../platform/compatFilter'
import { useSettings } from './useSettings'
import type { DeckCompat, StoreItem } from '../types/steam'

/**
 * The sort both the picker and the results grid start on.
 *
 * ⚠️ Shared deliberately, and it is the whole reason the two screens can agree on a
 * number. Steam applies each sort as a filter, so "how many Roguelikes are there" has
 * five different answers; the only way the picker's count can survive pressing A is for
 * both screens to ask the same question. Change this and they diverge.
 *
 * `Most reviewed` rather than the design's `Top sellers` because top sellers is a
 * bounded chart, not a catalogue — 619 Roguelikes against 5,214 — so it reads as a
 * suspiciously small library and pages out after a few screens.
 */
export const DEFAULT_TAG_SORT: TagSort = TAG_SORTS.find((s) => s.id === 'reviews') ?? TAG_SORTS[0]!

/**
 * ⚠️ 25, not the design's 15, and this is Steam's decision rather than ours.
 *
 * `search/results` has a MINIMUM page of 25: asking for 10, 15 or 20 all return 25 rows,
 * and `start` snaps to 25-boundaries — `start=15` returns the same page as `start=0`,
 * every row identical. Paging a 15-up grid would therefore have shown games 1–15 and
 * then 26–40, silently skipping ten games on every page while the header claimed a
 * complete catalogue.
 *
 * So the FETCH is what Steam actually serves. The 2026-08-21 revision shows five
 * results at a time, so a view page is a 5-slice of one fetch and only every fifth
 * page costs a request — which is also why paging feels instant four times out of five.
 */
export const TAG_FETCH_SIZE = 25

/** What the grid shows at once: one row of five, per the artboard. */
export const TAG_VIEW_SIZE = 5

const VIEWS_PER_FETCH = TAG_FETCH_SIZE / TAG_VIEW_SIZE

export type TagBrowseState = {
  items: StoreItem[]
  /**
   * Size of the whole result set FOR THE CURRENT SORT.
   *
   * ⚠️ Re-read on every sort change, never cached against the tag. Steam applies each
   * sort as a filter too: the same tag is 5,214 games by review count and 20,054 by
   * relevance. See `platform/tagBrowse.ts`.
   */
  total: number
  pageCount: number
  loading: boolean
}

const EMPTY: TagBrowseState = { items: [], total: 0, pageCount: 0, loading: false }

/**
 * One page of a tag browse, hydrated and filtered.
 *
 * Two requests: the ordered appids from `search/results`, then one batched `GetItems`
 * to turn them into cards. The second is the same call the home shelves make, so a game
 * already seen today is served from cache.
 *
 * ⚠️ Withholds the page until BOTH resolve, and fails **closed** — the same decision as
 * `useHydratedRows`, for the same reason. Content descriptors arrive with the
 * hydration, so painting the appid list first would put unfiltered results on a
 * living-room television for a few hundred milliseconds. On this screen it is worse
 * than on the home rows: a tag browse can be pointed at anything.
 */
export const useTagBrowse = (
  tagids: readonly number[],
  sort: TagSort,
  /** VIEW page (five results), not the fetch page. */
  page: number,
): TagBrowseState => {
  const [state, setState] = useState<TagBrowseState>(EMPTY)
  const { settings } = useSettings()
  // Joined rather than passed as an array: a fresh array literal per render would
  // re-run this effect forever.
  const key = tagids.join(',')

  useEffect(() => {
    if (key === '') {
      setState(EMPTY)
      return
    }

    let cancelled = false
    setState((prev) => ({ ...prev, loading: true }))

    void (async () => {
      const ids = key.split(',').map(Number)
      const listing = await browseByTag({
        tagids: ids,
        sort,
        // ⚠️ Fetch on 25-boundaries, always. `start` snaps to them upstream, so asking
        // for `page * 5` would silently re-serve page 0 for four pages out of five.
        start: Math.floor(page / VIEWS_PER_FETCH) * TAG_FETCH_SIZE,
        count: TAG_FETCH_SIZE,
      })
      if (cancelled) return

      const pageCount = Math.ceil(listing.total / TAG_VIEW_SIZE)
      if (listing.appids.length === 0) {
        setState({ items: [], total: listing.total, pageCount, loading: false })
        return
      }

      // Cheap pre-filter on the descriptors Steam already put in the listing markup.
      // Saves hydrating what we are about to throw away; it is NOT the guarantee,
      // because roughly half the rows carry no descriptors at all.
      const candidates = listing.appids.filter(
        (appid) => !isAdultContent(listing.descriptorsByAppid.get(appid)),
      )

      try {
        const facts = await fetchStoreItems(candidates)
        if (cancelled) return

        const items = candidates
          .map((appid): StoreItem | undefined => {
            const extra = facts.get(appid)
            if (!extra || extra.name === '') return undefined
            return {
              appid,
              name: extra.name,
              capsuleUrl: extra.headerUrl ?? '',
              headerUrl: extra.headerUrl,
              discounted: extra.discounted,
              discountPercent: extra.discountPercent,
              originalPriceCents: extra.originalPriceCents,
              finalPriceCents: extra.finalPriceCents,
              // ⚠️ Valve's flag first, the date only as a fallback. `search/results` has
              // no notion of unreleased-vs-free and there is no containing row to infer
              // it from, so before GetItems carried `is_coming_soon` this screen had
              // nothing but a date comparison — which is wrong for any app shipping a
              // placeholder date in the past.
              comingSoon:
                extra.comingSoon ??
                (extra.releaseDate !== undefined && extra.releaseDate * 1000 > Date.now()),
              linuxAvailable: false,
              reviewPercent: extra.reviewPercent,
              reviewLabel: extra.reviewLabel,
              releaseDate: extra.releaseDate,
              discountEndsAt: extra.discountEndsAt,
              dealFlag: extra.dealFlag,
              contentDescriptors: extra.contentDescriptors,
              controllerSupport: extra.controllerSupport,
              deckCompat: extra.deckCompat,
            }
          })
          .filter((item): item is StoreItem => item !== undefined)
          // The authoritative pass, against GetItems rather than the markup.
          .filter((item) => !isAdultContent(item.contentDescriptors))

        // Slice the fetched 25 down to the five on screen. Filtering happens first, so
        // the slice is over what survived — the window compacts rather than leaving
        // holes in a row of five, where a gap is very visible. The Compatibility page
        // is part of that filtering for exactly the same reason.
        const shown = applyCompatFilter(items, settings)
        const offset = (page % VIEWS_PER_FETCH) * TAG_VIEW_SIZE
        setState({
          items: shown.slice(offset, offset + TAG_VIEW_SIZE),
          total: listing.total,
          pageCount,
          loading: false,
        })
      } catch {
        // ⚠️ Fail CLOSED. Without descriptors we cannot tell what is safe to show, and
        // showing the unfiltered listing is exactly the failure being prevented.
        if (!cancelled) setState({ ...EMPTY, total: listing.total })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [key, sort, page, settings])

  return state
}

/* ─────────────────────────── the picker's preview ─────────────────────────── */

/** How many results the Bazzite split is measured over. Said out loud in the UI. */
export const PREVIEW_SAMPLE = 100
/** How many of them the preview lists by name. */
const PREVIEW_TOP = 6

export type TagPreview = {
  /**
   * Which tag this describes.
   *
   * ⚠️ Carried so a consumer can prove the preview belongs to the tag it is drawn
   * beside. `loading` alone is not enough: the effect that sets it runs *after* the
   * render in which focus moved, so for one commit the picker holds the NEW tag and the
   * OLD tag's numbers — and "43,980 games" under the wrong heading is a lie that looks
   * exactly like data.
   */
  tagid?: number
  /** Same query the results grid will run, so the number survives pressing A. */
  total: number
  top: StoreItem[]
  /** Deck verdict counts across the sample actually measured. */
  split: { verdict: DeckCompat; count: number }[]
  /** How many games the split is over — never the tag's size. */
  sampled: number
  loading: boolean
}

const EMPTY_PREVIEW: TagPreview = { total: 0, top: [], split: [], sampled: 0, loading: false }

/**
 * What the focused tag looks like, without pretending to know the whole tag.
 *
 * ⚠️ The design draws a "Runs on Bazzite" bar chart across the entire tag. There is no
 * endpoint for that and there cannot be a cheap one: ProtonDB serves one appid per HTTP
 * request with no aggregation, so a true split over 13,912 Roguelikes is 13,912
 * requests against a budget of roughly 200 per five minutes.
 *
 * What IS free is Valve's Deck verdict, which rides along in the hydration we already
 * pay for. So the split is measured over the 100 most-reviewed games in the tag — a
 * real sample of the games anyone is likely to play — and the UI says so in as many
 * words. A sample described as a sample is honest; the same chart labelled "Roguelike"
 * would not be.
 *
 * Two requests per focused tag, so callers must debounce: holding a direction moves
 * focus every ~90ms and this must not fire eleven times a second.
 */
export const useTagPreview = (tagid: number | undefined, delayMs = 260): TagPreview => {
  const [preview, setPreview] = useState<TagPreview>(EMPTY_PREVIEW)

  useEffect(() => {
    if (tagid === undefined) {
      setPreview(EMPTY_PREVIEW)
      return
    }

    let cancelled = false
    // ⚠️ Reset, not `{ ...prev, loading: true }`. Keeping the previous tag's numbers in
    // state while claiming to be loading is how they end up on screen: every consumer
    // then has to remember to gate on `loading`, and the one that forgets shows another
    // tag's data. There is nothing to keep — this is a different question.
    setPreview({ ...EMPTY_PREVIEW, tagid, loading: true })

    const timer = setTimeout(() => {
      void (async () => {
        const listing = await browseByTag({
          tagids: [tagid],
          sort: DEFAULT_TAG_SORT,
          start: 0,
          count: PREVIEW_SAMPLE,
        })
        if (cancelled) return
        if (listing.appids.length === 0) {
          setPreview({ ...EMPTY_PREVIEW, tagid, total: listing.total })
          return
        }

        try {
          const facts = await fetchStoreItems(listing.appids)
          if (cancelled) return

          const counts = new Map<DeckCompat, number>()
          const top: StoreItem[] = []

          for (const appid of listing.appids) {
            const extra = facts.get(appid)
            if (!extra || isAdultContent(extra.contentDescriptors)) continue
            if (extra.deckCompat !== undefined && extra.deckCompat !== 'unknown') {
              counts.set(extra.deckCompat, (counts.get(extra.deckCompat) ?? 0) + 1)
            }
            if (top.length < PREVIEW_TOP && extra.name !== '') {
              top.push({
                appid,
                name: extra.name,
                capsuleUrl: extra.headerUrl ?? '',
                headerUrl: extra.headerUrl,
                discounted: extra.discounted,
                discountPercent: extra.discountPercent,
                originalPriceCents: extra.originalPriceCents,
                finalPriceCents: extra.finalPriceCents,
                comingSoon: extra.comingSoon === true,
                linuxAvailable: false,
                reviewPercent: extra.reviewPercent,
                deckCompat: extra.deckCompat,
                controllerSupport: extra.controllerSupport,
                contentDescriptors: extra.contentDescriptors,
              })
            }
          }

          // Best verdict first, and `unknown` never appears — a bar labelled "Unknown"
          // teaches the reader to ignore the chart.
          const order: DeckCompat[] = ['verified', 'playable', 'unsupported']
          const split = order
            .map((verdict) => ({ verdict, count: counts.get(verdict) ?? 0 }))
            .filter((bar) => bar.count > 0)
          const sampled = split.reduce((n, bar) => n + bar.count, 0)

          setPreview({ tagid, total: listing.total, top, split, sampled, loading: false })
        } catch {
          if (!cancelled) setPreview({ ...EMPTY_PREVIEW, tagid, total: listing.total })
        }
      })()
    }, delayMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tagid, delayMs])

  return preview
}

/* ─────────────────────────── the spotlight carousel ─────────────────────────── */

/** How many games the spotlight cycles through. */
export const SPOTLIGHT_COUNT = 9

/**
 * Games for the "Featured in this tag" carousel.
 *
 * ⚠️ The artboard calls these "spotlights this week" and it is modelled on Steam's own
 * `/category/<slug>` page. **Steam's spotlights are not available to us.** Verified
 * 2026-08-21 by reading that page anonymously: it carries its data in `data-ch_*`
 * attributes, and `ch_spotlights_data` is `[]` on every category tried, as is the
 * `featured` list inside `ch_main_list_data`. Both are personalized, the same trap
 * `home_spotlight_recommendations` falls into (private/STEAM-ENDPOINTS.md).
 *
 * ⚠️ Steam's *categories* are also not our *tags*: `ch_hub_data` reports `nTagID: 0`,
 * `/category/roguelike` 404s, and the category list is a curated few dozen against 446
 * tags. So even the populated parts of that page would only cover a fraction of the
 * picker.
 *
 * What IS real is top sellers within the tag, which is a defensible reading of
 * "featured" and works for every tag. It is labelled as top sellers on screen rather
 * than as an editorial pick, and "this week" is dropped — we have no recency signal.
 *
 * The trailers are not a problem: all 14 of the first 14 top sellers checked in
 * Roguelike had a derivable microtrailer.
 */
export const useTagSpotlights = (tagids: readonly number[]): StoreItem[] => {
  const [items, setItems] = useState<StoreItem[]>([])
  const key = tagids.join(',')

  useEffect(() => {
    if (key === '') {
      setItems([])
      return
    }
    let cancelled = false

    void (async () => {
      const listing = await browseByTag({
        tagids: key.split(',').map(Number),
        sort: TAG_SORTS.find((s) => s.id === 'topsellers') ?? TAG_SORTS[0]!,
        start: 0,
        count: SPOTLIGHT_COUNT,
      })
      if (cancelled || listing.appids.length === 0) return

      const candidates = listing.appids
        .filter((appid) => !isAdultContent(listing.descriptorsByAppid.get(appid)))
        .slice(0, SPOTLIGHT_COUNT)

      try {
        const facts = await fetchStoreItems(candidates)
        if (cancelled) return
        setItems(
          candidates.flatMap((appid) => {
            const extra = facts.get(appid)
            if (!extra || extra.name === '' || isAdultContent(extra.contentDescriptors)) return []
            return [
              {
                appid,
                name: extra.name,
                capsuleUrl: extra.headerUrl ?? '',
                headerUrl: extra.headerUrl,
                discounted: extra.discounted,
                discountPercent: extra.discountPercent,
                originalPriceCents: extra.originalPriceCents,
                finalPriceCents: extra.finalPriceCents,
                comingSoon: extra.comingSoon === true,
                linuxAvailable: false,
                reviewPercent: extra.reviewPercent,
                reviewLabel: extra.reviewLabel,
                shortDescription: extra.shortDescription,
                dealFlag: extra.dealFlag,
                contentDescriptors: extra.contentDescriptors,
                controllerSupport: extra.controllerSupport,
                deckCompat: extra.deckCompat,
              },
            ]
          }),
        )
      } catch {
        // Additive: no carousel is better than an unfiltered one.
        if (!cancelled) setItems([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [key])

  return items
}
