import { useCallback, useEffect, useRef, useState } from 'react'
import {
  checkForNewerSnapshot,
  downloadDump,
  readDumpStatus,
  type DumpState,
} from '../platform/protonDump'
import { useSetting } from './useSettings'

/**
 * The ProtonDB snapshot's six states — design turn 13a.
 *
 * ⚠️ The whole point of the shape is that "we have not asked" and "the answer is no"
 * never share a treatment. `unavailable` (this build cannot), `absent` (you have not
 * fetched it) and `ready` with zero reports for a game are three different sentences,
 * and collapsing any two of them makes the client claim something about the GAME that
 * is actually true about ITSELF.
 *
 * ⚠️ Nothing here downloads on its own, ever. 66 MB on a metered connection, unasked,
 * on a machine whose whole point is playing games, is not a decision this code gets to
 * make. `check` is separate and costs a few KB — that separation is why 13a draws two
 * buttons rather than one that changes meaning.
 */
export const useProtonDump = (): {
  state: DumpState
  check: () => void
  download: () => void
  busy: boolean
} => {
  const [state, setState] = useState<DumpState>({ phase: 'unavailable' })
  const timeoutMs = useSetting('requestTimeoutMs')
  // ⚠️ Guards against a second run while one is in flight. Two concurrent imports would
  // both write the same table, and the loser's transaction rolls back — wasting a 66 MB
  // download rather than corrupting anything, but wasting it silently.
  const running = useRef(false)

  useEffect(() => {
    let alive = true
    void readDumpStatus().then((next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
    }
  }, [])

  const check = useCallback(() => {
    if (running.current) return
    running.current = true
    setState((prev) => ({ ...prev, phase: 'checking' }))
    void checkForNewerSnapshot(timeoutMs)
      .then(async (result) => {
        const held = await readDumpStatus()
        setState({
          ...held,
          latest: result.latest,
          error: result.error,
          // ⚠️ A newer snapshot is not a problem. `outdated` exists so 13a can say
          // "your snapshot still works — fetching is a choice, not a repair", which is
          // only true if we never dress it as an error.
          phase: result.updateAvailable ? 'outdated' : held.phase,
        })
      })
      .finally(() => {
        running.current = false
      })
  }, [timeoutMs])

  const download = useCallback(() => {
    if (running.current) return
    running.current = true
    setState((prev) => ({ ...prev, phase: 'downloading', downloaded: 0, error: undefined }))
    void downloadDump(
      // ⚠️ NOT the Network page's request timeout. That is tuned for a JSON endpoint
      // answering in milliseconds; applying it to a 66 MB body aborts every attempt.
      // The Rust side clamps this to a floor of its own, so this is a hint.
      600_000,
      (downloaded, total) => {
        setState((prev) =>
          prev.phase === 'downloading' || prev.phase === 'indexing'
            ? {
                ...prev,
                downloaded,
                total,
                // Progress stops arriving once the body is complete, and the parse
                // reports nothing from inside itself. Crossing to `indexing` at 100% is
                // what lets 13a say "there is no progress to report" honestly rather
                // than animating a second bar that means nothing.
                phase: total !== undefined && downloaded >= total ? 'indexing' : 'downloading',
              }
            : prev,
        )
      },
    )
      .then(setState)
      .finally(() => {
        running.current = false
      })
  }, [])

  return {
    state,
    check,
    download,
    busy: state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'indexing',
  }
}
