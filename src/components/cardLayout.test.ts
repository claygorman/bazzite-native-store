import assert from 'node:assert/strict'
import test from 'node:test'

import { compatGetsOwnRow, NARROW_CONTENT_REM } from './cardLayout.ts'

const at = (o: Partial<Parameters<typeof compatGetsOwnRow>[0]>) =>
  compatGetsOwnRow({ compact: false, contentRem: 0, hasDeck: false, hasTier: false, ...o })

/**
 * ⚠️ **THE regression.** `WishlistView` is compact, is parent-sized (`contentRem` 0), and
 * passes BOTH a Deck verdict and a ProtonDB tier. The old rule vetoed the own-row treatment
 * on `!compact` alone, so all four facts landed on one `whitespace-nowrap` line and clipped
 * mid-word on a 4K television. Seen on the box 2026-08-24.
 */
test('a compact card with BOTH compat labels puts them on their own line', () => {
  assert.equal(at({ compact: true, hasDeck: true, hasTier: true }), true)
})

/**
 * ...and the case the original `!compact` guard was actually protecting, which is still
 * right: one label does fit beside a price and a rating.
 */
test('a compact card with ONE compat label keeps it inline', () => {
  assert.equal(at({ compact: true, hasDeck: true }), false)
  assert.equal(at({ compact: true, hasTier: true }), false)
})

test('nothing to say means no row — an empty line is worse than no line', () => {
  assert.equal(at({ compact: true }), false)
  assert.equal(at({ compact: false }), false)
  assert.equal(at({ contentRem: 100 }), false)
})

test('a wide card keeps compatibility inline however many labels there are', () => {
  assert.equal(at({ contentRem: NARROW_CONTENT_REM, hasDeck: true, hasTier: true }), false)
  assert.equal(at({ contentRem: 60, hasDeck: true, hasTier: true }), false)
})

test('a roomy card is exactly at the boundary, not over it', () => {
  assert.equal(at({ hasDeck: true, contentRem: NARROW_CONTENT_REM - 0.01 }), true)
  assert.equal(at({ hasDeck: true, contentRem: NARROW_CONTENT_REM }), false)
})

/**
 * ⚠️ `contentRem === 0` is "the parent sizes this card", not "this card is zero wide".
 * A parent-sized card is a grid or flex child — the narrow ones — so it must take the
 * narrow branch. The wishlist depends on this.
 */
test('a parent-sized card takes the narrow branch', () => {
  assert.equal(at({ contentRem: 0, hasDeck: true }), true)
})

/** A non-compact narrow card was always meant to split; that behaviour is unchanged. */
test('the original non-compact behaviour is preserved exactly', () => {
  assert.equal(at({ compact: false, hasDeck: true, contentRem: 10 }), true)
  assert.equal(at({ compact: false, hasTier: true, contentRem: 10 }), true)
  assert.equal(at({ compact: false, hasDeck: true, hasTier: true, contentRem: 10 }), true)
})
