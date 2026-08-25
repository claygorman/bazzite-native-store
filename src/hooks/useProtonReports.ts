import { useEffect, useState } from 'react'
import { readProtonReports, type ProtonReport } from '../platform/protonReports'
import { readDumpStatus, type DumpPhase } from '../platform/protonDump'
import { scopeToDistro, type NamedDistro, type UnscopedReason } from '../platform/reportDistro'
import type { ReportDistro } from '../platform/settings'

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
  /** Already scoped to `distro` — see `scopeToDistro`. */
  reports: ProtonReport[]
  /** `unavailable` in the browser, `absent` until the archive is fetched. */
  phase: DumpPhase
  loading: boolean
  /**
   * Which distribution the list was narrowed to, and why it was not.
   *
   * ⚠️ Reported rather than inferred, for the same reason `phase` is: a caller cannot
   * tell a scoped list from an unscoped one by looking at it, and "these are Bazzite
   * reports" is a claim the UI must not make on its own.
   */
  distro?: NamedDistro
  unscoped?: UnscopedReason
}

export const useProtonReports = (
  appid: number | undefined,
  /** The `reportDistro` setting. `any` is off; `auto` reads `hostOs`. */
  distro: ReportDistro = 'any',
  /** This machine's `PRETTY_NAME`, for `auto`. */
  hostOs?: string,
): ProtonReportsState => {
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
      /*
       * ⚠️ Scoped HERE and not in the component, so every consumer of this hook gets the
       * same list. The details page, the hardware score and the outcome bars all read
       * `reports`, and three of them filtering separately is three chances to disagree
       * about what the user is looking at.
       */
      const scope = scopeToDistro(reports, distro, hostOs)
      setState({
        reports: scope.reports,
        phase: 'ready',
        loading: false,
        distro: scope.applied,
        unscoped: scope.unscoped,
      })
    })()

    return () => {
      alive = false
    }
  }, [appid, distro, hostOs])

  return state
}
