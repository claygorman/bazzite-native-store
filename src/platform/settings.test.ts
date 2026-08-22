import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SETTINGS,
  labelFor,
  mergeSettings,
  stepSetting,
  type Settings,
} from './settings.ts'
import { applyCompatFilter, compatFilterActive } from './compatFilter.ts'
import { glyphFor, setGlyphSet } from './glyphs.ts'
import type { StoreItem } from '../types/steam.ts'

/* ─────────────────────────── the stored file ─────────────────────────── */

test('a stored file degrades key by key, never wholesale', async (t) => {
  await t.test('an empty or absent file is the defaults', () => {
    assert.deepEqual(mergeSettings(undefined), DEFAULT_SETTINGS)
    assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS)
    assert.deepEqual(mergeSettings('{}'), DEFAULT_SETTINGS)
    assert.deepEqual(mergeSettings({}), DEFAULT_SETTINGS)
  })

  await t.test('known keys are taken, unknown keys are ignored', () => {
    const merged = mergeSettings({ uiScalePercent: 125, somethingRemovedInV2: true })
    assert.equal(merged.uiScalePercent, 125)
    assert.equal('somethingRemovedInV2' in merged, false)
  })

  /*
   * ⚠️ The reason this is not `{...DEFAULTS, ...stored}`. A hand-edited or corrupt
   * file must not be able to render the whole app at NaN — `uiScalePercent` multiplies
   * the root font size, so one bad value there is an app nobody can read or navigate
   * back out of.
   */
  await t.test('a value of the wrong type falls back alone', () => {
    const merged = mergeSettings({
      uiScalePercent: 'enormous',
      showClock: 'yes',
      region: 'GB',
    })
    assert.equal(merged.uiScalePercent, DEFAULT_SETTINGS.uiScalePercent)
    assert.equal(merged.showClock, DEFAULT_SETTINGS.showClock)
    assert.equal(merged.region, 'GB', 'the valid key beside it must survive')
  })

  await t.test('a non-finite number is refused', () => {
    // JSON cannot carry these, but a value that arrived some other way still can.
    assert.equal(mergeSettings({ uiScalePercent: NaN }).uiScalePercent, 100)
    assert.equal(mergeSettings({ trailerDelayMs: Infinity }).trailerDelayMs, 600)
  })
})

/* ─────────────────────────── steppers ─────────────────────────── */

test('a stepper clamps at both ends rather than wrapping', () => {
  // Wrapping would mean one more press on the last value silently returns to the
  // first — a press that looks like it undid four presses.
  assert.equal(stepSetting('uiScalePercent', 90, -1), 90)
  assert.equal(stepSetting('uiScalePercent', 150, 1), 150)
  assert.equal(stepSetting('uiScalePercent', 100, 1), 110)
  assert.equal(stepSetting('uiScalePercent', 110, -1), 100)
})

test('an unrecognised current value steps to the first, not nowhere', () => {
  // An old settings file, or a hand edit. `indexOf` gives -1, and -1 + 1 is 0.
  assert.equal(stepSetting('uiScalePercent', 137 as Settings['uiScalePercent'], 1), 90)
})

test('every stepper value renders as a phrase, never a bare number', () => {
  assert.equal(labelFor('safeAreaPercent', 0), 'None')
  assert.equal(labelFor('cacheLimitMb', 512), '512 MB')
  assert.equal(labelFor('cacheLimitMb', 2048), '2 GB')
  assert.equal(labelFor('region', 'GB'), 'United Kingdom')
  assert.equal(labelFor('deckFloor', 'all'), 'Show everything')
})

/* ─────────────────────────── the compatibility filter ─────────────────────────── */

const game = (name: string, extra: Partial<StoreItem> = {}): StoreItem => ({
  appid: name.length,
  name,
  capsuleUrl: '',
  discounted: false,
  discountPercent: 0,
  comingSoon: false,
  linuxAvailable: false,
  ...extra,
})

const CATALOGUE: StoreItem[] = [
  game('verified', { deckCompat: 'verified' }),
  game('playable', { deckCompat: 'playable' }),
  game('unsupported', { deckCompat: 'unsupported' }),
  game('unrated', { deckCompat: 'unknown' }),
  game('no-field'),
]

const names = (items: readonly StoreItem[]) => items.map((i) => i.name)

test('the floor hides everything below it', () => {
  const at = (deckFloor: Settings['deckFloor']) =>
    names(applyCompatFilter(CATALOGUE, { ...DEFAULT_SETTINGS, deckFloor }))

  assert.deepEqual(at('all'), ['verified', 'playable', 'unsupported', 'unrated', 'no-field'])
  assert.deepEqual(at('playable'), ['verified', 'playable', 'unrated', 'no-field'])
  assert.deepEqual(at('verified'), ['verified', 'unrated', 'no-field'])
})

/*
 * ⚠️ The single most important behaviour here. Valve has rated a small fraction of the
 * catalogue, so treating "no verdict" as "fails the bar" would empty most tags — a
 * floor of Verified would hide almost every indie game on Steam, including ones that
 * run perfectly. Absence of a verdict is absence of information.
 */
test('unrated is not below the floor unless someone says so', () => {
  const strict = applyCompatFilter(CATALOGUE, { ...DEFAULT_SETTINGS, deckFloor: 'verified' })
  assert.ok(names(strict).includes('unrated'))
  assert.ok(names(strict).includes('no-field'), 'a missing field is unrated, not unsupported')

  const hidden = applyCompatFilter(CATALOGUE, {
    ...DEFAULT_SETTINGS,
    deckFloor: 'verified',
    hideUnrated: true,
  })
  assert.deepEqual(names(hidden), ['verified'])
})

test('native-first partitions without re-sorting inside each group', () => {
  // Steam's own order inside each half is the answer to whatever question produced
  // the list; re-sorting across it would quietly replace that answer with ours.
  const list = [
    game('proton-a'),
    game('native-a', { linuxAvailable: true }),
    game('proton-b'),
    game('native-b', { linuxAvailable: true }),
  ]
  assert.deepEqual(
    names(applyCompatFilter(list, { ...DEFAULT_SETTINGS, nativeLinuxFirst: true })),
    ['native-a', 'native-b', 'proton-a', 'proton-b'],
  )
  assert.deepEqual(
    names(applyCompatFilter(list, DEFAULT_SETTINGS)),
    ['proton-a', 'native-a', 'proton-b', 'native-b'],
    'off, the order must be untouched',
  )
})

test('the defaults hide nothing at all', () => {
  assert.equal(compatFilterActive(DEFAULT_SETTINGS), false)
  assert.deepEqual(applyCompatFilter(CATALOGUE, DEFAULT_SETTINGS).length, CATALOGUE.length)
})

/* ─────────────────────────── glyph sets ─────────────────────────── */

test('a glyph set swaps face buttons by POSITION, not by letter', (t) => {
  t.after(() => setGlyphSet('xbox'))

  setGlyphSet('playstation')
  assert.equal(glyphFor('accept', 'gamepad').label, '✕')
  assert.equal(glyphFor('back', 'gamepad').label, '○')
  assert.equal(glyphFor('secondary', 'gamepad').label, '□')
  assert.equal(glyphFor('search', 'gamepad').label, '△')

  /*
   * ⚠️ Nintendo's A/B and X/Y are mirrored from Xbox in both axes. Mapping by LETTER
   * would put "press A to open" on the button that goes back — the single worst thing
   * a hint bar can do — so `accept` stays on the same physical button and `secondary`
   * lands on Y rather than X.
   */
  setGlyphSet('nintendo')
  assert.equal(glyphFor('accept', 'gamepad').label, 'A')
  assert.equal(glyphFor('back', 'gamepad').label, 'B')
  assert.equal(glyphFor('secondary', 'gamepad').label, 'Y')
  assert.equal(glyphFor('search', 'gamepad').label, 'X')
})

test('only face buttons change, and only for a gamepad', (t) => {
  t.after(() => setGlyphSet('xbox'))
  setGlyphSet('playstation')

  // The keyboard is not a PlayStation pad.
  assert.equal(glyphFor('accept', 'keyboard').label, 'Enter')
  assert.equal(glyphFor('back', 'keyboard').label, 'Esc')
  // Shoulders, triggers and the dpad are named the same on every pad worth supporting.
  assert.equal(glyphFor('shelfPrev', 'gamepad').label, 'LB')
  assert.equal(glyphFor('pageNext', 'gamepad').label, 'RT')
  assert.equal(glyphFor('up', 'gamepad').label, '▲')
})

/**
 * ⚠️ These disagreed for months: the tray drew `F1` while the key map bound `Tab`,
 * on a binding nobody had a reason to press. Both are `M` now, which is the design's
 * own keyboard map, and this asserts they stay together.
 */
test('the menu glyph names the key that is actually bound', () => {
  assert.equal(glyphFor('menu', 'keyboard').label, 'M')
  assert.equal(glyphFor('menu', 'gamepad').label, '☰')
})
