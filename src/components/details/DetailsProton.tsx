import { TIER_STYLE, type ProtonTier } from '../../platform/protondb'
import {
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  outcomeOf,
  type Outcome,
  type ProtonReport,
} from '../../platform/protonReports'
import { RUNGS, scoreForHardware, verdictFor, type Rung } from '../../platform/hardwareScore'
import type { ProtonState } from '../../hooks/useProtonRating'
import type { DumpPhase } from '../../platform/protonDump'
import { ValueSelect } from '../ValueSelect'
import { ControllerGlyph } from '../ControllerGlyph'
import type { InputSource } from '../../platform/glyphs'
import { PROTON_FILTERS, sectionRing, type ProtonFilterKey, type SectionKey } from './sections'

/**
 * Details screen 3 — the ProtonDB tab. Design turn 11a, in the state 13b describes.
 *
 * The page answers exactly one question: *will this exe run under Proton on my
 * desktop*. Controller support is deliberately NOT here — it lives on Overview,
 * because it answers a different question, and a Platinum game can have no pad support
 * while a Borked one has perfect pad support.
 *
 * ## The two halves, and why they are drawn differently
 *
 * The **live half** — tier medallion, verdict sentence, the three trend cards — comes
 * from protondb.com one game at a time and works with nothing on disk.
 *
 * The **archive half** — the outcome distribution, the hardware score, anti-cheat, the
 * report feed — is computed here from the local index. Without it, every one of those
 * becomes a dashed outline saying *we have not asked*, which is a fact about this
 * client, and never "no reports", which would be a claim about the game. That
 * distinction is turn 13's entire through-line and nothing on this screen may blur it.
 *
 * ## ⚠️ Nothing computed here is a tier
 *
 * The dump has carried no tier field since February 2022; upstream derives it from the
 * fault answers, and reconstructing that agreed with them 38% of the time. So the
 * distribution is drawn over **what reporters said happened** — answers they gave
 * directly — and the hardware figure is a plain number on a meter with no medallion
 * and no metal palette. The only graded words on this screen come from the live API.
 */

type Props = {
  name?: string
  rating: ProtonState
  reports: ProtonReport[]
  /** Why the report list is empty, when it is. */
  phase: DumpPhase
  reportsLoading: boolean
  /** The rendering GPU, from `host_info`. */
  hostGpu?: string
  /** Settings › Compatibility › Device profile, shown on the scope pill. */
  deviceLabel: string
  /** Index into this screen's sections. */
  sectionIndex: number
  /** A has opened the focused filter's list. */
  expanded: boolean
  /** Where the dpad sits inside the open list. */
  cursor: number
  filters: ProtonFilters
  source: InputSource
}

export type ProtonFilters = Record<ProtonFilterKey, string>

/** Every filter starts at "Any" — upstream's own default, so numbers can be compared. */
export const DEFAULT_PROTON_FILTERS: ProtonFilters = {
  pdbType: 'any',
  pdbCpu: 'any',
  pdbGpu: 'any',
  pdbDistro: 'any',
}

export const FILTER_CAPTION: Record<ProtonFilterKey, string> = {
  pdbType: 'Type',
  pdbCpu: 'CPU',
  pdbGpu: 'GPU',
  pdbDistro: 'Distro',
}

/** Human sentence for a tier — the same map the About screen's verdict card uses. */
const VERDICT: Record<ProtonTier, string> = {
  platinum: 'Runs perfectly out of the box',
  gold: 'Runs well after tweaks',
  silver: 'Runs with minor issues',
  bronze: 'Runs with significant issues',
  borked: "Doesn't run",
  pending: 'Not enough reports yet',
}

/**
 * The outcome palette.
 *
 * ⚠️ Chosen NOT to rhyme with `TIER_STYLE`. Bronze-through-platinum is a metal ramp;
 * this is a red-to-green one, because these are outcomes rather than grades and the
 * two must not be mistaken for each other at ten feet.
 */
const OUTCOME_COLOR: Record<Outcome, string> = {
  noInstall: '#d0685f',
  noOpen: '#e08a5f',
  noPlay: '#e0ab84',
  bugs: '#cfb53b',
  tinkered: '#a1cd44',
  clean: '#9ec97f',
  unanswered: 'rgb(244 247 249 / 0.14)',
}

/* ────────────────────────────── filtering ────────────────────────────── */

const RUNTIME_LABEL: Record<string, string> = {
  native: 'Native Linux',
  official: 'Proton (official)',
  experimental: 'Proton Experimental',
  ge: 'GE-Proton',
  notListed: 'Not listed',
  older: 'Older Proton',
  unknown: 'Unstated',
}

/** First word of a distro string — "Linux Mint 22.3" and "Linux Mint 21" are one distro. */
const distroFamily = (os: string): string => {
  const trimmed = os.trim()
  if (!trimmed) return ''
  // Two words, because the single-word form collapses every "Linux <something>".
  const words = trimmed.split(/\s+/)
  return words[0] === 'Linux' && words.length > 1 ? `${words[0]} ${words[1]}` : words[0]
}

const cpuVendor = (cpu: string): string => {
  const text = cpu.toLowerCase()
  if (text.includes('amd') || text.includes('ryzen')) return 'AMD'
  if (text.includes('intel') || /\bi[3579]-/.test(text)) return 'Intel'
  return ''
}

const gpuVendor = (gpu: string): string => {
  const text = gpu.toLowerCase()
  if (/nvidia|geforce|rtx|gtx/.test(text)) return 'NVIDIA'
  if (/radeon|\bamd\b|\brx\b/.test(text)) return 'AMD'
  if (/intel|\barc\b|iris|uhd graphics/.test(text)) return 'Intel'
  return ''
}

const facetOf = (report: ProtonReport, key: ProtonFilterKey): string =>
  key === 'pdbType'
    ? report.variant
    : key === 'pdbCpu'
      ? cpuVendor(report.cpu)
      : key === 'pdbGpu'
        ? gpuVendor(report.gpu)
        : distroFamily(report.os)

/**
 * The values a filter can actually take, built from the reports in hand.
 *
 * ⚠️ Derived, never hardcoded. A fixed distro list would offer choices that match
 * nothing for this game — and a filter that can only ever return zero results is worse
 * than no filter, because the empty list then reads as a fact about the game.
 */
const optionsFor = (
  reports: readonly ProtonReport[],
  key: ProtonFilterKey,
): { value: string; label: string }[] => {
  const counts = new Map<string, number>()
  for (const report of reports) {
    const facet = facetOf(report, key)
    if (facet) counts.set(facet, (counts.get(facet) ?? 0) + 1)
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    // Eight is the stepper ceiling the settings ideology sets, and the same reason
    // applies to a dropdown at this distance: a list you have to scroll is a list you
    // cannot read at rest.
    .slice(0, 8)
    .map(([value]) => ({
      value,
      label: key === 'pdbType' ? (RUNTIME_LABEL[value] ?? value) : value,
    }))
  return [{ value: 'any', label: 'Any' }, ...sorted]
}

const matchesFilters = (report: ProtonReport, filters: ProtonFilters): boolean =>
  PROTON_FILTERS.every((key) => filters[key] === 'any' || facetOf(report, key) === filters[key])

/* ──────────────────────────── small pieces ──────────────────────────── */

const Caption = ({ children }: { children: React.ReactNode }) => (
  <span className="text-sm font-bold uppercase tracking-label text-ink-3/45">{children}</span>
)

/**
 * The frame every archive-fed block wears when the archive is missing.
 *
 * ⚠️ Dashed, and that is the load-bearing detail. A solid empty panel reads as a
 * finished answer; a dashed one reads as a hole where something goes. Same words, very
 * different claim.
 */
const Missing = ({
  caption,
  children,
  className = '',
}: {
  caption: string
  children: React.ReactNode
  className?: string
}) => (
  <div
    className={`flex flex-col gap-2.5 rounded-xl border border-dashed border-hairline bg-chip-soft p-5.5 ${className}`}
  >
    <Caption>{caption}</Caption>
    <span className="text-xl font-semibold leading-[1.3] text-ink-2/70 text-pretty">
      {children}
    </span>
  </div>
)

const TrendCard = ({ label, tier, note }: { label: string; tier?: ProtonTier; note: string }) => {
  const style = tier ? TIER_STYLE[tier] : undefined
  return (
    <div className="flex min-w-0 flex-col gap-2.25 rounded-lg bg-chip-soft p-4.5">
      <Caption>{label}</Caption>
      <span className="flex items-center gap-2.75 text-2xl font-extrabold text-ink">
        <span
          className="size-4 shrink-0 rounded-sm"
          style={{ background: style?.dot ?? 'rgb(244 247 249 / 0.14)' }}
        />
        {style?.label ?? 'Unrated'}
      </span>
      <span className="text-base font-medium leading-[1.3] text-ink-3/55">{note}</span>
    </div>
  )
}

/* ───────────────────────────── 13d, the score ───────────────────────────── */

const RUNG_LABEL: Record<Rung, string> = {
  model: 'This exact card',
  generation: 'This card generation',
  vendor: 'This GPU vendor',
}

/**
 * The ladder, drawn with the rungs it had to give up **struck through**.
 *
 * ⚠️ Striking them is the point, not decoration. The number means something different
 * at each rung, so a reader who cannot see that we widened cannot calibrate it. Stating
 * "landed on generation" in prose and drawing a tidy single line would technically be
 * honest and would still let someone read 78 as "78 on my card".
 */
const Ladder = ({ landed }: { landed?: Rung }) => {
  const at = landed ? RUNGS.indexOf(landed) : RUNGS.length
  return (
    <div className="flex flex-col gap-2">
      <Caption>Scope</Caption>
      {RUNGS.map((rung, index) => {
        const passed = index < at
        const here = index === at
        return (
          <span
            key={rung}
            className={[
              'flex items-center gap-2.5 rounded-lg px-3.25 py-2.25 text-lg font-semibold',
              here ? 'bg-focus/16 text-ink' : 'text-ink-3/40',
              passed ? 'line-through' : '',
            ].join(' ')}
          >
            <span
              className={`size-2 shrink-0 rounded-full bg-focus ${here ? 'opacity-100' : 'opacity-0'}`}
            />
            {RUNG_LABEL[rung]}
          </span>
        )
      })}
    </div>
  )
}

/* ──────────────────────────────── screen ──────────────────────────────── */

export const DetailsProton = ({
  name,
  rating,
  reports,
  phase,
  reportsLoading,
  hostGpu,
  deviceLabel,
  sectionIndex,
  expanded,
  cursor,
  filters,
  source,
}: Props) => {
  const ready = phase === 'ready'
  const live = rating.status === 'rated' ? rating.rating : undefined
  const tier: ProtonTier = live?.tier ?? 'pending'
  const style = TIER_STYLE[tier]

  const sections: SectionKey[] = ready ? [...PROTON_FILTERS] : ['pdbGet']
  const active = sections[sectionIndex]

  const shown = reports.filter((report) => matchesFilters(report, filters))
  const hidden = reports.length - shown.length

  // Distribution over what reporters SAID, across every report we hold for the game —
  // deliberately not the filtered set, so changing a filter cannot silently redraw the
  // headline shape of the evidence.
  const counts = new Map<Outcome, number>()
  for (const report of reports) {
    const outcome = outcomeOf(report)
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
  }
  const answered = reports.length - (counts.get('unanswered') ?? 0)
  const bars = OUTCOME_ORDER.map((outcome) => ({
    outcome,
    count: counts.get(outcome) ?? 0,
  })).filter((bar) => bar.count > 0)

  const hardware = scoreForHardware(reports, hostGpu)

  // ⚠️ `undefined` and `false` are different answers. `anticheat` is null on every
  // report whose questionnaire never asked, so the impacted count is over the reports
  // that ANSWERED — printing it over all reports would understate it silently.
  const anticheatAnswered = reports.filter((report) => report.anticheat !== undefined)
  const anticheatImpacted = anticheatAnswered.filter((report) => report.anticheat === true).length

  return (
    <div className="absolute inset-x-13 bottom-22 top-25 flex items-stretch gap-6.5 overflow-hidden p-3">
      {/* ── left: the live verdict, then what the archive says happened ── */}
      <div className="flex min-w-0 flex-[1.35] flex-col gap-5">
        <div className="flex flex-col gap-5 rounded-xl border border-hairline bg-plate p-6">
          <div className="flex items-center gap-6">
            {/*
              ⚠️ Sized for PLATINUM, not for BRONZE. The artboard's medallion is a 96px
              square carrying a six-letter word; PLATINUM is nine and UNRATED eight, and
              at the artboard's type size the longest label runs straight out through
              both sides of the square. The type steps down one notch and the tracking
              comes in so every tier fits the same box — a medallion that changes shape
              per tier would read as a different kind of badge.
            */}
            <span
              className="grid size-24 shrink-0 place-items-center rounded-xl px-1 text-center text-sm font-extrabold uppercase leading-none tracking-[0.04em] text-ink-on-light"
              style={{ background: style.dot }}
            >
              {style.label}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <span className="text-4xl font-extrabold leading-[1.05] text-ink">
                {VERDICT[tier]}
              </span>
              <span className="text-lg font-medium leading-[1.4] text-ink-2/72 text-pretty">
                {rating.status === 'loading'
                  ? 'Asking ProtonDB…'
                  : live
                    ? `Tier and verdict come from ProtonDB directly, one game at a time. Those work without a snapshot.${live.total ? ` ${live.total.toLocaleString('en-US')} reports upstream.` : ''}`
                    : `ProtonDB has no summary for ${name ?? 'this game'} yet. That is upstream's answer, not a gap on this machine.`}
              </span>
            </div>
            {/* The device scope, and where it is set. Same value as Settings ›
                Compatibility › Device profile — one setting, two places to see it. */}
            <span className="flex shrink-0 flex-col items-end gap-2">
              <span className="flex items-center gap-3 rounded-full border border-hairline bg-chip-strong px-4.5 py-2.75 text-lg font-semibold text-ink-2">
                {deviceLabel}
              </span>
              <span className="text-base font-medium text-ink-3/42">Settings › Compatibility</span>
            </span>
          </div>

          {ready && reports.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3.5">
                <Caption>
                  What {reports.length.toLocaleString('en-US')} reporters said happened
                </Caption>
                <span className="text-base font-medium text-ink-3/40">
                  {/* ⚠️ Counts, never percentages, and this line says why: the median
                      game in the archive has two reports, so "50%" is routinely one
                      person. */}
                  their own answers, not a computed grade
                </span>
              </div>
              <div className="flex h-4.5 overflow-hidden rounded-full bg-chip">
                {bars.map((bar) => (
                  <span
                    key={bar.outcome}
                    style={{
                      width: `${(bar.count / Math.max(1, reports.length)) * 100}%`,
                      background: OUTCOME_COLOR[bar.outcome],
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-7 gap-y-2.5">
                {bars.map((bar) => (
                  <span
                    key={bar.outcome}
                    className="flex items-center gap-2.25 text-lg font-semibold text-ink-2/82"
                  >
                    <span
                      className="size-3.5 rounded-sm"
                      style={{ background: OUTCOME_COLOR[bar.outcome] }}
                    />
                    {OUTCOME_LABEL[bar.outcome]}
                    <span className="tabular-nums text-ink-3/50">{bar.count}</span>
                  </span>
                ))}
                {answered < reports.length && (
                  <span className="text-lg font-medium text-ink-3/40">
                    {reports.length - answered} never asked
                  </span>
                )}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-3.5">
            <TrendCard label="Rated now" tier={live?.tier} note="What upstream grades it today" />
            <TrendCard
              label="Best reported"
              tier={live?.bestReportedTier}
              note="The best anyone has managed"
            />
            <TrendCard
              label="Trending"
              tier={live?.trendingTier}
              note={
                live?.confidence
                  ? `Recent reports · ${live.confidence} confidence`
                  : 'Where recent reports are heading'
              }
            />
          </div>
        </div>

        {/* The archive half of the left column: the distribution above lives inside the
            card when we have it, and this block carries the ask when we do not. */}
        {!ready && (
          <div
            className={`flex flex-1 flex-col justify-center gap-5 rounded-xl border border-dashed border-hairline bg-chip-soft p-8 transition-shadow ${sectionRing(active === 'pdbGet')}`}
          >
            <Caption>Individual reports</Caption>
            <span className="text-3xl font-extrabold leading-[1.15] text-ink text-pretty">
              {phase === 'unavailable'
                ? 'This build cannot read the report archive'
                : 'This client has not downloaded the report archive'}
            </span>
            <span className="text-xl font-medium leading-[1.45] text-ink-2/66 text-pretty">
              {phase === 'unavailable' ? (
                <>
                  The archive is indexed into a local database, which the browser build has no way
                  to hold. Nothing here is a statement about {name ?? 'this game'} — it is a limit
                  of where this is running.
                </>
              ) : (
                <>
                  The distribution, the tweaks people applied and the report feed all come from
                  ProtonDB&rsquo;s open archive, which lives on this machine once you fetch it.
                  Nothing here is a statement about {name ?? 'this game'} — it is reports we have
                  not asked for yet.
                </>
              )}
            </span>
            {phase !== 'unavailable' && (
              <div className="mt-1 flex items-center gap-3.5">
                <span className="flex items-center gap-3 rounded-full bg-gradient-to-br from-accent-hi to-accent-lo px-6 py-3.75 text-xl font-bold text-ink-on-accent shadow-[0_0_2.25rem_rgba(77,155,230,.4)]">
                  <ControllerGlyph action="accept" source={source} size="lg" />
                  Download · 66 MB
                </span>
                <span className="text-lg font-medium leading-[1.35] text-ink-3/45">
                  One file, indexed locally. Settings › Compatibility keeps it current.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── right: this machine, anti-cheat, and the feed ── */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex gap-4">
          {ready ? (
            <div className="flex flex-1 flex-col gap-2.5 rounded-xl border border-focus/35 bg-focus/12 p-5.5">
              <Caption>On hardware like yours</Caption>
              {hardware.score === undefined ? (
                <>
                  <span className="text-2xl font-extrabold leading-[1.15] text-ink-2/62">
                    No score
                  </span>
                  <span className="text-lg font-medium leading-[1.35] text-ink-2/78 text-pretty">
                    {hostGpu === undefined
                      ? 'This machine does not report a GPU, so there is nothing to match against.'
                      : `No rung had enough reports — not your card, not its generation, not the vendor. ${reports.length} report${reports.length === 1 ? '' : 's'} for this game in total.`}
                  </span>
                </>
              ) : (
                <>
                  <div className="flex items-end gap-2.5">
                    <span className="text-6xl font-extrabold leading-none tracking-display tabular-nums text-ink">
                      {hardware.score}
                    </span>
                    <span className="pb-1.5 text-xl font-semibold text-ink-3/45">/ 100</span>
                  </div>
                  <div className="h-2 rounded-full bg-chip">
                    <span
                      className="block h-2 rounded-full bg-gradient-to-r from-focus to-accent-hi"
                      style={{ width: `${hardware.score}%` }}
                    />
                  </div>
                  <span className="text-xl font-semibold leading-[1.25] text-ink-2 text-pretty">
                    {verdictFor(hardware.score)}
                  </span>
                  <Ladder landed={hardware.rung} />
                  <div className="flex flex-col gap-1">
                    <span className="text-xl font-bold tabular-nums text-ink">
                      {hardware.count} report{hardware.count === 1 ? '' : 's'}
                    </span>
                    <span className="text-lg font-medium leading-[1.3] text-ink-2/66">
                      from {hardware.scope}
                    </span>
                    <span className="text-base font-medium leading-[1.3] tabular-nums text-ink-3/42">
                      of {hardware.total} for this game
                    </span>
                  </div>
                  {/* ⚠️ `auto` is italic and offers nothing. Only an override earns the
                      upright treatment and the Y hint, because only an override is a
                      thing you can undo. */}
                  <span className="mt-auto inline-flex w-fit items-center gap-2.5 rounded-full border border-hairline bg-chip px-3.5 py-2.25 text-lg font-semibold italic text-ink-2/70">
                    GPU · auto
                  </span>
                </>
              )}
            </div>
          ) : (
            <Missing caption="On hardware like yours" className="flex-1">
              Needs the archive — this is computed here, from reports, not fetched.
            </Missing>
          )}

          {ready ? (
            <div
              className={`flex flex-1 flex-col gap-2.5 rounded-xl border p-5.5 ${
                anticheatImpacted > 0 ? 'border-bad/40 bg-bad-wash' : 'border-hairline bg-chip-soft'
              }`}
            >
              <Caption>Anti-cheat</Caption>
              {anticheatAnswered.length === 0 ? (
                <span className="text-lg font-medium leading-[1.35] text-ink-2/70 text-pretty">
                  Nobody who reported this game was asked about anti-cheat.
                </span>
              ) : (
                <>
                  <span className="text-2xl font-extrabold text-ink">
                    {anticheatImpacted === 0
                      ? 'Not reported as a blocker'
                      : anticheatImpacted === anticheatAnswered.length
                        ? 'Reported as blocking'
                        : 'Partly blocked'}
                  </span>
                  <span className="text-lg font-medium leading-[1.35] text-ink-2/78 text-pretty">
                    {anticheatImpacted} of {anticheatAnswered.length} reports that were asked said
                    anti-cheat got in the way.
                  </span>
                </>
              )}
            </div>
          ) : (
            <Missing caption="Anti-cheat" className="flex-1">
              Answered in 21,890 reports across the archive. None of them are here yet.
            </Missing>
          )}
        </div>

        {ready ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 rounded-xl border border-hairline bg-plate p-6">
            <div className="flex items-baseline gap-3.5">
              <Caption>Recent reports</Caption>
              <span className="text-base font-medium tabular-nums text-ink-3/40">
                {reportsLoading
                  ? 'reading the index…'
                  : `showing ${shown.length} of ${reports.length}${hidden > 0 ? ` · ${hidden} filtered out` : ''}`}
              </span>
            </div>

            <div className="flex flex-wrap items-start gap-2.5">
              {PROTON_FILTERS.map((key) => {
                const options = optionsFor(reports, key)
                const current = filters[key]
                return (
                  <ValueSelect
                    key={key}
                    caption={FILTER_CAPTION[key]}
                    options={options}
                    current={current}
                    valueLabel={options.find((o) => o.value === current)?.label ?? 'Any'}
                    focused={active === key}
                    open={active === key && expanded}
                    cursor={active === key && expanded ? cursor : undefined}
                    isDefault={current === 'any'}
                  />
                )
              })}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
              {shown.length === 0 ? (
                <span className="text-lg font-medium leading-[1.4] text-ink-2/60 text-pretty">
                  {reports.length === 0
                    ? `The archive holds no reports for ${name ?? 'this game'}. That is a gap in ProtonDB, not in this client — the snapshot is downloaded and indexed.`
                    : 'No report matches all four filters. Widen one to see the rest.'}
                </span>
              ) : (
                shown.slice(0, 6).map((report, index) => {
                  const outcome = outcomeOf(report)
                  return (
                    <div
                      key={`${report.timestamp}-${index}`}
                      className="flex flex-col gap-2 rounded-lg bg-chip-soft px-4.5 py-4"
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex shrink-0 items-center gap-2.25 text-lg font-bold text-ink">
                          <span
                            className="size-3.5 rounded-sm"
                            style={{ background: OUTCOME_COLOR[outcome] }}
                          />
                          {OUTCOME_LABEL[outcome]}
                        </span>
                        <span className="min-w-0 truncate text-lg font-semibold text-ink-2/70">
                          {report.gpu || 'GPU unstated'}
                        </span>
                        <span className="shrink-0 rounded-sm bg-chip px-2.75 py-1.25 text-base font-semibold text-ink-2/75">
                          {report.proton || RUNTIME_LABEL[report.variant] || 'Unstated'}
                        </span>
                        <span className="ml-auto shrink-0 text-base font-medium tabular-nums text-ink-3/45">
                          {report.timestamp
                            ? new Date(report.timestamp * 1000).toISOString().slice(0, 10)
                            : '—'}
                        </span>
                      </div>
                      {report.note && (
                        <span className="line-clamp-2 text-lg font-medium leading-[1.35] text-ink-2/70 text-pretty">
                          {report.note}
                        </span>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <Missing caption="Recent reports" className="min-h-0 flex-1 justify-start">
            The four filters that belong here — Type, CPU, GPU, Distro — stay hidden rather than
            sitting empty over nothing. They return with the archive.
          </Missing>
        )}
      </div>
    </div>
  )
}

/** How many options the focused filter's list holds — App clamps its cursor to this. */
export const protonOptionCount = (reports: readonly ProtonReport[], key: ProtonFilterKey): number =>
  optionsFor(reports, key).length

/** The value at `index` in the focused filter's list, for A to commit. */
export const protonOptionAt = (
  reports: readonly ProtonReport[],
  key: ProtonFilterKey,
  index: number,
): string | undefined => optionsFor(reports, key)[index]?.value

/** Where the cursor should open — on the committed value, never on the first row. */
export const protonOptionIndex = (
  reports: readonly ProtonReport[],
  key: ProtonFilterKey,
  value: string,
): number =>
  Math.max(
    0,
    optionsFor(reports, key).findIndex((option) => option.value === value),
  )
