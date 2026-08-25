import assert from 'node:assert/strict'
import test from 'node:test'

import { appidsWithin, rgAppsAppids, spotlightRow } from './spotlight.ts'

/**
 * ⚠️ The anonymous response, captured verbatim 2026-08-24. This is the shape that made
 * "there is no endpoint" look true for an afternoon: HTTP 200, valid JSON, everything
 * empty. It must never produce a shelf.
 */
const ANONYMOUS = {
  spotlight_recommendations: [],
  spotlight_panels: [],
  item_data: { rgApps: [], rgPackages: [], rgBundles: [] },
}

test('the anonymous 200-with-empty-arrays payload yields undefined, not an empty row', () => {
  assert.equal(spotlightRow(ANONYMOUS), undefined)
})

/**
 * ⭐ The REAL shape, captured from a signed-in client 2026-08-24 (structure only — this repo
 * is public and the payload is one person's recommendations, so field names and counts, never
 * ids or titles). 86,805 bytes; 20 recommendations, 6 panels, 26 hydrated apps.
 *
 * Two things it settles:
 *   - `spotlight_recommendations` entries are exactly `{appid: number}`. Nothing more to
 *     parse, and the walk reads them directly.
 *   - `rgApps` really does arrive as an OBJECT keyed by appid strings when populated, and as
 *     `[]` when empty. The trap this module was written around is real, not theoretical.
 */
const REAL_SHAPE = {
  spotlight_recommendations: Array.from({ length: 20 }, (_, i) => ({ appid: 1000 + i })),
  spotlight_panels: Array.from({ length: 6 }, (_, i) => ({ appid: 2000 + i })),
  item_data: {
    rgApps: Object.fromEntries(
      Array.from({ length: 26 }, (_, i) => [
        String(1000 + i),
        { name: 'x', tags: [], tagids: [], has_live_broadcast: false },
      ]),
    ),
    rgPackages: [],
    rgBundles: [],
  },
}

test('the real payload parses to a ranked row of every recommendation and panel', () => {
  const row = spotlightRow(REAL_SHAPE)
  assert.ok(row, 'the real shape must parse')
  assert.equal(row.ranked, true)
  assert.equal(row.appids.length, 26)
  // Recommendations lead, in order, then the panels — Steam's ranking, untouched.
  assert.deepEqual(row.appids.slice(0, 3), [1000, 1001, 1002])
  assert.deepEqual(row.appids.slice(-3), [2003, 2004, 2005])
})

test('garbage, nulls and non-objects yield undefined rather than throwing', () => {
  for (const bad of [undefined, null, '', 0, [], 'not json', { unrelated: true }]) {
    assert.equal(spotlightRow(bad), undefined)
  }
})

test('appids come back in the order Steam ranked them', () => {
  const payload = {
    spotlight_recommendations: [{ appid: 2764460 }, { appid: 1374490 }, { appid: 1326470 }],
    spotlight_panels: [],
  }
  const row = spotlightRow(payload)
  assert.deepEqual(row?.appids, [2764460, 1374490, 1326470])
  assert.equal(row?.ranked, true)
})

/**
 * ⚠️ THE trap this module exists to survive. Steam's backend renders an empty associative
 * array as a JSON array and a populated one as a JSON object — `"rgApps":[]` anonymously,
 * `"rgApps":{"1631270":{…}}` on the real page. Assuming either alone is right half the
 * time, and wrong on the half that has data.
 */
test('rgApps is read whether it arrives as an object or an array', () => {
  assert.deepEqual(rgAppsAppids({ rgApps: [] }), [])
  // ⚠️ Written 1631270-then-1062090, read back ASCENDING. Not a typo — see the note on the
  // fallback test below. This assertion is the demonstration that the bag cannot be ranked.
  assert.deepEqual(rgAppsAppids({ rgApps: { '1631270': {}, '1062090': {} } }), [1062090, 1631270])
  // ⚠️ The ARRAY form keeps its order, because array indices are positions rather than
  // integer-like keys being re-enumerated. Both forms are handled; only one is ordered.
  assert.deepEqual(rgAppsAppids({ rgApps: [{ appid: 730 }, { appid: 570 }] }), [730, 570])
})

/**
 * ⚠️ Note the order, and that it is NOT the order written above. Integer-index-like object
 * keys enumerate ascending in every conforming JS engine regardless of insertion order
 * (ECMAScript OrdinaryOwnPropertyKeys), so the bag can never carry Steam's ranking. That is
 * exactly why this case reports `ranked: false` — right games, arbitrary order — and why the
 * caller keeps the shelf marked approximate when it lands here.
 */
test('the rgApps fallback returns the right games but reports itself unranked', () => {
  const payload = {
    spotlight_recommendations: [{ unrecognised_shape: true }],
    item_data: { rgApps: { '892970': {}, '252490': {}, '1631270': {} } },
  }
  const row = spotlightRow(payload)
  assert.deepEqual(row?.appids, [252490, 892970, 1631270])
  assert.equal(row?.ranked, false)
})

test('the ranked lists win over rgApps when both are readable', () => {
  const payload = {
    spotlight_recommendations: [{ appid: 111 }],
    item_data: { rgApps: { '999': {} } },
  }
  assert.deepEqual(spotlightRow(payload)?.appids, [111])
})

test('appids arrive as numbers or as decimal strings, and both count', () => {
  assert.deepEqual(appidsWithin([{ appid: 730 }, { appid: '570' }]), [730, 570])
})

/** `0` is Steam's "no app" sentinel; rendering it is a broken tile. */
test('zero, negatives and non-numeric ids are not appids', () => {
  assert.deepEqual(
    appidsWithin([{ appid: 0 }, { appid: -5 }, { appid: '12a' }, { appid: null }]),
    [],
  )
})

test('a game listed twice keeps its FIRST rank', () => {
  const payload = {
    spotlight_recommendations: [{ appid: 730 }, { appid: 570 }],
    spotlight_panels: [{ appid: 730 }, { appid: 440 }],
  }
  assert.deepEqual(spotlightRow(payload)?.appids, [730, 570, 440])
})

test('nested entries are reached — a row item may carry its own contents', () => {
  const payload = {
    spotlight_recommendations: [{ appid: 100, included_items: [{ appid: 200 }, { appid: 300 }] }],
  }
  assert.deepEqual(spotlightRow(payload)?.appids, [100, 200, 300])
})

/**
 * ⚠️ The walk runs over a payload we do not control and have never seen populated. A hang
 * here is a frozen television, which is worse than a missing shelf — so depth and count are
 * bounded, and a cyclic structure must terminate rather than recurse forever.
 */
test('a pathological payload terminates instead of hanging', () => {
  const cyclic: Record<string, unknown> = { appid: 42 }
  cyclic.self = cyclic
  assert.deepEqual(appidsWithin(cyclic), [42])

  // Deeply buried ids are given up on rather than chased forever.
  let deep: unknown = { appid: 7 }
  for (let i = 0; i < 50; i++) deep = { nested: deep }
  assert.deepEqual(appidsWithin(deep), [])

  const huge = Array.from({ length: 5000 }, (_, i) => ({ appid: i + 1 }))
  assert.ok(appidsWithin(huge).length <= 200)
})

/**
 * ⚠️ The LIVE chip's only source. `GetItems` — which hydrates every other shelf — has no
 * live-broadcast field at all, verified against a real response 2026-08-24. So absence
 * from this set means "we cannot know", never "not streaming", and the card must not draw
 * it as an absence.
 */
test('live broadcasts are read from rgApps, and only the true ones', () => {
  const row = spotlightRow({
    spotlight_recommendations: [{ appid: 111 }, { appid: 222 }, { appid: 333 }],
    item_data: {
      rgApps: {
        '111': { has_live_broadcast: true },
        '222': { has_live_broadcast: false },
        // Present on the row, absent from the bag entirely — unknowable, so not live.
        '444': { has_live_broadcast: true },
      },
    },
  })
  assert.equal(row?.live.has(111), true)
  assert.equal(row?.live.has(222), false, 'false must not count as live')
  assert.equal(row?.live.has(333), false, 'absent from rgApps is not live')
  assert.equal(row?.live.has(444), true)
})

test('the empty payload has nothing live, and the array form is not walked for it', () => {
  assert.equal(spotlightRow(ANONYMOUS), undefined)
  // Truthy-but-wrong shapes must not smuggle a live flag through.
  const row = spotlightRow({
    spotlight_recommendations: [{ appid: 1 }],
    item_data: { rgApps: { '1': { has_live_broadcast: 'yes' } } },
  })
  assert.equal(row?.live.has(1), false, 'only a real boolean true counts')
})

/**
 * ⭐ **The shape this module was written blind against, now measured.**
 *
 * Read off a real signed-in client 2026-08-25: 86 368 bytes, 20 recommendations, 6 panels,
 * 26 `rgApps` entries, 8 of them live. The elements of both ranked arrays carry `appid` and
 * NOTHING ELSE, which is why reading only appids was right rather than merely cautious.
 *
 * ⚠️ This test exists so a future "richer parse" that reaches into
 * `spotlight_recommendations[]` for a title or a price fails here instead of on a
 * television — there is nothing in there to reach for.
 */
test('the measured payload: ranked arrays carry appid alone, facts live in rgApps', () => {
  const recommendations = Array.from({ length: 20 }, (_, i) => ({ appid: 100 + i }))
  const panels = Array.from({ length: 6 }, (_, i) => ({ appid: 200 + i }))
  const rgApps = Object.fromEntries(
    [...recommendations, ...panels].map(({ appid }, i) => [
      String(appid),
      {
        name: `game ${appid}`,
        header: `https://example.invalid/${appid}.jpg`,
        tagids: [1, 2, 3],
        review_summary: 8,
        // 8 of 26, matching the live measurement.
        has_live_broadcast: i < 8,
      },
    ]),
  )
  const row = spotlightRow({
    spotlight_recommendations: recommendations,
    spotlight_panels: panels,
    // ⚠️ PHP serializes an empty associative array as `[]`, so these arrive as arrays
    // even though the populated form would be an object. Neither may derail the parse.
    item_data: { rgApps, rgPackages: [], rgBundles: [] },
  })

  assert.equal(row?.ranked, true, 'the ranked lists were present, so the row is ranked')
  assert.equal(row?.appids.length, 26, '20 recommendations + 6 panels, none dropped')
  // Recommendations rank ahead of panels, in the order Steam sent them.
  assert.deepEqual(row?.appids.slice(0, 3), [100, 101, 102])
  assert.deepEqual(row?.appids.slice(20, 23), [200, 201, 202])
  assert.equal(row?.live.size, 8, '8 of 26 were broadcasting')
})
