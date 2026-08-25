import assert from 'node:assert/strict'
import test from 'node:test'

import { anticheatSummary, anticheatVerdict, answeredYear } from './anticheat.ts'
import type { ProtonReport } from './protonReports.ts'

const at = (year: number, anticheat?: boolean): ProtonReport => ({
  timestamp: Date.UTC(year, 5, 1) / 1000,
  gpu: '', cpu: '', os: '', kernel: '', proton: '', variant: 'official', note: '',
  ...(anticheat === undefined ? {} : { anticheat }),
})

/**
 * ⚠️⚠️ **THE trap this module exists for.** A game can have current reports and a
 * four-year-old anti-cheat picture — ProtonDB stopped asking after 2022, so the newest
 * REPORT and the newest ANSWER are years apart. Dating the claim from the whole set stamps
 * 2026 on a 2022 fact, which is how the panel came to tell Clay a wishlist game was
 * "reported as blocking" while Valve's current Deck verdict said Playable.
 */
test('the claim is dated by the newest ANSWER, never the newest report', () => {
  const reports = [at(2026), at(2025), at(2022, true), at(2021, true), at(2024)]
  const summary = anticheatSummary(reports)
  assert.equal(summary.asked, 2, 'three reports never answered')
  assert.equal(answeredYear(summary), 2022, 'not 2026')
})

/** ⚠️ Absent is NOT a reported "no" — merging them makes an unasked game look clean. */
test('an unanswered report is not counted as a clean one', () => {
  const summary = anticheatSummary([at(2026), at(2025), at(2024)])
  assert.equal(summary.asked, 0)
  assert.equal(summary.blocked, 0)
  assert.equal(anticheatVerdict(summary), 'unasked')
  assert.equal(answeredYear(summary), undefined, 'nothing to date')
})

test('the verdicts follow the answers that exist', () => {
  assert.equal(anticheatVerdict(anticheatSummary([at(2021, false), at(2021, false)])), 'clear')
  assert.equal(anticheatVerdict(anticheatSummary([at(2021, true), at(2021, true)])), 'blocking')
  assert.equal(anticheatVerdict(anticheatSummary([at(2021, true), at(2021, false)])), 'partial')
})

/** The real shape of the game that prompted this: 24 blocked of 29, newest 2022. */
test('the wishlist case: a confident blocking verdict, dated four years back', () => {
  const reports = [
    ...Array.from({ length: 24 }, () => at(2021, true)),
    ...Array.from({ length: 5 }, () => at(2021, false)),
    at(2022, true),
    // …and a pile of ordinary reports since, none of which were asked.
    ...Array.from({ length: 190 }, () => at(2026)),
  ]
  const summary = anticheatSummary(reports)
  assert.equal(summary.asked, 30)
  assert.equal(summary.blocked, 25)
  assert.equal(anticheatVerdict(summary), 'partial')
  assert.equal(answeredYear(summary), 2022, 'the 190 recent reports must not date this')
})

test('no reports at all is unasked, not clear', () => {
  assert.equal(anticheatVerdict(anticheatSummary([])), 'unasked')
})
