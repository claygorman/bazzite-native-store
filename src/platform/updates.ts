import { isTauri } from './index'
import type { UpdateChannel } from './settings'

/**
 * Client updates.
 *
 * ⭐ **Why this can be real on Bazzite.** The shipping route is an AppImage under
 * `~/.local/bin` (README §4) — the OS is immutable ostree, so there is no `rpm -i` and
 * no system package to bump. An AppImage is a single file the app can replace in
 * place, which is exactly the one Linux format `tauri-plugin-updater` can install
 * without elevation. A `.deb`/`.rpm` updater would need root and would be undone by
 * the next image rebase.
 *
 * ⚠️ **Two things this file cannot supply and must not pretend to.**
 *
 * 1. The **signing key**. Tauri verifies every downloaded artifact against a public
 *    key in `tauri.conf.json`; the private half signs the release. Generate it with
 *    `pnpm tauri signer generate` and keep the private half out of the repo.
 * 2. The **feed URL** — an HTTPS endpoint serving Tauri's `latest.json`. This repo is
 *    private, so anonymous GitHub releases are not it.
 *
 * Until both exist the state below is `unconfigured`, and the Updates page says so in
 * as many words. It does **not** say "Up to date", which is the tempting default and
 * is a lie: a client that has never asked cannot know.
 */

export type UpdateState =
  /** The browser build. There is no binary here to replace. */
  | { status: 'unsupported' }
  /** No feed URL or no public key. Says so rather than claiming to be current. */
  | { status: 'unconfigured' }
  /**
   * Installed as a Flatpak, where updates are the host's job.
   *
   * ⚠️ A distinct state rather than reusing `unconfigured`, because the two need
   * different sentences and different buttons. `unconfigured` means we could update and
   * nobody wired the feed; this means the client CANNOT update itself and should not
   * pretend otherwise — `/app` is read-only, so there is no file for the updater to
   * swap. Saying "up to date" here would be a lie, and offering Install would be a
   * button that fails every time.
   */
  | { status: 'managed' }
  | { status: 'idle' }
  | { status: 'checking' }
  /** Asked, and there is nothing newer. The only state that may claim currency. */
  | { status: 'current'; checkedAt: number }
  | { status: 'available'; version: string; notes?: string; date?: string; checkedAt: number }
  | { status: 'downloading'; version: string; percent?: number }
  /** Downloaded and verified; the binary swaps on relaunch. */
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string; checkedAt: number }

/**
 * ⚠️ The channel travels as a **header**, not as a second endpoint URL.
 *
 * Tauri's updater takes a fixed list of endpoints and walks it on *failure*, which is
 * a fallback mechanism, not a switch — pointing the second entry at a testing feed
 * would serve testing builds only when the stable feed was down. A header lets one
 * endpoint answer for both channels, which is also how the feed can guarantee a
 * testing build is never handed to someone who did not ask for one.
 */
const CHANNEL_HEADER = 'x-update-channel'

/** Whatever module Tauri's updater exposes, kept behind a narrow local shape. */
type TauriUpdate = {
  version: string
  date?: string
  body?: string
  downloadAndInstall: (
    onEvent?: (event: {
      event: string
      data?: { contentLength?: number; chunkLength?: number }
    }) => void,
  ) => Promise<void>
}

/**
 * Whether this process is running inside a Flatpak sandbox.
 *
 * ⚠️ Asked of Rust, not of the webview. A Tauri frontend has no Node, so the obvious
 * `process.env.FLATPAK_ID` check is not merely unavailable — it evaluates to `false`
 * everywhere and would quietly leave the Updates page offering an Install button that
 * can never work.
 */
export const isFlatpak = async (): Promise<boolean> => {
  if (!isTauri()) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<boolean>('is_flatpak')) === true
  } catch {
    return false
  }
}

/** True only when both a feed URL and a public key are configured. Read from Rust. */
export const updaterConfigured = async (): Promise<boolean> => {
  if (!isTauri()) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<boolean>('updater_configured')) === true
  } catch {
    return false
  }
}

export const checkForUpdate = async (channel: UpdateChannel): Promise<UpdateState> => {
  if (!isTauri()) return { status: 'unsupported' }
  // ⚠️ Before the feed check, not after. A Flatpak install has a perfectly valid feed
  // configured and still cannot use it, so asking "is it configured" first would answer
  // the wrong question and report `unconfigured`.
  if (await isFlatpak()) return { status: 'managed' }
  if (!(await updaterConfigured())) return { status: 'unconfigured' }

  const checkedAt = Date.now()
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = (await check({ headers: { [CHANNEL_HEADER]: channel } })) as TauriUpdate | null
    if (!update) return { status: 'current', checkedAt }
    return {
      status: 'available',
      version: update.version,
      notes: update.body,
      date: update.date,
      checkedAt,
    }
  } catch (err) {
    /*
     * ⚠️ Surfaced, not swallowed. Everywhere else in this app a failed request
     * degrades silently — a dead endpoint must never blank a shelf. This is the
     * opposite case: the page's entire job is to tell you whether the check worked,
     * so a silent failure would render as "we asked and you are current".
     */
    return { status: 'error', message: err instanceof Error ? err.message : String(err), checkedAt }
  }
}

/**
 * Download, verify and stage the update, reporting progress.
 *
 * ⚠️ The swap happens on relaunch, never mid-session. Replacing the running binary
 * under a live Game Mode session is how you get a store that half-restarts on a
 * television; `notifyBeforeRestart` exists so the relaunch is the user's press.
 */
export const installUpdate = async (
  channel: UpdateChannel,
  onProgress: (state: UpdateState) => void,
): Promise<UpdateState> => {
  if (!isTauri()) return { status: 'unsupported' }
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = (await check({ headers: { [CHANNEL_HEADER]: channel } })) as TauriUpdate | null
    if (!update) return { status: 'current', checkedAt: Date.now() }

    let total = 0
    let received = 0
    onProgress({ status: 'downloading', version: update.version })
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data?.contentLength ?? 0
      if (event.event === 'Progress') {
        received += event.data?.chunkLength ?? 0
        // No percent without a content length — a bar that invents its own progress
        // is worse than one that only says "downloading".
        onProgress({
          status: 'downloading',
          version: update.version,
          percent: total > 0 ? Math.round((received / total) * 100) : undefined,
        })
      }
    })
    return { status: 'ready', version: update.version }
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      checkedAt: Date.now(),
    }
  }
}

export const relaunchApp = async (): Promise<void> => {
  if (!isTauri()) return
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch {
    // Nothing sensible to do: the update is staged either way and will apply the next
    // time the app starts. Failing here must not lose that.
  }
}

/** One line for the status card and for the Up menu's badge. */
export const describeUpdate = (state: UpdateState): string => {
  switch (state.status) {
    case 'unsupported':
      return 'Not available in the browser build'
    case 'unconfigured':
      return 'Update feed not configured'
    case 'managed':
      return 'Managed by Flatpak · flatpak update'
    case 'idle':
      return 'Not checked yet'
    case 'checking':
      return 'Checking…'
    case 'current':
      return 'Up to date'
    case 'available':
      return `Update ready · ${state.version}`
    case 'downloading':
      return state.percent === undefined
        ? `Downloading ${state.version}…`
        : `Downloading ${state.version} · ${state.percent}%`
    case 'ready':
      return `${state.version} installs on restart`
    case 'error':
      return `Check failed · ${state.message}`
  }
}
