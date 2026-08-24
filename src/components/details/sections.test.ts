import assert from 'node:assert/strict'
import test from 'node:test'

import { extrasAcross, extrasAlong, extrasColumns, type SectionKey } from './sections.ts'

/**
 * Reviews & More draws two columns. Focus used to be a flat list in DOM order, so
 * both axes did the same thing and RIGHT from Customer Reviews landed on
 * Achievements — the panel directly BELOW it. These assert the two axes are now
 * genuinely different.
 *
 * ⚠️ The membership here must match `DetailsExtras`'s markup. If a panel moves
 * column in that file and not in `sections.ts`, focus lands on the wrong thing and
 * nothing here fails — so this file pins the ORDER too, which is the part a reader
 * of either file alone cannot check.
 */
const FULL: SectionKey[] = ['reviews', 'achievements', 'players', 'metacritic', 'genres']

test('the columns match what the screen draws', () => {
  assert.deepEqual(extrasColumns(FULL), [
    ['reviews', 'achievements'],
    ['players', 'metacritic', 'genres'],
  ])
})

test('left and right cross columns rather than walking the list', () => {
  // The original bug, stated as an assertion: right from reviews is NOT achievements.
  const fromReviews = extrasAcross(FULL, 0, 1)
  assert.notEqual(FULL[fromReviews], 'achievements')
  assert.equal(FULL[fromReviews], 'players')
  // ...and back again.
  assert.equal(FULL[extrasAcross(FULL, fromReviews, -1)], 'reviews')
})

test('crossing clamps the row instead of carrying it off the end', () => {
  // 'genres' is row 3 of the right column; the left column has only two panels, so
  // the row clamps to the last one rather than pointing at nothing.
  const genres = FULL.indexOf('genres')
  assert.equal(FULL[extrasAcross(FULL, genres, -1)], 'achievements')
})

test('crossing toward the column you are already in does not move', () => {
  assert.equal(extrasAcross(FULL, 0, -1), 0)
  const players = FULL.indexOf('players')
  assert.equal(extrasAcross(FULL, players, 1), players)
})

test('up and down stay inside the column', () => {
  assert.equal(FULL[extrasAlong(FULL, 0, 1) as number], 'achievements')
  // Down from the last panel of the left column leaves the content entirely rather
  // than jumping to the top of the right one.
  assert.equal(extrasAlong(FULL, FULL.indexOf('achievements'), 1), undefined)
  assert.equal(extrasAlong(FULL, 0, -1), undefined)
  assert.equal(FULL[extrasAlong(FULL, FULL.indexOf('players'), 1) as number], 'metacritic')
})

test('a column that lost its optional panels still navigates', () => {
  // No reviews and no achievements: the left column is empty, so crossing into it
  // must be a no-op rather than an index pointing at nothing.
  const rightOnly: SectionKey[] = ['players', 'metacritic']
  assert.deepEqual(extrasColumns(rightOnly), [[], ['players', 'metacritic']])
  assert.equal(extrasAcross(rightOnly, 0, -1), 0)
  assert.equal(rightOnly[extrasAlong(rightOnly, 0, 1) as number], 'metacritic')
})
