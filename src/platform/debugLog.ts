import { isTauri } from './index'

/**
 * The opt-in debug log — a file on disk you can read over SSH.
 *
 * ⚠️ It writes to a FILE rather than the console, and that is the point. In Game Mode the
 * app is launched by Steam as a non-Steam shortcut, so `console.log` and stdout go
 * somewhere nobody is watching — invisible exactly when the box is the only place a bug
 * reproduces. Several failures in this project were diagnosed by guesswork for want of it.
 *
 * ⚠️ Fire-and-forget, always. Nothing here may throw, block a request, or change what the
 * app does; the moment it runs is the moment something is already going wrong, and a
 * diagnostic that can fail the thing it is diagnosing is worse than none.
 */

let enabled = false

/** Mirror the setting into the Rust side, and return where it writes. */
export const setDebugLogging = async (on: boolean): Promise<string | undefined> => {
  enabled = on
  if (!isTauri()) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('debug_log_set', { enabled: on })
  } catch {
    return undefined
  }
}

export const debugLogPath = async (): Promise<string | undefined> => {
  if (!isTauri()) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('debug_log_path')
  } catch {
    return undefined
  }
}

/**
 * One line, timestamped.
 *
 * ⚠️ Checks `enabled` HERE as well as in Rust. The call is cheap but it is on the request
 * path, and an IPC round-trip per HTTP call while switched off would be a real cost for a
 * feature nobody has turned on.
 */
export const logDebug = (...parts: unknown[]): void => {
  if (!enabled) return
  const line = `${new Date().toISOString()} ${parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ')}`
  // Console too, which is what the browser dev build has instead of a file.
  console.debug('[bazzite-store]', line)
  if (!isTauri()) return
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('debug_log', { line }))
    .catch(() => undefined)
}
