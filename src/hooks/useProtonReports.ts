import { useEffect, useState } from 'react'
import { readProtonReports, type ProtonReport } from '../platform/protonReports'
import { readDumpStatus, type DumpPhase } from '../platform/protonDump'

/**
 * The report feed for one game, plus WHY it is empty when it is.
 *
 * ⚠️ The phase is returned alongside the list, not derived from it, and that is the
 * whole reason this hook exists rather than a bare `readProtonReports` call. An empty
 * array has three completely different meanings — this build cannot read an archive,
 * you have not downloaded one, or we have one and this game is genuinely in nobody's
 * reports — and only the first two are facts about US. Collapsing them makes the tab
 * say something about the GAME that is actually true about the client.
 */
export type ProtonReportsState = {
  reports: ProtonReport[]
  /** `unavailable` in the browser, `absent` until the archive is fetched. */
  phase: DumpPhase
  loading: boolean
}

export const useProtonReports = (appid: number | undefined): ProtonReportsState => {
  const [state, setState] = useState<ProtonReportsState>({
    reports: [],
    phase: 'unavailable',
    loading: true,
  })

  useEffect(() => {
    let alive = true
    setState((prev) => ({ ...prev, loading: true }))
    if (appid === undefined) {
      setState({ reports: [], phase: 'unavailable', loading: false })
      return
    }

    void (async () => {
      // Status first: with no archive there is nothing to query, and asking anyway
      // would return an empty list that looks exactly like a game nobody reported.
      const status = await readDumpStatus()
      if (!alive) return
      if (status.phase !== 'ready') {
        setState({ reports: [], phase: status.phase, loading: false })
        return
      }
      const reports = await readProtonReports(appid)
      if (!alive) return
      setState({ reports, phase: 'ready', loading: false })
    })()

    return () => {
      alive = false
    }
  }, [appid])

  return state
}
