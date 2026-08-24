import assert from 'node:assert/strict'
import test from 'node:test'

import { tagsThatFit } from './tagFit.ts'

/**
 * Real tag sets from the live home rows, 2026-08-24 — the ones that overflowed a 440px
 * shelf tile at a fixed count of three and prompted this module.
 */
const LONG = ['Turn-Based Tactics', 'Turn-Based Strategy', 'Sci-fi', 'Strategy', 'RPG']
const SHORT = ['FPS', 'Action', 'PvP', 'Co-op', 'Indie']

/** Content width of a `shelfWide` tile (27.5rem) after its 2rem of boxed padding. */
const SHELF_WIDE = 25.5

test('nothing to draw yields nothing, and never throws', () => {
  assert.deepEqual(tagsThatFit(undefined, SHELF_WIDE), [])
  assert.deepEqual(tagsThatFit([], SHELF_WIDE), [])
})

/**
 * ⚠️ The point of the whole module: the SAME card fits fewer long tags than short ones.
 * A fixed count cannot express this, which is why three long tags clipped on the live rows.
 */
test('a narrow card fits fewer long tags than short ones', () => {
  const long = tagsThatFit(LONG, SHELF_WIDE)
  const short = tagsThatFit(SHORT, SHELF_WIDE)
  assert.ok(long.length < short.length, `long ${long.length} should be under short ${short.length}`)
})

test('what comes back always fits the budget it was given', () => {
  for (const width of [12, 19, 25.5, 30, 41, 60]) {
    for (const tags of [LONG, SHORT]) {
      const fitted = tagsThatFit(tags, width)
      const used = fitted.reduce((n, t) => n + 1.5 + t.length * 0.5, 0) + (fitted.length - 1) * 0.5
      assert.ok(used <= width || fitted.length === 0, `${fitted.join('|')} overflows ${width}rem`)
    }
  }
})

/**
 * ⚠️ Steam sorts tags by vote weight, so the first is the most-agreed description of the
 * game. Skipping a long tag to fit a shorter one behind it would reorder that ranking by
 * length — it would look tidier and say something different.
 */
test('it stops at the first tag that does not fit, it does not skip to a shorter one', () => {
  // "Sci-fi" would fit in the room "Turn-Based Strategy" needs. It must not be promoted.
  const fitted = tagsThatFit(['Turn-Based Tactics', 'Turn-Based Strategy', 'Sci-fi'], 14)
  assert.equal(fitted.includes('Sci-fi'), false)
  // And what does come back is a prefix of the input, always.
  assert.deepEqual(fitted, LONG.slice(0, fitted.length).slice(0, fitted.length))
})

test('the result is always a prefix of the input, in Steam order', () => {
  for (const width of [10, 20, 30, 50]) {
    const fitted = tagsThatFit(LONG, width)
    assert.deepEqual(fitted, LONG.slice(0, fitted.length))
  }
})

test('a wide card is still capped at five, not filled with everything Steam sent', () => {
  const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  assert.equal(tagsThatFit(many, 200).length, 5)
})

/** A parent-sized card must not guess high — an overflow is visible, one fewer tag is not. */
test('an unknown width takes a conservative budget rather than an optimistic one', () => {
  const unknown = tagsThatFit(LONG, undefined)
  assert.ok(unknown.length <= tagsThatFit(LONG, 41).length)
  assert.ok(unknown.length >= 1, 'but it should still show something')
  assert.deepEqual(tagsThatFit(LONG, 0), unknown, 'zero is treated as unknown, not as no room')
})

/** A single tag longer than the whole card yields nothing rather than a clipped chip. */
test('a tag that cannot fit at all is dropped, not clipped', () => {
  assert.deepEqual(tagsThatFit(['Massively Multiplayer Online Battle Arena'], 6), [])
})
