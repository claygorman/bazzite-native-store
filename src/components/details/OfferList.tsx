import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { offerRowsFor, type Offer } from '../../hooks/useOffers'
import { useSteamLibrary } from '../../hooks/useSteamLibrary'
import { ControllerGlyph } from '../ControllerGlyph'
import { BAND_SLIDE, FOCUS_FADE } from '../../platform/motion'
import type { InputSource } from '../../platform/glyphs'

/**
 * "Editions & bundles" — design turn 14a, the block Steam's own store makes you leave
 * the page for.
 *
 * It sits in the BOTTOM HALF of the Overview screen, below the hero column and the
 * gallery, rather than replacing them. Focus is two-level: up and down moves between
 * offers, left and right walks the items inside the focused one.
 *
 * ## Why this exists at all
 *
 * A bundle on Steam is a wall of capsules you cannot interrogate. You can see that
 * three games cost $46.48 together; you cannot ask what any one of them scores, whether
 * it runs under Proton, or whether you already own it, without leaving and coming back.
 * Here every item walks into a page in this store — DLC included — so a bundle becomes
 * a way to browse rather than a single opaque purchase.
 *
 * ⚠️ Still no cart, anywhere. Every price leads to `steam://`, never to a checkout of
 * ours. That is the architectural line in CLAUDE.md, not a v1 shortcut.
 */

/**
 * The band the block lives in — design's "a new row below the current top two
 * sections", measured against what is actually above it.
 *
 * The hero column bottoms out around 31rem and the gallery's filmstrip around 35.5rem
 * of a 67.5rem viewport, at every scale the rem clamp produces; the button tray starts
 * at 6rem from the bottom. So this is the free space, not a guess.
 */
/**
 * Resting, the block sits under the hero and the gallery — "a new row below the current
 * top two sections".
 *
 * ⚠️ Focused, it takes the page. The first version kept the band fixed and slid the list
 * inside it, which meant four offers scrolled within an 18rem window while two thirds of
 * the screen sat still — the content moved under a frame that did not, which reads as a
 * widget rather than as a page. Moving the PAGE instead is what Clay asked for and is the
 * better answer: the hero lifts away, the offers get the height they need, and nothing has
 * to scroll inside anything.
 */
/*
 * ⚠️ **ONE geometry, and the movement is a transform.** This used to be two classes —
 * `top-[35.5rem]` and `top-25` — with `transition-[top]` between them, and that was the
 * choppy hero-to-offers transition Clay reported.
 *
 * `top` is a LAYOUT property, and because `bottom` is pinned, moving `top` also changes
 * the band's HEIGHT. So every frame of that 200ms the browser re-laid-out the entire
 * offers subtree — every row, every capsule, every price — then repainted it. Roughly
 * 29rem of travel across most of the screen, at 60fps.
 *
 * ⚠️ Promotion could not have saved it and nothing about the earlier fix was wrong: that
 * one promoted the hero and the gallery, which are the things LEAVING, and they were
 * genuinely part of it. This is the thing ARRIVING, and no amount of `will-change` makes
 * a layout property cheap. It had to stop being a layout property.
 *
 * The band now always has the FOCUSED geometry and the content inside it is translated
 * down at rest. The arithmetic works because `bottom` never moves: only the top edge
 * travels, so a translate of the difference puts the content exactly where the old `top`
 * put it — 6.25 + 29.25 = 35.5rem.
 *
 * ⚠️ `overflow-hidden` is what keeps that honest. Without it the translated content would
 * hang 29.25rem below the band and run under the button tray at rest. It costs nothing in
 * clipped focus glows, because the list inside already clips at this same box.
 */
const BAND = 'absolute inset-x-14 bottom-24 top-25 overflow-hidden'
/** 35.5rem (the old `BAND_REST` top) − 6.25rem (`top-25`). See `BAND`. */
const REST_DROP_REM = 29.25

type Props = {
  offers: Offer[]
  loading: boolean
  /** The game whose page this is — its own row leads the list. */
  subjectName: string
  subjectPriceLabel?: string
  /** True when this block holds focus at all. */
  focused: boolean
  /** Which offer row the dpad is on. */
  row: number
  /**
   * Which item inside that row is lit, or `undefined` for the row itself.
   *
   * ⚠️ The two are genuinely different states, not "item 0 by default". With the row
   * selected, A opens the bundle's page; with an item selected, A opens that game's.
   * The row's own A glyph stands down while an item is lit, which is why the artboard
   * shows exactly one A on screen — four A badges would say "actionable" four times and
   * tell you nothing about which one you are about to press.
   */
  col?: number
  /**
   * Click-through for a pointer: `col` undefined means the row itself.
   *
   * ⚠️ Moves focus AND activates, exactly as `Shelf` does with `onFocusItem` +
   * `onActivate`. Clicking something that then needs a second press to confirm is the
   * kind of half-wired pointer support that is worse than none.
   */
  onPick: (row: number, col?: number) => void
  source: InputSource
}

const Pct = ({ value, struck }: { value: number; struck?: boolean }) =>
  struck ? (
    <span className="flex items-center rounded-sm bg-chip px-2.25 py-1.25 text-lg font-bold tabular-nums text-ink-faint line-through">
      -{value}%
    </span>
  ) : (
    <span className="rounded-sm bg-sale px-2.75 py-1.5 text-2xl font-extrabold tabular-nums text-ink-on-light">
      -{value}%
    </span>
  )

/**
 * One capsule in a bundle's item strip.
 *
 * ⚠️ Named UNDERNEATH rather than carrying an A hint. The lit ring already says it is
 * actionable, and the design is explicit that a row of A badges would say it four
 * times. The name is what you actually need — "Original Soundtrack" and "Pax Umbra" are
 * not guessable from 184×86 of cover art at ten feet.
 */
const Item = ({
  item,
  state,
  owned,
  onPick,
}: {
  item: { appid: number; name: string; capsuleUrl?: string; isSubject: boolean }
  /** `lit` = the dpad is on it · `near` = its row is focused · `far` = neither. */
  state: 'lit' | 'near' | 'far'
  owned: boolean
  /** Click lands focus here AND opens it, the same pair a shelf tile does. */
  onPick: () => void
}) => (
  /*
   * ⚠️ A real `<button>`, not a div with a handler. Every square here is selectable
   * with the dpad, and the mouse has to reach the same thing — on a desktop this app is
   * developed and demoed with a pointer, and an element that lights up under the dpad
   * but ignores a click reads as broken rather than as controller-only.
   */
  <button type="button" onClick={onPick} className="flex flex-none flex-col gap-1.75 text-left">
    {/*
     * ⚠️ The wrapper exists ONLY to give the glow somewhere to live that is not inside
     * the clip. The lit glow used to be a `transition-shadow` on the box below, and that
     * box is `overflow-hidden` — fine for its own shadow, since an element's box-shadow
     * is not clipped by its own overflow, but it means a glow LAYER cannot be a child of
     * it without being cut off at the capsule's edge.
     */}
    <div className="relative">
      {/*
       * ⚠️ Opacity on a static layer, not a 26px blur being re-rasterised every frame of
       * a shadow transition — and this one fires on every dpad step along the offers row,
       * twice (the tile arriving and the tile leaving). See `FOCUS_FADE`.
       */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-md shadow-[0_0_1.625rem_rgba(77,155,230,.55)]"
        initial={false}
        animate={{ opacity: state === 'lit' ? 1 : 0 }}
        transition={FOCUS_FADE}
      />
      <div
        className={[
          // ⚠️ No `transition-shadow` any more: the only shadow it animated is the glow
          // above. The outline is a separate property and never transitioned — it snapped
          // before this change and it snaps now.
          'relative overflow-hidden rounded-md',
          state === 'lit' ? 'outline-2 outline-offset-[0.1875rem] outline-focus' : '',
          state === 'lit' ? 'opacity-100' : state === 'near' ? 'opacity-78' : 'opacity-62',
        ].join(' ')}
      >
        {item.capsuleUrl ? (
          <img src={item.capsuleUrl} alt="" className="block h-21.5 w-46 object-cover" />
        ) : (
          <div className="h-21.5 w-46 bg-plate" />
        )}
        {owned && (
          <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-focus text-xs font-extrabold text-ink-on-accent shadow-[0_0_0_0.1875rem_rgba(8,13,22,.75)]">
            ✓
          </span>
        )}
        {item.isSubject && (
          <span className="absolute bottom-1.5 left-1.5 rounded-sm bg-scrim px-2 py-0.75 text-xs font-bold tracking-[0.06em] text-ink-2/85">
            THIS GAME
          </span>
        )}
      </div>
    </div>
    <span
      className={`w-46 truncate text-base font-semibold ${state === 'lit' ? 'text-ink' : 'text-ink-2/60'}`}
    >
      {item.name || `App ${item.appid}`}
    </span>
  </button>
)

export const OfferList = ({
  offers,
  loading,
  subjectName,
  subjectPriceLabel,
  focused,
  row,
  col,
  onPick,
  source,
}: Props) => {
  const { owned } = useSteamLibrary()
  const listRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)

  /*
   * ⚠️ The base game leads the list even though Steam does not return it as a purchase
   * option in the same shape. Without it the block opens with "Soundtrack Edition" and
   * silently implies the plain game is not for sale — and on a game that is in no
   * bundle at all, this row is the whole block rather than an empty frame under a
   * heading, which would read as a load that failed.
   */
  const rows = offerRowsFor(offers)
  const demoCount = rows.filter((r) => r.kind === 'demo').length
  const buyCount = rows.length - demoCount

  /*
   * Slide the column so the focused row is fully visible.
   *
   * ⚠️ Measured from the DOM rather than computed from a row height, because rows are
   * NOT uniform: the base row has no item strip and each bundle's strip is as tall as
   * its labels wrap. A constant row height would drift a little further out of true
   * with every row passed, which is the failure mode that looks like a rounding bug
   * and is actually an assumption.
   */
  useLayoutEffect(() => {
    const list = listRef.current
    const track = list?.firstElementChild
    const item = track?.children[row] as HTMLElement | undefined
    if (!list || !item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    setOffset((current) => {
      if (top < current) return top
      if (bottom > current + list.clientHeight) return bottom - list.clientHeight
      return current
    })
  }, [row, offers.length, loading])

  /*
   * ⚠️ The slide is on the CONTENT, not on the box — see `BAND`. The box never moves, so
   * `overflow-hidden` there keeps the resting state clipped exactly where the old
   * `bottom-24` clipped it, and this transform is pure compositing.
   */
  const slide = {
    initial: false as const,
    animate: { y: focused ? 0 : `${REST_DROP_REM}rem` },
    transition: BAND_SLIDE,
    style: { willChange: 'transform' },
  }

  if (loading) {
    return (
      <div className={BAND}>
        <motion.div className="flex h-full transform-gpu flex-col gap-4" {...slide}>
          <div className="h-8 w-72 animate-pulse rounded-md bg-chip" />
          <div className="h-28 animate-pulse rounded-xl bg-chip-soft" />
        </motion.div>
      </div>
    )
  }

  return (
    <div className={BAND}>
      <motion.div className="flex h-full transform-gpu flex-col gap-4" {...slide}>
      <div className="flex items-baseline gap-4.5">
        <h2 className="text-3xl font-extrabold tracking-display text-ink">
          Editions &amp; bundles
        </h2>
        <span className="text-lg font-medium text-ink-3/50">
          {buyCount} {buyCount === 1 ? 'way' : 'ways'} to buy
          {/* ⚠️ Counted separately. A demo costs nothing, so folding it into "3 ways to
              buy" would overstate the offers by one and price a free thing. */}
          {demoCount > 0 && ' · a free demo'} · prices from Steam, checkout in Steam
        </span>
      </div>

      {/*
        ⚠️ The list WINDOWS rather than fitting. Four offers with item strips is roughly
        44rem of content and the band under the hero is ~18rem — the artboard can show
        all four because the offers block is the only thing on it, and here it is not.
        So the column slides to keep the focused row in view, exactly the way the
        gallery's filmstrip slides horizontally. Shrinking the rows to fit instead would
        put 184x86 capsules and their labels below what reads at ten feet, which is the
        one thing this design cannot trade away.
      */}
      {/*
        ⚠️ Still clips, but now only as a safety net. With the page lifted there is room
        for four offers, and the translate below stays for the game that has eight — a
        list that silently runs off the bottom of a television is worse than one that
        slides.
      */}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex flex-col gap-3 transition-transform duration-200 ease-out will-change-transform"
          style={{ transform: `translateY(${-offset}px)` }}
        >
          {rows.map((rowData, index) => {
            const here = focused && index === row
            const isDemo = rowData.kind === 'demo'
            const offer = rowData.kind === 'subject' ? undefined : rowData.offer
            const items = offer?.items ?? []
            // The row's own action is offered only when the dpad is on the row rather
            // than inside it — see the `col` prop's note.
            const rowAction = here && col === undefined

            return (
              <div
                key={isDemo ? `demo-${offer?.demoAppid}` : (offer?.bundleid ?? 'base')}
                className={[
                  'flex flex-none items-center gap-7 rounded-xl px-6 py-5 transition-colors',
                  here ? 'bg-plate-focus' : 'bg-plate shadow-[0_0_0_1px_var(--color-chip-soft)]',
                ].join(' ')}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`truncate text-xl font-bold ${here ? 'text-ink' : 'text-ink-soft'}`}
                    >
                      {offer ? offer.name : subjectName}
                    </span>
                    {rowData.kind === 'bundle' && (
                      <span className="flex-none rounded-sm bg-focus/20 px-2.5 py-1 text-xs font-extrabold tracking-[0.1em] text-focus-ink">
                        BUNDLE
                      </span>
                    )}
                    {/* Green, not the accent — it reads as "free to try" rather than as
                        one more thing on sale. Same token the old inert card used. */}
                    {isDemo && (
                      <span className="flex-none rounded-sm bg-ok-wash px-2.5 py-1 text-xs font-extrabold tracking-[0.1em] text-pad-ok">
                        DEMO
                      </span>
                    )}
                  </div>

                  {rowData.kind === 'bundle' && offer?.bundleDiscountPercent !== undefined && (
                    <span className="text-base font-medium text-ink-3/55">
                      Save {offer.bundleDiscountPercent}% on all {offer.gameCount} items
                    </span>
                  )}

                  {items.length > 0 && (
                    <div className="flex items-start gap-3">
                      {items.map((item, itemIndex) => (
                        <Item
                          key={item.appid}
                          item={item}
                          owned={owned.has(item.appid)}
                          state={here && col === itemIndex ? 'lit' : here ? 'near' : 'far'}
                          onPick={() => onPick(index, itemIndex)}
                        />
                      ))}
                    </div>
                  )}

                  {/*
                  ⚠️ The one place the arithmetic stops being simple, and we say so
                  rather than guessing. Steam charges only for what you do not already
                  own, so the price on this row is higher than what this account would
                  actually pay. We show Steam's own number and name the discrepancy —
                  computing "your" total would mean pricing packages we cannot price.
                */}
                  {offer && items.some((item) => owned.has(item.appid)) && (
                    <span className="flex items-center gap-2.25 text-base font-medium leading-[1.3] text-ink-3/50">
                      <span className="size-2.25 flex-none rounded-full bg-focus" />
                      You own {items.filter((item) => owned.has(item.appid)).length} of{' '}
                      {items.length} — Steam prices the remainder at checkout
                    </span>
                  )}
                </div>

                <div className="flex flex-none items-center gap-3.5">
                  {offer?.bundleDiscountPercent !== undefined &&
                    offer.discountPercent !== undefined &&
                    offer.discountPercent > offer.bundleDiscountPercent && (
                      <Pct value={offer.bundleDiscountPercent} struck />
                    )}
                  {offer?.discountPercent !== undefined && offer.discountPercent > 0 && (
                    <Pct value={offer.discountPercent} />
                  )}

                  <span className="flex flex-col items-end gap-0.75">
                    {offer?.formattedOriginalPrice !== undefined && (
                      <span className="text-base font-semibold tabular-nums text-ink-faint line-through">
                        {offer.formattedOriginalPrice}
                      </span>
                    )}
                    <span className="text-2xl font-extrabold tabular-nums text-ink">
                      {offer ? (offer.formattedFinalPrice ?? '—') : (subjectPriceLabel ?? '—')}
                    </span>
                  </span>

                  <span
                    className={[
                      'flex items-center gap-2.75 whitespace-nowrap rounded-full px-5.5 py-3.5 text-lg font-bold',
                      rowAction
                        ? 'bg-gradient-to-br from-accent-hi to-accent-lo text-ink-on-accent'
                        : 'border border-hairline bg-chip-strong text-ink',
                    ].join(' ')}
                  >
                    {rowAction && <ControllerGlyph action="accept" source={source} />}
                    {isDemo ? 'Get the demo' : offer ? 'Open bundle page' : 'Buy in Steam'}
                  </span>
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
