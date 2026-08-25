/**
 * Where the card's facts go — the decisions that were inline in `StoreCard` and rotted.
 *
 * ⚠️ **Why this is a module and not three lines in the component.** `compatOnOwnRow` was
 * written as `!compact && hasCompat && contentRem < NARROW`, with a comment explaining that
 * a compact grid never passes a ProtonDB tier so compatibility is one label rather than
 * two. That was true the day it was written. `WishlistView` and `TagResults` later both
 * started passing `tier`, and nothing failed — the premise had quietly become false and the
 * only symptom was on a television: `$35.00 | 94% | Deck Verified | Proton Platinum` on one
 * `whitespace-nowrap` line, clipped mid-word, with the lower half of the card left empty
 * because the line that should have filled it was never drawn.
 *
 * A comment cannot fail. A test can.
 */

/** rem of content column below which the facts row cannot hold everything. */
export const NARROW_CONTENT_REM = 26.25

export type CompatLayout = {
  compact: boolean
  /**
   * rem of content column. `0` means the parent sizes the card — see `CardShape.width` —
   * and selects the narrow branch deliberately, because a parent-sized card is a grid or
   * flex child and those are the narrow ones.
   */
  contentRem: number
  /** A Steam Deck verdict is present and has a label to draw. */
  hasDeck: boolean
  /** ProtonDB has answered for this app. */
  hasTier: boolean
}

/**
 * Whether compatibility takes its own line under the facts row.
 *
 * The design's rule, from `Store Card - Tailwind port.md`, 2026-08-22:
 *
 * > Caption is three lines, in this order. Title, then the facts row, then compatibility
 * > on its own line. The facts row cannot hold discount + price + review + a long tier
 * > label inside 312px of content, which is why the tier has its own line rather than an
 * > ellipsis.
 *
 * ⚠️ The decision is made on the CONTENT — how many labels there actually are — never on
 * the density. Density was a proxy for label count and stopped tracking it.
 */
export const compatGetsOwnRow = ({
  compact,
  contentRem,
  hasDeck,
  hasTier,
}: CompatLayout): boolean => {
  const labels = (hasDeck ? 1 : 0) + (hasTier ? 1 : 0)
  if (labels === 0) return false
  if (contentRem >= NARROW_CONTENT_REM) return false
  // A compact card with ONE label keeps it inline — that is what the original guard was
  // protecting, and it is still right. Two labels do not fit beside a price and a rating
  // at any width this branch sees.
  return !compact || labels === 2
}

/** Where the price is drawn. Exactly one of these, never two. */
export type PriceSlot = 'title' | 'facts' | 'footer'

export type PriceLayout = {
  /** The caller asked for a footer under a hairline — an explicit, winning placement. */
  priceFooter: boolean
  /** The caller named a slot. `undefined` lets rule §5.3 decide from the width. */
  pricePlacement?: 'title' | 'facts'
  /** rem of content column. `0` means the parent sizes the card — see `CompatLayout`. */
  contentRem: number
}

/**
 * Which of the three slots the price occupies.
 *
 * ⚠️ **The bug this exists to prevent: the price drawn TWICE.** `priceFooter` and the
 * facts row were decided independently, and a wishlist card asks for both — it is
 * parent-sized, so `contentRem` is 0, so the width rule put the price on the facts row,
 * and then the footer drew it again. `$35.00 | 97%` on one line and `$35.00` on the next,
 * on every card in the list. The title-row branch had a `!priceFooter` guard; the facts
 * branch did not, and nothing connected the two. Seen on the box 2026-08-25.
 *
 * ⚠️ `priceFooter` wins over everything. It is an explicit request from a caller that has
 * laid out a bottom band for it, where the width rule is only a default.
 */
export const priceGoesTo = ({ priceFooter, pricePlacement, contentRem }: PriceLayout): PriceSlot => {
  if (priceFooter) return 'footer'
  if (pricePlacement !== undefined) return pricePlacement
  // §5.3 — a narrow card cannot spare the title's width for a price.
  return contentRem < NARROW_CONTENT_REM ? 'facts' : 'title'
}
