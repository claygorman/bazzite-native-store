import assert from 'node:assert/strict'
import test from 'node:test'

import { stillToFetch, writeBack } from './appsCache.ts'

const map = (...ids: number[]) => new Map(ids.map((id) => [id, { id }]))

test('only the unknown appids are fetched', () => {
  assert.deepEqual(stillToFetch([1, 2, 3], map(2)), [1, 3])
  assert.deepEqual(stillToFetch([1, 2], map(1, 2)), [], 'all known means no request at all')
  assert.deepEqual(stillToFetch([1, 2], map()), [1, 2], 'nothing known means ask for everything')
})

test('a repeated appid is asked for once', () => {
  assert.deepEqual(stillToFetch([5, 5, 6, 5], map()), [5, 6])
})

/**
 * ⚠️⚠️ **THE trap.** Writing a cache hit back stamps it with a new timestamp, so a row read
 * on every shelf load renews its own freshness and never expires. The cache keeps working,
 * the TTL keeps being checked, and the data is pinned at whatever it said the first time.
 * Prices simply stop moving, and nothing anywhere reports a problem.
 */
test('a cache HIT is never written back, however it got into the result', () => {
  const known = map(1, 2)
  const all = new Map([...map(1, 2), ...map(3)])
  assert.deepEqual(
    writeBack(all, known).map(([appid]) => appid),
    [3],
    'only the appid that came off the network',
  )
})

test('with everything served from cache there is nothing to write', () => {
  const known = map(1, 2)
  assert.deepEqual(writeBack(known, known), [])
})

test('with nothing cached, everything fetched is written', () => {
  const all = map(1, 2, 3)
  assert.equal(writeBack(all, map()).length, 3)
})

/**
 * The invariant that ties the two together: what we ask for and what we write back are the
 * SAME set, and neither ever overlaps what we read. Stated as a property because the two
 * functions are edited at different times and only their relationship is load-bearing.
 */
test('asked-for and written-back are the same set, and disjoint from the cache hits', () => {
  const asked = [10, 11, 12, 13]
  const known = map(11, 13)
  const misses = stillToFetch(asked, known)

  // What a successful fetch produces: the hits plus a row for every miss.
  const all = new Map<number, { id: number }>([...known, ...misses.map((id) => [id, { id }] as const)])
  const written = writeBack(all, known).map(([appid]) => appid)

  assert.deepEqual(written.sort(), [...misses].sort(), 'we write exactly what we fetched')
  assert.equal(
    written.some((appid) => known.has(appid)),
    false,
    'and never anything we read back',
  )
  assert.equal(all.size, asked.length, 'every appid asked for is accounted for')
})
