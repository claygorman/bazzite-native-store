import { isTauri } from './index'

/**
 * What the machine is, for the status card at the top of every settings page.
 *
 * > Every page answers a status question before it offers a control. From ten feet
 * > away, that card is often the whole reason someone came here, and they leave
 * > without touching a row.
 *
 * ⚠️ Which is exactly why nothing in here is invented. The artboards fill those cards
 * with convincing constants — `Radeon 780M`, `6.14.9-201.bazzite.fc42`, `78%` battery
 * — and a plausible wrong number on a diagnostics screen is worse than a blank,
 * because the whole point of the card is that you can trust it without checking.
 * Every field below is read from the machine, and anything unreadable is `undefined`
 * and simply does not render.
 */

export type HostInfo = {
  os?: string
  /** ostree image version on an atomic desktop — Bazzite's `VERSION_ID`. */
  image?: string
  kernel?: string
  cpu?: string
  gpu?: string
  memoryGb?: number
}

const invokeOr = async <T>(command: string, fallback: T): Promise<T> => {
  if (!isTauri()) return fallback
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<T>(command)) ?? fallback
  } catch {
    return fallback
  }
}

/** Empty in the browser and on any host whose files we cannot read. */
export const loadHostInfo = async (): Promise<HostInfo> => {
  const raw = await invokeOr<Record<string, unknown>>('host_info', {})
  const text = (key: string): string | undefined => {
    const value = raw[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
  const memory = raw.memory_gb
  return {
    os: text('os'),
    image: text('image'),
    kernel: text('kernel'),
    cpu: text('cpu'),
    gpu: text('gpu'),
    memoryGb: typeof memory === 'number' && memory > 0 ? memory : undefined,
  }
}

/* ─────────────────────────── the pad ─────────────────────────── */

export type PadInfo = {
  name: string
  /** Percent, when the pad reports one. Wired pads legitimately report nothing. */
  batteryPercent?: number
  /** `charging`, `discharging`, `wired`… as gilrs names it. */
  power?: string
}

/**
 * The pad, as `gilrs` sees it.
 *
 * ⚠️ Read through Rust even though the browser has a Gamepad API, because the Tauri
 * build deliberately does not use that API at all (README §2 — WebKitGTK's is
 * unreliable). Two sources for one fact is how the card ends up disagreeing with the
 * input that is actually driving the screen.
 *
 * In the browser build there is no Rust, so this falls back to the Gamepad API — which
 * is the source that IS driving input there. Same rule, opposite answer.
 */
export const loadPadInfo = async (): Promise<PadInfo | undefined> => {
  if (isTauri()) {
    const pads = await invokeOr<PadInfo[]>('pad_info', [])
    return pads[0]
  }
  const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean)
  return pad ? { name: pad.id } : undefined
}

/* ─────────────────────────── the cache ─────────────────────────── */

export type CacheStats = {
  entries: number
  bytes: number
  /** Seconds since the newest entry was written. Absent when nothing is cached. */
  newestAgeSeconds?: number
  /** Bytes per upstream, from the host prefix on each cache filename. */
  byHost: Record<string, number>
}

export const EMPTY_CACHE: CacheStats = { entries: 0, bytes: 0, byHost: {} }

export const loadCacheStats = async (): Promise<CacheStats> => {
  const raw = await invokeOr<Record<string, unknown>>('cache_stats', {})
  const age = raw.newest_age_seconds
  const byHost = raw.by_host
  return {
    entries: typeof raw.entries === 'number' ? raw.entries : 0,
    bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
    newestAgeSeconds: typeof age === 'number' ? age : undefined,
    byHost: byHost && typeof byHost === 'object' ? (byHost as Record<string, number>) : {},
  }
}

/** Returns how many entries went. 0 in the browser, which has no disk cache. */
export const clearCache = async (): Promise<number> => invokeOr<number>('cache_clear', 0)

/* ─────────────────────────── formatting ─────────────────────────── */

/**
 * ⚠️ Binary units, and `GB` rather than `GiB` on the face.
 *
 * The card sits beside a `Cache limit` stepper whose ladder is 512 MB / 1 / 2 / 4 GB,
 * and those are powers of two. If the reading divided by 1000 and the limit by 1024,
 * a cache at its limit would read as under it — which is the one moment this number
 * matters. `GiB` is more correct and reads as a typo at ten feet.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / 1024 / 1024
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`
}

/** "41 minutes ago" — the card's phrasing, not a timestamp. */
export const formatAge = (seconds: number | undefined): string => {
  if (seconds === undefined) return 'never'
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.round(hours / 24)} days ago`
}

/* ─────────────────────────── the display ─────────────────────────── */

export type DisplayInfo = {
  /** CSS pixels the app is actually laid out in. */
  viewport: string
  /** The panel, in device pixels. */
  physical: string
  /** Undefined where the browser will not say — not `false`, which is a claim. */
  hdr?: boolean
}

/**
 * ⚠️ Refresh rate is deliberately absent. No web API exposes it, `requestAnimationFrame`
 * timing only estimates it and estimates badly under VRR — which this box runs — so the
 * card would show a number that changes when nothing changed. The design's
 * "1920 × 1080 · 120 Hz · HDR available" is two facts and one guess.
 */
export const readDisplayInfo = (): DisplayInfo => {
  const dpr = window.devicePixelRatio || 1
  const hdr = window.matchMedia?.('(dynamic-range: high)')
  return {
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    physical: `${Math.round(window.screen.width * dpr)} × ${Math.round(window.screen.height * dpr)}`,
    // `matches: false` from a browser that does not implement the query is
    // indistinguishable from a genuine SDR panel, so only `true` is believed.
    hdr: hdr?.matches === true ? true : undefined,
  }
}
