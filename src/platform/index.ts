/**
 * Runtime detection.
 *
 * The app runs in two places: a Tauri webview (the real target) and a plain browser
 * tab via `pnpm dev` (fast iteration, works on any machine). Everything that differs
 * between them lives behind the two facades in this directory — `steam.ts` for data,
 * `input.ts` for controllers. Nothing else in the app should branch on platform.
 */

/** Tauri v2 sets this on the window object before any frontend code runs. */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const platformName = (): 'tauri' | 'web' => (isTauri() ? 'tauri' : 'web')
