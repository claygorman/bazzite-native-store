import { useEffect, useState } from 'react'
import {
  fetchBundle,
  fetchPurchaseOptions,
  fetchStoreItems,
  type StoreItemFacts,
} from '../platform/steam'
import type { Offer } from './offerRows'

export {
  offerRowsFor,
  offerRowWidths,
  type Offer,
  type OfferItem,
  type OfferRow,
} from './offerRows'

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

export type OffersState = {
  offers: Offer[]
  loading: boolean
}

const EMPTY: OffersState = { offers: [], loading: true }

export const useOffers = (
  appid: number | undefined,
  /** From `appdetails`. Adds a free row above the bundles when the game has a demo. */
  demoAppid?: number,
): OffersState => {
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
      // ⚠️ A demo alone is enough to render the block. Bailing on `options.length === 0`
      // would hide the demo on exactly the games most likely to have one — free titles
      // and unreleased ones, which have no purchase options at all.
      if (options.length === 0 && demoAppid === undefined) {
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
      // ⚠️ The demo rides along in this batch rather than fetching its own name.
      // `GetItems` answers for a demo appid exactly as it does for a game — verified
      // 2026-08-24 against 4711740, "Mortal Shell II - Open Beta" — so the real name
      // costs one more id in a request that was already going out, not a request.
      const every = [
        ...new Set([...[...contents.values()].flat(), ...(demoAppid ? [demoAppid] : [])]),
      ]
      const facts: Map<number, StoreItemFacts> =
        every.length > 0 ? await fetchStoreItems(every) : new Map()
      if (!alive) return

      /*
       * The demo leads the list, under the game's own row.
       *
       * ⚠️ Above the bundles, deliberately. It is the only row that costs nothing, and
       * design 14a orders the block by commitment — the thing you can try before you
       * decide belongs before the things you decide between.
       */
      const demoOffer: Offer[] =
        demoAppid === undefined
          ? []
          : [
              {
                demoAppid,
                name: facts.get(demoAppid)?.name ?? 'Demo',
                gameCount: 1,
                formattedFinalPrice: 'Free',
                items: [],
              },
            ]

      setState({
        loading: false,
        offers: [
          ...demoOffer,
          ...options.map((option) => ({
            ...option,
            items: (contents.get(option.bundleid) ?? []).map((id) => ({
              appid: id,
              name: facts.get(id)?.name ?? '',
              capsuleUrl: facts.get(id)?.headerUrl,
              isSubject: id === appid,
            })),
          })),
        ],
      })
    })()

    return () => {
      alive = false
    }
  }, [appid, demoAppid])

  return state
}
