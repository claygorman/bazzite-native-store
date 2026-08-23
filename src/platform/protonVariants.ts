import { isTauri } from './index'

/**
 * "What people ran it under" — the runtime split, design turn 13c.
 *
 * ⚠️ A RUNTIME fact, not a graded one, and the whole reason this exists separately
 * from the Deck verdict bar above it. `native` belongs beside `official`, `ge` and
 * `experimental` because all four answer "what did this run on"; none of them answers
 * "how well did it run". The old bar had "Native" standing next to Platinum and Gold,
 * which are quality — one bar, two questions, and no way for a reader to tell which
 * one they were looking at.
 *
 * ⚠️ Local index only. ProtonDB's live API serves one appid per HTTP request with no
 * aggregation, so this question is unanswerable over the network at any sane cost and
 * is a `GROUP BY` here purely because turn 13a already put the dump in SQLite.
 *
 * ⚠️ The browser build has no index and therefore no answer. It gets zeroes, and
 * `TagPicker` renders nothing rather than an empty bar — "we cannot ask" and "nobody
 * has reported" must not share a treatment.
 */

/** The four runtimes the bar draws, in the order it draws them. */
export const RUNTIME_VARIANTS = ['native', 'official', 'ge', 'experimental'] as const

export type RuntimeVariant = (typeof RUNTIME_VARIANTS)[number]

export type VariantSplit = Record<RuntimeVariant, number> & {
  /**
   * `notListed`, `older`, and anything a later dump invents.
   *
   * Counted so `total` stays true, never drawn. A segment labelled "Other" teaches
   * the reader to distrust the four that mean something.
   */
  other: number
  /** Every report row for the sampled appids, `other` included. */
  total: number
  /**
   * Distinct sampled appids with at least one report.
   *
   * ⚠️ The honest denominator for the counted line. Games nobody has reported are not
   * in it — asking about a hundred appids does not make a hundred games' worth of
   * evidence.
   */
  games: number
}

export const EMPTY_VARIANT_SPLIT: VariantSplit = {
  native: 0,
  official: 0,
  ge: 0,
  experimental: 0,
  other: 0,
  total: 0,
  games: 0,
}

/** How many of `split`'s reports the bar can actually attribute to a runtime. */
export const attributedReports = (split: VariantSplit): number =>
  RUNTIME_VARIANTS.reduce((n, variant) => n + split[variant], 0)

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

/**
 * Group a sample's ProtonDB reports by the runtime they were filed against.
 *
 * ⚠️ Degrades to zeroes rather than throwing, the same shape `protonDump.ts` uses:
 * this is one additive block on a screen whose other numbers are already on their way,
 * and a rejected promise here would take the whole tag preview down with it.
 */
export const fetchVariantSplit = async (appids: readonly number[]): Promise<VariantSplit> => {
  if (!isTauri() || appids.length === 0) return EMPTY_VARIANT_SPLIT
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke<Partial<Record<keyof VariantSplit, unknown>>>(
      'proton_variant_split',
      // ⚠️ Copied, not passed through. Tauri serialises the argument, and a readonly
      // view of a React state array is not something to hand to a structured clone.
      { appids: [...appids] },
    )
    if (typeof raw !== 'object' || raw === null) return EMPTY_VARIANT_SPLIT
    return {
      native: count(raw.native),
      official: count(raw.official),
      ge: count(raw.ge),
      experimental: count(raw.experimental),
      other: count(raw.other),
      total: count(raw.total),
      games: count(raw.games),
    }
  } catch {
    return EMPTY_VARIANT_SPLIT
  }
}
