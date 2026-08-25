/**
 * What the archive can and cannot say about anti-cheat.
 *
 * ⚠️⚠️ **ProtonDB STOPPED ASKING THIS QUESTION AFTER 2022.** Measured against the real
 * archive on the box, 2026-08-25:
 *
 * | year | reports | answered the anti-cheat question |
 * |------|---------|----------------------------------|
 * | 2026 |  43,419 | **0**                            |
 * | 2025 |  60,865 | **0**                            |
 * | 2024 |  54,041 | **0**                            |
 * | 2023 |  45,235 | **0**                            |
 * | 2022 |  56,410 | 2,724                            |
 * | 2021 |  32,004 | 11,772                           |
 *
 * Zero answers across 203,560 reports since 2023. So this is a **historical** signal, not
 * a live one, and any UI built on it must say when it was last asked or it is reporting
 * 2022 as though it were today.
 *
 * ⚠️ That is not the same as saying anti-cheat is a solved problem on Linux — it very much
 * is not, and kernel anti-cheat still blocks real games. It means THIS SOURCE stopped
 * measuring it. The live signal for that is Valve's Deck verdict, which is maintained.
 *
 * Concretely, this is why it matters: of the games this store had indexed, exactly one had
 * a confident "blocked" signal — 24 of 29 answers, newest **February 2022** — while Valve's
 * current Deck verdict for it is *Playable*. Presented undated, the archive contradicts a
 * maintained source and is wrong.
 */

import type { ProtonReport } from './protonReports'

export type AnticheatSummary = {
  /** Reports that ANSWERED the question. ⚠️ Not the number of reports. */
  asked: number
  /** Of those, how many said anti-cheat got in the way. */
  blocked: number
  /**
   * Unix seconds of the most recent report that ANSWERED.
   *
   * ⚠️ The newest ANSWERING report, never the newest report. A game with 223 reports and
   * 29 answers has current reports and a four-year-old anti-cheat picture; dating the claim
   * from the whole set would stamp 2026 on a 2022 fact, which is the precise error this
   * module exists to prevent.
   */
  newestAt?: number
}

export const anticheatSummary = (reports: readonly ProtonReport[]): AnticheatSummary => {
  let asked = 0
  let blocked = 0
  let newestAt: number | undefined
  for (const report of reports) {
    // ⚠️ `undefined` means the questionnaire never asked, which is a different fact from a
    // reported "no". Merging them turns a game nobody was asked about into a clean one.
    if (report.anticheat === undefined) continue
    asked += 1
    if (report.anticheat) blocked += 1
    if (newestAt === undefined || report.timestamp > newestAt) newestAt = report.timestamp
  }
  return { asked, blocked, newestAt }
}

/** What to headline. `unasked` is about the ARCHIVE; the rest are about the game. */
export type AnticheatVerdict = 'unasked' | 'clear' | 'partial' | 'blocking'

export const anticheatVerdict = ({ asked, blocked }: AnticheatSummary): AnticheatVerdict =>
  asked === 0 ? 'unasked' : blocked === 0 ? 'clear' : blocked === asked ? 'blocking' : 'partial'

/** The year an answer was given, for dating the claim. `undefined` when never asked. */
export const answeredYear = ({ newestAt }: AnticheatSummary): number | undefined =>
  newestAt === undefined ? undefined : new Date(newestAt * 1000).getUTCFullYear()
