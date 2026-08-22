import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Prompt } from './ButtonLegend'
import { formatPrice, DECK_COMPAT_LABEL, type StoreItem } from '../types/steam'
import { DEAL_FLAG_GRADIENTS } from '../platform/steam'
import { TIER_STYLE } from '../platform/protondb'
import type { ProtonState } from '../hooks/useProtonRating'
import type { InputSource } from '../platform/glyphs'

/** How long each spotlight holds before the carousel advances. */
export const SPOTLIGHT_DWELL_MS = 9000
/** Progress ticks per second — enough to look continuous, cheap enough to ignore. */
const TICK_MS = 100

type Props = {
  games: readonly StoreItem[]
  index: number
  /** True when the carousel, rather than the grid below, has focus. */
  focused: boolean
  /** Silent looping clip for the current spotlight, once it resolves. */
  previewUrl?: string
  proton?: ProtonState
  source: InputSource
  onAdvance: () => void
  onActivate: (appid: number) => void
}

/**
 * "Featured in this tag" — design 7b's spotlight, modelled on Steam's own
 * `/category/<slug>` carousel.
 *
 * ⚠️ The heading says **Top sellers**, not "Featured this week", and that is a
 * correction rather than a preference. Steam's spotlights are personalized and come
 * back empty for an anonymous caller — verified by reading a category page's
 * `data-ch_spotlights_data`, which is `[]` everywhere, as is the `featured` list beside
 * it. See `useTagSpotlights`. Calling a top-seller list "featured this week" would be
 * inventing an editorial claim out of a sales ranking.
 *
 * Geometry is the artboard's, converted from its 1920 frame: the video panel is
 * 47.25 x 26.5625rem, which is 756 x 425 and a **true 16:9** — the design is explicit
 * about that, and a microtrailer is 854x480, so it fills the frame without letterboxing
 * or cropping. The facts panel takes the remaining 30%.
 */
export const TagSpotlight = ({
  games,
  index,
  focused,
  previewUrl,
  proton,
  source,
  onAdvance,
  onActivate,
}: Props) => {
  const game = games[index]
  const next = games[(index + 1) % Math.max(1, games.length)]
  const [elapsed, setElapsed] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)

  /*
   * The advance timer, and the 4px bar under the video that shows it.
   *
   * ⚠️ `onAdvance` is held in a ref rather than listed as a dependency. As a dependency
   * it re-created the interval on every parent render, and since each new interval
   * starts its own countdown the carousel could sit at 0% indefinitely — a progress bar
   * that visibly resets is how that bug shows itself.
   */
  const advanceRef = useRef(onAdvance)
  advanceRef.current = onAdvance

  useEffect(() => {
    setElapsed(0)
    if (games.length < 2) return
    const timer = setInterval(() => {
      setElapsed((ms) => {
        const at = ms + TICK_MS
        if (at >= SPOTLIGHT_DWELL_MS) {
          advanceRef.current()
          return 0
        }
        return at
      })
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [index, games.length])

  if (!game) return null

  const tier = proton?.status === 'rated' ? TIER_STYLE[proton.rating.tier] : undefined
  const onSale =
    game.discounted && game.discountPercent > 0 && game.originalPriceCents !== undefined
  const showVideo = previewUrl !== undefined && !videoFailed

  return (
    <div className="flex shrink-0 flex-col gap-4">
      <div className="flex items-baseline gap-4.5">
        <h2 className="text-2xl font-bold text-ink">Top sellers in this tag</h2>
        <span className="text-base font-medium text-ink-faint">
          {index + 1} of {games.length}
        </span>
      </div>

      {/*
        ⚠️ `-mr-14` is deliberate. The next spotlight is drawn bleeding off the right
        edge of the 1920 frame — that peek is what says "there are more" without a
        second control — so this row has to escape the screen's own 3.5rem gutter and
        clip against the display edge instead.

        ⚠️ ...and clipping is exactly why `py-1.75 pl-1.75` is here, cancelled by the
        matching negative margins so nothing moves. `card-ring` is a 0.1875rem outline at
        0.25rem offset = 0.4375rem painted OUTSIDE the card's border box, and this row is
        the height of the card and starts flush with it. Without the padding the focused
        ring was cut on the top, left and bottom and survived only on the right, against
        the gap before the peek — which reads as a stray blue line rather than as a
        clipped ring, and is the third time this class of bug has shown up here (see
        Shelf.tsx). Nothing painted on a child may exceed its clip container's padding.
      */}
      <div className="-my-1.75 -ml-1.75 -mr-14 flex shrink-0 items-stretch gap-6 overflow-hidden py-1.75 pl-1.75">
        <button
          type="button"
          onClick={() => onActivate(game.appid)}
          className={[
            'flex h-106.25 w-270 shrink-0 overflow-hidden rounded-lg bg-plate text-left',
            focused ? 'card-ring z-10' : 'card-ring-off',
          ].join(' ')}
        >
          {/* 47.25 x 26.5625rem = 756 x 425 = exactly 16:9. */}
          <div className="relative h-full w-189 shrink-0 overflow-hidden">
            {game.headerUrl !== undefined && (
              <img
                src={game.headerUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
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

            {game.dealFlag !== undefined && (
              <span
                className="absolute left-0 top-0 px-3 py-1 text-sm font-medium uppercase leading-5 tracking-wide text-white shadow-flag"
                style={{ backgroundImage: DEAL_FLAG_GRADIENTS[game.dealFlag] }}
              >
                {game.dealFlag}
              </span>
            )}

            {/*
              ⚠️ A statement, not a control. Steam's microtrailers carry no audio stream
              at all, so there is nothing to unmute — and there is deliberately no pause
              either: leaving the carousel is how you stop it, which costs one button
              press and does not spend X on a second meaning. X is the sound toggle on
              the details page and nothing anywhere else.
            */}
            <span className="absolute right-2.5 top-2.5 rounded-md bg-scrim px-2.5 py-1.25 text-sm font-bold text-ink-mute">
              Muted
            </span>

            <span className="absolute bottom-2.5 left-2.5 rounded-md bg-scrim px-2.5 py-1.25 text-sm font-bold text-ink-mute">
              Microtrailer
            </span>

            {/* The advance timer, made visible. Without it the carousel moving on its
                own reads as the UI doing something random. */}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-scrim-soft">
              <motion.span
                className="block h-full bg-focus shadow-[0_0_0.875rem_rgba(77,155,230,.8)]"
                animate={{ width: `${(elapsed / SPOTLIGHT_DWELL_MS) * 100}%` }}
                transition={{ duration: TICK_MS / 1000, ease: 'linear' }}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3.5 border-l border-hairline p-5.5">
            <span className="truncate text-2xl font-bold leading-tight text-ink">{game.name}</span>

            {/* Steam's own blurb. Stands in for the artboard's `headline`, which comes
                from a marketing announcement no anonymous call reaches. */}
            {game.shortDescription !== undefined && (
              <span className="line-clamp-4 text-base font-medium leading-snug text-ink-mute">
                {game.shortDescription}
              </span>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {game.deckCompat !== undefined && game.deckCompat !== 'unknown' && (
                <span className="rounded bg-chip px-3 py-1 text-base font-medium text-ink-mute">
                  Deck {DECK_COMPAT_LABEL[game.deckCompat]}
                </span>
              )}
              {tier !== undefined && (
                <span className="flex items-center gap-2 rounded bg-chip px-3 py-1 text-base font-medium text-ink-mute">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: tier.dot }}
                  />
                  Proton {tier.label}
                </span>
              )}
            </div>

            {game.reviewPercent !== undefined && (
              <span className="text-lg font-bold tabular-nums text-rating-up">
                {game.reviewPercent}% positive
              </span>
            )}

            <div className="mt-auto flex flex-col gap-2.5">
              <span className="flex items-center gap-2.5">
                {onSale && (
                  <>
                    <span className="rounded bg-sale px-1.5 py-0.5 text-base font-extrabold tabular-nums text-ink-on-light">
                      -{game.discountPercent}%
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-ink-faint line-through">
                      {formatPrice(game.originalPriceCents, game.currency)}
                    </span>
                  </>
                )}
                <span className="text-xl font-extrabold tabular-nums text-white">
                  {formatPrice(game.finalPriceCents, game.currency)}
                </span>
              </span>
              <span className="flex items-center gap-2.5 text-base font-bold text-ink-2">
                <Prompt action="accept" source={source} />
                Open store page
              </span>
            </div>
          </div>
        </button>

        {/* The peek. Rounded on its left only — its right edge is the display edge. */}
        {next !== undefined && next.appid !== game.appid && (
          <div className="relative h-106.25 w-190 shrink-0 overflow-hidden rounded-l-lg opacity-45">
            {next.headerUrl !== undefined && (
              <img
                src={next.headerUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-baseline gap-3 bg-scrim px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-lg font-bold text-ink">
                {next.name}
              </span>
              <span className="shrink-0 text-lg font-bold tabular-nums text-ink">
                {formatPrice(next.finalPriceCents, next.currency)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Carousel dots, centred under the spotlight card only — not under the peek. */}
      <div className="flex w-270 shrink-0 items-center justify-center gap-2.25">
        {games.map((g, i) => (
          <span
            key={g.appid}
            className={`h-2.25 rounded-full transition-all duration-200 ${
              i === index ? 'w-7 bg-ink' : 'w-2.25 bg-ink/30'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
