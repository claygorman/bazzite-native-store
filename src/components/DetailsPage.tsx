import { TIER_STYLE } from '../platform/protondb'
import { formatPrice } from '../types/steam'
import type { InputSource } from '../platform/glyphs'
import { ControllerGlyph } from './ControllerGlyph'
import type { ProtonState } from '../hooks/useProtonRating'
import type { DetailsState } from '../hooks/useAppDetails'
import type { TrailerPreview } from '../platform/steam'
import { DetailsAbout } from './details/DetailsAbout'
import { MediaGallery, buildGallery } from './details/MediaGallery'
import { DetailsExtras } from './details/DetailsExtras'
import { motion } from 'motion/react'
import { PAGE_ENTER } from '../platform/motion'

/** The three detail screens, paged with LB/RB as the design specifies. */
export const DETAIL_SCREENS = ['Overview', 'About', 'Reviews & More'] as const
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
  zone: 'media' | 'tabs'
  /** Index into the media gallery on the Overview screen. */
  mediaIndex: number
  muted: boolean
  /** Focused section on the About / Reviews screens. */
  sectionIndex: number
  sectionExpanded: boolean
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
  mediaIndex,
  muted,
  sectionIndex,
  sectionExpanded,
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
        <ControllerGlyph action="back" source={source} className="!size-6.5" />
        {[details?.genres[0], details?.publishers[0]].filter(Boolean).join(' · ') || 'Back'}
      </div>

      {/* Tab strip — shows where you are in the three-screen pager. */}
      <div className="absolute right-14 top-10 flex items-center gap-2.5">
        {DETAIL_SCREENS.map((label, index) => (
          <span
            key={label}
            className={[
              'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all',
              index === screen
                ? 'bg-ink text-ink-on-light'
                : 'bg-chip-strong text-ink-3/60',
              // Only ring the active tab while the tab strip actually holds focus,
              // so "where am I" and "what is selected" stay distinguishable.
              zone === 'tabs' && index === screen
                ? 'relative z-10 ring-tile'
                : '',
            ].join(' ')}
          >
            {label}
          </span>
        ))}
      </div>

      {screen === 1 && (
        <motion.div key="about" {...PAGE_ENTER}>
        <DetailsAbout
          details={details}
          proton={proton}
          loading={loading}
          sectionIndex={sectionIndex}
          expanded={sectionExpanded}
          source={source}
        />
        </motion.div>
      )}
      {screen === 2 && (
        <motion.div key="extras" {...PAGE_ENTER}>
        <DetailsExtras
          details={details}
          reviews={reviews}
          players={state.players}
          loading={loading}
          sectionIndex={sectionIndex}
        />
        </motion.div>
      )}

      {screen === 0 && (
      <motion.div
        key="overview-text"
        {...PAGE_ENTER}
        className="absolute left-14 top-24 flex w-205 flex-col gap-3.5"
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
            Steam returned no details for this app. It is either age-gated or no longer
            listed — the store API does not distinguish the two.
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
            <Chip className="bg-chip-strong text-ink-2/85">
              Metacritic {details.metacritic}
            </Chip>
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
            <ControllerGlyph action="accept" source={source} className="!size-6.5" />
            Open in Steam
            {priceLabel && ` · ${priceLabel}`}
          </button>

        </div>
      </motion.div>
      )}

      {/* The trailer as the object on screen, not a widget in a column. */}
      {screen === 0 && (
        <MediaGallery
          items={gallery}
          index={mediaIndex}
          focused={zone === 'media'}
          muted={muted}
          onAudioChange={onAudioChange}
          source={source}
        />
      )}
    </div>
  )
}
