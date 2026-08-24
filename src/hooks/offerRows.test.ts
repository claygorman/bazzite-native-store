import assert from 'node:assert/strict'
import test from 'node:test'

import { offerRowsFor, offerRowWidths, type Offer } from './offerRows.ts'

/**
 * The offers block draws three kinds of row and three places used to work out which
 * was which, each with its own `bundleid !== undefined` filter. They agreed only while
 * there were two kinds. These pin the order and the widths against the markup, because
 * an offset row list is the kind of bug that opens A page — just not the right one.
 */
const demo = (appid: number): Offer => ({
  demoAppid: appid,
  name: 'Mortal Shell II - Open Beta',
  gameCount: 1,
  formattedFinalPrice: 'Free',
  items: [],
})

const bundle = (bundleid: number, itemCount: number): Offer => ({
  bundleid,
  name: `Bundle ${bundleid}`,
  gameCount: itemCount,
  items: Array.from({ length: itemCount }, (_, i) => ({
    appid: 1000 + i,
    name: `Game ${i}`,
    isSubject: false,
  })),
})

/** An edition — a package, not a bundle. It is NOT drawn as a row of its own. */
const edition = (packageid: number): Offer => ({
  packageid,
  name: `Edition ${packageid}`,
  gameCount: 1,
  items: [],
})

test('the subject leads, the demo follows, bundles come last', () => {
  const rows = offerRowsFor([bundle(7, 3), demo(4711740), bundle(8, 2)])
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['subject', 'demo', 'bundle', 'bundle'],
  )
  // Order within a kind is the order Steam gave, not re-sorted.
  assert.deepEqual(
    rows.flatMap((r) => (r.kind === 'bundle' ? [r.offer.bundleid] : [])),
    [7, 8],
  )
})

test('a game with no demo has no demo row', () => {
  assert.deepEqual(
    offerRowsFor([bundle(7, 3)]).map((r) => r.kind),
    ['subject', 'bundle'],
  )
})

/**
 * ⚠️ The case that motivated passing `demoAppid` past the early bail in `useOffers`:
 * a free or unreleased game has no purchase options at all, and is exactly the kind of
 * title most likely to be offering a demo.
 */
test('a demo alone still produces a block', () => {
  assert.deepEqual(
    offerRowsFor([demo(4711740)]).map((r) => r.kind),
    ['subject', 'demo'],
  )
})

/**
 * Editions arrive in `purchase_options` beside bundles and have never been drawn as
 * their own row — the subject row stands for them. Pinned so the demo's arrival does
 * not quietly promote them.
 */
test('an edition is not a row of its own', () => {
  assert.deepEqual(
    offerRowsFor([edition(99), bundle(7, 3)]).map((r) => r.kind),
    ['subject', 'bundle'],
  )
})

test('only a bundle has items the dpad can walk into', () => {
  // Subject 0, demo 0, bundles their own contents — index-for-index with the rows.
  assert.deepEqual(offerRowWidths([bundle(7, 3), demo(4711740), bundle(8, 2)]), [0, 0, 3, 2])
})

/**
 * The property the three old copies could not guarantee between them: whatever the mix
 * of offers, there is exactly one width per drawn row, in the same order.
 */
test('there is one width per row, always', () => {
  for (const offers of [
    [] as Offer[],
    [demo(1)],
    [bundle(7, 3)],
    [edition(99), demo(1), bundle(7, 3), bundle(8, 0)],
  ]) {
    assert.equal(offerRowWidths(offers).length, offerRowsFor(offers).length)
  }
})
