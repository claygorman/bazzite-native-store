import assert from 'node:assert/strict'
import { generationOf, modelOf, scoreForHardware, vendorOf, verdictFor } from './hardwareScore.ts'
import { outcomeOf, type ProtonReport } from './protonReports.ts'

/*
 * Every GPU string below is VERBATIM from ProtonDB's own `reports_sep1_2025.tar.gz`
 * (309,222 records, downloaded and surveyed 2026-08-22), picked from the most-reported
 * entries rather than written to suit the parser. That matters here more than usual:
 * the field is free text produced by whatever driver the reporter was running, so it
 * carries codenames, LLVM versions, DRM versions and an entire kernel release inside
 * the same string, and a parser tested against tidy invented strings passes while
 * failing on the real thing.
 *
 * Measured coverage of this parser over that archive:
 *   vendor resolved  306,460 / 309,218  (99.1%)
 *   model  resolved  215,085 / 309,218  (69.6%)
 */

const vendorCases: Array<[string, string | undefined]> = [
  ['NVIDIA GeForce GTX 1070', 'nvidia'],
  ['NVIDIA GeForce RTX 2070 SUPER', 'nvidia'],
  // ⚠️ No "AMD" anywhere in this one — 3,194 reports, and matching only on the vendor
  // word would drop every one of them.
  ['Radeon RX 580', 'amd'],
  ['AMD Custom GPU 0405 (vangogh, LLVM 14.0.6, DRM 3.45, 5.13.0-valve36-1-neptune)', 'amd'],
  ['Intel Mesa Intel Arc A770 (DG2)', 'intel'],
  ['Intel Mesa Intel UHD 620 (KBL GT2)', 'intel'],
  // Software rendering. Not a vendor, and pretending otherwise would file ~2,700
  // reports under whoever's CPU happened to be running the rasteriser.
  ['Mesa llvmpipe (LLVM 15.0.7, 256 bits)', undefined],
]

for (const [gpu, expected] of vendorCases) {
  assert.equal(vendorOf(gpu), expected, `vendorOf(${gpu})`)
}

const modelCases: Array<[string, string | undefined]> = [
  ['NVIDIA GeForce GTX 1070', 'GTX 1070'],
  // The same card reported two ways must normalise to one string, or the exact-model
  // rung splits its own evidence in half.
  ['AMD Radeon RX 7900 XTX', 'RX 7900 XTX'],
  [
    'AMD Radeon RX 7900 XTX (radeonsi, navi31, LLVM 18.1.8, DRM 3.57, 6.10.11-2-MANJARO)',
    'RX 7900 XTX',
  ],
  // ⚠️ The alternation order test. `XT` before `XTX` files every XTX as an XT.
  [
    'AMD Radeon RX 7900 XT (radeonsi, navi31, LLVM 17.0.6, DRM 3.54, 6.5.0-26-generic)',
    'RX 7900 XT',
  ],
  // Capacity suffixes are not model suffixes — these two are one card.
  ['NVIDIA GeForce GTX 1060 6GB', 'GTX 1060'],
  ['NVIDIA GeForce GTX 1060', 'GTX 1060'],
  ['NVIDIA GeForce RTX 2070 SUPER', 'RTX 2070 SUPER'],
  ['Intel Mesa Intel Arc B580 (BMG G21)', 'ARC B580'],
  ['Intel Mesa Intel Arc A770 (DG2)', 'ARC A770'],
  // The two Decks, by device id. 0405 is ~14% of every GPU-carrying report in the
  // archive — more than any retail card — so it earns its own rung entry.
  [
    'AMD Custom GPU 0405 (vangogh, LLVM 14.0.6, DRM 3.45, 5.13.0-valve36-1-neptune)',
    'Steam Deck LCD',
  ],
  [
    'AMD Custom GPU 0932 (radeonsi, vangogh, LLVM 20.1.8, DRM 3.63, 6.15.6-105.bazzite.fc42.x86_64)',
    'Steam Deck OLED',
  ],
  // Real strings that genuinely carry no marketing model. `undefined` is the right
  // answer — the ladder widens rather than the parser guessing.
  ['AMD RAVEN', undefined],
  ['Intel Mesa Intel Arc (MTL)', undefined],
  ['Radeon RX Vega', undefined],
  ['Mesa llvmpipe (LLVM 15.0.7, 256 bits)', undefined],
]

for (const [gpu, expected] of modelCases) {
  assert.equal(modelOf(gpu), expected, `modelOf(${gpu})`)
}

const generationCases: Array<[string, string | undefined]> = [
  ['AMD Radeon RX 9070 XT', 'RDNA 4'],
  ['AMD Radeon RX 7900 XTX', 'RDNA 3'],
  ['AMD Radeon RX 6800 XT', 'RDNA 2'],
  // Both Decks are van Gogh, which is RDNA 2 — so Deck reports are evidence for an
  // RX 6000 owner. That is the entire purpose of the middle rung.
  ['AMD Custom GPU 0405 (vangogh, LLVM 14.0.6, DRM 3.45, 5.13.0-valve36-1-neptune)', 'RDNA 2'],
  ['Radeon RX 580', 'Polaris'],
  // ⚠️ The 16-series is Turing despite the 1000-looking number. GTX 1070 and 1080 are
  // the two most-reported cards in the archive and are Pascal; filing 1660 with them
  // would be wrong on ~3,400 reports.
  ['NVIDIA GeForce GTX 1660 Ti', 'Turing'],
  ['NVIDIA GeForce GTX 1070', 'Pascal'],
  ['NVIDIA GeForce GTX 970', 'Maxwell'],
  ['NVIDIA GeForce RTX 3080', 'Ampere'],
  ['NVIDIA GeForce RTX 4090', 'Ada Lovelace'],
  ['Intel Mesa Intel Arc B580 (BMG G21)', 'Battlemage'],
  ['Intel Mesa Intel Arc A770 (DG2)', 'Alchemist'],
  ['AMD RAVEN', undefined],
]

for (const [gpu, expected] of generationCases) {
  assert.equal(generationOf(gpu), expected, `generationOf(${gpu})`)
}

/* ─────────────────────────── outcomes and the ladder ─────────────────────────── */

const report = (over: Partial<ProtonReport>): ProtonReport => ({
  timestamp: 1_700_000_000,
  gpu: '',
  cpu: '',
  os: '',
  kernel: '',
  proton: '',
  variant: 'official',
  note: '',
  ...over,
})

// ⚠️ The whole of turn 13 turns on this row: a report that answered nothing is NOT a
// failed report. Reading `undefined` as `false` would file it under "never installed".
assert.equal(outcomeOf(report({})), 'unanswered')
assert.equal(outcomeOf(report({ installs: false })), 'noInstall')
// Earliest failure wins — "it never installed" is the whole story regardless of what
// a later, contradictory answer says.
assert.equal(outcomeOf(report({ installs: false, verdict: true })), 'noInstall')
assert.equal(outcomeOf(report({ installs: true, opens: false })), 'noOpen')
assert.equal(outcomeOf(report({ installs: true, opens: true, startsPlay: false })), 'noPlay')
assert.equal(outcomeOf(report({ startsPlay: true, significantBugs: true })), 'bugs')
assert.equal(outcomeOf(report({ startsPlay: true, tinkered: true })), 'tinkered')
assert.equal(outcomeOf(report({ startsPlay: true })), 'clean')
// Bugs outrank tinkering: someone who changed things AND still hit bugs did not have
// it work.
assert.equal(outcomeOf(report({ startsPlay: true, tinkered: true, significantBugs: true })), 'bugs')

const played = (gpu: string) => report({ gpu, startsPlay: true })
const failed = (gpu: string) => report({ gpu, installs: false })

// Nothing at all to match against.
assert.deepEqual(scoreForHardware([], undefined), { count: 0, total: 0 })

// Six exact-model reports, five of which played -> lands on the top rung and never
// widens.
{
  const reports = [
    ...Array.from({ length: 5 }, () => played('AMD Radeon RX 9070 XT')),
    failed('AMD Radeon RX 9070 XT'),
  ]
  const score = scoreForHardware(reports, 'AMD Radeon RX 9070 XT (radeonsi, gfx1201)')
  assert.equal(score.rung, 'model')
  assert.equal(score.count, 6)
  assert.equal(score.score, 83)
  assert.equal(score.scope, 'RX 9070 XT')
}

// ⚠️ The case the ladder exists for. Four reports from the exact card is under the
// threshold, so a FILTER would say "no data" — which reads as a verdict about the
// game. The ladder widens to the generation instead and says so.
{
  const reports = [
    ...Array.from({ length: 4 }, () => played('AMD Radeon RX 9070 XT')),
    ...Array.from({ length: 6 }, () => played('AMD Radeon RX 9060 XT')),
  ]
  const score = scoreForHardware(reports, 'AMD Radeon RX 9070 XT')
  assert.equal(score.rung, 'generation')
  assert.equal(score.count, 10)
  assert.equal(score.scope, 'RDNA 4 cards')
}

// Nothing from RDNA 4, but plenty of AMD — falls to the widest rung rather than to
// nothing.
{
  const reports = Array.from({ length: 8 }, () => played('Radeon RX 580'))
  const score = scoreForHardware(reports, 'AMD Radeon RX 9070 XT')
  assert.equal(score.rung, 'vendor')
  assert.equal(score.scope, 'AMD cards')
}

// A different vendor entirely: no rung matches, and that is a stated "No score"
// rather than a zero. ⚠️ Zero would read as "nobody got it running".
{
  const reports = Array.from({ length: 20 }, () => played('NVIDIA GeForce RTX 3080'))
  const score = scoreForHardware(reports, 'AMD Radeon RX 9070 XT')
  assert.equal(score.rung, undefined)
  assert.equal(score.score, undefined)
  assert.equal(score.total, 20)
}

// ⚠️ Unanswered reports are excluded from BOTH halves of the fraction. Counting them
// as failures would drag every older game's score down for a question nobody asked.
{
  const reports = [
    ...Array.from({ length: 5 }, () => played('NVIDIA GeForce RTX 3080')),
    ...Array.from({ length: 50 }, () => report({ gpu: 'NVIDIA GeForce RTX 3080' })),
  ]
  const score = scoreForHardware(reports, 'NVIDIA GeForce RTX 3080')
  assert.equal(score.score, 100)
  assert.equal(score.count, 5)
  assert.equal(score.total, 55)
}

// The verdict bands never borrow a tier's vocabulary.
assert.equal(verdictFor(100), 'Plays as shipped')
assert.equal(verdictFor(78), 'Plays, with tweaks reported')
assert.equal(verdictFor(50), 'Mixed — about half got it running')
assert.equal(verdictFor(10), 'Mostly did not run')
assert.equal(verdictFor(0), 'Nobody got it running')
for (const score of [0, 10, 50, 78, 100]) {
  const words = verdictFor(score).toLowerCase()
  for (const tier of ['platinum', 'gold', 'silver', 'bronze', 'borked']) {
    assert.ok(!words.includes(tier), `verdict for ${score} must not say "${tier}"`)
  }
}

console.log('hardwareScore: ok')
