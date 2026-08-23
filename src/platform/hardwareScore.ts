// ⚠️ Extension is required: this module is exercised by node --experimental-strip-types
// (src/platform/hardwareScore.test.ts), whose resolver does not do extensionless
// lookups. Same reason as `calendar.ts` -> `contentFilter.ts`.
import { outcomeOf, PLAYED, type ProtonReport } from './protonReports.ts'

/**
 * A compatibility score for THIS machine — design turn 13d.
 *
 * ⚠️ Deliberately unlike a tier. A plain number on a meter, no medallion, no metal
 * palette, and it never borrows ProtonDB's vocabulary. That is not squeamishness: a
 * reconstruction of upstream's tier agreed with them only 38% of the time, so anything
 * that LOOKS like a tier here would be read as one and would be wrong more than half
 * the time on the games people actually check.
 *
 * ⚠️ It is a LADDER, not a filter. Filtering reports down to an exact GPU model is the
 * obvious implementation and it is the wrong one — measured against the real archive,
 * the exact-model rung holds 5,960 reports across 2,510 games, and per game even a
 * 500-report title carries 0–31 reports from any one card generation. Filtering
 * therefore produces "no data" for most games on most hardware, which reads as a
 * verdict about the game. So the scope WIDENS until there is evidence, and the rung it
 * landed on is stated as loudly as the number, because 78 from your exact card and 78
 * from "some AMD GPU" are different claims.
 */

export type Rung = 'model' | 'generation' | 'vendor'

/** Widest last — this is the order the ladder walks. */
export const RUNGS: readonly Rung[] = ['model', 'generation', 'vendor'] as const

/**
 * How many ANSWERED reports a rung needs before it counts as evidence.
 *
 * ⚠️ Low on purpose. The median game in the archive has two reports, so a threshold
 * tuned for statistical comfort would send every game to the vendor rung and make the
 * ladder decorative. Five is "more than a couple of people", which is the most this
 * data can honestly support, and the count is always printed beside the number so the
 * reader can discount it themselves.
 */
export const MIN_REPORTS = 5

export type HardwareScore = {
  /** Where the ladder stopped. `undefined` means no rung had enough evidence. */
  rung?: Rung
  /** 0–100. Absent exactly when `rung` is. */
  score?: number
  /** Answered reports at the landed rung. */
  count: number
  /** Every report we hold for this game, answered or not — the denominator. */
  total: number
  /** What the ladder matched on, e.g. "RX 9070 XT" or "RDNA 4 cards". */
  scope?: string
}

/* ───────────────────────── reading a GPU string ───────────────────────── */

export type Vendor = 'amd' | 'nvidia' | 'intel'

const VENDOR_LABEL: Record<Vendor, string> = {
  amd: 'AMD cards',
  nvidia: 'NVIDIA cards',
  intel: 'Intel graphics',
}

/**
 * ⚠️ Order matters. "AMD Radeon RX 7900 XTX (RADV NAVI31)" contains neither "nvidia"
 * nor "intel", but plenty of NVIDIA strings mention "GeForce" without "NVIDIA", and
 * Intel's read "Intel Arc". Test the most specific token first and never fall through
 * to a substring that appears inside a driver name.
 */
export const vendorOf = (gpu: string): Vendor | undefined => {
  const text = gpu.toLowerCase()
  if (/\b(nvidia|geforce|rtx|gtx)\b/.test(text)) return 'nvidia'
  if (/\b(radeon|amd|rx)\b/.test(text)) return 'amd'
  if (/\b(intel|arc|iris|uhd graphics)\b/.test(text)) return 'intel'
  return undefined
}

/**
 * Valve's handhelds, which do not carry a marketing model in the driver string.
 *
 * ⚠️ Not a nicety — measured against the September 2025 archive, `AMD Custom GPU 0405`
 * is the single most common GPU in the whole dump at ~14% of every report with a GPU,
 * ahead of any retail card. Without this the Deck falls all the way to "some AMD GPU",
 * which is the least useful rung there is on the one device most of these reports came
 * from. `0405` is the LCD Deck (van Gogh), `0932` the OLED refresh.
 */
const deckModel = (text: string): string | undefined => {
  if (text.includes('CUSTOM GPU 0405')) return 'Steam Deck LCD'
  if (text.includes('CUSTOM GPU 0932')) return 'Steam Deck OLED'
  return undefined
}

/**
 * The card's marketing model, normalised — "RX 9070 XT", "RTX 4080", "ARC B580".
 *
 * Returns `undefined` rather than guessing. ProtonDB report strings are whatever the
 * reporter's driver said, so they carry codenames, LLVM versions, DRM versions and a
 * whole kernel release inside the same field: `AMD Radeon RX 7900 XTX (radeonsi,
 * navi31, LLVM 18.1.8, DRM 3.57, 6.10.11-2-MANJARO)` and a bare `AMD Radeon RX 7900
 * XTX` are the same card and must normalise to the same string. Matching the family
 * prefix plus the model number is the only part reliably present in both those and in
 * a `/sys/class/drm` product string.
 *
 * ⚠️ Measured on the September 2025 archive: this resolves a model for **69.6%** of the
 * 309,218 reports carrying a GPU. The remainder are integrated Intel parts named by
 * codename (`Intel Mesa Intel UHD 620 (KBL GT2)`), AMD APUs named by architecture
 * (`AMD RAVEN`), workstation cards, and llvmpipe software rendering. They are not
 * failures — they simply have no marketing model in the string, and the ladder exists
 * precisely so that they still land somewhere useful.
 *
 * ⚠️ `XTX` must precede `XT` in the alternation, or every 7900 XTX is filed as a
 * 7900 XT. Same class of bug as `TI SUPER` before `SUPER`.
 */
export const modelOf = (gpu: string): string | undefined => {
  const text = gpu.toUpperCase()
  const deck = deckModel(text)
  if (deck) return deck
  const match =
    /\b(RX)\s?(\d{3,4})\s?(XTX|XT|GRE|M|S)?\b/.exec(text) ??
    /\b(RTX|GTX)\s?(\d{3,4})\s?(TI\s?SUPER|SUPER|TI)?\b/.exec(text) ??
    /\b(ARC)\s?([AB]\d{3})\b/.exec(text)
  if (!match) return undefined
  const [, family, number, suffix] = match
  return [family, number, suffix?.replace(/\s+/g, ' ')].filter(Boolean).join(' ')
}

/**
 * The architecture generation, as a label people recognise.
 *
 * ⚠️ Derived from the model NUMBER, not from a lookup table of every SKU ever sold.
 * A table would be wrong the week a new card ships, and being wrong here is worse than
 * being absent — the rung label is the thing that tells the reader how much to trust
 * the number. Anything unrecognised returns `undefined` and the ladder falls through
 * to the vendor rung, which is always true.
 */
export const generationOf = (gpu: string): string | undefined => {
  const model = modelOf(gpu)
  if (!model) return undefined
  // Both Decks are van Gogh, which is RDNA 2 — so a Deck report is evidence for an
  // RX 6000 owner and vice versa, which is exactly what the middle rung is for.
  if (model.startsWith('Steam Deck')) return 'RDNA 2'

  const [family, number] = model.split(' ')
  const series = Number(number)

  if (family === 'RX') {
    if (series >= 9000) return 'RDNA 4'
    if (series >= 7000 && series < 8000) return 'RDNA 3'
    if (series >= 6000 && series < 7000) return 'RDNA 2'
    if (series >= 5000 && series < 6000) return 'RDNA'
    // ⚠️ The 400 and 500 series are both Polaris and both still very much in the
    // archive — RX 580 alone is the most-reported AMD retail card in it. Leaving them
    // out sent every one of those reports to the vendor rung.
    if (series >= 400 && series < 600) return 'Polaris'
    return undefined
  }
  if (family === 'RTX') {
    if (series >= 5000 && series < 6000) return 'Blackwell'
    if (series >= 4000 && series < 5000) return 'Ada Lovelace'
    if (series >= 3000 && series < 4000) return 'Ampere'
    if (series >= 2000 && series < 3000) return 'Turing'
    return undefined
  }
  if (family === 'GTX') {
    // ⚠️ 16-series is Turing, same as RTX 20 — the number looks like it belongs with
    // the 10-series and does not. GTX 1070/1080 are the two most-reported cards in the
    // entire archive, so getting this wrong is not a corner case.
    if (series >= 1600 && series < 1700) return 'Turing'
    if (series >= 1000 && series < 1200) return 'Pascal'
    if (series >= 900 && series < 1000) return 'Maxwell'
    if (series >= 700 && series < 800) return 'Kepler'
    return undefined
  }
  if (family === 'ARC') return number.startsWith('B') ? 'Battlemage' : 'Alchemist'
  return undefined
}

/* ─────────────────────────────── the ladder ─────────────────────────────── */

/** Does this report's GPU match the host's, at the given rung? */
const matches = (reportGpu: string, hostGpu: string, rung: Rung): boolean => {
  if (rung === 'model') {
    const host = modelOf(hostGpu)
    return host !== undefined && modelOf(reportGpu) === host
  }
  if (rung === 'generation') {
    const host = generationOf(hostGpu)
    return host !== undefined && generationOf(reportGpu) === host
  }
  const host = vendorOf(hostGpu)
  return host !== undefined && vendorOf(reportGpu) === host
}

const scopeLabel = (hostGpu: string, rung: Rung): string | undefined => {
  if (rung === 'model') return modelOf(hostGpu)
  if (rung === 'generation') {
    const generation = generationOf(hostGpu)
    return generation ? `${generation} cards` : undefined
  }
  const vendor = vendorOf(hostGpu)
  return vendor ? VENDOR_LABEL[vendor] : undefined
}

/**
 * Score this game for this GPU, widening the scope until there is evidence.
 *
 * The score is the share of MATCHING, ANSWERED reports in which the game actually ran.
 * Reports whose questionnaire never asked are excluded from both halves of the
 * fraction rather than counted as failures — the same "not asked ≠ no" rule the whole
 * of turn 13 turns on, applied to arithmetic instead of to a sentence.
 */
export const scoreForHardware = (
  reports: readonly ProtonReport[],
  hostGpu: string | undefined,
): HardwareScore => {
  const total = reports.length
  if (!hostGpu) return { count: 0, total }

  for (const rung of RUNGS) {
    const scope = scopeLabel(hostGpu, rung)
    if (scope === undefined) continue

    const answered = reports.filter(
      (report) => matches(report.gpu, hostGpu, rung) && outcomeOf(report) !== 'unanswered',
    )
    if (answered.length < MIN_REPORTS) continue

    const played = answered.filter((report) => PLAYED.has(outcomeOf(report))).length
    return {
      rung,
      score: Math.round((played / answered.length) * 100),
      count: answered.length,
      total,
      scope,
    }
  }

  return { count: 0, total }
}

/**
 * The sentence under the number.
 *
 * ⚠️ Bands, not a formula, and none of them borrow a tier's name. "Plays, with tweaks
 * reported" is a statement about what reporters did; "Gold" would be a claim we cannot
 * back with this data.
 */
export const verdictFor = (score: number): string => {
  if (score >= 90) return 'Plays as shipped'
  if (score >= 70) return 'Plays, with tweaks reported'
  if (score >= 45) return 'Mixed — about half got it running'
  if (score > 0) return 'Mostly did not run'
  return 'Nobody got it running'
}
