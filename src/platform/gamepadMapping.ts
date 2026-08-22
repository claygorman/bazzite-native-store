/**
 * Pure gamepad-state resolution, kept free of DOM and module imports so it can be
 * tested directly (see src/platform/gamepadMapping.test.ts).
 */

export type InputAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'accept'
  | 'back'
  | 'search'
  | 'secondary'
  | 'shelfPrev'
  | 'shelfNext'
  | 'pagePrev'
  | 'pageNext'
  | 'menu'
  | 'hud'

/** Standard Gamepad API button indices -> our actions (Xbox layout names). */
export const BUTTON_MAP: Record<number, InputAction> = {
  0: 'accept', // A / Cross
  1: 'back', // B / Circle
  2: 'secondary', // X / Square — delete in search, sound on a trailer
  3: 'search', // Y / Triangle
  4: 'shelfPrev', // LB
  5: 'shelfNext', // RB
  6: 'pagePrev', // LT
  7: 'pageNext', // RT
  // ⚠️ View (⊟) is what the design reserves and asks to leave alone; the controller
  // HUD is a diagnostic overlay, which is the one thing a reserved button should hold.
  // It moved here so ☰ Start could take the Up menu.
  8: 'hud', // View / Select / Share
  9: 'menu', // Start — ☰, raises the Up menu from anywhere
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
}

/** Left stick is latched into dpad-style edges past this magnitude. */
export const STICK_DEADZONE = 0.5

/** The subset of a Gamepad this resolver needs — keeps the test free of DOM types. */
export type PadSnapshot = {
  buttons: ReadonlyArray<{ pressed: boolean }>
  axes: ReadonlyArray<number>
}

/**
 * Resolve every action's pressed-state for one frame.
 *
 * ⚠️ The dpad and the left stick both drive the same four directions, so their
 * contributions MUST be combined before anything is emitted. Emitting them as two
 * independent passes produces a press/release pair every frame on a held dpad
 * direction — the button pass says "pressed", the stick pass immediately says "not
 * pressed". Because a press fires its action instantly and a release cancels the
 * repeat timer, that turns one dpad tap into a 60fps run to the end of the shelf.
 */
export const resolveGamepadState = (
  pad: PadSnapshot | null,
  /**
   * The Controller page's "Left stick moves focus" row. Off, only the dpad drives —
   * which is what someone with a drifting stick wants, since a drifting stick under
   * this mapping walks the shelf on its own.
   */
  stickMovesFocus = true,
): Map<InputAction, boolean> => {
  const state = new Map<InputAction, boolean>()
  for (const action of Object.values(BUTTON_MAP)) state.set(action, false)
  if (!pad) return state

  const or = (action: InputAction, value: boolean) =>
    state.set(action, (state.get(action) ?? false) || value)

  for (const [index, action] of Object.entries(BUTTON_MAP)) {
    or(action, pad.buttons[Number(index)]?.pressed === true)
  }

  if (stickMovesFocus) {
    const [x = 0, y = 0] = pad.axes
    or('left', x < -STICK_DEADZONE)
    or('right', x > STICK_DEADZONE)
    or('up', y < -STICK_DEADZONE)
    or('down', y > STICK_DEADZONE)
  }

  return state
}
