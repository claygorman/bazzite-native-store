import { useEffect, useState } from 'react'
import {
  fetchBundle,
  fetchStoreItems,
  type BundleDetails,
  type StoreItemFacts,
} from '../platform/steam'

/**
 * One bundle and the facts its cards need — design turn 14b.
 *
 * ⚠️ Two requests, and the second is not optional. `GetItems` honours
 * `include_included_items` but the per-app `reviews` object inside it comes back
 * EMPTY (verified against bundle 234 on 2026-08-22), so the review score on each card
 * has to be hydrated separately. The design's whole argument is that the cards carry
 * enough to judge each game on its own, and a card with no review score does not.
 */
export type BundleState = {
  bundle?: BundleDetails
  facts: Map<number, StoreItemFacts>
  loading: boolean
  /** The bundle id resolved to nothing — delisted, region-locked, or a bad id. */
  missing: boolean
}

const EMPTY: BundleState = { facts: new Map(), loading: true, missing: false }

export const useBundle = (bundleid: number | undefined): BundleState => {
  const [state, setState] = useState<BundleState>(EMPTY)

  useEffect(() => {
    setState(EMPTY)
    if (bundleid === undefined) {
      setState({ facts: new Map(), loading: false, missing: false })
      return
    }

    let alive = true
    void (async () => {
      const bundle = await fetchBundle(bundleid)
      if (!alive) return
      if (!bundle) {
        setState({ facts: new Map(), loading: false, missing: true })
        return
      }
      // Show the bundle as soon as it lands rather than holding the whole page for the
      // hydration — the title, price and card frames are all already known.
      setState({ bundle, facts: new Map(), loading: true, missing: false })

      const facts = bundle.appids.length > 0 ? await fetchStoreItems(bundle.appids) : new Map()
      if (!alive) return
      setState({ bundle, facts, loading: false, missing: false })
    })()

    return () => {
      alive = false
    }
  }, [bundleid])

  return state
}
