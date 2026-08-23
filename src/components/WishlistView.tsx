import { useEffect, useRef } from 'react'

import { StoreCard, type CardAttention } from './StoreCard'
import { formatPrice, type StoreItem } from '../types/steam'
import type { WishlistState } from '../hooks/useWishlist'
import { useSetting } from '../hooks/useSettings'
import { TIER_STYLE } from '../platform/protondb'
import { useProtonRating } from '../hooks/useProtonRating'

/**
 * Two across, scrolling — design turn 15a.
 *
 * ⚠️ The grid used to be two rows of five and paginate at ten, which left the entire
 * bottom half of a 4K screen empty while announcing "Page 1 / 3". A wishlist is a list
 * you scan, not a deck you deal, so the page scrolls and every item is on it.
 *
 * Two columns of the SIDE card, per 15a. Five stacked ones squeezed the caption below
 * the width its own text needs, so "Deck Playable" rendered as "Deck Playabl" on every
 * tile whose verdict was longer than "Deck"; the side layout gives the text its own
 * column instead of sharing the tile's width with nothing.
 */
export const WISHLIST_COLS = 2

/**
 * 15a's measurements, converted at 16px per rem (DESIGN-PORT §1).
 *
 * ⚠️ The art is 420×236, which is 1.78:1 — NOT Steam's 460:215 header ratio. That is
 * deliberate in the design: the art fills the card's full height and `object-cover`
 * takes the crop off the sides. Deriving the height from the header ratio instead, as
 * the grid tiles do, would leave a gap under the art on every card.
 */
const ART_WIDTH_REM = 420 / 16
const ROW_HEIGHT_REM = 236 / 16

/** Whole days from now until `epochSeconds`, or undefined if it is past. */
const daysUntil = (epochSeconds: number | undefined, now: number): number | undefined => {
  if (epochSeconds === undefined) return undefined
  const days = Math.ceil((epochSeconds * 1000 - now) / 86_400_000)
  return days > 0 ? days : undefined
}

/**
 * 15a's fourth band — "the reason to look today".
 *
 * ⚠️ The design's best lines are the ones we cannot write. "Lowest price since you
 * added it" and "Cheapest it has ever been" need price HISTORY, which nothing in this
 * app stores; inventing them from the current discount would be a claim about the past
 * built from a single point. So the band is present only when there is something true
 * to put in it, and absent otherwise — a blank line beats a fabricated reason.
 */
const noteFor = (
  item: StoreItem,
  now: number,
): { text: string; tone: 'sale' | 'warn' | 'info' } | undefined => {
  if (item.comingSoon) {
    const days = daysUntil(item.releaseDate, now)
    return days === undefined
      ? { text: 'Release date not announced', tone: 'info' }
      : { text: days === 1 ? 'Releases tomorrow' : `Releases in ${days} days`, tone: 'info' }
  }
  const saleDays = daysUntil(item.discountEndsAt, now)
  if (saleDays !== undefined && item.discounted && item.discountPercent > 0) {
    return {
      text: saleDays === 1 ? 'On sale — last day' : `On sale for ${saleDays} more days`,
      tone: 'sale',
    }
  }
  return undefined
}

type Props = {
  state: WishlistState
  focusedIndex: number
  onActivate: (appid: number) => void
}

/**
 * The wishlist — the Up menu's fourth entry.
 *
 * Not an artboard: `9a` names the destination and gives it a hint line ("18 games · 4
 * on sale right now"), and this is that screen, built from the card and grid the tag
 * results already use rather than inventing a fourth surface.
 *
 * ⚠️ Reads the local Steam client, not a sign-in — see `useWishlist`. The one thing
 * this screen must get right is saying so: an empty grid because Steam is not running
 * and an empty grid because the wishlist is empty are completely different facts, and
 * only one of them is about the user.
 */
export const WishlistView = ({ state, focusedIndex, onActivate }: Props) => {
  const { items, status, loading } = state
  const onSale = items.filter((i) => i.discounted && i.discountPercent > 0).length

  /*
   * ⚠️ Keep the focused card in view, and do it INSTANTLY.
   *
   * `block: 'nearest'` scrolls only when the card is actually off screen, so walking
   * along a visible row does not drag the page around under the cursor. No smooth
   * behaviour: a held direction moves focus faster than smooth scrolling can service,
   * which is the same reason the shelves move by transform rather than scroll.
   */
  const focusedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  return (
    <div className="absolute inset-x-0 bottom-18.5 top-0 flex flex-col gap-5 px-14 py-9">
      <header className="flex shrink-0 flex-col gap-2.5">
        <h1 className="text-display font-extrabold tracking-display text-ink">Wishlist</h1>
        <div className="flex items-center gap-4 text-lg font-medium text-ink-faint">
          {status === 'unavailable' ? (
            /*
             * ⚠️ A statement about this machine, not about the account. "No wishlist"
             * would be a claim we have no way to make.
             */
            <span>Needs the Steam client running on this machine</span>
          ) : status === 'loading' || (loading && items.length === 0) ? (
            <span>Loading…</span>
          ) : (
            <>
              <span>{items.length.toLocaleString()} games</span>
              {onSale > 0 && (
                <>
                  <span className="h-5 w-px bg-hairline" />
                  <span className="text-sale">{onSale} on sale right now</span>
                </>
              )}
            </>
          )}
        </div>
      </header>

      {/*
        ⚠️ FULL-BLEED with the page gutter as its own padding — not a content-width box
        with a little breathing room. `overflow-y-auto` is a clip box, and the focused
        card's bloom reaches ~5rem: a blur radius is not a reach, because CSS
        approximates a blur of B with a Gaussian of sigma B/2 and paints out to ~3
        sigma, so 3.375rem of blur lays down pixels to about 5rem. See index.css's
        `--shadow-tile-glow-hi` note, which had to work this out the hard way for the
        shelves.

        So `-mx-14 px-14` cancels the page margin and re-spends it INSIDE the clip box:
        the cut then happens at the display edge, where there is nothing beyond it to
        compare against, rather than as a hard seam inside the layout. `py-20` is 5rem,
        the full documented reach, so the first and last rows bloom rather than chop —
        15a asks for 72px here and 80 costs nothing visible.

        ⚠️ This only holds while no ancestor is narrower than the screen. Narrow one and
        the outermost card's glow chops again.
      */}
      <div className="-mx-14 min-h-0 flex-1 overflow-y-auto px-14 py-20">
        <div className="grid grid-cols-2 gap-6.5" style={{ gridAutoRows: `${ROW_HEIGHT_REM}rem` }}>
          {items.map((item, index) => (
            <WishlistCard
              key={item.appid}
              item={item}
              focused={focusedIndex === index}
              rank={index + 1}
              cardRef={focusedIndex === index ? focusedRef : undefined}
              onActivate={() => onActivate(item.appid)}
            />
          ))}
          {status === 'ready' && !loading && items.length === 0 && (
            <span className="col-span-2 text-xl font-medium text-ink-faint">
              Nothing on your wishlist yet.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const WishlistCard = ({
  item,
  focused,
  rank,
  cardRef,
  onActivate,
}: {
  item: StoreItem
  focused: boolean
  rank: number
  cardRef?: React.RefObject<HTMLDivElement | null>
  onActivate: () => void
}) => {
  const showDeck = useSetting('deckVerified')
  /*
   * ⚠️ Same hook and TIER_STYLE map as `Tile` and the tag results, so the three
   * surfaces cannot disagree about what colour Gold is. 15a's third band puts the tier
   * dot beside the review score, which is exactly what `CompatFacts` already draws.
   */
  const proton = useProtonRating(item.appid)
  const tier = proton.status === 'rated' ? TIER_STYLE[proton.rating.tier] : undefined
  /*
   * ⚠️ Read once per render rather than per card. `Date.now()` inside `noteFor` would
   * be a different instant for every tile in the grid, so two cards whose sale ends at
   * the same moment could round to different day counts.
   */
  const now = Date.now()
  // Same price gating as every other surface: Coming Soon is resolved BEFORE
  // formatting, or an unreleased free-to-play title advertises itself as free.
  const onSale =
    !item.comingSoon &&
    item.discounted &&
    item.discountPercent > 0 &&
    item.originalPriceCents !== undefined

  return (
    <div ref={cardRef}>
    <StoreCard
      /* 15a: 420×236, art filling the card's full height. See ART_WIDTH_REM. */
      layout="side"
      artWidth={ART_WIDTH_REM}
      artHeight={ROW_HEIGHT_REM}
      density="compact"
      surface="boxed"
      title={item.name}
      art={item.headerUrl || item.capsuleUrl || undefined}
      artFallback={
        <div className="flex h-full w-full items-center justify-center bg-surface-raised px-3 text-center text-base leading-tight text-ink-faint">
          {item.name}
        </div>
      }
      price={item.comingSoon ? 'Coming Soon' : formatPrice(item.finalPriceCents, item.currency)}
      wasPrice={onSale ? formatPrice(item.originalPriceCents, item.currency) : undefined}
      discount={onSale ? `-${item.discountPercent}%` : undefined}
      rating={item.comingSoon ? undefined : item.reviewPercent}
      deck={showDeck ? item.deckCompat : undefined}
      flag={item.dealFlag}
      controllerSupport={item.controllerSupport === 'none' ? undefined : item.controllerSupport}
      rank={String(rank).padStart(2, '0')}
      note={noteFor(item, now)}
      priceFooter
      tier={tier}
      attention={(focused ? 'focused' : 'nearby') satisfies CardAttention}
      onActivate={onActivate}
    />
    </div>
  )
}
