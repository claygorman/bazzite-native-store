/**
 * Regression test for the dpad/stick frame thrash.
 *
 * Run: node --experimental-strip-types src/platform/gamepadMapping.test.ts
 *
 * Symptom this guards against: a single dpad-right press walked the focus all the
 * way to the end of the shelf, while the keyboard behaved correctly. Cause was the
 * dpad and the left stick being emitted as two independent passes over the same
 * four directions, producing a press/release pair every frame.
 */

import { resolveGamepadState, type PadSnapshot } from './gamepadMapping.ts'

const pad = (pressedIndices: number[], axes: number[] = [0, 0, 0, 0]): PadSnapshot => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressedIndices.includes(i) })),
  axes,
})

let failures = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  )
}

// The bug: dpad held, stick centred. 'right' must stay true across every frame.
const heldDpadRight = [0, 1, 2].map(() => resolveGamepadState(pad([15])).get('right'))
check('held dpad-right stays pressed across frames', heldDpadRight, [true, true, true])

// Release must actually register.
check('released dpad-right reports false', resolveGamepadState(pad([])).get('right'), false)

// Stick alone still works.
check('stick right reports pressed', resolveGamepadState(pad([], [0.9, 0])).get('right'), true)

// Stick inside the deadzone must not trigger.
check('stick inside deadzone is idle', resolveGamepadState(pad([], [0.2, 0])).get('right'), false)

// Both at once is still one press, not a conflict.
check(
  'dpad + stick together stay pressed',
  resolveGamepadState(pad([15], [0.9, 0])).get('right'),
  true,
)

// Opposing sources: dpad right + stick left should leave both directions live
// rather than one silently cancelling the other.
const opposed = resolveGamepadState(pad([15], [-0.9, 0]))
check('opposed dpad/stick do not cancel', [opposed.get('right'), opposed.get('left')], [true, true])

// No pad connected: everything released, nothing left stuck down.
check('no pad releases everything', [...resolveGamepadState(null).values()].some(Boolean), false)

// Xbox face/shoulder mapping sanity.
check('button 0 is accept', resolveGamepadState(pad([0])).get('accept'), true)
check('button 2 is secondary', resolveGamepadState(pad([2])).get('secondary'), true)
check('button 3 is search', resolveGamepadState(pad([3])).get('search'), true)
check('button 4 is shelfPrev', resolveGamepadState(pad([4])).get('shelfPrev'), true)
check('button 7 is pageNext', resolveGamepadState(pad([7])).get('pageNext'), true)

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
