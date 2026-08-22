import { useEffect, useState } from 'react'
import { platformName } from '../platform'
import { subscribeInput } from '../platform/input'
import { impliedUiScale, loadSteamUiScale, type SteamUiScale } from '../platform/display'

/**
 * Development HUD: what pad is connected, and what the app just received.
 *
 * This exists because controller problems on this platform are almost always silent
 * (private/BAZZITE-NOTES.md §1) — if Steam Input hands the app a Desktop-layout pad it
 * emits keyboard and mouse events and the app sees nothing at all, which looks
 * exactly like broken input code. Being able to see "pad detected, no events" versus
 * "no pad at all" turns a guessing game into a two-second diagnosis.
 *
 * Toggle with **F2**, or ⊟ View on a pad. Hidden by default in production builds.
 */
type Props = {
  /** Optional shelf/tile position readout — moved here off the design's top bar. */
  position?: string
}

/**
 * What the webview believes it is rendering to.
 *
 * ⚠️ This exists because Bazzite Game Mode has several independent scale factors and
 * none of them announce themselves: gamescope can render internally below the output
 * mode and upscale, the compositor can advertise a Wayland output scale (which becomes
 * devicePixelRatio), and Steam has its own resolution/scaling setting. All of them are
 * invisible from inside the app EXCEPT through these three numbers.
 *
 * The layout survives all of it — sizing is derived from viewport width, so it stays
 * proportional whatever the app is handed. What the numbers actually tell you is
 * SHARPNESS: if `css` is 1920 on a 4K panel, something upscaled and the 2x artwork is
 * being thrown away.
 */
type DisplayInfo = {
  css: string
  dpr: number
  physical: string
  remPx: number
  clamp: 'fluid' | 'min' | 'max'
}

const readDisplay = (): DisplayInfo => {
  const dpr = window.devicePixelRatio || 1
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize)
  // Mirrors index.css: clamp(12px, 0.8333vw, 34px). If either bound is binding, the
  // layout has stopped scaling with the viewport and everything is relatively off.
  const fluid = (window.innerWidth * 0.8333) / 100
  const clamp = fluid <= 12 ? 'min' : fluid >= 34 ? 'max' : 'fluid'
  return {
    css: `${window.innerWidth}x${window.innerHeight}`,
    dpr,
    physical: `${Math.round(window.innerWidth * dpr)}x${Math.round(window.innerHeight * dpr)}`,
    remPx: Math.round(remPx * 100) / 100,
    clamp,
  }
}

export const ControllerHud = ({ position }: Props) => {
  const [visible, setVisible] = useState(import.meta.env.DEV)
  const [display, setDisplay] = useState<DisplayInfo>(readDisplay)
  /** Steam's own UI scale for this panel, when we are on Bazzite and can read it. */
  const [steamScale, setSteamScale] = useState<SteamUiScale | undefined>(undefined)

  useEffect(() => {
    const read = () => void loadSteamUiScale().then(setSteamScale)
    read()
    // Steam rewrites config.vdf the moment the user changes the setting, and Game Mode
    // can put them in Steam's settings and back without restarting us. Re-read on
    // regaining focus so a manual scale change is picked up rather than stale.
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [])
  const [pads, setPads] = useState<string[]>([])
  /** Rolling log — one line per received edge, newest first. */
  const [log, setLog] = useState<string[]>([])

  /*
   * ⚠️ Moved off ☰ Start, which now raises the Up menu (design 9a). The HUD sits on
   * ⊟ View / F2 instead — the design reserves View and asks that it stay unassigned,
   * and a diagnostic overlay is exactly the kind of thing a reserved button should
   * hold rather than a button the product uses.
   *
   * The pad half matters more than the keyboard half: on a couch there is no F2 key,
   * and this panel is the only way to tell "the app never received the input" from
   * "the app received it and did the wrong thing" — the single most useful
   * distinction when Steam Input is in the way (private/BAZZITE-NOTES.md §1).
   */
  useEffect(
    () =>
      subscribeInput((event) => {
        if (event.action === 'hud' && event.pressed) setVisible((v) => !v)
      }),
    [],
  )

  useEffect(() => {
    if (!visible) return
    return subscribeInput((event) => {
      if (!event.pressed) return
      setLog((prev) => [`${event.action} (${event.source})`, ...prev].slice(0, 6))
    })
  }, [visible])

  useEffect(() => {
    const onResize = () => setDisplay(readDisplay())
    window.addEventListener('resize', onResize)
    // devicePixelRatio can change without a resize when a window moves between
    // displays; this media query is the documented way to hear about it.
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mq.addEventListener?.('change', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      mq.removeEventListener?.('change', onResize)
    }
  }, [display.dpr])

  useEffect(() => {
    if (!visible) return
    // The Gamepad API only populates entries after the pad sends its first input,
    // so an Xbox pad shows up as "none" until a button is pressed. That is normal.
    const tick = setInterval(() => {
      const connected = [...(navigator.getGamepads?.() ?? [])]
        .filter((p): p is Gamepad => p !== null)
        .map((p) => `${p.id} (${p.mapping || 'non-standard'})`)
      setPads(connected)
    }, 500)
    return () => clearInterval(tick)
  }, [visible])

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-136 rounded-lg bg-black/80 px-4 py-3 font-mono text-base leading-relaxed text-white/80 backdrop-blur">
      <div>
        platform <span className="text-focus">{platformName()}</span>
      </div>
      <div className="truncate">
        pad{' '}
        <span className={pads.length ? 'text-focus' : 'text-amber-400'}>
          {pads.length ? pads.join(', ') : 'none — press a button to wake it'}
        </span>
      </div>
      <div>
        display <span className="text-focus">{display.css}</span> css ·{' '}
        <span className={display.dpr === 1 ? 'text-white/45' : 'text-focus'}>{display.dpr}x</span>{' '}
        dpr · <span className="text-focus">{display.physical}</span> physical
      </div>
      <div>
        1rem <span className="text-focus">{display.remPx}px</span>{' '}
        <span className={display.clamp === 'fluid' ? 'text-white/45' : 'text-amber-400'}>
          ({display.clamp === 'fluid' ? 'scaling with width' : `CLAMPED at ${display.clamp}`})
        </span>
      </div>
      <div>
        ui scale <span className="text-focus">{impliedUiScale().toFixed(2)}x</span> ours ·{' '}
        {steamScale === undefined ? (
          <span className="text-white/45">steam n/a</span>
        ) : (
          <span
            className={
              Math.abs(steamScale.scale - impliedUiScale()) > 0.15 ? 'text-amber-400' : 'text-focus'
            }
          >
            {steamScale.scale.toFixed(2)}x steam ({steamScale.automatic ? 'auto' : 'MANUAL'})
          </span>
        )}
      </div>
      {position !== undefined && <div className="text-white/45">{position}</div>}
      <div className="mt-1">received:</div>
      {log.length === 0 ? (
        <div className="text-amber-400">
          nothing yet — if the pad moves the UI but nothing appears here, something upstream is
          eating the input
        </div>
      ) : (
        log.map((line, index) => (
          <div key={`${line}-${index}`} className={index === 0 ? 'text-focus' : 'text-white/45'}>
            {line}
          </div>
        ))
      )}
      <div className="mt-1 text-white/40">F2 or View toggles</div>
    </div>
  )
}
