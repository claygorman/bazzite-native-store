import type { InputAction } from './gamepadMapping'
import type { GlyphSet } from './settings'

/**
 * How each action is *presented*, per input device.
 *
 * Prompts must name the button the user is actually holding. Telling someone at a
 * keyboard to "press A" is wrong twice over — there is an A key, and it does
 * nothing. Games switch prompt glyphs on the last-used device for exactly this
 * reason, and on a box that is driven by both a pad and a keyboard over SSH it
 * matters more than usual.
 *
 * `round` renders as a face button (A/B/X/Y). `key` renders as a keycap, which is
 * the right shape for shoulders, triggers and every keyboard binding.
 */
export type InputSource = 'gamepad' | 'keyboard'
export type Glyph = { label: string; shape: 'round' | 'key' }

const round = (label: string): Glyph => ({ label, shape: 'round' })
const key = (label: string): Glyph => ({ label, shape: 'key' })

/** Keep in step with KEY_MAP in input.ts and action_for() in src-tauri/src/input.rs. */
const GLYPHS: Record<InputAction, Record<InputSource, Glyph>> = {
  accept: { gamepad: round('A'), keyboard: key('Enter') },
  back: { gamepad: round('B'), keyboard: key('Esc') },
  search: { gamepad: round('Y'), keyboard: key('Y') },
  secondary: { gamepad: round('X'), keyboard: key('X') },
  shelfPrev: { gamepad: key('LB'), keyboard: key('Q') },
  shelfNext: { gamepad: key('RB'), keyboard: key('E') },
  pagePrev: { gamepad: key('LT'), keyboard: key('1') },
  pageNext: { gamepad: key('RT'), keyboard: key('3') },
  /*
   * ⚠️ `M`, matching what `input.ts` actually binds.
   *
   * This said `F1` while the key map bound `Tab` — a disagreement nobody caught
   * because the tray never showed it on a screen where anyone pressed it. The design's
   * own keyboard map names `M` for ☰, so both moved there together.
   */
  menu: { gamepad: key('☰'), keyboard: key('M') },
  /*
   * ⚠️ The design reserves ⊟ View and asks that it stay unassigned. The controller HUD
   * is a diagnostic overlay rather than a product surface, which is exactly the kind
   * of thing a reserved button is for — and it had to move off ☰, which now raises
   * the Up menu.
   */
  hud: { gamepad: key('⊟'), keyboard: key('F2') },
  up: { gamepad: key('▲'), keyboard: key('↑') },
  down: { gamepad: key('▼'), keyboard: key('↓') },
  left: { gamepad: key('◀'), keyboard: key('←') },
  right: { gamepad: key('▶'), keyboard: key('→') },
}

/**
 * The four face buttons, per pad family.
 *
 * ⚠️ **Position, not letter.** A PlayStation pad's ✕ is where an Xbox pad's A is, so
 * `accept` maps to ✕ — but a Nintendo pad's A and B are *swapped* relative to Xbox,
 * and its B is the cancel button in the same physical spot as Xbox's B. Mapping by
 * letter would put "press A to open" on the button that goes back, which is the single
 * worst thing a hint bar can do.
 *
 * Only the face buttons change. Shoulders, triggers and the dpad are named the same on
 * every pad worth supporting, and Steam Deck differs from Xbox only in that its ☰/⊟
 * are drawn rather than lettered — which is what `menu`/`hud` already use.
 */
const FACE_BUTTONS: Record<GlyphSet, Record<'accept' | 'back' | 'search' | 'secondary', string>> = {
  xbox: { accept: 'A', back: 'B', search: 'Y', secondary: 'X' },
  playstation: { accept: '✕', back: '○', search: '△', secondary: '□' },
  // Nintendo: A/B and X/Y are mirrored from the Xbox layout in both axes.
  nintendo: { accept: 'A', back: 'B', search: 'X', secondary: 'Y' },
  deck: { accept: 'A', back: 'B', search: 'Y', secondary: 'X' },
}

/**
 * ⚠️ Module-level rather than threaded through props, and it is the same trade as
 * `STORE_LOCALE`. `glyphFor` is called from roughly thirty places, none of which have
 * any other reason to know about settings; passing a glyph set to all of them would be
 * thirty parameters that never vary within a render. Set once from `useSettings`.
 */
let glyphSet: GlyphSet = 'xbox'

export const setGlyphSet = (next: GlyphSet): void => {
  glyphSet = next
}

/** Read by `ControllerGlyph`, which colours the face buttons only on the Xbox set. */
export const currentGlyphSet = (): GlyphSet => glyphSet

export const glyphFor = (action: InputAction, source: InputSource): Glyph => {
  const glyph = GLYPHS[action][source]
  if (source !== 'gamepad' || glyph.shape !== 'round') return glyph
  const face = FACE_BUTTONS[glyphSet][action as 'accept' | 'back' | 'search' | 'secondary']
  return face === undefined ? glyph : round(face)
}

/** "Dpad" vs "Arrows" — used where a prompt refers to direction as a whole. */
export const directionalName = (source: InputSource): string =>
  source === 'gamepad' ? 'Dpad' : 'Arrows'
