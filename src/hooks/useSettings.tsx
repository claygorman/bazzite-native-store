import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  cadenceSeconds,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from '../platform/settings'
import { setGlyphSet } from '../platform/glyphs'
import { setStickMovesFocus } from '../platform/input'
import { setTransportPolicy } from '../platform/transport'
import { setProtonPolicy } from '../platform/protondb'
import { setStoreRegion } from '../platform/steam'

type SettingsApi = {
  settings: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** Y on a focused row. One row, not the page. */
  reset: (key: keyof Settings) => void
  /** The About page's button. Never a toggle — see the ideology doc. */
  resetAll: () => void
}

const noop = () => {}
const SettingsContext = createContext<SettingsApi>({
  settings: DEFAULT_SETTINGS,
  set: noop,
  reset: noop,
  resetAll: noop,
})

/**
 * Settings, loaded once and shared.
 *
 * ⚠️ Loaded SYNCHRONOUSLY in the initializer, not in an effect. Interface scale and
 * safe area are applied to the document root, so an async load would paint one frame
 * at 100% and then jump — on a 4K television that reads as the app resizing itself
 * every launch. `localStorage` is synchronous, so there is no reason to pay for that.
 *
 * > Nothing needs a Save. Every change applies on press, and the status card at the
 * > top of the page reflects it.
 *
 * That is why `set` writes to disk on every call rather than debouncing: a setting
 * that survives the press but not a power cut is not a setting anyone can trust, and
 * the payload is a few hundred bytes.
 */
export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  const commit = useCallback((next: Settings) => {
    setSettings(next)
    saveSettings(next)
  }, [])

  const set = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) =>
      setSettings((prev) => {
        if (prev[key] === value) return prev
        const next = { ...prev, [key]: value }
        saveSettings(next)
        return next
      }),
    [],
  )

  const reset = useCallback(
    (key: keyof Settings) =>
      setSettings((prev) => {
        const next = { ...prev, [key]: DEFAULT_SETTINGS[key] }
        saveSettings(next)
        return next
      }),
    [],
  )

  const resetAll = useCallback(() => commit(DEFAULT_SETTINGS), [commit])

  /*
   * The two settings that are not read by a component but by the document itself.
   *
   * ⚠️ Interface scale multiplies the ROOT FONT SIZE rather than applying a
   * transform. The whole app is sized in rem off `clamp(12px, 0.8333vw, 34px)`
   * (index.css), so scaling the root scales every element, every gap and every
   * outline together and nothing has to know. A `transform: scale()` would instead
   * blur text and leave the viewport the wrong size.
   *
   * Safe area is padding on the app frame, since a TV that crops the edges crops
   * pixels, not layout — pulling the content in is the only thing that helps.
   */
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--ui-scale', String(settings.uiScalePercent / 100))
    root.style.setProperty('--safe-area', `${settings.safeAreaPercent}%`)
  }, [settings.uiScalePercent, settings.safeAreaPercent])

  /*
   * Settings that belong to modules rather than components.
   *
   * ⚠️ Five of them are module-level state written from here rather than props read
   * down there, and it is the same trade every time: `glyphFor` is called from about
   * thirty places, `STORE_LOCALE` from twelve, and the gamepad poll loop runs outside
   * React entirely and must not be rebuilt when a setting changes (restarting it
   * mid-hold leaves a direction latched down forever). Threading a settings object
   * through all of that would be a parameter nobody varies within a render.
   *
   * ⚠️ This effect runs on mount too, which is what makes a stored region or glyph set
   * take effect before the first request goes out.
   */
  useEffect(() => setGlyphSet(settings.glyphSet), [settings.glyphSet])
  useEffect(() => setStickMovesFocus(settings.stickMovesFocus), [settings.stickMovesFocus])
  useEffect(() => setStoreRegion(settings.region), [settings.region])
  useEffect(
    () =>
      setTransportPolicy({
        timeoutMs: settings.requestTimeoutMs,
        offline: settings.offlineMode,
      }),
    [settings.requestTimeoutMs, settings.offlineMode],
  )
  useEffect(
    () =>
      setProtonPolicy({
        enabled: settings.protonRatings,
        ttlSeconds: cadenceSeconds(settings.refreshCadence),
      }),
    [settings.protonRatings, settings.refreshCadence],
  )

  const api = useMemo<SettingsApi>(
    () => ({ settings, set, reset, resetAll }),
    [settings, set, reset, resetAll],
  )

  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>
}

export const useSettings = (): SettingsApi => useContext(SettingsContext)

/** Read one value without re-reading the API object at every call site. */
export const useSetting = <K extends keyof Settings>(key: K): Settings[K] =>
  useContext(SettingsContext).settings[key]
