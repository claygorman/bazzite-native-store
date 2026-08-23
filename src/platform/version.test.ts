import assert from 'node:assert/strict'
import test from 'node:test'

import { isNewerVersion } from './version.ts'

test('a newer published version is offered', () => {
  assert.equal(isNewerVersion('0.8.0', '0.7.0'), true)
  assert.equal(isNewerVersion('0.7.1', '0.7.0'), true)
  assert.equal(isNewerVersion('1.0.0', '0.9.9'), true)
})

test('the same version is not an update', () => {
  assert.equal(isNewerVersion('0.7.0', '0.7.0'), false)
})

/**
 * ⚠️ The property that keeps a dev build from being told to downgrade, and keeps a
 * botched publish serving an older version from raising a badge. "Different" would
 * have been the easy implementation and is wrong in both cases.
 */
test('an older published version is never offered', () => {
  assert.equal(isNewerVersion('0.6.1', '0.7.0'), false)
  assert.equal(isNewerVersion('0.9.9', '1.0.0'), false)
})

test('segment counts need not match', () => {
  assert.equal(isNewerVersion('0.7', '0.7.0'), false)
  assert.equal(isNewerVersion('0.7.0.1', '0.7.0'), true)
})

/** 10 > 9 numerically, but "10" < "9" as strings — the classic way to get this wrong. */
test('segments compare as numbers, not as text', () => {
  assert.equal(isNewerVersion('0.10.0', '0.9.0'), true)
  assert.equal(isNewerVersion('0.9.0', '0.10.0'), false)
})

test('unparseable segments degrade to zero rather than NaN', () => {
  assert.equal(isNewerVersion('0.8.0-rc.1', '0.8.0'), false)
  assert.equal(isNewerVersion('', '0.0.0'), false)
})
