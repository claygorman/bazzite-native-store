import assert from 'node:assert/strict'
import test from 'node:test'

import { distroOf, scopeToDistro } from './reportDistro.ts'
import type { ProtonReport } from './protonReports.ts'

const report = (os: string): ProtonReport =>
  ({ timestamp: 0, gpu: '', cpu: '', os, kernel: '', proton: '', variant: 'official', note: '' })

/**
 * ⚠️ **THE trap.** `sysinfo.rs` documents this machine's own `PRETTY_NAME` as
 * "Bazzite 44 (FROM Fedora Linux 44)" — it contains BOTH names, so a scan that tested
 * `fedora` first would call the box this app was written on Fedora and scope its reports
 * to a distro it is not.
 */
test('a derivative distro wins over the one it derives from', () => {
  assert.equal(distroOf('Bazzite 44 (FROM Fedora Linux 44)'), 'bazzite')
  assert.equal(distroOf('Fedora Linux 44 (Workstation Edition)'), 'fedora')
})

test('the distros the setting offers are each recognised', () => {
  assert.equal(distroOf('Linux Mint 22.3'), 'mint')
  assert.equal(distroOf('Ubuntu 24.04.1 LTS'), 'ubuntu')
  assert.equal(distroOf('Arch Linux'), 'arch')
})

test('a near-miss is not a match', () => {
  assert.equal(distroOf('Archcraft'), undefined, 'word boundary on arch')
  assert.equal(distroOf('SteamOS Holo'), undefined, 'Arch-based, but does not say so')
  assert.equal(distroOf(''), undefined)
  assert.equal(distroOf(undefined), undefined)
})

test('`any` is the off position and keeps every report', () => {
  const all = [report('Arch Linux'), report('Ubuntu 24.04')]
  const scoped = scopeToDistro(all, 'any', 'Bazzite 44')
  assert.equal(scoped.reports.length, 2)
  assert.equal(scoped.unscoped, 'off')
  assert.equal(scoped.applied, undefined)
})

test('`auto` reads the distro off this machine', () => {
  const all = [report('Bazzite 44'), report('Arch Linux'), report('Bazzite 43')]
  const scoped = scopeToDistro(all, 'auto', 'Bazzite 44 (FROM Fedora Linux 44)')
  assert.equal(scoped.applied, 'bazzite')
  assert.equal(scoped.reports.length, 2)
  assert.equal(scoped.unscoped, undefined)
})

/** ⚠️ `auto` and `any` are different. An unreadable host must not silently mean "off". */
test('`auto` on an unrecognisable host keeps everything and says why', () => {
  const all = [report('Arch Linux')]
  const scoped = scopeToDistro(all, 'auto', 'Slackware 15.0')
  assert.equal(scoped.reports.length, 1)
  assert.equal(scoped.unscoped, 'unknownHost')
})

test('a named distro is honoured whatever this machine runs', () => {
  const all = [report('Ubuntu 24.04'), report('Bazzite 44')]
  const scoped = scopeToDistro(all, 'ubuntu', 'Bazzite 44')
  assert.equal(scoped.applied, 'ubuntu')
  assert.deepEqual(scoped.reports.map((r) => r.os), ['Ubuntu 24.04'])
})

/**
 * ⚠️⚠️ **THE product rule.** Scoping must never manufacture silence: 23 reports becoming
 * "no reports" reads as *nobody has tried this game*, which is a claim about the GAME made
 * by the FILTER. Hand back everything and say why instead.
 */
test('scoping never turns a full report list into an empty one', () => {
  const all = [report('Ubuntu 24.04'), report('Arch Linux')]
  const scoped = scopeToDistro(all, 'bazzite', undefined)
  assert.equal(scoped.reports.length, 2, 'all of them, not none')
  assert.equal(scoped.unscoped, 'noReportsFromThere')
  assert.equal(scoped.applied, undefined, 'nothing was applied, so claim nothing')
})

test('a genuinely empty list stays empty and is not blamed on the filter', () => {
  const scoped = scopeToDistro([], 'bazzite', 'Bazzite 44')
  assert.deepEqual(scoped.reports, [])
  // Nothing was removed, because there was nothing to remove — the game has no reports.
  assert.equal(scoped.unscoped, 'noReportsFromThere')
})
