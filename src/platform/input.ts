import { isTauri } from './index'
import { resolveGamepadState, type InputAction } from './gamepadMapping'

/**
 * Unified controller input.
 *
 * Both backends emit RAW EDGES ONLY (pressed true / false). Repeat rate, initial
 * delay and hold-to-scroll live in one shared place (src/hooks/useInputActions.ts)
 * so that input feel tuned in a browser tab is the same feel you get on the couch.
 * If repeat lived in Rust, the two would silently diverge and only one of them
 * would be the one users actually run.
 *
 * On the real target, gamepad state is read in Rust with `gilrs` — NOT the browser
 * Gamepad API, which is unreliable under WebKitGTK (README §2). The browser path
 * below exists for desktop development only, where Chrome's implementation is fine.
 */

export type { InputAction } from './gamepadMapping'

export type InputEvent = {
  action: InputAction
  pressed: boolean
  source: 'gamepad' | 'keyboard'
}

export type InputListener = (event: InputEvent) => void

/**
 * Text capture, for screens where a real keyboard should TYPE rather than act.
 *
 * ⚠️ Without this, letter bindings actively sabotage typing: `q`/`e` jump shelves,
 * `1`/`3` page, `x` deletes and `y` opens search — so typing "quest" on the search
 * screen fires four navigation actions and spells nothing. The action map has to be
 * bypassed for printable keys while text entry is live, not merely supplemented.
 *
 * The handler returns true when it consumed the event; only then is action mapping
 * skipped. That keeps arrows, Enter and Escape working as navigation while typing.
 */
export type TextHandler = (event: KeyboardEvent) => boolean

/**
 * A key text capture would treat as typing: one printable character, no command
 * modifier. Ctrl/Cmd combinations stay available as shortcuts.
 */
export const isTypedKey = (e: KeyboardEvent): boolean =>
  e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

let textHandler: TextHandler | null = null
let captureListener: ((e: KeyboardEvent) => void) | null = null

/**
 * Pass null to release capture. Set from the screen that wants typing.
 *
 * ⚠️ This installs exactly ONE window listener, in the CAPTURE phase, rather than
 * being consulted from inside each keyboard subscription. Several hooks subscribe to
 * input at once (the action loop, the debug HUD, the device tracker), so a
 * per-subscription check ran the handler once per subscriber and every keystroke
 * arrived four times over. One listener, and `stopImmediatePropagation` keeps the
 * consumed key away from the action mapping entirely.
 */
export const setTextCapture = (handler: TextHandler | null): void => {
  textHandler = handler

  if (captureListener) {
    window.removeEventListener('keydown', captureListener, true)
    captureListener = null
  }
  if (!handler) return

  captureListener = (event: KeyboardEvent) => {
    if (event.repeat) {
      // The OS repeats held keys; let it, but do not let it reach the action map.
      if (isTypedKey(event) || event.key === 'Backspace') {
        handler(event)
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      return
    }
    if (!handler(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  window.addEventListener('keydown', captureListener, true)
}

/** Keyboard equivalents are the ones the design names: Q/E shoulders, 1/3 triggers. */
const KEY_MAP: Record<string, InputAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'accept',
  ' ': 'accept',
  Escape: 'back',
  Backspace: 'back',
  q: 'shelfPrev',
  e: 'shelfNext',
  '1': 'pagePrev',
  '3': 'pageNext',
  y: 'search',
  x: 'secondary',
  // ⚠️ `m`, matching the glyph the tray draws. This was `Tab` against a glyph that
  // said `F1`; the design's keyboard map names M for ☰, so both are M now.
  m: 'menu',
  F2: 'hud',
}

/**
 * The one setting the raw input layer needs.
 *
 * ⚠️ Module-level rather than a subscription argument, because the poll loop is
 * started once and must not be torn down and rebuilt when a setting changes — every
 * held key's edge state lives in that closure, so restarting it mid-hold leaves an
 * action latched down forever. Written by `useSettings`, read every frame.
 */
const inputPolicy = { stickMovesFocus: true }

export const setStickMovesFocus = (enabled: boolean): void => {
  inputPolicy.stickMovesFocus = enabled
}

/** Shared edge-detector: swallows repeats so listeners only ever see transitions. */
const makeEmitter = (listener: InputListener) => {
  const held = new Set<InputAction>()
  return (action: InputAction, pressed: boolean, source: InputEvent['source']) => {
    if (pressed === held.has(action)) return
    if (pressed) held.add(action)
    else held.delete(action)
    listener({ action, pressed, source })
  }
}

const subscribeKeyboard = (listener: InputListener): (() => void) => {
  const emit = makeEmitter(listener)

  const onKeyDown = (e: KeyboardEvent) => {
    // Belt and braces. The capture listener normally stops these before they get
    // here, but stopImmediatePropagation only beats same-node listeners when the
    // event actually traverses the capture phase first — for an event dispatched
    // ON window, capture and bubble listeners fire in REGISTRATION order instead.
    // Checking here makes the outcome independent of listener order, so Backspace
    // cannot both delete a character and navigate back.
    if (textHandler && (isTypedKey(e) || e.key === 'Backspace')) return
    const action = KEY_MAP[e.key] ?? KEY_MAP[e.key.toLowerCase()]
    if (!action) return
    e.preventDefault()
    // The OS auto-repeats held keys; ignore those or we would repeat twice, at two
    // different rates, and never match the pad's feel.
    if (e.repeat) return
    emit(action, true, 'keyboard')
  }

  const onKeyUp = (e: KeyboardEvent) => {
    // A key consumed on the way down must not emit a release on the way up, or the
    // repeat timer for an action never fired is left to clear.
    if (textHandler && isTypedKey(e)) return
    const action = KEY_MAP[e.key] ?? KEY_MAP[e.key.toLowerCase()]
    if (!action) return
    e.preventDefault()
    emit(action, false, 'keyboard')
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}

/** Browser Gamepad API polling. Development only — never used in the Tauri build. */
const subscribeGamepadWeb = (listener: InputListener): (() => void) => {
  const emit = makeEmitter(listener)
  let frame = 0

  const poll = () => {
    frame = requestAnimationFrame(poll)
    // getGamepads() returns a live snapshot; it must be re-read every frame.
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p !== null) ?? null
    for (const [action, pressed] of resolveGamepadState(pad, inputPolicy.stickMovesFocus)) {
      emit(action, pressed, 'gamepad')
    }
  }

  frame = requestAnimationFrame(poll)
  return () => cancelAnimationFrame(frame)
}

const subscribeWeb = (listener: InputListener): (() => void) => {
  const stopKeys = subscribeKeyboard(listener)
  const stopPads = subscribeGamepadWeb(listener)
  return () => {
    stopKeys()
    stopPads()
  }
}

const subscribeTauri = (listener: InputListener): (() => void) => {
  let unlisten: (() => void) | undefined
  let cancelled = false

  void (async () => {
    const { listen } = await import('@tauri-apps/api/event')
    const stop = await listen<{ action: InputAction; pressed: boolean }>(
      'input://action',
      (event) => listener({ ...event.payload, source: 'gamepad' }),
    )
    if (cancelled) stop()
    else unlisten = stop
  })()

  // Keyboard stays live here too: it costs nothing and keeps the app drivable over
  // SSH when Steam Input has not handed us a usable pad (private/BAZZITE-NOTES.md §1).
  // The browser gamepad poll is deliberately NOT started — gilrs is the only pad
  // source in this build.
  const stopKeys = subscribeKeyboard(listener)

  return () => {
    cancelled = true
    unlisten?.()
    stopKeys()
  }
}

export const subscribeInput = (listener: InputListener): (() => void) =>
  isTauri() ? subscribeTauri(listener) : subscribeWeb(listener)
