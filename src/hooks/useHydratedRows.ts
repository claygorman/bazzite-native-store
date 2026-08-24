import { useEffect, useRef, useState } from 'react'
import { fetchStoreItems } from '../platform/steam'
import { applyCompatFilter } from '../platform/compatFilter'
import { useSettings } from './useSettings'
import { isAdultContent } from '../platform/contentFilter'
import type { StoreRow } from '../types/steam'

export type HydratedRows = {
  rows: StoreRow[]
  /** True until the batched facts land. Callers must not paint rows while true. */
  hydrating: boolean
}

/**
 * Fill in the facts the tile captions need but `featuredcategories` does not carry —
 * review percentage, real release date, discount end date, the deal-flag label — and
 * drop anything Steam labels as adult.
 *
 * ONE batched `GetItems` request covers every appid on the home screen. Doing this with
 * the per-app endpoints would be ~25 requests against a budget of roughly 200 per 5
 * minutes, and would have to be re-spent on every cold start.
 *
 * ⚠️ Rows are now WITHHELD until that request resolves, reversing an earlier decision.
 * Painting immediately and filling captions in afterwards is the right trade for
 * captions — but content filtering cannot work that way. The descriptors arrive in the
 * same response, so painting first would put adult titles on screen for a few hundred
 * milliseconds before they vanish. On an 85-inch television in a living room the flash
 * IS the problem; a slower first paint is not.
 */
export const useHydratedRows = (rows: StoreRow[]): HydratedRows => {
  const [hydrated, setHydrated] = useState<HydratedRows>({ rows: [], hydrating: true })
  const { settings } = useSettings()

  /*
   * ⚠️ Held in a ref, and the effect deliberately does NOT depend on it.
   *
   * The filter has to read current settings, but adding `settings` to the dependency
   * list would re-run the whole hydration — one batched GetItems for every appid on
   * the home screen — every time any unrelated setting changed. The compatibility
   * rows re-run it explicitly, just below.
   */
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (rows.length === 0) {
      setHydrated({ rows: [], hydrating: true })
      return
    }

    const appids = rows.flatMap((row) => row.items.map((item) => item.appid))
    if (appids.length === 0) {
      setHydrated({ rows, hydrating: false })
      return
    }

    setHydrated({ rows: [], hydrating: true })

    let cancelled = false
    void fetchStoreItems(appids)
      .then((facts) => {
        if (cancelled) return
        const merged = rows
          .map((row) => ({
            ...row,
            items: row.items
              .map((item) => {
                const extra = facts.get(item.appid)
                if (!extra) return item
                // Either source may know. The row key knows because the item arrived in
                // `coming_soon`; GetItems knows because Valve says so. Trusting only the
                // row misses an unreleased title that turns up in Specials.
                const comingSoon = item.comingSoon || extra.comingSoon === true
                return {
                  ...item,
                  comingSoon,
                  // Only upgrade when GetItems actually had a 2x asset.
                  headerUrl: extra.headerUrl ?? item.headerUrl,
                  reviewPercent: extra.reviewPercent,
                  reviewLabel: extra.reviewLabel,
                  releaseDate: extra.releaseDate,
                  discountEndsAt: extra.discountEndsAt,
                  dealFlag: extra.dealFlag,
                  contentDescriptors: extra.contentDescriptors,
                  controllerSupport: extra.controllerSupport,
                  deckCompat: extra.deckCompat,
                  // Turn 16 — Steam's user tags, most-voted first. `GetItems` is the only source
                  // (`featuredcategories` and `SearchApps` carry none), and the ORDER is the
                  // product, so this copies the array as-is rather than merging with anything.
                  tags: extra.tags,
                  // GetItems is the better price source — it carries the original price
                  // even where featuredcategories sends null — but it must NOT overwrite
                  // a coming-soon item's price, which is 0 in both and means
                  // "unreleased", not "free".
                  ...(comingSoon
                    ? {}
                    : {
                        discounted: extra.discounted,
                        discountPercent: extra.discountPercent,
                        originalPriceCents: extra.originalPriceCents ?? item.originalPriceCents,
                        finalPriceCents: extra.finalPriceCents ?? item.finalPriceCents,
                      }),
                }
              })
              .filter((item) => !isAdultContent(item.contentDescriptors)),
          }))
          // ⚠️ Compatibility filtering runs AFTER the adult filter and before the
          // empty-row drop, so a shelf emptied by a Verified-only floor disappears
          // rather than rendering as a heading with nothing under it.
          .map((row) => ({ ...row, items: applyCompatFilter(row.items, settingsRef.current) }))
          // A row can be emptied entirely by the filter; an empty shelf is worse than
          // no shelf.
          .filter((row) => row.items.length > 0)

        setHydrated({ rows: merged, hydrating: false })
      })
      .catch(() => {
        // ⚠️ Fail CLOSED. If we cannot tell what is labelled adult, showing the
        // unfiltered rows is exactly the failure being fixed — so drop them rather
        // than gamble. Losing the home screen is recoverable; this is not.
        if (!cancelled) setHydrated({ rows: [], hydrating: false })
      })

    return () => {
      cancelled = true
    }
    // ⚠️ Re-run when the compatibility rows change, and only those. The response is
    // served from the session cache, so this costs no request — it re-filters what is
    // already in hand, which is what makes the setting apply without a reload.
  }, [rows, settings.deckFloor, settings.hideUnrated, settings.nativeLinuxFirst])

  return hydrated
}
