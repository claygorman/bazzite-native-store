import type { AppDetails, ReviewSummary } from '../../types/steam'
import { extrasSections, sectionRing, type SectionKey } from './sections'

type Props = {
  details?: AppDetails
  reviews?: ReviewSummary
  players?: number
  loading: boolean
  /** Index into extrasSections(details, reviews). */
  sectionIndex: number
}

const Panel = ({
  title,
  children,
  focused = false,
}: {
  title: string
  children: React.ReactNode
  focused?: boolean
}) => (
  <div
    className={`flex min-h-0 flex-col gap-3 rounded-lg bg-panel p-4.5 transition-shadow ${sectionRing(focused)}`}
  >
    <span className="text-sm font-bold uppercase tracking-label text-ink-3/45">{title}</span>
    {children}
  </div>
)

/**
 * Details screen 3 (design 6c) — reviews, achievements, players, demo.
 *
 * The design also shows review filters, DLC/bundles and curators. Those are left out
 * deliberately rather than mocked:
 *   - individual reviews need `/appreviews` paging with a cursor (we only pull the
 *     rollup, which is what `num_per_page=0` is for)
 *   - curators need `/curator/<clanid>/ajaxgetcreatorhomeinfo` plus a way to know
 *     WHICH curators, which nothing here supplies
 *   - packages/DLC pricing needs `packagedetails`, unverified for this project
 * All three are queued in private/STEAM-ENDPOINTS.md.
 */
export const DetailsExtras = ({ details, reviews, players, loading, sectionIndex }: Props) => {
  const keys = extrasSections(details, reviews)
  const active: SectionKey | undefined = keys[sectionIndex]
  const positivePct =
    reviews && reviews.total > 0 ? Math.round((reviews.positive / reviews.total) * 100) : undefined

  return (
    // `items-stretch` plus `justify-between` on both columns: the panels spread down
    // whatever height the screen has rather than bunching at the top, which is what
    // keeps this screen honest at 4K and in a small dev window alike.
    <div className="absolute inset-x-13 bottom-22 top-25 flex items-stretch gap-6.5 overflow-hidden p-3">
      <div className="flex min-w-0 flex-[1.45] flex-col justify-between gap-4">
        <Panel title="Customer Reviews" focused={active === 'reviews'}>
          {reviews ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-extrabold text-ok">{reviews.scoreDescription}</span>
                {positivePct !== undefined && (
                  <span className="text-lg font-semibold text-ink-2/70">
                    {positivePct}% of {reviews.total.toLocaleString('en-US')}
                  </span>
                )}
              </div>
              {/* Proportion bar — positive vs negative, at a glance from the couch. */}
              <div className="flex h-2.5 overflow-hidden rounded-full bg-chip-strong">
                <div className="bg-ok" style={{ width: `${positivePct ?? 0}%` }} />
              </div>
              <span className="text-sm font-medium text-ink-3/50">
                Counted across all languages, matching Steam's own figure.
              </span>
            </>
          ) : (
            <span className="text-base font-medium text-ink-3/50">
              {loading ? 'Loading…' : 'No user reviews yet'}
            </span>
          )}
        </Panel>

        <Panel
          title={`Achievements${details?.achievementsTotal ? ` · ${details.achievementsTotal}` : ''}`}
          focused={active === 'achievements'}
        >
          {details && details.achievementsHighlighted.length > 0 ? (
            <div className="flex flex-wrap gap-2.5">
              {details.achievementsHighlighted.map((achievement) => (
                <img
                  key={achievement.icon}
                  src={achievement.icon}
                  alt={achievement.name}
                  title={achievement.name}
                  className="h-14 w-14 rounded-md bg-surface-raised object-cover"
                />
              ))}
            </div>
          ) : (
            <span className="text-base font-medium text-ink-3/50">
              {loading ? 'Loading…' : 'No achievements'}
            </span>
          )}
        </Panel>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
        <Panel title="Players online" focused={active === 'players'}>
          <span className="text-4xl font-extrabold leading-none text-ink">
            {players !== undefined
              ? players.toLocaleString('en-US')
              : loading
                ? '—'
                : 'Unavailable'}
          </span>
          {/* Point-in-time only: GetNumberOfCurrentPlayers has no history behind it,
              so this must never be presented as a trend. */}
          <span className="text-sm font-medium text-ink-3/50">Right now</span>
        </Panel>

        {details?.hasDemo && (
          <div
            className={`flex items-center gap-3 rounded-lg bg-ok-wash px-4.5 py-4 transition-shadow ${sectionRing(active === 'demo')}`}
          >
            <span className="text-base font-bold text-pad-ok">Demo available</span>
            <span className="text-sm font-medium text-ink-2/70">Install it from Steam</span>
          </div>
        )}

        {details?.metacritic !== undefined && (
          <Panel title="Metacritic" focused={active === 'metacritic'}>
            <span className="text-4xl font-extrabold leading-none text-ink">
              {details.metacritic}
            </span>
          </Panel>
        )}

        {details && details.genres.length > 0 && (
          <Panel title="Genres" focused={active === 'genres'}>
            <div className="flex flex-wrap gap-2">
              {details.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-md bg-chip-strong px-3 py-1.5 text-sm font-semibold text-ink-2/85"
                >
                  {genre}
                </span>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
