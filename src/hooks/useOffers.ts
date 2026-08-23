import { useEffect, useState } from 'react'
import {
  fetchBundle,
  fetchPurchaseOptions,
  fetchStoreItems,
  type PurchaseOption,
  type StoreItemFacts,
} from '../platform/steam'

/**
 * Every way to buy this game, with the contents of each bundle — design turn 14a.
 *
 * ⚠️ Three requests deep, and it has to be. `purchase_options` names each bundle and
 * prices it but does NOT say what is in it — only `included_game_count`. So each bundle
 * is resolved by id for its appids, and the union of those appids is hydrated once for
 * capsule art and names. All three go through the same six-hour cache the rest of the
 * app-fact hydration uses, so a second visit to a game costs nothing.
 *
 * ⚠️ Bundles are resolved in PARALLEL but hydration waits for all of them, because the
 * capsules must appear together. A strip that fills in one tile at a time under a
 * focused row moves the thing you are pointing at.
 */

export type OfferItem = {
  appid: number
  name: string
  capsuleUrl?: string
  /** The game whose page you are on — 14a tags it THIS GAME. */
  isSubject: boolean
}

export type Offer = PurchaseOption & {
  /** Empty for a plain edition; the games inside, for a bundle. */
  items: OfferItem[]
}

export type OffersState = {
  offers: Offer[]
  loading: boolean
}

const EMPTY: OffersState = { offers: [], loading: true }

export const useOffers = (appid: number | undefined): OffersState => {
  const [state, setState] = useState<OffersState>(EMPTY)

  useEffect(() => {
    setState(EMPTY)
    if (appid === undefined) {
      setState({ offers: [], loading: false })
      return
    }

    let alive = true
    void (async () => {
      const options = await fetchPurchaseOptions(appid)
      if (!alive) return
      if (options.length === 0) {
        setState({ offers: [], loading: false })
        return
      }

      const bundles = await Promise.all(
        options
          .filter((option) => option.bundleid !== undefined)
          .map(async (option) => [option.bundleid, await fetchBundle(option.bundleid!)] as const),
      )
      if (!alive) return
      const contents = new Map(bundles.map(([id, bundle]) => [id, bundle?.appids ?? []]))

      // ⚠️ One hydration for the union, not one per bundle. The same game appears in
      // most of a title's bundles — Stray is in all three of its own — so per-bundle
      // hydration would ask for it three times.
      const every = [...new Set([...contents.values()].flat())]
      const facts: Map<number, StoreItemFacts> =
        every.length > 0 ? await fetchStoreItems(every) : new Map()
      if (!alive) return

      setState({
        loading: false,
        offers: options.map((option) => ({
          ...option,
          items: (contents.get(option.bundleid) ?? []).map((id) => ({
            appid: id,
            name: facts.get(id)?.name ?? '',
            capsuleUrl: facts.get(id)?.headerUrl,
            isSubject: id === appid,
          })),
        })),
      })
    })()

    return () => {
      alive = false
    }
  }, [appid])

  return state
}
