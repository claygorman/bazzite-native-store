import type { PurchaseOption } from '../platform/steam'

/**
 * What the offers block draws, and in what order — the pure half of `useOffers`.
 *
 * ⚠️ Split out so it can be TESTED. The hook itself imports React and the Steam
 * transport, which the type-stripping test runner cannot load; this file imports
 * nothing at runtime, exactly as `components/details/sections.ts` does for the details
 * screens' focus lists. The pattern is the same because the bug is: a focus list
 * derived in more than one place drifts, and nothing looks broken when it does.
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
  /**
   * The demo's appid — set on the demo row and on nothing else.
   *
   * ⚠️ This is what makes the row a THIRD kind, alongside editions (`packageid`) and
   * bundles (`bundleid`), and why `activateOffer` tests it first. A demo is not
   * something you buy, so it has no package and no bundle; giving it a fake one to fit
   * the existing two would make the price column lie.
   */
  demoAppid?: number
}

/**
 * One row of the offers block, in the order drawn.
 *
 * ⚠️ THE single definition of what rows exist, because three places used to compute it
 * with their own `bundleid !== undefined` filter: the dpad's width clamp in `App`,
 * `activateOffer`'s index arithmetic, and `OfferList`'s own `[null, ...bundles]`. Three
 * copies agreed only as long as there were exactly two kinds of row; adding the demo
 * would have silently offset one of them, and an offset row list means A opens the
 * wrong page — which still opens A page, so nothing would look broken.
 *
 * Same reasoning as `details/sections.ts`: derive it once, next to the type it
 * partitions, and the copies cannot drift.
 */
export type OfferRow =
  { kind: 'subject' } | { kind: 'demo'; offer: Offer } | { kind: 'bundle'; offer: Offer }

export const offerRowsFor = (offers: readonly Offer[]): OfferRow[] => [
  { kind: 'subject' },
  ...offers
    .filter((offer) => offer.demoAppid !== undefined)
    .map((offer) => ({ kind: 'demo' as const, offer })),
  ...offers
    .filter((offer) => offer.bundleid !== undefined)
    .map((offer) => ({ kind: 'bundle' as const, offer })),
]

/** How many items the dpad can walk inside each row. Only bundles have any. */
export const offerRowWidths = (offers: readonly Offer[]): number[] =>
  offerRowsFor(offers).map((row) => (row.kind === 'bundle' ? row.offer.items.length : 0))
