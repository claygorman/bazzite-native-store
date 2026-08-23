import { isTauri } from './index'

/**
 * The local ProtonDB report index — design turn 13a.
 *
 * ProtonDB open-sources every report it holds. The client downloads one cumulative
 * snapshot (~66 MB) and indexes it into SQLite, which is what makes a game's report
 * feed, its hardware match and the anti-cheat signal possible at all: the live API
 * serves one appid per request with no aggregation.
 *
 * ⚠️ The tier does NOT come from here and must not. Since February 2022 the dump
 * carries no tier field — ProtonDB derives it from the fault answers — and a
 * reconstruction agreed with them only 38% of the time, on well-reported games at
 * that. The live summaries endpoint stays the source of truth for any graded verdict.
 *
 * ⚠️ Every state below distinguishes "we have not asked" from "the answer is no".
 * That is turn 13's through-line: the first is a fact about this client, the second is
 * a claim about the game, and they never share a treatment.
 */

/** What the status card on Settings → Compatibility is showing. */
export type DumpPhase =
  'unavailable' | 'absent' | 'checking' | 'downloading' | 'indexing' | 'ready' | 'outdated'

export type DumpState = {
  phase: DumpPhase
  /** The snapshot we hold, as a date — never a filename. */
  snapshot?: string
  /** A newer published snapshot, when one exists. */
  latest?: string
  reports?: number
  games?: number
  /** Bytes downloaded so far, while `downloading`. */
  downloaded?: number
  /**
   * Total bytes, when the server said.
   *
   * ⚠️ Optional on purpose. GitHub's CDN sends `content-length`, but a missing one has
   * to render as indeterminate rather than as a division by zero — and 13a's bar is
   * only honest while it is backed by a real denominator.
   */
  total?: number
  error?: string
}

const invokeOr = async <T>(
  command: string,
  args: Record<string, unknown>,
  fallback: T,
): Promise<T> => {
  if (!isTauri()) return fallback
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<T>(command, args)) ?? fallback
  } catch {
    return fallback
  }
}

type StatusRaw = { ready?: boolean; snapshot?: string; publishedOn?: string; games?: number }

/**
 * What we already hold, without touching the network.
 *
 * ⚠️ In the browser build this is `unavailable`, and that is a different state from
 * `absent`. "This build cannot do it" and "you have not downloaded it yet" lead to
 * different sentences and different buttons — the browser has nothing to offer, so it
 * must not draw a Download button that cannot work.
 */
export const readDumpStatus = async (): Promise<DumpState> => {
  if (!isTauri()) return { phase: 'unavailable' }
  const raw = await invokeOr<StatusRaw>('proton_index_status', {}, {})
  if (raw.ready !== true) return { phase: 'absent' }
  return {
    phase: 'ready',
    snapshot: raw.publishedOn ?? raw.snapshot,
    games: raw.games,
  }
}

type CheckRaw = {
  installed?: string
  latest?: string
  updateAvailable?: boolean
  publishedOn?: string
}

/**
 * Ask GitHub which snapshot is current. A few KB, not 66 MB.
 *
 * ⚠️ Deliberately separate from `downloadDump`, and 13a keeps them as two buttons for
 * the same reason: one control whose meaning depends on hidden state is the thing you
 * can least afford at ten feet.
 */
export const checkForNewerSnapshot = async (
  timeoutMs: number,
): Promise<{ latest?: string; updateAvailable: boolean; error?: string }> => {
  if (!isTauri()) return { updateAvailable: false, error: 'Not available in the browser build' }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke<CheckRaw>('proton_check', { timeoutMs })
    return { latest: raw.publishedOn ?? raw.latest, updateAvailable: raw.updateAvailable === true }
  } catch (cause) {
    return { updateAvailable: false, error: String(cause) }
  }
}

/**
 * Fetch and index the newest snapshot, reporting download progress.
 *
 * ⚠️ `onProgress` fires only while BYTES are arriving. Indexing emits nothing, because
 * the parse is one pass with nothing meaningful to report from inside it — 13a says so
 * on screen rather than animating a bar that means nothing. Callers should move to
 * `indexing` when progress stops arriving at 100%, not invent a second bar.
 */
export const downloadDump = async (
  timeoutMs: number,
  onProgress: (downloaded: number, total?: number) => void,
): Promise<DumpState> => {
  if (!isTauri()) return { phase: 'unavailable' }
  try {
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ])
    const stop = await listen<{ downloaded: number; total: number | null }>(
      'protondb://progress',
      (event) => onProgress(event.payload.downloaded, event.payload.total ?? undefined),
    )
    try {
      const raw = await invoke<StatusRaw & { reports?: number }>('proton_refresh', { timeoutMs })
      return {
        phase: 'ready',
        snapshot: raw.publishedOn ?? raw.snapshot,
        games: raw.games,
        reports: raw.reports,
      }
    } finally {
      // ⚠️ Always unlisten. The listener outlives the command otherwise, and a second
      // download would then drive two progress handlers at once.
      stop()
    }
  } catch (cause) {
    return { phase: 'absent', error: String(cause) }
  }
}

/** `66 MB`, `41 of 66 MB` — 13a labels bytes, never raw counts. */
export const formatBytes = (bytes: number): string => {
  const mb = bytes / 1_048_576
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
