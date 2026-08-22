import { StoreCard, type CardAttention } from './StoreCard'
import { Prompt } from './ButtonLegend'
import { formatPrice, type StoreItem } from '../types/steam'
import type { WishlistState } from '../hooks/useWishlist'
import type { InputSource } from '../platform/glyphs'
import { useSetting } from '../hooks/useSettings'

/** Two rows of five — the same card and the same grid as the tag results. */
export const WISHLIST_COLS = 5
export const WISHLIST_PAGE = WISHLIST_COLS * 2

type Props = {
  state: WishlistState
  focusedIndex: number
  page: number
  source: InputSource
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
export const WishlistView = ({ state, focusedIndex, page, source, onActivate }: Props) => {
  const { items, status, loading } = state
  const pageCount = Math.max(1, Math.ceil(items.length / WISHLIST_PAGE))
  const onScreen = items.slice(page * WISHLIST_PAGE, page * WISHLIST_PAGE + WISHLIST_PAGE)
  const onSale = items.filter((i) => i.discounted && i.discountPercent > 0).length

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
              {pageCount > 1 && (
                <>
                  <span className="h-5 w-px bg-hairline" />
                  <span className="tabular-nums">
                    Page {page + 1} / {pageCount}
                  </span>
                  <span className="flex items-center gap-2.5">
                    <Prompt action="pagePrev" source={source} />
                    <Prompt action="pageNext" source={source} />
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </header>

      {/* ⚠️ `-mx-6 -my-6 px-6 py-6` — the focus ring and glow are painted outside the
          card, and this grid is otherwise flush with the screen gutter. */}
      <div className="-mx-6 -my-6 grid shrink-0 grid-cols-5 gap-x-5 gap-y-6 px-6 py-6">
        {onScreen.map((item, index) => (
          <WishlistCard
            key={item.appid}
            item={item}
            focused={focusedIndex === page * WISHLIST_PAGE + index}
            onActivate={() => onActivate(item.appid)}
          />
        ))}
        {status === 'ready' && !loading && items.length === 0 && (
          <span className="col-span-5 text-xl font-medium text-ink-faint">
            Nothing on your wishlist yet.
          </span>
        )}
      </div>
    </div>
  )
}

const WishlistCard = ({
  item,
  focused,
  onActivate,
}: {
  item: StoreItem
  focused: boolean
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
    <StoreCard
      artHeight={7.625}
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
  )
}
