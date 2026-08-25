import { TIER_STYLE } from '../platform/protondb'
import { formatPrice } from '../types/steam'
import { appDetailsLikelyThrottled } from '../platform/steam'
import type { InputSource } from '../platform/glyphs'
import { ControllerGlyph } from './ControllerGlyph'
import type { ProtonState } from '../hooks/useProtonRating'
import type { DetailsState } from '../hooks/useAppDetails'
import type { TrailerPreview } from '../platform/steam'
import { DetailsAbout } from './details/DetailsAbout'
import { MediaGallery, buildGallery } from './details/MediaGallery'
import { DetailsExtras } from './details/DetailsExtras'
import { DetailsProton, type ProtonFilters } from './details/DetailsProton'
import { OfferList } from './details/OfferList'
import type { OffersState } from '../hooks/useOffers'
import type { ProtonReportsState } from '../hooks/useProtonReports'
import { motion } from 'motion/react'
import { PAGE_ENTER } from '../platform/motion'

/**
 * The four detail screens, paged with LB/RB as the design specifies.
 *
 * ⚠️ ProtonDB is THIRD, not last — design turn 11 puts it directly after About, on the
 * grounds that "does it run" is a purchase question and belongs beside the description
 * rather than filed behind the reviews. Reordering this array reorders the pager, and
 * `sectionsFor` in `details/sections.ts` keys off the same indices, so the two move
 * together or focus lands on a screen that is not there.
 */
export const DETAIL_SCREENS = ['Overview', 'About', 'ProtonDB', 'Reviews & More'] as const
export type DetailScreen = (typeof DETAIL_SCREENS)[number]

type Props = {
  state: DetailsState
  proton: ProtonState
  preview: TrailerPreview
  /** Fallback art while `appdetails` is still in flight — keeps the page from flashing empty. */
  fallbackArt?: string
  fallbackName?: string
  /** Index into DETAIL_SCREENS. */
  screen: number
  /** Which part of this page has controller focus. */
  zone: 'media' | 'tabs' | 'offers'
  /** Turn 14a's offers block, and where the dpad is inside it. */
  offers: OffersState
  offerRow: number
  offerCol?: number
  /** Pointer click-through for the offers block; `col` undefined means the row. */
  onPickOffer: (row: number, col?: number) => void
  /** Index into the media gallery on the Overview screen. */
  mediaIndex: number
  muted: boolean
  /** Focused section on the About / ProtonDB / Reviews screens. */
  sectionIndex: number
  sectionExpanded: boolean
  /** Where the dpad sits inside an open ProtonDB filter list. */
  sectionCursor: number
  /** The local report archive, and why it is empty when it is. */
  protonReports: ProtonReportsState
  protonFilters: ProtonFilters
  /** Host GPU from `host_info`, for the on-your-hardware score. */
  hostGpu?: string
  /** Settings › Compatibility › Device profile, rendered on the scope pill. */
  deviceLabel: string
  onAudioChange?: (hasAudio: boolean | undefined) => void
  source: InputSource
  onOpenInSteam: () => void
}

const Chip = ({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) => (
  <span
    style={style}
    className={`flex shrink-0 items-center gap-2 rounded-md px-3.5 py-2 text-base font-bold ${className}`}
  >
    {children}
  </span>
)

const MetaRow = ({ label, value }: { label: string; value: string }) => (
  <>
    <span className="text-ink-3/45">{label}</span>
    <span className="text-ink-2">{value}</span>
  </>
)

/**
 * Game details, design 6a: art washes the whole frame, the trailer is the object on
 * screen rather than a widget in a column, and the listing's facts sit on top of it.
 *
 * Reached by pressing A on a shelf tile. Only the explicit "Open in Steam" button
 * hands off to the Steam client — the tile itself opens this page.
 */
export const DetailsPage = ({
  state,
  proton,
  preview,
  fallbackArt,
  fallbackName,
  screen,
  zone,
  offers,
  offerRow,
  offerCol,
  onPickOffer,
  mediaIndex,
  muted,
  sectionIndex,
  sectionExpanded,
  sectionCursor,
  protonReports,
  protonFilters,
  hostGpu,
  deviceLabel,
  onAudioChange,
  source,
  onOpenInSteam,
}: Props) => {
  const { details, reviews, loading, unavailable } = state
  const art = details?.screenshots[0] ?? details?.headerUrl ?? fallbackArt
  const gallery = buildGallery(details, preview, fallbackArt)
  const name = details?.name ?? fallbackName ?? ''

  const priceLabel = details?.isFree
    ? 'Free'
    : details?.comingSoon
      ? ''
      : formatPrice(details?.priceCents, details?.currency)

  return (
    <div className="absolute inset-0">
      {art && (
        <img
          key={art}
          src={art}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-112 object-cover opacity-60 blur-[1rem] saturate-125"
        />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(94rem_59rem_at_22%_12%,rgba(30,82,160,.4),rgba(9,15,26,.86)_60%,#080d16_88%)]" />

      <div className="absolute left-14 top-10 flex items-center gap-3.5 text-base font-semibold text-ink-3/55">
        <ControllerGlyph action="back" source={source} size="lg" />
        {[details?.genres[0], details?.publishers[0]].filter(Boolean).join(' · ') || 'Back'}
      </div>

      {/* Tab strip — shows where you are in the three-screen pager. */}
      <div className="absolute right-14 top-10 flex items-center gap-2.5">
        {DETAIL_SCREENS.map((label, index) => (
          <span
            key={label}
            className={[
              'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-[color,background-color,box-shadow]',
              index === screen ? 'bg-ink text-ink-on-light' : 'bg-chip-strong text-ink-3/60',
              // Only ring the active tab while the tab strip actually holds focus,
              // so "where am I" and "what is selected" stay distinguishable.
              zone === 'tabs' && index === screen ? 'relative z-10 ring-tile' : '',
            ].join(' ')}
          >
            {label}
          </span>
        ))}
      </div>

      {/*
        ⚠️ `absolute inset-0` on the MOTION wrapper, not just on the screen inside it.
        `PAGE_ENTER` animates `y`, which compiles to a `transform` — and a transformed
        element becomes the containing block for every `position: absolute` descendant.
        A bare wrapper has no height of its own (its only child is absolutely
        positioned), so the screen inside it resolved `top-25 bottom-22` against a
        zero-height box and collapsed to a ~32px sliver with `overflow-hidden` eating
        the rest. Sizing the wrapper puts the containing block back where the geometry
        expects it. Screen 0 was never affected because its wrapper carries its own
        `absolute` positioning.
      */}
      {screen === 1 && (
        <motion.div key="about" className="absolute inset-0" {...PAGE_ENTER}>
          <DetailsAbout
            details={details}
            proton={proton}
            loading={loading}
            /*
              ⚠️ `-1` when the tab strip holds focus, so NOTHING on the page is ringed
              while the tabs are. The panels used to ring purely from `sectionIndex`,
              which does not know about zones — so the focused tab and a panel lit at
              once and there were two cursors on screen saying different things about
              where the next press goes.

              `keys[-1]` is `undefined`, so every `active === '...'` test is false and
              no panel draws a ring. Passing the index rather than a second `focused`
              prop keeps the three screens' signatures identical.
            */
            sectionIndex={zone === 'media' ? sectionIndex : -1}
            expanded={sectionExpanded}
            source={source}
          />
        </motion.div>
      )}
      {screen === 2 && (
        <motion.div key="proton" className="absolute inset-0" {...PAGE_ENTER}>
          <DetailsProton
            name={name}
            rating={proton}
            reports={protonReports.reports}
            distro={protonReports.distro}
            unscoped={protonReports.unscoped}
            phase={protonReports.phase}
            reportsLoading={protonReports.loading}
            hostGpu={hostGpu}
            deviceLabel={deviceLabel}
            /*
              ⚠️ `-1` when the tab strip holds focus, so NOTHING on the page is ringed
              while the tabs are. The panels used to ring purely from `sectionIndex`,
              which does not know about zones — so the focused tab and a panel lit at
              once and there were two cursors on screen saying different things about
              where the next press goes.

              `keys[-1]` is `undefined`, so every `active === '...'` test is false and
              no panel draws a ring. Passing the index rather than a second `focused`
              prop keeps the three screens' signatures identical.
            */
            sectionIndex={zone === 'media' ? sectionIndex : -1}
            expanded={sectionExpanded}
            cursor={sectionCursor}
            filters={protonFilters}
            source={source}
          />
        </motion.div>
      )}
      {screen === 3 && (
        <motion.div key="extras" className="absolute inset-0" {...PAGE_ENTER}>
          <DetailsExtras
            details={details}
            reviews={reviews}
            players={state.players}
            loading={loading}
            /*
              ⚠️ `-1` when the tab strip holds focus, so NOTHING on the page is ringed
              while the tabs are. The panels used to ring purely from `sectionIndex`,
              which does not know about zones — so the focused tab and a panel lit at
              once and there were two cursors on screen saying different things about
              where the next press goes.

              `keys[-1]` is `undefined`, so every `active === '...'` test is false and
              no panel draws a ring. Passing the index rather than a second `focused`
              prop keeps the three screens' signatures identical.
            */
            sectionIndex={zone === 'media' ? sectionIndex : -1}
          />
        </motion.div>
      )}

      {screen === 0 && (
        <motion.div
          key="overview-text"
          initial={PAGE_ENTER.initial}
          /*
            ⚠️ Lifted and faded rather than unmounted when the offers take focus. Removing
            it would reflow the page under the cursor and cost the entry animation on the
            way back; moving it keeps the two halves of Overview feeling like one page you
            scrolled rather than two screens that swapped.
          */
          /*
            ⚠️ The retreat is driven through `animate`, NOT through classes, and that is
            the whole fix. This element previously spread `{...PAGE_ENTER}` — whose
            `animate` is `{opacity: 1, y: 0}` — alongside a conditional
            `opacity-0 -translate-y-6`. Motion writes its animate values as INLINE
            STYLES, and an inline style beats a utility class, so the fade-out was dead
            code: the hero stayed at full opacity and the lifted offers band rendered
            straight through the game's title. Nothing about it looked wrong in the
            source, which is why it survived.
          */
          animate={zone === 'offers' ? { opacity: 0, y: -24 } : PAGE_ENTER.animate}
          transition={PAGE_ENTER.transition}
          /*
            ⚠️ `will-change` because of the `drop-shadow` filter on the child below. This
            block animates opacity AND y, and an un-promoted filtered subtree is re-run by
            the compositor on every frame of that move — the same bug as the ambient wash,
            in a different place. Promoted, the shadow rasterises once and the animation
            transforms a cached texture.
          */
          style={{ willChange: 'transform, opacity' }}
          className={`absolute left-14 top-24 flex w-205 transform-gpu flex-col gap-3.5 ${
            zone === 'offers' ? 'pointer-events-none' : ''
          }`}
        >
          {/* Shadow on the WRAPPER, not on the truncating element: `truncate` is
            overflow:hidden, which clips a text-shadow into a hard rectangle. A
            drop-shadow filter on an unclipped parent renders the same effect. */}
          <div className="[filter:drop-shadow(0_0.25rem_1.25rem_rgba(0,0,0,.75))]">
            {/*
            Wraps to two lines rather than scrolling. This page has vertical room to
            spare, and a title you can simply read beats one you have to wait for.
            The home hero cannot do this — its band is a fixed 140px — so that one
            marquees instead.
          */}
            <h1 className="line-clamp-2 text-6xl font-extrabold leading-[0.96] tracking-[-0.015em] text-ink">
              {name}
            </h1>
          </div>

          {unavailable ? (
            // success:false — age-gated or delisted, and the response cannot tell us
            // which. Say what we know rather than rendering an empty page.
            <p className="max-w-175 text-xl leading-relaxed text-amber-300/80">
              {/*
                ⚠️ Rate limiting is named FIRST because it is the likeliest cause and the
                only reversible one. Steam answers `success: false` at HTTP 200 both when
                an app is genuinely gone and when it is simply refusing us — and this app
                spends that budget itself, one request per tile you rest on. Accusing the
                game of being delisted when the truth is "come back in five minutes" sent
                a real investigation down the wrong path.
              */}
              {appDetailsLikelyThrottled()
                ? 'Steam is rate-limiting this client, so it returned no details. Browsing many games quickly spends its budget — this usually clears within a few minutes.'
                : 'Steam returned no details for this app. It may be rate-limiting us, age-gated, or no longer listed — the store API answers all three the same way.'}
            </p>
          ) : (
            <p className="max-w-175 text-xl leading-[1.45] text-ink-2/80">
              {loading ? '' : details?.shortDescription}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {proton.status === 'loading' ? (
              <Chip className="animate-pulse bg-scrim-soft text-ink-3/40">
                <span className="h-2.75 w-2.75 rounded-full bg-ink-3/25" />
                ProtonDB
              </Chip>
            ) : (
              (() => {
                const tier = proton.status === 'rated' ? proton.rating.tier : 'pending'
                const style = TIER_STYLE[tier]
                return (
                  <Chip
                    className="bg-scrim-soft ring-1 ring-inset"
                    style={{ color: style.text, boxShadow: `inset 0 0 0 1px ${style.dot}55` }}
                  >
                    <span
                      className="h-2.75 w-2.75 rounded-full"
                      style={{ background: style.dot }}
                    />
                    ProtonDB {style.label}
                    {proton.status === 'rated' && ` · ${proton.rating.total} reports`}
                  </Chip>
                )
              })()
            )}

            {details?.controllerSupport && (
              <Chip className="bg-ok-wash text-pad-ok">
                {details.controllerSupport === 'full' ? 'Full' : 'Partial'} controller support
              </Chip>
            )}
            {details?.metacritic !== undefined && (
              <Chip className="bg-chip-strong text-ink-2/85">Metacritic {details.metacritic}</Chip>
            )}
          </div>

          <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-6 text-base font-medium leading-[1.6]">
            <MetaRow
              label="RELEASE"
              value={details?.releaseDate || (loading ? '—' : 'Unannounced')}
            />
            <MetaRow label="DEVELOPER" value={details?.developers.join(', ') || '—'} />
            <MetaRow
              label="REVIEWS"
              value={
                reviews
                  ? `${reviews.scoreDescription} (${reviews.total.toLocaleString('en-US')})`
                  : loading
                    ? '—'
                    : 'No user reviews yet'
              }
            />
          </div>

          <div className="mt-2 flex items-center gap-3.5">
            <button
              type="button"
              onClick={onOpenInSteam}
              className="flex items-center gap-3 whitespace-nowrap rounded-full bg-gradient-to-br from-focus to-focus-deep px-7 py-3.75 text-xl font-bold text-ink-on-accent shadow-[0_0_2.75rem_rgba(77,155,230,.5)]"
            >
              <ControllerGlyph action="accept" source={source} size="lg" />
              Open in Steam
              {priceLabel && ` · ${priceLabel}`}
            </button>
          </div>
        </motion.div>
      )}

      {/* The trailer as the object on screen, not a widget in a column. */}
      {/*
        Turn 14a — a new row in the BOTTOM HALF of Overview, below the hero column and
        the gallery rather than replacing either. Both of those are absolutely
        positioned from `top-24` and run out around `42rem` of a `67.5rem` viewport at
        every scale the rem clamp produces, so the space underneath is genuinely free.
      */}
      {screen === 0 && (
        <OfferList
          offers={offers.offers}
          loading={offers.loading}
          subjectName={name}
          subjectPriceLabel={priceLabel}
          focused={zone === 'offers'}
          row={offerRow}
          col={offerCol}
          onPick={onPickOffer}
          source={source}
        />
      )}

      {screen === 0 && (
        <MediaGallery
          items={gallery}
          index={mediaIndex}
          focused={zone === 'media'}
          muted={muted}
          onAudioChange={onAudioChange}
          // Same retreat as the hero: the lifted band sits above this element's `top-24`
          // and would otherwise hide the first offer's price and its button.
          retreated={zone === 'offers'}
          source={source}
        />
      )}
    </div>
  )
}
