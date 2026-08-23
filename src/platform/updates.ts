import { isTauri } from './index'
import type { UpdateChannel } from './settings'
import { isNewerVersion } from './version.ts'

/**
 * The running build's version.
 *
 * ⚠️ Wrapped rather than referenced inline: `__APP_VERSION__` is a Vite `define`, so it
 * does not exist under bare Node — and `updates.test.ts` runs there.
 */
const installedVersion = (): string =>
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

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
  /**
   * A Flatpak that CAN update itself, asked, and was told nothing.
   *
   * ⚠️ Deliberately not `current`. The portal's monitor announces updates; there is no
   * "you are up to date" signal and no way to make it check on demand — so silence
   * means "nothing was announced", which covers both "there is nothing" and "it has
   * not looked yet". Only `current` may claim currency, and this cannot.
   */
  | { status: 'unannounced'; checkedAt: number }
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
/**
 * What the Flatpak build can do about updating itself.
 *
 * `portalVersion` is `null` when `org.freedesktop.portal.Flatpak` is not on the
 * session bus at all — an old host, or a sandbox without portals. That is a different
 * sentence from "the portal said nothing", so the two are kept apart here rather than
 * collapsed into a boolean.
 */
/**
 * How often the app re-asks the remote whether it is out of date.
 *
 * ⚠️ This is a VERSION-FEED poll, not a portal check. The portal's monitor announces on
 * its own schedule and offers no way to ask it now, so it cannot answer "am I current"
 * on demand — and it never announces the negative, so it can never confirm that you
 * ARE current. Comparing two version strings does both, immediately.
 */
export const UPDATE_POLL_MS = 15 * 60_000

/** The newest version the published remote advertises, or `undefined` if unreachable. */
export const publishedVersion = async (): Promise<string | undefined> => {
  if (!isTauri()) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<string | null>('published_version')) ?? undefined
  } catch {
    return undefined
  }
}

export const flatpakUpdateSupport = async (): Promise<{
  sandboxed: boolean
  portalVersion: number | null
}> => {
  if (!isTauri()) return { sandboxed: false, portalVersion: null }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke<{ sandboxed: boolean; portalVersion: number | null }>(
      'flatpak_update_supported',
    )
    return { sandboxed: raw.sandboxed === true, portalVersion: raw.portalVersion ?? null }
  } catch {
    return { sandboxed: false, portalVersion: null }
  }
}

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
  if (await isFlatpak()) {
    /*
     * ⚠️ The portal, NOT `tauri-plugin-updater`, and not `flatpak-spawn --host`.
     * `/app` is read-only so there is nothing for the plugin to swap, and spawning
     * would need a manifest permission that lets the sandbox run any host command.
     * `CreateUpdateMonitor` is bound to this app's own ref — updating anything else is
     * not expressible. See src-tauri/src/flatpakupdate.rs.
     */
    const support = await flatpakUpdateSupport()
    // No portal: nothing this app can do, so say so and name what does work.
    if (support.portalVersion === null) return { status: 'managed' }
    const checkedAt = Date.now()

    /*
     * The version feed FIRST, and the portal only as a fallback. The feed is a plain
     * comparison of two strings, so it answers immediately and — unlike the monitor —
     * can honestly report `current`. The portal is what INSTALLS; asking it whether an
     * update exists means waiting on a signal that may simply not come yet.
     */
    const published = await publishedVersion()
    if (published !== undefined) {
      return isNewerVersion(published, installedVersion())
        ? { status: 'available', version: published, checkedAt }
        : { status: 'current', checkedAt }
    }

    // Feed unreachable — offline, or Pages is down. Ask the monitor instead, which may
    // already know from an earlier poll.
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const commit = await invoke<string | null>('flatpak_update_check')
      // ⚠️ A commit, not a version — the portal deals in ostree commits and does not
      // know what we call this build. Short-form so it fits a card at ten feet.
      if (!commit) return { status: 'unannounced', checkedAt }
      return { status: 'available', version: commit.slice(0, 7), checkedAt }
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        checkedAt,
      }
    }
  }
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

  if (await isFlatpak()) {
    /*
     * ⚠️ No progress percentage here, and that is not laziness. The portal reports
     * progress as an operation COUNT plus a per-operation percent, which does not
     * compose into one honest bar — and a bar that invents its own number is worse
     * than a spinner, the same rule the download branch below already follows.
     */
    onProgress({ status: 'downloading', version: 'the new build' })
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('flatpak_update_install')
      // ⚠️ The running deployment stays mounted, so nothing has changed under this
      // process. `ready` is the honest state: it applies on restart.
      return { status: 'ready', version: 'the new build' }
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now(),
      }
    }
  }

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
    case 'unannounced':
      // ⚠️ Not "Up to date". Nothing confirmed that; see the state's own comment.
      return 'No update waiting'
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

export { isNewerVersion }
