/**
 * Day-bucketing tests for the Personal Calendar band.
 *
 * Run: node --experimental-strip-types src/platform/calendar.test.ts
 *
 * `now` is injected into every call. A test that reads the real clock would pass on
 * a Tuesday and fail on a Sunday, and the interesting cases here — the midnight
 * boundary, the month rollover — are precisely the ones a wall-clock test cannot
 * reach on demand.
 *
 * Every fixture timestamp is built with `new Date(y, m, d, …)`, i.e. LOCAL time, so
 * the suite gives the same answer in any timezone. Hard-coded epoch constants would
 * quietly encode the author's UTC offset.
 */

import {
  buildCalendarDays,
  calendarWindowKeys,
  isWithinCalendarWindow,
  localDayKey,
  type CalendarEntry,
} from './calendar.ts'

let failures = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

/** Unix epoch SECONDS — the unit `release.steam_release_date` uses. */
const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
  Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000)

const entry = (appid: number, releaseEpoch: number): CalendarEntry => ({
  game: { appid, name: `App ${appid}`, capsuleUrl: `https://example.invalid/${appid}.jpg`, price: '$9.99' },
  releaseEpoch,
})

const namesOn = (days: ReturnType<typeof buildCalendarDays>, index: number): number[] =>
  days[index].games.map((g) => g.appid)

// Thursday 20 August 2026, mid-afternoon. Window: Mon 17th .. Sun 23rd.
const now = new Date(2026, 7, 20, 14, 30)

// ── the window itself ───────────────────────────────────────────────────────────

check('window is seven days', calendarWindowKeys(now).length, 7)
check('window runs today-3 .. today+3', calendarWindowKeys(now), [
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23',
])
check('day key pads month and day', localDayKey(new Date(2026, 0, 5)), '2026-01-05')

const empty = buildCalendarDays([], now)
check('labels read MON..SUN with TODAY in the middle', empty.map((d) => d.label), [
  'MON', 'TUE', 'WED', 'TODAY', 'FRI', 'SAT', 'SUN',
])
// Today shows the word and NOT the date — the design's one asymmetry.
check('dates are M/D, and empty for today', empty.map((d) => d.date), [
  '8/17', '8/18', '8/19', '', '8/21', '8/22', '8/23',
])
check('exactly one day is today, at index 3', empty.map((d) => d.isToday), [
  false, false, false, true, false, false, false,
])

// ── bucketing ───────────────────────────────────────────────────────────────────

// The boundary that matters: local midnight, not UTC midnight. One minute either
// side of it must land in different columns.
const midnight = buildCalendarDays(
  [entry(101, at(2026, 8, 19, 23, 59)), entry(102, at(2026, 8, 20, 0, 1))],
  now,
)
check('23:59 files under the previous day', namesOn(midnight, 2), [101])
check('00:01 files under today', namesOn(midnight, 3), [102])

const windowed = buildCalendarDays(
  [
    entry(201, at(2026, 8, 16, 12)), // one day before the window
    entry(202, at(2026, 8, 17, 12)), // first column
    entry(203, at(2026, 8, 23, 12)), // last column
    entry(204, at(2026, 8, 24, 12)), // one day after the window
  ],
  now,
)
check('releases outside the window are dropped', windowed.flatMap((d) => d.games.map((g) => g.appid)), [202, 203])

// A release date of 0 is Steam for "no date announced". It is not 1 Jan 1970.
check('undated releases are dropped', buildCalendarDays([entry(301, 0)], now).flatMap((d) => d.games), [])
check('negative release dates are dropped', buildCalendarDays([entry(302, -1)], now).flatMap((d) => d.games), [])

// The anonymous path unions coming_soon with new_releases, and those shelves overlap.
const duped = buildCalendarDays([entry(401, at(2026, 8, 21, 9)), entry(401, at(2026, 8, 21, 9))], now)
check('a duplicated appid is filed once', namesOn(duped, 4), [401])

// Stable order or the top capsule shuffles between fetches.
const ordered = buildCalendarDays(
  [
    entry(503, at(2026, 8, 22, 18)),
    entry(502, at(2026, 8, 22, 9)),
    entry(501, at(2026, 8, 22, 9)), // same instant as 502 — appid breaks the tie
  ],
  now,
)
check('a day sorts by release time, then appid', namesOn(ordered, 5), [501, 502, 503])

// The band draws three capsules and derives "+N More" from the overflow, so the day
// must keep everything it was given.
const busy = buildCalendarDays(
  [1, 2, 3, 4, 5].map((n) => entry(600 + n, at(2026, 8, 18, 10 + n))),
  now,
)
check('a busy day keeps every game, not just three', busy[1].games.length, 5)

// ── rollovers ───────────────────────────────────────────────────────────────────

// Thursday 31 December 2026 — the window has to cross into 2027.
const newYear = new Date(2026, 11, 31, 20, 0)
check('the window crosses the year boundary', calendarWindowKeys(newYear), [
  '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
])
check('dates roll over to 1/1', buildCalendarDays([], newYear).map((d) => d.date), [
  '12/28', '12/29', '12/30', '', '1/1', '1/2', '1/3',
])
const january = buildCalendarDays([entry(701, at(2027, 1, 2, 11))], newYear)
check('a January release files into a December window', namesOn(january, 5), [701])

// ── the pre-filter used before hydrating the personalized 300 ────────────────────

check('in-window release passes the pre-filter', isWithinCalendarWindow(at(2026, 8, 20, 12), now), true)
check('one day of slack either side is allowed', [
  isWithinCalendarWindow(at(2026, 8, 16, 12), now),
  isWithinCalendarWindow(at(2026, 8, 24, 12), now),
], [true, true])
check('far-future releases are pre-filtered out', isWithinCalendarWindow(at(2027, 3, 1, 12), now), false)
check('undated releases are pre-filtered out', isWithinCalendarWindow(0, now), false)

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
