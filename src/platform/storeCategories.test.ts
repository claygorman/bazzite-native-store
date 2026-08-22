import assert from 'node:assert/strict'
import { controllerSupportFrom, deckCompatFrom } from './storeCategories.ts'
import type { ControllerSupport, DeckCompat } from '../types/steam.ts'

/*
 * Fixtures are REAL, captured from the live batched GetItems response 2026-08-21 and
 * recorded in private/STEAM-ENDPOINTS.md.
 *
 * Two boundaries carry the whole test. Factorio's `18` arrives LAST, after four
 * unrelated input-config ids — reading ids[0], or assuming one element, gets both
 * partial-support titles wrong. And Counter-Strike 2 has NO key at all rather than an
 * empty array, so "absent" has to mean "none" rather than "missing field".
 */
const controllerCases: Array<[string, unknown, ControllerSupport]> = [
  ['Stardew Valley', { controller_categoryids: [28] }, 'full'],
  ['Cyberpunk 2077', { controller_categoryids: [28, 55, 57, 58] }, 'full'],
  ['Half-Life 2', { controller_categoryids: [28, 55, 56, 57, 58, 59] }, 'full'],
  ['Factorio — 18 last', { controller_categoryids: [55, 56, 57, 58, 18] }, 'partial'],
  ['RimWorld', { controller_categoryids: [18] }, 'partial'],
  ['both claimed, full wins', { controller_categoryids: [18, 28] }, 'full'],
  ['input-config ids alone', { controller_categoryids: [55, 56, 57, 58, 59] }, 'none'],
  ['Counter-Strike 2 — key absent', { supported_player_categoryids: [1, 27] }, 'none'],
  ['empty categories', {}, 'none'],
  ['not an object', undefined, 'none'],
]

/*
 * Three near-identical siblings live in the same object and disagree — Stardew Valley
 * is Deck 3 but SteamOS 2 — so the mixed case is the one that matters. Reading the
 * wrong field is a silent downgrade, not an error.
 */
const deckCases: Array<[string, unknown, DeckCompat]> = [
  ['unknown', { steam_deck_compat_category: 0 }, 'unknown'],
  ['unsupported', { steam_deck_compat_category: 1 }, 'unsupported'],
  ['Counter-Strike 2', { steam_deck_compat_category: 2 }, 'playable'],
  ['Stardew Valley', { steam_deck_compat_category: 3 }, 'verified'],
  [
    'siblings must not be read instead',
    {
      steam_os_compat_category: 2,
      steam_frame_compat_category: 0,
      steam_machine_compat_category: 3,
      steam_deck_compat_category: 3,
    },
    'verified',
  ],
  ['a category Valve has not shipped yet', { steam_deck_compat_category: 9 }, 'unknown'],
  ['a string where a number belongs', { steam_deck_compat_category: 'verified' }, 'unknown'],
  ['no platforms block', {}, 'unknown'],
  ['not an object', undefined, 'unknown'],
]

let failed = 0

console.log('controller support')
for (const [name, categories, expected] of controllerCases) {
  const actual = controllerSupportFrom(categories)
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expected.padEnd(7)} ${name}`)
}

console.log('\ndeck compatibility')
for (const [name, platforms, expected] of deckCases) {
  const actual = deckCompatFrom(platforms)
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expected.padEnd(11)} ${name}`)
}

assert.equal(failed, 0, `${failed} store-category cases failed`)
console.log('\nall passed')
