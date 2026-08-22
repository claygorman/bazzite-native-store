import { useEffect, useState } from 'react'
import { fetchStoreItems } from '../platform/steam'
import { isAdultContent } from '../platform/contentFilter'
import { applyCompatFilter } from '../platform/compatFilter'
import { useSettings } from './useSettings'
import { useSteamLibrary } from './useSteamLibrary'
import type { StoreItem } from '../types/steam'

export type WishlistState = {
  items: StoreItem[]
  /** Mirrors the library's own tri-state so the screen can say WHY it is empty. */
  status: 'loading' | 'unavailable' | 'ready'
  loading: boolean
}

/**
 * The wishlist, hydrated.
 *
 * ⭐ Costs one request, and that is the interesting part: `dynamicstore/userdata`
 * returns `rgWishlist` in the same response as `rgOwnedApps`, which
 * `loadSteamLibrary` has been reading — and discarding — since the owned badges
 * shipped. The list was already on this machine; only the screen was missing.
 *
 * ⚠️ **Not reachable by signing in.** A Steam OpenID sign-in returns a SteamID64 and
 * nothing else (private/AUTH-AND-CART.md); SteamDB, using the identical flow, has its own
 * Wishlist button disabled for exactly this reason. This works because Steam's own
 * logged-in browser is running on the box, which is why the Up menu dims the entry
 * rather than opening a page that would have to apologise.
 *
 * ⚠️ Owned by the App rather than the view, matching `useTagBrowse`: the input handler
 * needs the appid under the cursor in order to open it, and a view that owned its own
 * list would have to hand that back up on every focus move.
 */
export const useWishlist = (active: boolean): WishlistState => {
  const { status, wishlist } = useSteamLibrary()
  const { settings } = useSettings()
  const [items, setItems] = useState<StoreItem[]>([])
  const [loading, setLoading] = useState(false)

  // Joined rather than passed as a Set: a fresh Set identity per render would re-run
  // this forever. Same reason `useTagBrowse` joins its tagids.
  const key = [...wishlist].join(',')

  useEffect(() => {
    // Hydrating a hundred wishlist entries is one batched request, but it is still a
    // request — do not spend it until the screen is actually open.
    if (!active || key === '') return

    let cancelled = false
    setLoading(true)

    void (async () => {
      const appids = key.split(',').map(Number)
      try {
        const facts = await fetchStoreItems(appids)
        if (cancelled) return
        setItems(
          applyCompatFilter(
            appids.flatMap((appid) => {
              const extra = facts.get(appid)
              if (!extra || extra.name === '' || isAdultContent(extra.contentDescriptors)) {
                return []
              }
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
                  linuxAvailable: extra.linuxAvailable === true,
                  reviewPercent: extra.reviewPercent,
                  reviewLabel: extra.reviewLabel,
                  releaseDate: extra.releaseDate,
                  discountEndsAt: extra.discountEndsAt,
                  dealFlag: extra.dealFlag,
                  contentDescriptors: extra.contentDescriptors,
                  controllerSupport: extra.controllerSupport,
                  deckCompat: extra.deckCompat,
                },
              ]
            }),
            settings,
          ),
        )
      } catch {
        // ⚠️ Fail CLOSED, as everywhere else: the content descriptors that decide what
        // is safe to put on a television arrive with this hydration, so a failure
        // means showing nothing rather than showing an unfiltered list.
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [key, active, settings])

  return { items, status, loading }
}
