import { useEffect, useState } from 'react'
import { TIER_STYLE } from '../../platform/protondb'
import { fetchPopularTags } from '../../platform/steam'
import type { ProtonState } from '../../hooks/useProtonRating'
import type { AppDetails } from '../../types/steam'
import { aboutSections, sectionRing, type SectionKey } from './sections'
import { glyphFor, type InputSource } from '../../platform/glyphs'

type Props = {
  details?: AppDetails
  proton: ProtonState
  loading: boolean
  /** Index into aboutSections(details). */
  sectionIndex: number
  expanded: boolean
  source: InputSource
}

/** Human sentence for a ProtonDB tier — the design's verdict card. */
const VERDICT: Record<string, string> = {
  platinum: 'Runs perfectly out of the box',
  gold: 'Runs well after tweaks',
  silver: 'Runs with minor issues',
  bronze: 'Runs with significant issues',
  borked: "Doesn't run",
  pending: 'Not enough reports yet',
}

const RequirementsCard = ({
  title,
  lines,
  focused,
}: {
  title: string
  lines: string[]
  focused: boolean
}) => (
  <div
    className={`flex flex-1 flex-col gap-1.75 rounded-lg bg-panel p-4 transition-shadow ${sectionRing(focused)}`}
  >
    <span className="text-sm font-bold uppercase tracking-label text-ink-3/45">
      {title}
    </span>
    {lines.length === 0 ? (
      <span className="text-sm font-medium leading-[1.35] text-ink-3/40">
        Not published
      </span>
    ) : (
      lines.map((line) => (
        <span key={line} className="text-sm font-medium leading-[1.35] text-ink-2/80">
          {line}
        </span>
      ))
    )}
  </div>
)

/**
 * The store's own user-defined tags, most-voted first.
 *
 * Fetched here rather than in `useAppDetails` because `appdetails` does not carry
 * tags at all — they come from `GetItems`, which is a separate pair of requests
 * (private/STEAM-ENDPOINTS.md). Both are cached hard in the transport, and the request
 * is per PAGE, never per tag or per tile, so it costs one lookup per game opened.
 *
 * Returns an empty list on any failure; the section is then omitted rather than
 * rendering raw tagids at a TV.
 */
const usePopularTags = (appid: number | undefined): string[] => {
  const [tags, setTags] = useState<string[]>([])

  useEffect(() => {
    setTags([])
    if (appid === undefined) return

    let cancelled = false
    void fetchPopularTags(appid).then((names) => {
      if (!cancelled) setTags(names)
    })

    return () => {
      cancelled = true
    }
  }, [appid])

  return tags
}

/**
 * Details screen 2 (design 6b) — About, system requirements, compatibility verdict.
 *
 * All of this comes out of `appdetails`, whose `about_the_game` and `pc_requirements`
 * are HTML blobs. They are converted to text/lines in the platform layer and rendered
 * as text — never with dangerouslySetInnerHTML.
 *
 * "More Like This" from the design (a 2×2 grid of capsules) is still NOT here: its
 * only source is the `/recommended/morelike/app/<id>/` HTML page, which needs
 * age-gate cookies (private/STEAM-URL-REFERENCE.md §2) and would be a scrape. Left out
 * rather than faked. The tag row that follows it in the design IS here — `GetItems`
 * supplies those as ids and `GetLocalizedNameForTags` names them, both keyless.
 */
export const DetailsAbout = ({ details, proton, loading, sectionIndex, expanded, source }: Props) => {
  const tier = proton.status === 'rated' ? proton.rating.tier : 'pending'
  const style = TIER_STYLE[tier]

  const keys = aboutSections(details)
  const active: SectionKey | undefined = keys[sectionIndex]
  const isOpen = (key: SectionKey) => active === key && expanded
  const tags = usePopularTags(details?.appid)
  const ABOUT_PREVIEW = 420

  return (
    // `items-stretch` and `justify-between` on the columns are the design's answer to
    // varying content: the panels distribute themselves down whatever height the
    // screen has instead of stacking at the top with a hole underneath.
    <div className="absolute inset-x-13 bottom-22 top-25 flex items-stretch gap-6.5 overflow-hidden p-3">
      <div
        className={`flex min-w-0 flex-[1.4] flex-col justify-between gap-4 rounded-lg p-2 transition-shadow ${sectionRing(active === 'about')}`}
      >
        {details?.tagline && (
          <span className="text-3xl font-extrabold tracking-[0.03em] text-ink">
            {details.tagline}
          </span>
        )}

        {/* Frame and prose travel together: with the column distributing its children,
            a screenshot that drifts away from the text it illustrates reads as two
            unrelated panels. `min-h-0` keeps the expanded text scrollable. */}
        <div className="flex min-h-0 flex-col gap-3.5">
          {/* The screenshot yields to the text when the section is expanded — the
              point of expanding is to read, and the frame is the least useful pixel.
              Its ratio is Steam's header ratio rather than a fixed height, so it
              cannot letterbox or crop as the column's height changes. */}
          {details?.screenshots[1] && !isOpen('about') && (
            <img
              src={details.screenshots[1]}
              alt=""
              className="aspect-header h-auto w-full rounded-lg object-cover"
            />
          )}

          <p
            className={[
              'text-lg leading-normal text-ink-2/80 [text-wrap:pretty]',
              isOpen('about') ? 'overflow-y-auto pr-2' : '',
            ].join(' ')}
          >
            {loading
              ? ''
              : isOpen('about')
                ? details?.about
                : details?.about.slice(0, ABOUT_PREVIEW)}
            {!isOpen('about') && (details?.about.length ?? 0) > ABOUT_PREVIEW ? '…' : ''}
          </p>

          {!isOpen('about') &&
            (details?.about.length ?? 0) > ABOUT_PREVIEW &&
            active === 'about' && (
              <span className="text-base font-semibold text-focus">
                {glyphFor('accept', source).label} to read more
              </span>
            )}
        </div>

        {details?.matureNote && (
          <span className="text-base font-medium leading-[1.4] text-ink-3/50">
            Mature content: {details.matureNote}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
        <div
          className={`flex flex-col gap-1.75 rounded-lg p-4.5 transition-shadow ${sectionRing(active === 'proton')}`}
          style={{ background: `${style.dot}1f`, border: `1px solid ${style.dot}4d` }}
        >
          <span className="text-lg font-bold" style={{ color: style.text }}>
            {VERDICT[tier]}
          </span>
          <span className="text-base font-medium leading-[1.45] text-ink-2/78">
            {proton.status === 'rated'
              ? `${style.label} across ${proton.rating.total.toLocaleString('en-US')} ProtonDB reports.`
              : proton.status === 'loading'
                ? 'Checking ProtonDB…'
                : 'No ProtonDB reports for this title yet.'}
          </span>
        </div>

        <div className="flex gap-3.5">
          <RequirementsCard
            title="Minimum"
            focused={active === 'minimum'}
            lines={
              isOpen('minimum')
                ? (details?.requirementsMinimum ?? [])
                : (details?.requirementsMinimum.slice(0, 6) ?? [])
            }
          />
          <RequirementsCard
            title="Recommended"
            focused={active === 'recommended'}
            lines={
              isOpen('recommended')
                ? (details?.requirementsRecommended ?? [])
                : (details?.requirementsRecommended.slice(0, 6) ?? [])
            }
          />
        </div>

        {details?.languages && (
          <div
            className={`flex flex-col gap-2 rounded-lg bg-panel p-4 transition-shadow ${sectionRing(active === 'languages')}`}
          >
            <span className="text-sm font-bold uppercase tracking-label text-ink-3/45">
              Languages
            </span>
            <span
              className={[
                'text-sm font-medium leading-[1.35] text-ink-2/80',
                isOpen('languages') ? '' : 'line-clamp-3',
              ].join(' ')}
            >
              {details.languages}
            </span>
          </div>
        )}

        {/*
          Popular user-defined tags. Not a focusable section: there is nothing to
          expand or open, and a focus stop that does nothing is worse than none.

          Rendered only when we have NAMES — an empty list means the lookup failed or
          the app carries no tags, and either way raw tagids would be gibberish.
        */}
        {tags.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-bold uppercase tracking-label text-ink-3/45">
              Popular user-defined tags
            </span>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm bg-chip px-3.25 py-2 text-sm font-semibold text-ink-2/80"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
