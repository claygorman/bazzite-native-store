import type { ReactNode } from 'react'
import { StoreCard, type CardAttention } from './StoreCard'
import { Prompt } from './ButtonLegend'
import { formatPrice, type StoreItem } from '../types/steam'
import type { StoreTagInfo, TagSort } from '../platform/tagBrowse'
import { TAG_VIEW_SIZE, type TagBrowseState } from '../hooks/useTagBrowse'
import type { InputSource } from '../platform/glyphs'
import { useOwned } from '../hooks/useSteamLibrary'
import { useSetting } from '../hooks/useSettings'
import { TIER_STYLE } from '../platform/protondb'
import { useProtonRating } from '../hooks/useProtonRating'

/** 5 across, as the design draws it. */
export const TAG_RESULT_COLS = TAG_VIEW_SIZE

type Props = {
  tags: readonly StoreTagInfo[]
  sort: TagSort
  page: number
  state: TagBrowseState
  focusedIndex: number
  source: InputSource
  onActivate: (appid: number) => void
  /** The carousel above the results. Rendered here so both share one scroll frame. */
  spotlight?: ReactNode
}

/**
 * Inside a tag — design 7b.
 *
 * ⚠️ Every number here is a property of the QUERY, not of the tag, and the artboard
 * draws them as though they were fixed. Steam applies each sort as a filter, so the same
 * tag reports 5,214 games by review count, 13,525 by release date and 20,054 by
 * relevance — so the total, the page count and the range are all re-read whenever the
 * sort changes.
 *
 * ⚠️ The "showing N–M" range is approximate in one case, and knowingly so: adult
 * filtering can drop items out of the fetched 25 before it is sliced into fives, which
 * compacts the window. The alternative was a visible hole in a row of five. `M` is
 * therefore computed from what is actually on screen rather than from `N + 5`.
 *
 * ⚠️ `Y WISHLIST` from the artboard's tray is not rendered. Wishlisting is not reachable
 * anonymously (private/AUTH-AND-CART.md), and drawing a hint for a button that does nothing
 * is the bug fixed in 3e48ac0.
 */
export const TagResults = ({
  tags,
  sort,
  page,
  state,
  focusedIndex,
  source,
  onActivate,
  spotlight,
}: Props) => {
  const from = page * TAG_VIEW_SIZE + 1
  const to = from + state.items.length - 1

  return (
    <div className="absolute inset-x-0 bottom-18.5 top-0 flex flex-col gap-5 px-14 py-9">
      <header className="flex shrink-0 flex-col gap-2.5">
        <h1 className="truncate text-display font-extrabold tracking-display text-ink">
          {tags.map((t) => t.name).join(' + ')}
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-lg font-medium text-ink-faint">
            {state.loading && state.items.length === 0
              ? 'loading…'
              : `${state.total.toLocaleString()} games`}
          </span>
          <span className="h-5 w-px bg-hairline" />
          <span className="text-lg font-medium tabular-nums text-ink-faint">
            Page {page + 1} / {Math.max(1, state.pageCount).toLocaleString()}
          </span>
          <span className="h-5 w-px bg-hairline" />
          {/* Named here and not only in the tray, because changing it changes both
              numbers to its left. */}
          <span className="flex items-center gap-2.5 text-lg font-semibold text-ink-2">
            <Prompt action="shelfPrev" source={source} />
            {sort.label}
            <Prompt action="shelfNext" source={source} />
          </span>
        </div>
      </header>

      {spotlight}

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-baseline gap-4">
          <h2 className="text-2xl font-bold text-ink">{sort.label}</h2>
          {state.items.length > 0 && (
            <span className="text-base font-medium text-ink-faint">
              showing {from.toLocaleString()}–{to.toLocaleString()} of{' '}
              {state.total.toLocaleString()}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2.5 text-base font-semibold text-ink-faint">
            <Prompt action="pageNext" source={source} />
            Next page
          </span>
        </div>

        {/* One row of four. No vertical scroll any more — the page IS the row. */}
        <div className="-mx-6 -my-6 grid shrink-0 grid-cols-4 gap-x-5 px-6 py-6">
          {state.items.map((item, index) => (
            <ResultCard
              key={item.appid}
              item={item}
              attention={focusedIndex === index ? 'focused' : ('nearby' as CardAttention)}
              onActivate={() => onActivate(item.appid)}
            />
          ))}
          {!state.loading && state.items.length === 0 && (
            <span className="col-span-4 text-xl font-medium text-ink-faint">
              Nothing to show for this tag.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * One result.
 *
 * No fixed width — the grid column sizes it, which is what `StoreCard`'s optional
 * `width` exists for. Same price and review gating as the shelf tile; see
 * `docs/DESIGN-PORT.md` §4 for why that logic never lives in the card.
 */
const ResultCard = ({
  item,
  attention,
  onActivate,
}: {
  item: StoreItem
  attention: CardAttention
  onActivate: () => void
}) => {
  const owned = useOwned(item.appid)
  const showDeck = useSetting('deckVerified')
  /*
   * ⚠️ StoreCard has drawn a ProtonDB tier since the shelf tiles got one — this card
   * just never passed it, so every result on the tag screen showed Valve's Deck
   * verdict with the community tier beside it permanently blank. Same hook and same
   * TIER_STYLE mapping as `Tile`, so the two can never disagree about a colour.
   */
  const proton = useProtonRating(item.appid)
  const tier = proton.status === 'rated' ? TIER_STYLE[proton.rating.tier] : undefined
  const onSale =
    !item.comingSoon &&
    item.discounted &&
    item.discountPercent > 0 &&
    item.originalPriceCents !== undefined

  return (
    <StoreCard
      /*
       * ⚠️ Measured against the frame, not converted from the artboard.
       *
       * The design gives this row 236px of a 1080 frame, but its spotlight and headings
       * are drawn at absolute offsets while ours stack in flow — so the leftover is not
       * identical. 8.875rem (the artboard's own figure) overflowed the bottom of the
       * screen by 25px. 7.625rem fits with slack.
       */
      artHeight={7.625}
      density="compact"
      surface="boxed"
      title={item.name}
      /*
       * ⚠️ `|| undefined`, not `??`. `capsuleUrl` is set to `''` when GetItems had no
       * header asset, and an empty string is not nullish — so `??` passes it through
       * and renders `<img src="">`, which paints an empty plate rather than the
       * fallback. Whole rows of blank cards showed up the moment the sort surfaced
       * obscure titles, which is exactly where art is most often missing.
       */
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
      tier={tier}
      deck={showDeck ? item.deckCompat : undefined}
      flag={item.dealFlag}
      controllerSupport={item.controllerSupport === 'none' ? undefined : item.controllerSupport}
      owned={owned}
      attention={attention}
      onActivate={onActivate}
    />
  )
}
