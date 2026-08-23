/**
 * Version comparison, alone in its own module so it can be tested.
 *
 * ⚠️ Nothing may be imported here. `updates.ts` statically imports `./index`, which
 * reaches Tauri through an extension-less specifier that Vite resolves and bare Node
 * does not — so a test importing `updates.ts` cannot run. Same reason `calendar.ts`
 * keeps its day maths free of the transport.
 */

/**
 * Is `candidate` newer than `installed`?
 *
 * ⚠️ Strictly greater, never "different". A dev build running ahead of the published
 * one must not be told to downgrade itself, and a feed that briefly serves an older
 * version during a botched publish must not trigger a badge.
 *
 * ⚠️ The pre-release suffix is CUT before splitting, and that is not tidiness. Splitting
 * `0.8.0-rc.1` on dots yields `['0','8','0-rc','1']`; `0-rc` parses to 0 and the `1`
 * becomes a fourth segment, so the release candidate compared NEWER than `0.8.0` and a
 * client on the release would have been offered a downgrade. Cutting at `-` (and `+`,
 * for build metadata) makes it compare equal to its own release, which is the intent.
 *
 * ⚠️ Not full semver. Two pre-releases of the same version compare equal to each other.
 * Releases here are plain `x.y.z`, and half a semver implementation is wrong in subtler
 * ways than an explicit simplification.
 */
export const isNewerVersion = (candidate: string, installed: string): boolean => {
  const parse = (v: string): number[] =>
    (v.split('-')[0] ?? '').split('+')[0]!.split('.').map((part) => {
      const n = Number.parseInt(part, 10)
      return Number.isFinite(n) ? n : 0
    })
  const a = parse(candidate)
  const b = parse(installed)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}
