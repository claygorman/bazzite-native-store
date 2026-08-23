import { TIER_STYLE, type ProtonTier } from '../platform/protondb'
import type { BundleDetails, StoreItemFacts } from '../platform/steam'
import type { ProtonState } from '../hooks/useProtonRating'
import { useSteamLibrary } from '../hooks/useSteamLibrary'
import { ControllerGlyph } from './ControllerGlyph'
import type { InputSource } from '../platform/glyphs'
import { motion } from 'motion/react'
import { PAGE_ENTER } from '../platform/motion'

/**
 * A bundle's own page — design turn 14b, `/bundle/<id>` rendered here rather than in
 * Steam.
 *
 * ⚠️ The contents are real store CARDS, not capsules, and that is the whole turn. A
 * capsule tells you a bundle contains three things. A card tells you what each one
 * scores, whether it runs under Proton, what it costs on its own, and whether you
 * already own it — which is the information you need to decide whether the bundle is a
 * good deal, and exactly the information Steam's bundle page withholds.
 *
 * ⚠️ X is the only control here that leaves the client. Every other press stays inside
 * the store — A walks into a game's page, B goes back to the offers you came from.
 */

type Props = {
  bundle?: BundleDetails
  /** Per-app facts, hydrated separately: the bundle response carries no reviews. */
  facts: Map<number, StoreItemFacts>
  /** Per-app ProtonDB tiers, keyed by appid. */
  ratings: Map<number, ProtonState>
  loading: boolean
  /** Which card the dpad is on. */
  index: number
  /** Pointer click-through, mirroring A on the focused card. */
  onPick: (index: number) => void
  source: InputSource
}

const Card = ({
  appid,
  facts,
  rating,
  owned,
  focused,
  onPick,
  source,
}: {
  appid: number
  facts?: StoreItemFacts
  rating?: ProtonState
  owned: boolean
  focused: boolean
  /** Click lands focus here AND opens the game — same pair the dpad's A does. */
  onPick: () => void
  source: InputSource
}) => {
  const tier: ProtonTier | undefined =
    rating?.status === 'rated'
      ? rating.rating.tier
      : rating?.status === 'unrated'
        ? 'pending'
        : undefined
  const style = tier ? TIER_STYLE[tier] : undefined

  return (
    /*
     * ⚠️ A real `<button>`. Each card is a dpad target, and the pointer has to reach the
     * same one — the whole argument for this page is that the games in a bundle are
     * individually interrogable, and a card you can look at but not click is only half
     * of that. `text-left` because a button centres its text by default.
     */
    <button
      type="button"
      onClick={onPick}
      className={[
        'relative isolate flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl text-left transition-colors',
        focused
          ? 'bg-plate-focus shadow-[0_0_0_0.09375rem_rgba(122,186,240,.38),0_0_3.375rem_rgba(77,155,230,.55),0_1.25rem_2.875rem_rgba(0,0,0,.6)]'
          : 'bg-plate shadow-[0_0_0_1px_var(--color-chip-soft)]',
      ].join(' ')}
    >
      <div className="relative">
        {facts?.headerUrl ? (
          <img src={facts.headerUrl} alt="" className="block h-66 w-full object-cover" />
        ) : (
          <div className="h-66 w-full bg-surface-raised" />
        )}
        {owned && (
          <span className="absolute right-2.5 top-2.5 grid size-7.5 place-items-center rounded-full bg-focus text-sm font-extrabold text-ink-on-accent shadow-[0_0_0_0.25rem_rgba(8,13,22,.72)]">
            ✓
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-5.5 pb-5.5 pt-5">
        <span className="text-xs font-bold uppercase tracking-label text-ink-3/42">
          {owned ? 'In your library' : 'Not owned'}
        </span>
        <span className={`truncate text-xl font-bold ${focused ? 'text-ink' : 'text-ink-soft'}`}>
          {facts?.name ?? `App ${appid}`}
        </span>

        <div className="flex min-h-8.5 items-center gap-3 whitespace-nowrap">
          {/*
            ⚠️ "Owned" replaces the price rather than sitting beside a struck-through
            one. A price you are not going to pay, shown next to a game you already
            have, is the kind of thing people read as a charge.
          */}
          {owned ? (
            <span className="text-lg font-extrabold text-focus-ink">Owned</span>
          ) : (
            <>
              {facts?.discounted && facts.discountPercent > 0 && (
                <span className="flex items-center gap-2">
                  <span className="rounded-sm bg-sale px-1.75 py-0.75 text-base font-extrabold tabular-nums text-ink-on-light">
                    -{facts.discountPercent}%
                  </span>
                  {facts.originalPriceCents !== undefined && (
                    <span className="text-sm font-semibold tabular-nums text-ink-faint line-through">
                      ${(facts.originalPriceCents / 100).toFixed(2)}
                    </span>
                  )}
                </span>
              )}
              <span className="text-lg font-extrabold tabular-nums text-ink">
                {facts?.finalPriceCents === undefined
                  ? '—'
                  : facts.finalPriceCents === 0
                    ? 'Free'
                    : `$${(facts.finalPriceCents / 100).toFixed(2)}`}
              </span>
            </>
          )}
          {facts?.reviewPercent !== undefined && (
            <>
              <span className="h-5 w-px bg-hairline" />
              <span className="text-base font-bold tabular-nums text-rating-up">
                {facts.reviewPercent}%
              </span>
            </>
          )}
        </div>

        {/* Held even while the rating is in flight, so the card does not grow under
            the cursor when protondb answers. */}
        <span className="flex min-h-6 items-center gap-2.25 text-base font-semibold text-ink-2/70">
          {style && (
            <>
              <span className="size-3 flex-none rounded-full" style={{ background: style.dot }} />
              Proton {style.label}
            </>
          )}
        </span>

        {focused && (
          <span className="mt-1.5 flex items-center justify-center gap-2.5 rounded-full bg-gradient-to-br from-accent-hi to-accent-lo px-4.5 py-3 text-lg font-bold text-ink-on-accent">
            <ControllerGlyph action="accept" source={source} />
            Open this page
          </span>
        )}
      </div>
    </button>
  )
}

export const BundlePage = ({ bundle, facts, ratings, loading, index, onPick, source }: Props) => {
  const { owned } = useSteamLibrary()
  const appids = bundle?.appids ?? []
  const ownedCount = appids.filter((id) => owned.has(id)).length

  return (
    <motion.div className="absolute inset-0" {...PAGE_ENTER}>
      {/*
        ⚠️ The breadcrumb is not decoration here. This is the one screen you can only
        arrive at from somewhere else, and B goes back to that somewhere rather than to
        Home — saying so on screen is what makes walking into a bundle feel like a
        detour rather than a departure. The route is printed because `/bundle/<id>` is
        a real Steam address, and seeing it is what tells you this is the actual bundle
        rather than a summary we assembled.
      */}
      <div className="absolute left-14 top-10 flex items-center gap-4.5">
        <span className="rounded-full border border-hairline px-4.5 py-2.25 text-base font-bold text-ink">
          Esc
        </span>
        <span className="text-lg font-medium text-ink-2/72">
          Back to offers · /bundle/{bundle?.bundleid ?? ''}
        </span>
      </div>

      <div className="absolute left-14 right-14 top-26 flex items-end gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3.5">
            <h1 className="truncate text-5xl font-extrabold tracking-display text-ink">
              {bundle?.name ?? (loading ? '' : 'Bundle')}
            </h1>
            <span className="flex-none rounded-md bg-focus/20 px-3 py-1.25 text-sm font-extrabold tracking-[0.1em] text-focus-ink">
              BUNDLE
            </span>
          </div>
          <span className="text-xl font-medium text-ink-3/60">
            {appids.length} {appids.length === 1 ? 'game' : 'games'}
            {bundle?.bundleDiscountPercent !== undefined &&
              ` · save ${bundle.bundleDiscountPercent}% buying them together`}
            {ownedCount > 0 && ` · you already own ${ownedCount}`}
          </span>
        </div>

        <div className="flex flex-none items-center gap-3.5">
          {bundle?.bundleDiscountPercent !== undefined &&
            bundle.discountPercent !== undefined &&
            bundle.discountPercent > bundle.bundleDiscountPercent && (
              <span className="rounded-sm bg-chip px-2.25 py-1.25 text-lg font-bold tabular-nums text-ink-faint line-through">
                -{bundle.bundleDiscountPercent}%
              </span>
            )}
          {bundle?.discountPercent !== undefined && bundle.discountPercent > 0 && (
            <span className="rounded-sm bg-sale px-2.75 py-1.5 text-2xl font-extrabold tabular-nums text-ink-on-light">
              -{bundle.discountPercent}%
            </span>
          )}
          <span className="flex flex-col items-end gap-0.75">
            {bundle?.formattedOriginalPrice !== undefined && (
              <span className="text-base font-semibold tabular-nums text-ink-faint line-through">
                {bundle.formattedOriginalPrice}
              </span>
            )}
            <span className="text-3xl font-extrabold tabular-nums text-ink">
              {bundle?.formattedFinalPrice ?? '—'}
            </span>
          </span>
          <span className="flex items-center gap-2.75 whitespace-nowrap rounded-full border border-hairline bg-chip-strong px-6 py-3.75 text-lg font-bold text-ink">
            <ControllerGlyph action="secondary" source={source} />
            Buy in Steam · the only step that leaves
          </span>
        </div>
      </div>

      <div className="absolute inset-x-14 top-[15.5rem] flex items-start gap-6">
        {appids.map((appid, cardIndex) => (
          <Card
            key={appid}
            appid={appid}
            facts={facts.get(appid)}
            rating={ratings.get(appid)}
            owned={owned.has(appid)}
            focused={cardIndex === index}
            onPick={() => onPick(cardIndex)}
            source={source}
          />
        ))}
      </div>

      {/*
        ⚠️ Says the quiet part rather than doing arithmetic we cannot do. Steam charges
        only for what you do not own, so the headline total above is higher than what
        this account would actually pay at checkout. Showing a computed "your price"
        would mean pricing packages we cannot price, and being confidently wrong about
        money is the one error this page cannot afford.
      */}
      {ownedCount > 0 && (
        <div className="absolute inset-x-14 bottom-30 flex items-center gap-3 text-lg font-medium leading-[1.4] text-ink-3/50">
          <span className="size-2.5 flex-none rounded-full bg-focus" />
          <span className="text-pretty">
            Steam charges only for what you do not own, so the bundle total at checkout will be
            lower than the figure above. We show Steam&rsquo;s own number rather than guessing at
            yours.
          </span>
        </div>
      )}
    </motion.div>
  )
}
