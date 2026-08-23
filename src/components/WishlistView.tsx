import { useEffect, useRef } from 'react'

import { StoreCard, type CardAttention } from './StoreCard'
import { formatPrice, type StoreItem } from '../types/steam'
import type { WishlistState } from '../hooks/useWishlist'
import { useSetting } from '../hooks/useSettings'

/**
 * Three across, scrolling — not a page of ten.
 *
 * ⚠️ The grid used to be two rows of five and paginate at ten, which left the entire
 * bottom half of a 4K screen empty while announcing "Page 1 / 3". A wishlist is a list
 * you scan, not a deck you deal, so the page scrolls and every item is on it.
 *
 * Three columns of the SIDE card rather than five of the stacked one: five squeezed the
 * caption below the width its own text needs, so "Deck Playable" rendered as "Deck
 * Playabl" on every tile whose verdict was longer than "Deck". The side layout gives the
 * text its own column instead of sharing the tile's width with nothing.
 */
export const WISHLIST_COLS = 3

/** Art width for the side card, in rem. Its height is derived from Steam's ratio. */
const ART_WIDTH_REM = 14

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

      {/* ⚠️ `-mx-6 -my-6 px-6 py-6` — the focus ring and glow are painted outside the
          card, and this grid is otherwise flush with the screen gutter. The padding is
          also what stops `scrollIntoView` clipping a focused card's ring against the
          scroll container's edge. */}
      <div className="-mx-6 -my-6 min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="grid grid-cols-3 gap-x-5 gap-y-5">
          {items.map((item, index) => (
            <WishlistCard
              key={item.appid}
              item={item}
              focused={focusedIndex === index}
              cardRef={focusedIndex === index ? focusedRef : undefined}
              onActivate={() => onActivate(item.appid)}
            />
          ))}
          {status === 'ready' && !loading && items.length === 0 && (
            <span className="col-span-3 text-xl font-medium text-ink-faint">
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
  cardRef,
  onActivate,
}: {
  item: StoreItem
  focused: boolean
  cardRef?: React.RefObject<HTMLDivElement | null>
  onActivate: () => void
}) => {
  const showDeck = useSetting('deckVerified')
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
      /*
       * ⚠️ Art at Steam's own header ratio, 460:215. It was 7.625rem tall against a
       * tile whose width the grid decided, so the box was far wider than the source and
       * `object-cover` cropped the top and bottom off every capsule — which is why the
       * art read as a squashed strip rather than as cover art.
       *
       * Derived from `artWidth` rather than written as a second magic number, so the
       * two cannot drift apart.
       */
      layout="side"
      artWidth={ART_WIDTH_REM}
      artHeight={(ART_WIDTH_REM * 215) / 460}
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
      attention={(focused ? 'focused' : 'nearby') satisfies CardAttention}
      onActivate={onActivate}
    />
    </div>
  )
}
