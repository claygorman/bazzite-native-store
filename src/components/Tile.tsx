import { useState } from 'react'
import type { StoreItem } from '../types/steam'
import { formatPrice } from '../types/steam'
import { TIER_STYLE } from '../platform/protondb'
import type { ProtonState } from '../hooks/useProtonRating'
import { useOwned } from '../hooks/useSteamLibrary'
import { useSetting } from '../hooks/useSettings'
import { CARD_SIZES, SHELF_SURFACE, StoreCard, type CardAttention } from './StoreCard'
import { ControllerGlyph } from './ControllerGlyph'

type Props = {
  item: StoreItem
  focused: boolean
  /** True when this tile's shelf is the focused one, focused tile or not. */
  rowActive: boolean
  /** Derived preview clip, present only once the focus has settled on this tile. */
  previewUrl?: string
  /**
   * Compatibility rating. `undefined` means "not asked yet" — ratings are fetched a
   * row at a time, so most tiles legitimately have none and must show a neutral dot
   * rather than an empty gap that reflows when it arrives.
   */
  proton?: ProtonState
  /** Whether a gamepad is the active input, for the focused tile's press hint. */
  padActive?: boolean
  onActivate: () => void
}

/**
 * A shelf tile.
 *
 * Since the 2026-08-21 componentization this is a thin wrapper: `StoreCard` owns every
 * pixel, and what remains here is the two things a generic card cannot know.
 *
 * **The microtrailer**, which the design has no concept of — a silent VP9 loop over the
 * artwork once focus settles, passed in through the card's `media` slot.
 *
 * **Policy about live Steam data**, which is the part that keeps biting:
 *
 * - `formatPrice(0)` returns 'Free' and unreleased titles report `final_price: 0` with
 *   no per-item flag, so `comingSoon` has to be resolved BEFORE formatting or every
 *   upcoming game is advertised as free.
 * - A pre-order discount is not a sale. Rendering it stacks "-10% / $15.99 / Coming
 *   Soon" — three contradictory prices — on one tile.
 * - An unreleased game having no reviews is not news, and saying so costs the caption
 *   the room its compatibility labels need.
 *
 * ⚠️ The caption under each tile reverses an older decision, that facts belong in a hero
 * because captions turn a shelf into "a grid of labelled thumbnails" at couch distance.
 * The design revision overrode it deliberately. Still worth re-judging on the TV; the
 * boxed-versus-bare question in `SHELF_SURFACE` is the same argument in a new form.
 */
export const Tile = ({
  item,
  focused,
  rowActive,
  previewUrl,
  proton,
  padActive,
  onActivate,
}: Props) => {
  const owned = useOwned(item.appid)
  /*
   * ⚠️ The Compatibility page's `Show Deck verdicts`, read at the card boundary rather
   * than threaded through the data layer — same reason as `useOwned`: the verdict is a
   * property of the LISTING, but whether to draw it is a property of this machine's
   * preferences, and hydration runs long before anyone opens Settings.
   */
  const showDeck = useSetting('deckVerified')
  const [artFailed, setArtFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const art = item.headerUrl ?? item.capsuleUrl
  // The microtrailer URL is derived and can 404 for any given game; the art stays
  // mounted underneath so a failed preview is invisible rather than a blank tile.
  const showVideo = focused && previewUrl !== undefined && !videoFailed

  const onSale =
    !item.comingSoon &&
    item.discounted &&
    item.discountPercent > 0 &&
    item.originalPriceCents !== undefined

  const attention: CardAttention = focused ? 'focused' : rowActive ? 'nearby' : 'away'
  const tier = proton?.status === 'rated' ? TIER_STYLE[proton.rating.tier] : undefined

  return (
    <StoreCard
      {...CARD_SIZES.shelf}
      surface={SHELF_SURFACE}
      title={item.name}
      art={artFailed ? undefined : art}
      onArtError={() => setArtFailed(true)}
      artFallback={
        <div className="flex h-full w-full items-center justify-center bg-surface-raised px-4 text-center text-base text-ink-faint">
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
      owned={owned}
      /*
       * Both DECLARED states — Steam's glyph, solid for full and half-filled for
       * partial. It survives being on every tile in a way the design's "Full controller
       * support" sentence did not.
       *
       * ⚠️ `none` is deliberately dropped, and it is the interesting case. Steam always
       * returns a `categories` object but simply omits `controller_categoryids`, and on
       * the live home rows that omission covers both genuinely keyboard-only games
       * (Counter-Strike 2, Stellaris, Civ VI) AND anything whose developer has not
       * filled the field in — every unreleased title, and the Steam Machine hardware
       * listing, which an earlier draft cheerfully labelled "No controller support".
       * One signal, two meanings, no way to tell them apart, so it is not a claim we
       * get to make.
       */
      controllerSupport={item.controllerSupport === 'none' ? undefined : item.controllerSupport}
      attention={attention}
      onActivate={onActivate}
      media={
        <>
          {showVideo && (
            <video
              key={previewUrl}
              src={previewUrl}
              autoPlay
              muted
              loop
              playsInline
              onError={() => setVideoFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {/* ⚠️ The drawn A, not the letter. This badge only ever appears when a pad
              is the active input, so it should be the button, not a description of it. */}
          {focused && padActive && (
            <span className="absolute bottom-2.5 right-2.5 grid place-items-center rounded-md bg-scrim p-1.25">
              <ControllerGlyph action="accept" source="gamepad" className="!size-6" />
            </span>
          )}
        </>
      }
    />
  )
}
