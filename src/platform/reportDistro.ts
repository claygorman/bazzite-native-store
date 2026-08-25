/**
 * Scoping ProtonDB reports to one distribution — what the `reportDistro` setting does.
 *
 * ⚠️ **This row shipped as a control that read nothing.** It rendered, it stepped through
 * seven values, it persisted, and no code anywhere consulted it. The project's rule is that
 * a switch which changes nothing is indistinguishable from a broken one at ten feet, and
 * the data was there the whole time: `reports.os` has been on every report since the
 * archive landed.
 */

import type { ProtonReport } from './protonReports'
import type { ReportDistro } from './settings'

/** The settings values that name an actual distribution. `auto` and `any` do not. */
export type NamedDistro = Exclude<ReportDistro, 'auto' | 'any'>

/**
 * ⚠️ **Ordered most-specific first, and the order is the whole point.** `sysinfo.rs`
 * documents this machine's own `PRETTY_NAME` as:
 *
 *     "Bazzite 44 (FROM Fedora Linux 44)"
 *
 * which contains BOTH names. A naive scan that happened to test `fedora` first would
 * report the box this app was written on as Fedora, scope its reports to a distro it is
 * not, and be wrong in a way nobody would ever think to check. Derivative distros go above
 * the distro they derive from, always.
 *
 * ⚠️ Word boundaries on `arch`, so "Archcraft" and "architecture" are not Arch Linux.
 */
const MATCHERS: readonly (readonly [NamedDistro, RegExp])[] = [
  ['bazzite', /bazzite/i],
  ['mint', /\bmint\b/i],
  ['fedora', /fedora/i],
  ['ubuntu', /ubuntu/i],
  ['arch', /\barch\b/i],
]

/** Which distribution an os-release string names, if it names one this app knows. */
export const distroOf = (os: string | undefined): NamedDistro | undefined =>
  os === undefined ? undefined : MATCHERS.find(([, pattern]) => pattern.test(os))?.[0]

/**
 * How a distribution is named in the interface.
 *
 * ⚠️ Its own map rather than reaching for `REPORT_DISTRO_NAMES` in `settings.ts`: that one
 * also has to name `auto` ("This machine") and `any` ("Any distro"), which are settings
 * values and not distributions. A list scoped to `auto` is scoped to *Bazzite*, and saying
 * "This machine reporters" would be nonsense.
 */
export const DISTRO_LABEL: Record<NamedDistro, string> = {
  bazzite: 'Bazzite',
  arch: 'Arch',
  fedora: 'Fedora',
  ubuntu: 'Ubuntu',
  mint: 'Linux Mint',
}

/** Why a report list came back unscoped. */
export type UnscopedReason =
  /** The setting is `any` — the user asked for every distro. */
  | 'off'
  /** `auto`, but this machine's os-release named nothing recognisable. */
  | 'unknownHost'
  /** We know the distro and nobody has reported this game from it. */
  | 'noReportsFromThere'

export type DistroScope = {
  reports: ProtonReport[]
  /** The distribution actually applied. `undefined` whenever `unscoped` is set. */
  applied?: NamedDistro
  unscoped?: UnscopedReason
}

/**
 * Narrow a game's reports to one distribution.
 *
 * ⚠️⚠️ **Never returns an empty list when an unfiltered one exists.** If scoping would
 * remove every report, this hands back all of them and says `noReportsFromThere` instead.
 * Twenty-three reports becoming "no reports" reads as *nobody has tried this game* — a
 * statement about the GAME that is actually a statement about the FILTER, which is the
 * exact failure the `useProtonReports` phase exists to prevent one layer up. A preference
 * about whose reports to prefer must never be able to manufacture silence.
 *
 * ⚠️ `auto` is "read it off this machine", NOT "no answer" — and it is different from
 * `any`. Collapsing them would silently narrow the report set on a distro nobody else
 * reports from, which is precisely where the archive is most useful.
 */
export const scopeToDistro = (
  reports: readonly ProtonReport[],
  setting: ReportDistro,
  hostOs: string | undefined,
): DistroScope => {
  const all = [...reports]
  if (setting === 'any') return { reports: all, unscoped: 'off' }

  const wanted = setting === 'auto' ? distroOf(hostOs) : setting
  if (wanted === undefined) return { reports: all, unscoped: 'unknownHost' }

  const matching = all.filter((report) => distroOf(report.os) === wanted)
  if (matching.length === 0) {
    return { reports: all, applied: undefined, unscoped: 'noReportsFromThere' }
  }
  return { reports: matching, applied: wanted }
}
