/**
 * Individual ProtonDB reports for one game, read out of the local SQLite index.
 *
 * Separate from `protonDump.ts` on purpose: that file is the archive's LIFECYCLE
 * (absent, downloading, indexing, outdated) and this one is what you do with it once
 * it is there. They change for different reasons.
 *
 * ⚠️ Nothing here produces a tier, and nothing here may. Since ProtonDB's February
 * 2022 schema change the dump carries no tier field at all — upstream derives it from
 * the fault answers, and a reconstruction agreed with them 38% of the time (on
 * well-reported gold and platinum games, which is the easy half). The live summaries
 * endpoint in `protondb.ts` stays the only source of a graded verdict.
 *
 * What the dump DOES state directly is what each reporter said happened: did it
 * install, did it open, did they get past the menu, did they have to change something.
 * That is the raw material upstream grades from, and it is reportable as-is without
 * inventing a grade. Everything below is built from those answers.
 */

/** One report, matching `protondb::Report` on the Rust side. */
export type ProtonReport = {
  /** Unix seconds. */
  timestamp: number
  gpu: string
  cpu: string
  /** Distribution string, e.g. "Linux Mint 22.3". */
  os: string
  kernel: string
  /** The Proton build, where the reporter named one. */
  proton: string
  variant: RuntimeVariant
  note: string
  /**
   * ⚠️ Every field below is `undefined` when the question was NOT ASKED, which is a
   * different fact from a reported "no". ProtonDB's questionnaire changed over the
   * years and older reports simply do not carry the newer questions — treating an
   * absent answer as a negative turns a fine report into a broken one.
   */
  /**
   * ⚠️ **Parsed, and deliberately not shown anywhere.** ProtonDB stopped asking this after
   * 2022 — zero answers across 203,560 reports from 2023 on — and a report is a verdict on a
   * Proton version rather than on the game, so a 2022 "blocked" cannot be checked against
   * today's stack. The details page's Anti-cheat panel was removed 2026-08-25 for exactly
   * that. Kept on the type because the archive carries the column and dropping it would
   * misrepresent the source shape; do not build a feature on it without checking whether
   * ProtonDB has started asking again.
   */
  anticheat?: boolean
  installs?: boolean
  opens?: boolean
  startsPlay?: boolean
  verdict?: boolean
  significantBugs?: boolean
  /** `tinker` upstream: they changed something to get there. */
  tinkered?: boolean
  /** How many of the seven fault questions were answered "yes". */
  faults?: number
}

export type RuntimeVariant =
  'native' | 'official' | 'experimental' | 'ge' | 'notListed' | 'older' | 'unknown'

const VARIANTS: ReadonlySet<string> = new Set([
  'native',
  'official',
  'experimental',
  'ge',
  'notListed',
  'older',
])

/**
 * What a reporter said happened, worst to best.
 *
 * ⚠️ This is NOT a tier and must never be drawn as one — no medallion, no metal
 * palette, no six-rung ladder that rhymes with ProtonDB's. Each value is a restatement
 * of an answer the reporter gave, which is why it can be shown without upstream's
 * algorithm. `unanswered` is a real outcome: the report exists and the questionnaire
 * did not ask.
 */
export type Outcome =
  'unanswered' | 'noInstall' | 'noOpen' | 'noPlay' | 'bugs' | 'tinkered' | 'clean'

export const OUTCOME_LABEL: Record<Outcome, string> = {
  clean: 'Played, no changes',
  tinkered: 'Played, after changes',
  bugs: 'Played, with bugs',
  noPlay: 'Never started playing',
  noOpen: 'Never opened',
  noInstall: 'Never installed',
  unanswered: 'Not asked',
}

/** Worst to best, which is the order the distribution bar draws in. */
export const OUTCOME_ORDER: readonly Outcome[] = [
  'noInstall',
  'noOpen',
  'noPlay',
  'bugs',
  'tinkered',
  'clean',
] as const

/**
 * Reduce one report's answers to what it says happened.
 *
 * Read strictly top-down: the earliest failure wins, because "it never installed" is
 * the whole story regardless of what the later questions say. A report that answered
 * nothing relevant lands on `unanswered` rather than being guessed into a bucket.
 */
export const outcomeOf = (report: ProtonReport): Outcome => {
  if (report.installs === false) return 'noInstall'
  if (report.opens === false) return 'noOpen'
  if (report.startsPlay === false) return 'noPlay'
  // Past this point we only know it played if something actually said so.
  const played = report.startsPlay === true || report.verdict === true
  if (!played) return 'unanswered'
  if (report.significantBugs === true) return 'bugs'
  if (report.tinkered === true) return 'tinkered'
  return 'clean'
}

/** The three outcomes that mean the game ran. */
export const PLAYED: ReadonlySet<Outcome> = new Set<Outcome>(['clean', 'tinkered', 'bugs'])

const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const normalize = (raw: Record<string, unknown>): ProtonReport => ({
  timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : 0,
  gpu: str(raw.gpu),
  cpu: str(raw.cpu),
  os: str(raw.os),
  kernel: str(raw.kernel),
  proton: str(raw.proton),
  variant: VARIANTS.has(str(raw.variant)) ? (raw.variant as RuntimeVariant) : 'unknown',
  note: str(raw.note),
  anticheat: bool(raw.anticheat),
  installs: bool(raw.installs),
  opens: bool(raw.opens),
  // ⚠️ serde serializes the Rust field names verbatim, so these two arrive
  // snake_case while the rest of this app is camelCase. Renaming them here rather
  // than in Rust keeps the wire format matching the SQLite column names, which is
  // what anyone debugging the index will actually be looking at.
  startsPlay: bool(raw.starts_play),
  verdict: bool(raw.verdict),
  significantBugs: bool(raw.significant_bugs),
  tinkered: bool(raw.tinkered),
  faults: typeof raw.faults === 'number' ? raw.faults : undefined,
})

/**
 * Every report we hold for one game, newest first.
 *
 * Empty in the browser build and whenever the archive is not on disk. ⚠️ The caller
 * must not read an empty array as "nobody reported this game" — that is the whole
 * point of turn 13, and it is why `useProtonReports` reports the dump phase alongside
 * the list rather than handing back a bare array.
 */
export const readProtonReports = async (appid: number): Promise<ProtonReport[]> => {
  try {
    // ⚠️ `isTauri` is imported dynamically rather than at the top of the file, and it
    // is not stylistic: everything above this function is pure and is exercised by
    // `node --experimental-strip-types` in hardwareScore.test.ts. A top-level import of
    // `./index` drags the whole platform barrel — and the browser globals it touches —
    // into a plain Node process, which fails at module load before a single assertion
    // runs. The dynamic form keeps the parsing rules testable without a DOM.
    const { isTauri } = await import('./index')
    if (!isTauri()) return []
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke<unknown>('proton_reports', { appid })
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
      )
      .map(normalize)
  } catch {
    return []
  }
}
