import assert from 'node:assert/strict'
import { parseSearchResults } from './searchResults.ts'

/*
 * Fixtures are trimmed from a REAL `search/results/?infinite=1` response captured
 * 2026-08-21 (tags=1716, sort_by=Reviews_DESC). Attribute order and spelling are
 * verbatim — that is the whole point of a parser test for markup we do not control.
 *
 * The failure this guards against is not "it returns nothing". It is "it returns
 * something wrong": one row's appid paired with the next row's content descriptors,
 * which is how an adult descriptor set ends up attached to an innocent game.
 */
const ROW = (key: string, extra = '') =>
  `<a href="https://store.steampowered.com/app/x/?snr=1_7_7_240_150_1" ` +
  `data-ds-appid="${key.replace('App_', '')}" data-ds-itemkey="${key}" ` +
  `data-ds-tagids="[4885,492,19]" ${extra} onmouseover="ShowHover()">` +
  `<span class="title">Whatever</span></a>`

const page = (html: string, total: unknown = 5214) => ({
  success: 1,
  start: 0,
  total_count: total,
  results_html: html,
})

let failed = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  let ok: boolean
  try {
    assert.deepEqual(actual, expected)
    ok = true
  } catch {
    ok = false
    failed++
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok)
    console.log(
      `        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
    )
}

// --- ordering and identity -------------------------------------------------
const three = parseSearchResults(page(ROW('App_790060') + ROW('App_3618850') + ROW('App_1145360')))
check('keeps Steam’s ranking order', three.appids, [790060, 3618850, 1145360])
check('reads total_count', three.total, 5214)

// --- item types ------------------------------------------------------------
const mixed = parseSearchResults(page(ROW('App_620') + ROW('Sub_12345') + ROW('Bundle_999')))
check('skips packages and bundles, keeps apps', mixed.appids, [620])

// --- the pairing bug -------------------------------------------------------
// Row 1 has NO descids; row 2 does. A regex spanning the whole fragment matches row
// 1's itemkey against row 2's descids and mislabels an innocent game as adult.
const straddle = parseSearchResults(
  page(ROW('App_111') + ROW('App_222', 'data-ds-descids="[1,3,4,5]"')),
)
check('does not borrow the next row’s descriptors', straddle.descriptorsByAppid.get(111), undefined)
check('attaches descriptors to their own row', straddle.descriptorsByAppid.get(222), [1, 3, 4, 5])

// --- descriptor parsing ----------------------------------------------------
const descs = parseSearchResults(
  page(
    ROW('App_1', 'data-ds-descids="[1,5]"') +
      ROW('App_2', 'data-ds-descids="[]"') +
      ROW('App_3', 'data-ds-descids="[ 1 , 2 , 5 ]"') +
      ROW('App_4', 'data-ds-descids="not-a-list"'),
  ),
)
check('parses a descriptor list', descs.descriptorsByAppid.get(1), [1, 5])
check('an empty list is empty, not absent', descs.descriptorsByAppid.get(2), [])
check('tolerates whitespace', descs.descriptorsByAppid.get(3), [1, 2, 5])
check('a malformed attribute costs one row, not the page', descs.descriptorsByAppid.get(4), [])
check('...and that row is still returned', descs.appids, [1, 2, 3, 4])

// --- duplicates ------------------------------------------------------------
const dupes = parseSearchResults(page(ROW('App_7') + ROW('App_8') + ROW('App_7')))
check('drops a repeated app, keeping the first position', dupes.appids, [7, 8])

// --- degrading -------------------------------------------------------------
// Every one of these must yield an empty page rather than throw. A dead endpoint
// must never blank the UI, and half-parsed results are worse than none.
for (const [name, input] of [
  ['null', null],
  ['a string', 'nope'],
  ['no results_html', { total_count: 12 }],
  ['results_html is not a string', { total_count: 12, results_html: { a: 1 } }],
  ['an HTML error page', page('<html><body>Sorry!</body></html>')],
  ['empty markup', page('')],
] as const) {
  const r = parseSearchResults(input)
  check(`degrades on ${name}`, { total: r.total, appids: r.appids }, { total: 0, appids: [] })
}

// total_count present but nonsense -> 0, while rows still parse
const badTotal = parseSearchResults(page(ROW('App_5'), 'lots'))
check('a non-numeric total is 0, not NaN', badTotal.total, 0)
check('...and the rows survive it', badTotal.appids, [5])

// --- the empty-page ambiguity ---------------------------------------------
// A real total with no parseable rows means one of two very different things, and
// only the offset separates them.
const lastPage = parseSearchResults({
  success: 1,
  start: 5200,
  total_count: 5214,
  results_html: '',
})
check(
  'paging past the end keeps its real total',
  { t: lastPage.total, n: lastPage.appids.length },
  { t: 5214, n: 0 },
)

const brokenFirst = parseSearchResults({
  success: 1,
  start: 0,
  total_count: 5214,
  results_html: '<div class="renamed"></div>',
})
check(
  'but "5,214 matches" with nothing to show at offset 0 is a broken parser, not a result',
  { t: brokenFirst.total, n: brokenFirst.appids.length },
  { t: 0, n: 0 },
)

assert.equal(failed, 0, `${failed} search-results cases failed`)
console.log('\nall passed')
