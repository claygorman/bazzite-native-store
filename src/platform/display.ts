import { isTauri } from './index'

/**
 * The UI scale Steam picked for this display, if we can see it.
 *
 * Game Mode's Display settings has "Automatically Scale User Interface". It is derived
 * from the panel's PHYSICAL SIZE (via EDID) and resolution — on clay's 84-inch 4K set,
 * 2.5596 — and Steam applies it to its own Big Picture UI as a device scale factor.
 *
 * ⚠️ It does NOT reach us. Steam scales its own windows; gamescope advertises nothing
 * equivalent to other Wayland clients, so we get the raw surface at scale 1. Honouring
 * the user's choice therefore means reading it ourselves, which we can — it is a plain
 * local file (see src-tauri/src/display.rs).
 *
 * ⚠️ Enhancement layer only: `undefined` in the browser, off Bazzite, and whenever the
 * file or key is missing. Nothing may depend on it.
 */
export type SteamUiScale = {
  /** The scale in effect — the user's manual choice, or Steam's automatic one. */
  scale: number
  /** What Steam would pick automatically, for comparison. */
  auto?: number
  /** False once the user turns automatic scaling off and picks their own. */
  automatic: boolean
  min?: number
  max?: number
}

export const loadSteamUiScale = async (): Promise<SteamUiScale | undefined> => {
  if (!isTauri()) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<SteamUiScale | null>('steam_ui_scale')
    if (!result || typeof result.scale !== 'number' || !Number.isFinite(result.scale)) {
      return undefined
    }
    // Guard the range as well as the type: a corrupt value should degrade to "we don't
    // know" rather than render the app at 12x. Steam's own slider bounds are the right
    // limits when we have them.
    const min = result.min ?? 0.5
    const max = result.max ?? 8
    return result.scale >= min && result.scale <= max ? result : undefined
  } catch {
    return undefined
  }
}

/**
 * What OUR layout is implicitly scaled by, for comparison with Steam's number.
 *
 * Everything is sized from viewport width (`clamp(12px, 0.8333vw, 34px)`), which makes
 * the viewport 120rem across at any resolution and the design's reference 1920px wide.
 * So our effective scale is simply how many times wider than 1920 the viewport is.
 *
 * Comparing the two is the useful bit: if Steam says 2.56 and we are at 2.0, Steam
 * believes this display wants a UI ~28% larger than our design assumes.
 */
export const DESIGN_REFERENCE_WIDTH = 1920

export const impliedUiScale = (): number => window.innerWidth / DESIGN_REFERENCE_WIDTH
