import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AccountChip } from './components/AccountChip'
import { AmbientArt } from './components/AmbientArt'
import { MotionConfig, motion, useSpring } from 'motion/react'
import { PAGE_ENTER, STACK_SPRING } from './platform/motion'
import { ButtonLegend } from './components/ButtonLegend'
import { TagPicker, TAG_GRID_COLS, type TagZone } from './components/TagPicker'
import { UP_MENU, UpMenu, type UpMenuId } from './components/UpMenu'
import { SettingsView, type SettingsFocus } from './components/SettingsView'
import { useProtonDump } from './hooks/useProtonDump'
import {
  SETTINGS_PAGES,
  pageIndexById,
  type SettingsRow as SettingsRowType,
} from './components/settings/pages'
import { WishlistView, WISHLIST_COLS, WISHLIST_PAGE } from './components/WishlistView'
import { useWishlist } from './hooks/useWishlist'
import { useSettings } from './hooks/useSettings'
import { useSystemStatus } from './hooks/useSystemStatus'
import {
  DEFAULT_SETTINGS,
  indexOfValue,
  labelFor,
  optionsFor,
  stepSetting,
  type Settings,
  type SteppableKey,
} from './platform/settings'

/**
 * The only two settings whose value applies as the dpad moves rather than on A.
 *
 * ⚠️ Not a general capability, and it should stay two. Both are chosen by LOOKING at
 * the result — you cannot pick a type size for a television by committing blind,
 * squinting at it, reopening the list and committing again. Every other row waits for
 * A, per design turn 10, so walking a list no longer fires a change per step.
 */
const LIVE_PREVIEW = new Set<SteppableKey>(['uiScalePercent', 'safeAreaPercent'])
import {
  checkForUpdate,
  describeUpdate,
  installUpdate,
  relaunchApp,
  updaterConfigured,
  type UpdateState,
} from './platform/updates'
import { isTauri } from './platform/index'
import { clearCache } from './platform/systemInfo'
import { clearSteamCache } from './platform/transport'
import { healthSummary } from './platform/serviceHealth'
import { TagResults } from './components/TagResults'
import { TagSpotlight } from './components/TagSpotlight'
import {
  fetchAllTags,
  isBrowsableTag,
  TAG_GROUPS,
  TAG_SORTS,
  type StoreTagInfo,
} from './platform/tagBrowse'
import {
  DEFAULT_TAG_SORT,
  TAG_VIEW_SIZE,
  useTagBrowse,
  useTagPreview,
  useTagSpotlights,
} from './hooks/useTagBrowse'
import { DETAIL_SCREENS, DetailsPage } from './components/DetailsPage'
import { EXPANDABLE, PROTON_FILTERS, sectionsFor } from './components/details/sections'
import { ControllerHud } from './components/ControllerHud'
import { SearchView, keyAt, rowLength, type SearchFocus } from './components/SearchView'
import { Shelf } from './components/Shelf'
import { CalendarBand, CalendarRecommended } from './components/CalendarBand'
import { useAppDetails } from './hooks/useAppDetails'
import { useInputActions } from './hooks/useInputActions'
import { useMicrotrailer } from './hooks/useMicrotrailer'
import { useProtonRating } from './hooks/useProtonRating'
import { useProtonReports } from './hooks/useProtonReports'
import { useOffers } from './hooks/useOffers'
import { useBundle } from './hooks/useBundle'
import { BundlePage } from './components/BundlePage'
import { loadHostInfo } from './platform/systemInfo'
import {
  DEFAULT_PROTON_FILTERS,
  protonOptionAt,
  protonOptionCount,
  protonOptionIndex,
  type ProtonFilters,
} from './components/details/DetailsProton'
import { useHydratedRows } from './hooks/useHydratedRows'
import { useRowProtonRatings } from './hooks/useRowProtonRatings'
import { signIn, signOut } from './platform/auth'
import { directionalName, glyphFor } from './platform/glyphs'
import { isTypedKey, setTextCapture } from './platform/input'
import { useInputSource } from './hooks/useInputSource'
import { useSteamSession } from './hooks/useSteamSession'
import { useStoreFocus } from './hooks/useStoreFocus'
import { fetchFeaturedRows, openBundleInSteam, openExternal, openInSteam } from './platform/steam'
import {
  VISIBLE_DAYS,
  fetchCalendarBand,
  type CalendarBand as CalendarBandData,
} from './platform/calendar'
import type { InputAction } from './platform/input'
import type { StoreItem, StoreRow } from './types/steam'

/** Which screen has focus. Details is reached with A, dismissed with B. */
type View =
  | { screen: 'home' }
  // `from` is a one-level back-stack: B unwinds detail pages, then returns to
  // wherever the page was opened from. Without it, opening a game from search and
  // pressing B dumps you on the home screen having lost the query.
  /**
   * `hint` is the name and art of the game we BELIEVE we are opening, captured at the
   * moment of the press.
   *
   * ⚠️ It exists because the fallbacks used to come from the home shelf's focused tile,
   * which has nothing to do with which game this page is showing. That is invisible
   * while `appdetails` succeeds — the real name wins — and catastrophic when it fails:
   * the page then renders one game's NAME and ART above another game's price,
   * compatibility and bundles. Seen on the box: Stray opened as "How to Fish" with
   * Stray's 470 ProtonDB reports and Stray's soundtrack bundle under it.
   */
  | {
      screen: 'details'
      appid: number
      page: number
      from: 'home' | 'search'
      hint?: { name?: string; art?: string }
    }
  | { screen: 'search' }
  /**
   * 14b — a bundle's own page, `/bundle/<id>` rendered here rather than in Steam.
   *
   * ⚠️ `appid` is carried alongside the bundle id so B can go back to the offers block
   * on the game you came from, with that game's page already loaded. Without it the
   * only honest destination is Home, and walking into a bundle would cost you your
   * place — which would undo the point of the turn, since the bundle exists here so you
   * can look at its contents and come back.
   */
  | { screen: 'bundle'; bundleid: number; appid: number; from: 'home' | 'search' }
  /** 7a — pick a tag. */
  | { screen: 'tags' }
  /**
   * 7b — inside one or more tags.
   *
   * `sortIndex` lives in the view rather than in component state because changing it
   * changes the RESULT SET, not just the order: Steam applies each sort as a filter,
   * so the total and the page count move with it. Keeping it here is what makes
   * "re-read the numbers on every sort change" automatic instead of remembered.
   */
  | { screen: 'tag-results'; tagids: number[]; sortIndex: number; page: number }
  /** Everything you saved for later, read from the local Steam client. */
  | { screen: 'wishlist'; page: number }
  /**
   * 8a-8g.
   *
   * ⚠️ Focus is a (zone, column, row) triple rather than an index into a flat list,
   * because the rail is reachable. The ideology doc says "the rail is never focused
   * directly; it is a position indicator that LB/RB drives" — Clay overrode that, and
   * on a keyboard it is clearly right: LB/RB are Q/E, which nobody reaches for before
   * they have reached for an arrow key.
   */
  | {
      screen: 'settings'
      page: number
      zone: 'rail' | 'rows'
      col: number
      row: number
      /**
       * A has opened the focused stepper's list of values.
       *
       * ⚠️ The only modal state on this screen, and it lives in the view rather than
       * in the component because it changes what up/down, A and B mean — which is the
       * input handler's business, not the renderer's.
       */
      open?: boolean
      /**
       * Which option the dpad sits on inside an open list.
       *
       * ⚠️ Separate from the committed value on purpose — design turn 10 draws the ring
       * and the check apart, "moved to Gold, check stays on Silver", so moving previews
       * without changing anything. `undefined` means "wherever the current value is",
       * resolved on read so opening a list never has to write state first.
       */
      cursor?: number
    }

const SEARCH_ACTION_ROW = 4

/**
 * Which screen each Up-menu entry maps to, and the reverse.
 *
 * ⚠️ Replaces the old two-item menu bar (`Zone`, `MENU_ITEMS`), which was a chip for
 * Browse by Tag plus the account chip, reachable only by Up from the first shelf on
 * home. The design's answer is one row of five over the dimmed page, reachable from
 * anywhere with ☰ — which is what finally makes Settings reachable from a details
 * page, and what the tag chip in the header was standing in for.
 */
const MENU_DESTINATION: Record<UpMenuId, View> = {
  home: { screen: 'home' },
  tags: { screen: 'tags' },
  search: { screen: 'search' },
  wishlist: { screen: 'wishlist', page: 0 },
  settings: { screen: 'settings', page: 0, zone: 'rows', col: 0, row: 0 },
}

/** Which entry is highlighted when the menu opens: the place you already are. */
const currentDestination = (screen: View['screen']): UpMenuId =>
  screen === 'tags'
    ? 'tags'
    : screen === 'search'
      ? 'search'
      : screen === 'wishlist'
        ? 'wishlist'
        : screen === 'settings'
          ? 'settings'
          : 'home'

/**
 * Stable identity for "no rows yet". A fresh `[]` per render would make every
 * downstream effect keyed on `rows` re-run forever.
 */
const EMPTY_ROWS: StoreRow[] = []
const EMPTY_APPIDS: number[] = []

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; rows: StoreRow[] }
  | { status: 'error'; message: string }

/**
 * Wall clock for the top bar.
 *
 * Game Mode is full-screen with no system tray, so this is the only clock a user in
 * the living room has. Ticks every 15s rather than every second — nothing here shows
 * seconds, and a per-second render of the whole home screen is pure waste.
 */
const Clock = ({ hour24 }: { hour24: boolean }) => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className="text-base font-semibold tabular-nums text-ink-3/50">
      {now.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        hour12: !hour24,
      })}
    </span>
  )
}

export const App = () => {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [view, setView] = useState<View>({ screen: 'home' })
  const { session } = useSteamSession()
  const inputSource = useInputSource()
  const { settings, set, reset, resetAll } = useSettings()
  /** Null when the Up menu is closed; otherwise which entry is focused. */
  const [menuIndex, setMenuIndex] = useState<number | null>(null)
  const menuOpen = menuIndex !== null
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [wishlistFocus, setWishlistFocus] = useState(0)
  /**
   * The settings snapshot taken when a stepper's list opened, so B can put it back.
   *
   * ⚠️ The whole object, not just the one key. Storing `{key, value}` cannot be typed
   * without a cast — `Settings[SteppableKey]` is a union that TypeScript will not let
   * back into `set(key, …)` — whereas a snapshot indexes cleanly as `snapshot[row.key]`
   * once `row.key` has narrowed. It is thirty short fields; copying it is free.
   */
  const [pickerUndo, setPickerUndo] = useState<Settings | null>(null)
  /** Every store tag, loaded once the tag screen is first opened. */
  const [allTags, setAllTags] = useState<StoreTagInfo[]>([])
  const [tagGroup, setTagGroup] = useState(0)
  const [tagIndex, setTagIndex] = useState(0)
  /** Tag picker: the group tabs, or the grid below them. Up out of row 0 reaches them. */
  const [tagZone, setTagZone] = useState<TagZone>('grid')
  const [tagResultFocus, setTagResultFocus] = useState(0)
  /** Which spotlight is showing, and whether focus is on it rather than the grid. */
  const [spotlightIndex, setSpotlightIndex] = useState(0)
  const [spotlightZone, setSpotlightZone] = useState(true)
  const [query, setQuery] = useState('')
  const [searchFocus, setSearchFocus] = useState<SearchFocus>({
    row: 1,
    col: 0,
  })
  const [searchResults, setSearchResults] = useState<StoreItem[]>([])
  /** null = focus is on the on-screen keyboard; a number = focus is in the results. */
  const [resultFocus, setResultFocus] = useState<number | null>(null)
  /**
   * Which part of the details page has focus, and where the gallery is.
   *
   * ⚠️ `offers` is the bottom half of the Overview screen — design turn 14a — and it is
   * a THIRD zone rather than a mode of `media`, because the dpad means different things
   * in it: left/right walks the items inside a bundle rather than the gallery. Reading
   * top to bottom the page is tabs → media → offers, which is also the order up and
   * down move through.
   */
  const [detailZone, setDetailZone] = useState<'media' | 'tabs' | 'offers'>('media')
  /** Which offer row, and which item inside it — `undefined` means the row itself. */
  const [offerRow, setOfferRow] = useState(0)
  const [offerCol, setOfferCol] = useState<number | undefined>(undefined)
  /** Which card the dpad is on inside a bundle's own page — turn 14b. */
  const [bundleIndex, setBundleIndex] = useState(0)
  const [mediaIndex, setMediaIndex] = useState(0)
  /**
   * Trailer audio. Starts muted — a store that blares sound the moment you open a
   * page is hostile in a living room — and X unmutes.
   *
   * ⚠️ X means sound and ONLY sound, everywhere in the app. It used to also pause the
   * tag carousel, which is one button carrying two different verbs a screen apart — so
   * the pause was removed rather than rebound. Leaving a screen is how you stop a clip;
   * that costs one press and spends no button.
   */
  const [trailerMuted, setTrailerMuted] = useState(true)
  /** Focused panel on the About / ProtonDB / Reviews screens, and whether A opened it. */
  const [sectionIndex, setSectionIndex] = useState(0)
  const [sectionExpanded, setSectionExpanded] = useState(false)
  /**
   * Where the dpad sits inside an OPEN ProtonDB filter list — design 10's control,
   * reused. Separate from the committed value on purpose: arrowing past an option must
   * not apply it. An earlier version of the settings dropdown applied every value you
   * moved over, so walking a five-item list fired four changes nobody asked for.
   */
  const [sectionCursor, setSectionCursor] = useState(0)
  const [protonFilters, setProtonFilters] = useState<ProtonFilters>(DEFAULT_PROTON_FILTERS)
  /** Whether the focused clip carries audio at all. Microtrailers do not. */
  const [trailerHasAudio, setTrailerHasAudio] = useState<boolean | undefined>(undefined)
  const onAudioChange = useCallback((value: boolean | undefined) => setTrailerHasAudio(value), [])
  const onResults = useCallback((items: StoreItem[]) => {
    setSearchResults(items)
    // A new result set invalidates the old cursor.
    setResultFocus(null)
  }, [])
  const loadedRows = state.status === 'ready' ? state.rows : EMPTY_ROWS
  // Captions need facts featuredcategories does not send; one batched call fills
  // them in just after first paint.
  const { rows, hydrating } = useHydratedRows(loadedRows)
  /**
   * "Your Personal Calendar" is the fifth shelf, not a screen of its own — the design
   * numbers it "Shelf 5 / 5". It loads independently of the store rows so a slow or
   * empty calendar never delays the shelves above it.
   */
  const [calendar, setCalendar] = useState<CalendarBandData | undefined>(undefined)
  /** Day opened out to full width with A, or null for the five-column band. */
  const [expandedDay, setExpandedDay] = useState<number | null>(null)
  const calendarDays = calendar?.days.length ?? 0
  const todayColumn = Math.max(0, calendar?.days.findIndex((day) => day.isToday) ?? 0)

  /*
   * The calendar contributes TWO focus rows, not one: the day band and the recommended
   * row beneath it. They are separate rows because the home screen scrolls by each
   * stack child's offsetTop — nested inside the band, the recommended cards shared its
   * offset and could never be scrolled to.
   *
   * Opening a day re-points the first of those rows at that day's releases.
   */
  const bandColumns =
    expandedDay === null ? calendarDays : (calendar?.days[expandedDay]?.games.length ?? 0)
  const trailingRows = useMemo(
    () => (calendar ? [bandColumns, calendar.recommended.length] : []),
    [calendar, bandColumns],
  )
  const { focus, move, focusItem, focusedItem } = useStoreFocus(
    rows,
    trailingRows,
    todayColumn,
    settings.wrapAtEnds,
  )
  const onCalendarRow = calendarDays > 0 && focus.row === rows.length
  const onRecommendedRow = calendarDays > 0 && focus.row === rows.length + 1

  useEffect(() => {
    let cancelled = false
    void fetchCalendarBand()
      .then((band) => {
        if (!cancelled && band.days.length > 0) setCalendar(band)
      })
      // A missing calendar costs the home screen one shelf, nothing more.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchFeaturedRows()
      .then((result) => {
        if (cancelled) return
        setState(
          result.length > 0
            ? { status: 'ready', rows: result }
            : { status: 'error', message: 'Steam returned no rows.' },
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // On the details page the subject is the opened app, not whatever the shelf
  // happens to be focused on; they are the same until focus moves behind it.
  const subjectAppid = view.screen === 'details' ? view.appid : focusedItem?.appid
  /*
   * ⚠️ Autoplay off passes `undefined` rather than a long delay — the request itself
   * is what the setting turns off. `fetchMicrotrailer` is an `appdetails` call per
   * focused game, which is the second largest source of traffic this app generates
   * after ProtonDB, so a setting that only hid the video would be cosmetic.
   *
   * The details page keeps a 0ms delay: you arrived there deliberately, so there is no
   * scroll-past to protect against.
   */
  const trailerAppid = settings.trailerAutoplay === 'off' ? undefined : subjectAppid
  const preview = useMicrotrailer(
    trailerAppid,
    view.screen === 'details' ? 0 : settings.trailerDelayMs,
  )
  // The design puts a compatibility dot under every tile, so ratings are now fetched
  // a row at a time rather than one focused game at a time. On the details page the
  // subject is the opened app, which may not be in any visible row.
  const ratingAppids =
    view.screen === 'details'
      ? subjectAppid === undefined
        ? EMPTY_APPIDS
        : [subjectAppid]
      : (rows[focus.row]?.items.map((item) => item.appid) ?? EMPTY_APPIDS)
  const rowRatings = useRowProtonRatings(ratingAppids)
  const proton = (subjectAppid !== undefined ? rowRatings.get(subjectAppid) : undefined) ?? {
    status: 'loading' as const,
  }
  const detailsState = useAppDetails(view.screen === 'details' ? view.appid : undefined)
  const protonReports = useProtonReports(view.screen === 'details' ? view.appid : undefined)
  const offers = useOffers(view.screen === 'details' ? view.appid : undefined)
  const bundle = useBundle(view.screen === 'bundle' ? view.bundleid : undefined)
  /*
   * ⚠️ The bundle cards' Proton tiers ride the SAME per-row hook the shelves use, which
   * dedupes by appid and never re-asks. ProtonDB serves one appid per request with no
   * batching, so three cards is three requests — acceptable once, and free on a second
   * visit because the games in a bundle are usually ones you have already scrolled past.
   */
  const bundleRatings = useRowProtonRatings(bundle.bundle?.appids ?? [])
  // A fresh bundle starts on its first card. Without this, walking into a three-card
  // bundle from a two-card one opens with the cursor past the end.
  useEffect(() => setBundleIndex(0), [view.screen === 'bundle' ? view.bundleid : undefined])

  /**
   * The rendering GPU, for the ProtonDB tab's on-your-hardware score.
   *
   * ⚠️ Read once here rather than through `useSystemStatus`, which is gated to the
   * Settings screen because it also times the four upstreams. Borrowing it would run a
   * network probe every time someone opened a game page. This is one local invoke that
   * reads `/sys/class/drm`, and it is `undefined` in the browser build — which the
   * score already treats as "nothing to match against" rather than as zero evidence.
   */
  const [hostGpu, setHostGpu] = useState<string | undefined>(undefined)
  useEffect(() => {
    void loadHostInfo().then((host) => setHostGpu(host.gpu))
  }, [])

  // Clamp gallery navigation to what actually exists, so holding a direction does
  // not run the index off the end and leave the user pressing back through nothing.
  // Which panels exist on the current details screen. Derived from the same helper
  // the screens use, so the focus index can never point at a panel that is not there.
  const sections =
    view.screen === 'details'
      ? sectionsFor(
          view.page,
          detailsState.details,
          detailsState.reviews,
          protonReports.phase === 'ready',
        )
      : []
  const activeSection = sections[sectionIndex]
  /** The ProtonDB filter under focus, when one is — narrows `activeSection` for the input block. */
  const activeFilter = PROTON_FILTERS.find((key) => key === activeSection)

  /*
   * Turn 14a's offer rows, as widths the dpad can be clamped against.
   *
   * ⚠️ Row 0 is the base game and has NO items, so its width is 0 — left/right must do
   * nothing there rather than lighting an item that is not drawn. Every other row's
   * width is its bundle's contents.
   */
  const offerRows: number[] =
    view.screen === 'details'
      ? [0, ...offers.offers.filter((o) => o.bundleid !== undefined).map((o) => o.items.length)]
      : []
  const offerBundles = offers.offers.filter((offer) => offer.bundleid !== undefined)

  const galleryLength = Math.max(
    1,
    (preview.hlsUrl || preview.microUrl ? 1 : 0) + (detailsState.details?.screenshots.length ?? 0),
  )

  /**
   * A real keyboard types into the query while the search screen is open.
   *
   * Registered as text CAPTURE rather than an extra listener, because the letter
   * bindings would otherwise fight it — q/e jump shelves, 1/3 page, x deletes and y
   * opens search, so "quest" would fire four actions and type nothing. Capture takes
   * printable keys and Backspace; everything else falls through, so arrows still move
   * the on-screen keyboard and Escape still exits.
   */
  useEffect(() => {
    if (view.screen !== 'search') return
    setTextCapture((event) => {
      if (event.key === 'Backspace') {
        setQuery((q) => q.slice(0, -1))
        return true
      }
      if (!isTypedKey(event)) return false
      setQuery((q) => (q.length < 60 ? q + event.key : q))
      return true
    })
    return () => setTextCapture(null)
  }, [view.screen])

  const typeKey = useCallback(() => {
    const key = keyAt(searchFocus)
    if (key === 'SPACE') setQuery((q) => `${q} `)
    else if (key === '⌫') setQuery((q) => q.slice(0, -1))
    else if (key === 'Search')
      return // results already update as you type
    else if (key) setQuery((q) => q + key)
  }, [searchFocus])

  /*
   * Resolve the curated groups against the live vocabulary.
   *
   * ⚠️ Steam publishes no tag taxonomy — `GetTagList` is a flat list of names — so the
   * groups are ours, which means a tag renamed upstream simply stops matching. Skipped
   * rather than rendered as a tile that browses nothing.
   */
  const tagGroups = useMemo(() => {
    if (allTags.length === 0) return []
    const byName = new Map(allTags.filter(isBrowsableTag).map((t) => [t.name, t]))
    return TAG_GROUPS.map((g) => ({
      label: g.label,
      tags: g.tags.flatMap((name) => {
        const tag = byName.get(name)
        return tag ? [tag] : []
      }),
    })).filter((g) => g.tags.length > 0)
  }, [allTags])

  /* ─────────────────────────── Settings and the Up menu ─────────────────────────── */

  const status = useSystemStatus(view.screen === 'settings')
  const wishlist = useWishlist(view.screen === 'wishlist' || menuOpen)

  /**
   * ⚠️ Dimmed rather than hidden, and with the reason on the line beneath. The row is
   * always the same five in the same order — that is the entire point of it — so an
   * entry that disappeared when Steam was not running would shift every entry to its
   * right and destroy the muscle memory the design is built on.
   */
  const menuDisabled = useMemo<Partial<Record<UpMenuId, string>>>(
    () => (wishlist.status === 'unavailable' ? { wishlist: 'Needs the Steam client running' } : {}),
    [wishlist.status],
  )

  /**
   * The badge, and where pressing A on it lands you.
   *
   * > Settings carries the badge. The store never nags mid-browse; it waits here,
   * > where you already are on your way somewhere else.
   *
   * ⚠️ An update outranks a degraded service because it is actionable and the service
   * usually is not. Both are real signals — the update from a live feed check, the
   * service from four timed requests — so neither can appear without something behind
   * it, which is why an unconfigured feed produces no badge at all rather than a
   * permanent one.
   */
  const badge = useMemo(() => {
    if (update.status === 'available' || update.status === 'ready') {
      return {
        on: 'settings' as const,
        reason: describeUpdate(update),
        page: 'updates',
      }
    }
    const services = status.services
    if (services && services.some((s) => s.state !== 'ok')) {
      return {
        on: 'settings' as const,
        reason: healthSummary(services),
        page: 'network',
      }
    }
    return undefined
  }, [update, status.services])

  /**
   * Where the Settings entry actually goes.
   *
   * > Entering Settings from the badge lands you on the page the badge came from —
   * > Updates for a build, Network for a degraded service — not on the last page you
   * > happened to visit.
   *
   * ⚠️ Which means the badge is not decoration: it is a link with a destination. A dot
   * that says "something is wrong" and then drops you on a page that does not mention
   * it is worse than no dot.
   */
  const openMenuEntry = useCallback(
    (id: UpMenuId) => {
      setMenuIndex(null)
      if (menuDisabled[id] !== undefined) return
      if (id === currentDestination(view.screen)) return
      if (id === 'tags') {
        setTagIndex(0)
        setTagZone('grid')
      }
      if (id === 'wishlist') setWishlistFocus(0)
      if (id === 'settings' && badge) {
        setView({
          screen: 'settings',
          page: pageIndexById(badge.page),
          zone: 'rows',
          col: 0,
          row: 0,
        })
        return
      }
      setView(MENU_DESTINATION[id])
    },
    [menuDisabled, view.screen, badge],
  )

  /** Injected at build time from package.json — see vite.config.ts. */
  const clientVersion = __APP_VERSION__

  /*
   * What the Updates page can honestly say before anyone presses anything.
   *
   * ⚠️ Resolved on launch rather than left at `idle`, because `idle` renders as "Not
   * checked yet" — which is true but useless when the answer is that there is nothing
   * to check. The browser build has no binary to replace, and a build with no feed URL
   * or signing key has nowhere to ask; both are permanent facts about this install,
   * not states a press could change.
   *
   * ⚠️ `autoUpdate` only fires a real check when the feed IS configured. Without the
   * guard every launch would spend a request on a 404.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!isTauri()) return void setUpdate({ status: 'unsupported' })
      if (!(await updaterConfigured())) {
        if (!cancelled) setUpdate({ status: 'unconfigured' })
        return
      }
      if (!settings.autoUpdate) return
      const result = await checkForUpdate(settings.updateChannel)
      if (cancelled) return
      setUpdate(result)

      /*
       * Automatic means DOWNLOADED, not merely noticed — otherwise the row's own
       * description ("check on launch and download in the background") is a lie, and
       * the user still has to make a trip to Settings to get the thing they already
       * said they wanted automatically.
       *
       * ⚠️ Skipped on a metered connection. This is a ~16 MB transfer with no user
       * waiting on it, which is exactly what that setting exists to stop — the same
       * reasoning as trailer and artwork prefetch.
       */
      if (result.status !== 'available' || settings.meteredConnection) return

      const installed = await installUpdate(settings.updateChannel, (progress) => {
        if (!cancelled) setUpdate(progress)
      })
      if (!cancelled) setUpdate(installed)
      /*
       * ⚠️ It stops at `ready` and never relaunches itself here, even with
       * `notifyBeforeRestart` off. That setting means "do not make me confirm the
       * restart I just asked for" — it is about the MANUAL path, where someone pressed
       * Install and is watching. Restarting the app from under someone seconds after
       * they launched it is a different act entirely, and not one they consented to.
       */
    })()
    return () => {
      cancelled = true
    }
    // Launch only. Re-checking on every channel flip would fire a request per dpad
    // press while someone was stepping the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * The Check row's face, which is three verbs in one place.
   *
   * ⚠️ `Not configured` rather than `Check` when there is no feed, because pressing it
   * would fail silently every time. The row stays focusable so the page still explains
   * itself; it just does not pretend the press will do something.
   */
  const protonDump = useProtonDump()

  /**
   * The two ProtonDB rows' faces and descriptions, per turn 13a's six states.
   *
   * ⚠️ The DESCRIPTIONS carry the work here, not the labels. "Nothing to cancel — the
   * download is already on disk" is what turns an inert button into an explained one,
   * and "Your snapshot still works. Fetching is a choice, not a repair" is what stops
   * a newer snapshot reading as a fault. A state that looks broken and is not costs
   * more trust than one that is.
   */
  const protonActionLabel = useMemo(() => {
    const { phase, snapshot, latest, downloaded, total } = protonDump.state
    // ⚠️ Parenthesise the division. `Math.round(downloaded * 100) / total` rounds the
    // wrong operand: the byte units cancel so the magnitude looks right, but the
    // rounding lands before the divide and 62% renders as 62.121212121212125%. A bug
    // that produces a plausible number is the kind that ships.
    const pct =
      total !== undefined && total > 0 ? `${Math.round(((downloaded ?? 0) / total) * 100)}%` : '…'
    switch (phase) {
      case 'unavailable':
        return {
          'proton-download': {
            label: 'Unavailable',
            desc: 'The report archive needs the desktop app — the browser build cannot index it',
          },
          'proton-check': { label: 'Unavailable', desc: '' },
        }
      case 'checking':
        return {
          'proton-download': { label: 'Download', desc: '' },
          'proton-check': {
            label: 'Checking…',
            desc: 'Asking which snapshot is current — a few KB, no archive fetched',
          },
        }
      case 'downloading':
        return {
          'proton-download': {
            label: pct,
            desc: `Fetching the ${latest ?? snapshot ?? 'newest'} snapshot`,
          },
          'proton-check': { label: 'Check', desc: '' },
        }
      case 'indexing':
        return {
          'proton-download': {
            label: 'Indexing…',
            desc: 'Nothing to cancel — the download is already on disk',
          },
          'proton-check': { label: 'Check', desc: '' },
        }
      case 'outdated':
        return {
          'proton-download': {
            label: 'Download',
            desc: 'Your snapshot still works. Fetching is a choice, not a repair',
          },
          'proton-check': {
            label: 'Check',
            desc: `You have ${snapshot ?? '—'} · ${latest ?? 'a newer one'} has been published`,
          },
        }
      case 'ready':
        return {
          'proton-download': { label: 'Re-download', desc: `Built from the ${snapshot} snapshot` },
          'proton-check': {
            label: 'Check',
            desc: 'Checking is cheap and separate; it never starts a download on its own',
          },
        }
      default:
        return {}
    }
  }, [protonDump.state])

  const updateActionLabel = useMemo(
    () => ({
      'check-updates': {
        label:
          update.status === 'ready'
            ? 'Restart'
            : update.status === 'available'
              ? 'Install'
              : update.status === 'downloading'
                ? 'Downloading'
                : update.status === 'checking'
                  ? 'Checking'
                  : // ⚠️ `managed` reads Unavailable too, and that is right: the button
                    // genuinely cannot do anything in a Flatpak. The card beside it says
                    // where updates come from instead, so the row is short rather than
                    // misleading.
                    update.status === 'unconfigured' ||
                      update.status === 'unsupported' ||
                      update.status === 'managed'
                    ? 'Unavailable'
                    : 'Check',
      },
    }),
    [update.status],
  )

  /**
   * A on a settings row.
   *
   * > A changes the focused thing. Nothing needs a Save; every change applies on press.
   *
   * ⚠️ A stepper steps FORWARD on A and stops at the end rather than wrapping, which
   * matches left/right. Wrapping would mean A on the last value silently returns to
   * the first — a press that looks like it undid four presses.
   */
  const activateRow = useCallback(
    (row: SettingsRowType) => {
      if (row.kind === 'toggle') return set(row.key, !settings[row.key])
      if (row.kind === 'stepper') {
        return set(row.key, stepSetting(row.key, settings[row.key], 1))
      }
      switch (row.action) {
        /*
         * ⚠️ ONE row, three verbs, chosen by where the update actually is. A separate
         * "Install" row would be dead most of the time and a separate "Restart" row
         * dead almost always, and the doc is explicit that a button is an action
         * rather than a state — so the action is whatever this row can do right now,
         * and its face says which. `updateActionLabel` keeps the label in step.
         */
        case 'check-updates':
          if (update.status === 'ready') return void relaunchApp()
          if (update.status === 'available') {
            return void installUpdate(settings.updateChannel, setUpdate).then((next) => {
              setUpdate(next)
              // > Notify before restarting: ask first if an update needs a relaunch.
              if (next.status === 'ready' && !settings.notifyBeforeRestart) void relaunchApp()
            })
          }
          setUpdate({ status: 'checking' })
          void checkForUpdate(settings.updateChannel).then(setUpdate)
          return
        /*
         * ⚠️ Neither of these ever fires on its own. 66 MB unasked, on a metered
         * connection, on a machine whose point is playing games, is not a decision
         * this code gets to make — see turn 13a and `useProtonDump`.
         */
        case 'proton-download':
          return protonDump.download()

        case 'proton-check':
          return protonDump.check()

        case 'clear-cache':
          void clearCache().then(() => status.refresh())
          return
        case 'refresh-ratings':
          // ⚠️ Drops the SESSION cache only. The disk cache is keyed per request and
          // clearing just ProtonDB's entries would mean teaching Rust which host a
          // file belongs to; the host prefix makes that possible, but "refresh" here
          // means "ask again now", and re-asking is what the memory cache blocks.
          clearSteamCache()
          status.refresh()
          return
        case 'run-diagnostics':
          status.refresh()
          return
        case 'copy-diagnostics':
          void navigator.clipboard
            ?.writeText(
              [
                `Bazzite Store ${clientVersion}`,
                `OS: ${status.host.os ?? 'unknown'}`,
                `Image: ${status.host.image ?? 'unknown'}`,
                `Kernel: ${status.host.kernel ?? 'unknown'}`,
                `CPU: ${status.host.cpu ?? 'unknown'}`,
                `GPU: ${status.host.gpu ?? 'unknown'}`,
                `Memory: ${status.host.memoryGb ? `${status.host.memoryGb} GB` : 'unknown'}`,
                `Display: ${status.display.physical} (viewport ${status.display.viewport})`,
                `Pad: ${status.pad?.name ?? 'none'}`,
                `Cache: ${status.cache.entries} entries`,
                `Update: ${describeUpdate(update)}`,
                `Services: ${status.services ? healthSummary(status.services) : 'not checked'}`,
              ].join('\n'),
            )
            .catch(() => undefined)
          return
        case 'open-docs':
          void openExternal('https://docs.bazzite.gg/')
          return
        case 'reset-all':
          resetAll()
          return
        case 'sign-out':
          if (session.status === 'signed-in') void signOut()
          else void signIn()
          return
      }
    },
    [settings, set, resetAll, status, update, session, clientVersion],
  )

  const focusedTag = tagGroups[tagGroup]?.tags[tagIndex]
  const tagPreview = useTagPreview(view.screen === 'tags' ? focusedTag?.tagid : undefined)

  const browseTagIds = view.screen === 'tag-results' ? view.tagids : EMPTY_APPIDS
  const browseSort = view.screen === 'tag-results' ? TAG_SORTS[view.sortIndex]! : DEFAULT_TAG_SORT
  const browsePage = view.screen === 'tag-results' ? view.page : 0
  const tagBrowse = useTagBrowse(browseTagIds, browseSort, browsePage)
  /*
   * The cursor, clamped to the row that actually arrived.
   *
   * ⚠️ Not the same number as `tagResultFocus`, and the difference matters. Paging
   * BACKWARDS aims at the last of five before the page has been fetched, and a page can
   * come back short — adult filtering compacts the fetched 25 before it is sliced. Left
   * unclamped, index 4 against a four-card page focuses nothing at all: no ring, and A
   * silently does nothing, on a screen where there is visibly something to press.
   */
  const tagFocus = Math.min(tagResultFocus, Math.max(0, tagBrowse.items.length - 1))
  const spotlights = useTagSpotlights(browseTagIds)
  const spotlightGame = spotlights[spotlightIndex % Math.max(1, spotlights.length)]
  /*
   * The spotlight's own trailer and compatibility rating.
   *
   * ⚠️ Keyed on the spotlight only while this screen is up. `useMicrotrailer` and
   * `useProtonRating` are already used by the home shelves and the details page against
   * `subjectAppid`; feeding them a second subject unconditionally would fire a request
   * per carousel tick on screens that never show it.
   */
  const spotlightPreview = useMicrotrailer(
    view.screen === 'tag-results' ? spotlightGame?.appid : undefined,
    600,
  )
  const spotlightProton = useProtonRating(
    view.screen === 'tag-results' ? spotlightGame?.appid : undefined,
    600,
  )

  // The full tag list is only needed once the picker is opened; fetching it on boot
  // would spend a request on a screen most sessions never visit.
  useEffect(() => {
    if (view.screen !== 'tags' || allTags.length > 0) return
    void fetchAllTags().then(setAllTags)
  }, [view.screen, allTags.length])

  const openDetails = useCallback((appid: number, hint?: { name?: string; art?: string }) => {
    setDetailZone('media')
    setMediaIndex(0)
    setView({ screen: 'details', appid, page: 0, from: 'home', hint })
  }, [])

  /**
   * Act on one offer row, or one item inside it — design 14a.
   *
   * ⚠️ ONE function, called by both the A button and a mouse click. The two used to be
   * written twice in this file for other screens and drifted every time; here the
   * difference would be silent, because a click that opens the wrong page still opens
   * a page. Clicking also lands FOCUS where you clicked, so the dpad carries on from
   * where the pointer left off rather than jumping back to wherever it was.
   */
  const activateOffer = useCallback(
    (row: number, col?: number) => {
      if (view.screen !== 'details') return
      setDetailZone('offers')
      setOfferRow(row)
      setOfferCol(col)
      const offer = row === 0 ? undefined : offerBundles[row - 1]
      if (offer === undefined) {
        void openInSteam(view.appid)
        return
      }
      const item = col !== undefined ? offer.items[col] : undefined
      if (item) {
        openDetails(item.appid, { name: item.name, art: item.capsuleUrl })
      } else if (offer.bundleid !== undefined) {
        setView({
          screen: 'bundle',
          bundleid: offer.bundleid,
          appid: view.appid,
          from: view.from,
        })
      }
    },
    [view, offerBundles, openDetails],
  )

  const onAction = useCallback(
    (action: InputAction) => {
      /*
       * --- The Up menu (9a) ---
       *
       * ⚠️ FIRST, before every screen's own handler, and it swallows everything.
       *
       * The menu is raised OVER whatever you were looking at, so a press reaching the
       * screen underneath would move a focus you cannot see — dismiss the menu and you
       * are somewhere else. It has to precede the search branch in particular, which
       * returns unconditionally for every action (it owns the whole keyboard while
       * text capture is on) and would otherwise make ☰ dead on the one screen where a
       * user is most likely to want out.
       */
      if (menuIndex !== null) {
        switch (action) {
          case 'left':
          case 'right':
            setMenuIndex((i) =>
              Math.min(UP_MENU.length - 1, Math.max(0, (i ?? 0) + (action === 'left' ? -1 : 1))),
            )
            return
          case 'accept': {
            // ⚠️ Opening the destination you are already in must be a no-op, not a
            // re-entry — the menu opens focused on it precisely so a stray Up-then-A
            // costs nothing, and re-navigating would reset scroll and focus.
            const entry = UP_MENU[menuIndex]
            if (entry) openMenuEntry(entry.id)
            else setMenuIndex(null)
            return
          }
          case 'back':
          case 'down':
          case 'menu':
            setMenuIndex(null)
            return
          default:
            return
        }
      }

      /*
       * ☰ raises it from anywhere at all. The one place Up ALSO does is the top shelf
       * on home, below — Up is the discoverable route and ☰ is the one that works when
       * Up would be ambiguous.
       */
      if (action === 'menu') {
        setMenuIndex(UP_MENU.findIndex((e) => e.id === currentDestination(view.screen)))
        return
      }

      if (view.screen === 'search') {
        // --- Focus is in the results list ---
        if (resultFocus !== null) {
          switch (action) {
            case 'left':
              setResultFocus(null) // back to the keyboard
              return
            case 'up':
              setResultFocus((i) => Math.max(0, (i ?? 0) - 1))
              return
            case 'down':
              setResultFocus((i) => Math.min(searchResults.length - 1, (i ?? 0) + 1))
              return
            case 'accept': {
              const item = searchResults[resultFocus]
              if (item) {
                setDetailZone('media')
                setMediaIndex(0)
                setView({
                  screen: 'details',
                  appid: item.appid,
                  page: 0,
                  from: 'search',
                  hint: { name: item.name, art: item.capsuleUrl },
                })
              }
              return
            }
            case 'back':
              setResultFocus(null)
              return
            case 'search':
              setView({ screen: 'home' })
              return
            default:
              return
          }
        }

        switch (action) {
          case 'back':
          case 'search':
            setView({ screen: 'home' })
            return
          case 'secondary':
            setQuery((q) => q.slice(0, -1))
            return
          case 'accept':
            typeKey()
            return
          case 'up':
          case 'shelfPrev':
          case 'down':
          case 'shelfNext': {
            const back = action === 'up' || action === 'shelfPrev'
            setSearchFocus((f) => {
              const row = Math.min(Math.max(0, f.row + (back ? -1 : 1)), SEARCH_ACTION_ROW)
              return {
                row,
                col: Math.min(f.col, Math.max(0, rowLength(row) - 1)),
              }
            })
            return
          }
          case 'left':
          case 'right': {
            // Right from the last key crosses into the results list, so the list is
            // reachable without a mouse.
            const atLastColumn = searchFocus.col >= rowLength(searchFocus.row) - 1
            if (action === 'right' && atLastColumn && searchResults.length > 0) {
              setResultFocus(0)
              return
            }
            setSearchFocus((f) => ({
              ...f,
              col: Math.min(
                Math.max(0, f.col + (action === 'left' ? -1 : 1)),
                Math.max(0, rowLength(f.row) - 1),
              ),
            }))
            return
          }
          default:
            return
        }
      }

      // Up from the first shelf raises it too. Only from the TOP shelf: from any lower
      // one Up still moves a shelf, because a direction that sometimes navigates and
      // sometimes opens a menu is a direction nobody trusts.
      if (
        view.screen === 'home' &&
        (action === 'up' || action === 'shelfPrev') &&
        focus.row === 0
      ) {
        setMenuIndex(UP_MENU.findIndex((e) => e.id === 'home'))
        return
      }

      /*
       * --- 8a-8g, Settings ---
       *
       * ⚠️ Two departures from `Settings ideology.md`, both because its own scheme has
       * a dead end in it.
       *
       * The doc gives left/right two jobs — "crosses to the other column OR steps a
       * stepper when the focused row has one" — and says the rail is never focused.
       * But land on a stepper and left/right is spent, so a column of nothing but
       * steppers could never be left; and with the rail unreachable, LB/RB (Q and E on
       * a keyboard) is the only way to change page.
       *
       * So: **left/right is movement and only movement** — rail ↔ column A ↔ column B
       * — and **the triggers adjust the focused stepper**. LT/RT are otherwise dead on
       * this screen, so nothing is taken from anything else, and every row stays
       * reachable whatever control it carries. A still changes the focused thing.
       */
      if (view.screen === 'settings') {
        const page = SETTINGS_PAGES[view.page]!
        const columns = [page.colA.rows, page.colB.rows]
        const rows = columns[view.col] ?? []
        const row = rows[Math.min(view.row, rows.length - 1)]

        /*
         * --- An open stepper ---
         *
         * ⚠️ Handled before everything else and swallows the whole dpad, because it is
         * the one modal state on this screen. A press that reached the rows underneath
         * would move a focus hidden behind an open list.
         *
         * ⚠️ The cursor is NOT the value — design turn 10, "moved to Gold, check stays
         * on Silver". Moving previews; only A commits. The version before this applied
         * every value you arrowed past, so walking a five-item list fired four changes
         * nobody asked for, and on rows like Region and Request timeout those are not
         * free — each one refetches.
         *
         * ⚠️ Two rows are exempt and MUST stay exempt: Interface scale and Safe area
         * are chosen by LOOKING at the result, so they apply as the cursor moves and B
         * puts them back. Committing blind, squinting, reopening and committing again
         * is not a way to pick a type size. `LIVE_PREVIEW` below is that exception, and
         * it is deliberately two entries rather than a general capability.
         */
        if (view.open && row?.kind === 'stepper') {
          const options = optionsFor(row.key)
          const at = view.cursor ?? indexOfValue(row.key, settings[row.key])
          const moveTo = (next: number) => {
            const clamped = Math.min(options.length - 1, Math.max(0, next))
            setView({ ...view, cursor: clamped })
            // Live-preview rows follow the cursor; everything else waits for A.
            if (LIVE_PREVIEW.has(row.key)) {
              set(row.key, options[clamped]!.value as never)
            }
          }
          switch (action) {
            case 'up':
              moveTo(at - 1)
              return
            case 'down':
              moveTo(at + 1)
              return
            case 'accept':
              set(row.key, options[at]!.value as never)
              setView({ ...view, open: false, cursor: undefined })
              setPickerUndo(null)
              return
            case 'back':
              // Only the live-preview rows have anything to undo — the rest were never
              // touched, which is the point.
              if (pickerUndo) set(row.key, pickerUndo[row.key])
              setView({ ...view, open: false, cursor: undefined })
              setPickerUndo(null)
              return
            case 'search':
              // Y resets the row, and the cursor follows it to the default so the ring
              // and the check agree about where you just landed.
              reset(row.key)
              setView({ ...view, cursor: indexOfValue(row.key, DEFAULT_SETTINGS[row.key]) })
              return
            default:
              // Left/right, the shoulders and the triggers are all deliberately inert:
              // an open list is a question, and every one of them would answer a
              // different one.
              return
          }
        }

        const goToPage = (next: number) =>
          // Focus lands on the first row of the left column on every page — the doc's
          // rule, and the reason the rail can be left with a single press of Right.
          setView({
            screen: 'settings',
            page: next,
            zone: 'rows',
            col: 0,
            row: 0,
          })

        // --- The rail ---
        if (view.zone === 'rail') {
          switch (action) {
            case 'up':
            case 'down': {
              const next = view.page + (action === 'up' ? -1 : 1)
              if (next < 0 || next > SETTINGS_PAGES.length - 1) return
              // Stays in the rail: walking the page list is the whole reason to be
              // here, and dropping into the rows after every step would make it a
              // one-shot control.
              setView({
                screen: 'settings',
                page: next,
                zone: 'rail',
                col: 0,
                row: 0,
              })
              return
            }
            case 'right':
            case 'accept':
              setView({ ...view, zone: 'rows', col: 0, row: 0 })
              return
            case 'left':
              return // nothing to the left of the rail
            case 'back':
              setView({ screen: 'home' })
              return
            case 'shelfPrev':
            case 'shelfNext':
              goToPage(
                (view.page + (action === 'shelfPrev' ? -1 : 1) + SETTINGS_PAGES.length) %
                  SETTINGS_PAGES.length,
              )
              return
            default:
              return
          }
        }

        // --- The rows ---
        switch (action) {
          case 'back':
            // > B out of any settings page returns to exactly the shelf and tile you
            // > left. Settings is a detour, never a place you navigate back from.
            setView({ screen: 'home' })
            return
          case 'shelfPrev':
          case 'shelfNext':
            goToPage(
              (view.page + (action === 'shelfPrev' ? -1 : 1) + SETTINGS_PAGES.length) %
                SETTINGS_PAGES.length,
            )
            return
          case 'up':
          case 'down': {
            const next = view.row + (action === 'up' ? -1 : 1)
            if (next < 0 || next > rows.length - 1) return
            setView({ ...view, row: next })
            return
          }
          case 'left':
            // Off the left of column A is the rail, which is how you change page
            // without knowing what a shoulder button is.
            if (view.col === 0) return setView({ ...view, zone: 'rail' })
            // ⚠️ Clamped, not carried. The columns differ in length — Updates is 4 and
            // 2 — so row 3 of column A has no counterpart, and landing on nothing is
            // how a press appears to do nothing.
            return setView({
              ...view,
              col: 0,
              row: Math.min(view.row, Math.max(0, columns[0]!.length - 1)),
            })
          case 'right': {
            if (view.col === 1) return
            const other = columns[1] ?? []
            if (other.length === 0) return
            setView({
              ...view,
              col: 1,
              row: Math.min(view.row, other.length - 1),
            })
            return
          }
          case 'pagePrev':
          case 'pageNext':
            // ⚠️ The triggers, because left/right is movement now. They are dead on
            // this screen otherwise, and a stepper with no way back would need A to
            // wrap — which reads as one press undoing four.
            if (row?.kind !== 'stepper') return
            set(row.key, stepSetting(row.key, settings[row.key], action === 'pagePrev' ? -1 : 1))
            return
          case 'accept':
            /*
             * ⚠️ A stepper OPENS rather than stepping. It used to step forward and
             * clamp, which meant A walked to the last value and then did nothing at
             * all — the control simply died under your thumb. Wrapping instead would
             * have read as one press undoing four.
             */
            if (row?.kind === 'stepper') {
              // Only the live-preview rows can be changed before A, so they are the
              // only ones with anything for B to restore.
              setPickerUndo(LIVE_PREVIEW.has(row.key) ? settings : null)
              setView({ ...view, open: true })
              return
            }
            if (row) activateRow(row)
            return
          case 'search':
            // > Y resets that one row to its default.
            //
            // ⚠️ Y is global search everywhere else, and this is the ONE screen that
            // reassigns it. The ideology doc asks for it by name and the tray says so;
            // it is defensible only because Settings has no search to reach.
            if (row && row.kind !== 'button') reset(row.key)
            return
          default:
            return
        }
      }

      // --- The wishlist ---
      if (view.screen === 'wishlist') {
        const count = wishlist.items.length
        const pages = Math.max(1, Math.ceil(count / WISHLIST_PAGE))
        switch (action) {
          case 'back':
            setView({ screen: 'home' })
            return
          case 'pagePrev':
          case 'pageNext': {
            const next = view.page + (action === 'pagePrev' ? -1 : 1)
            if (next < 0 || next > pages - 1) return
            setWishlistFocus(next * WISHLIST_PAGE)
            setView({ ...view, page: next })
            return
          }
          case 'left':
          case 'right':
          case 'up':
          case 'down': {
            const delta =
              action === 'left'
                ? -1
                : action === 'right'
                  ? 1
                  : action === 'up'
                    ? -WISHLIST_COLS
                    : WISHLIST_COLS
            const next = Math.min(count - 1, Math.max(0, wishlistFocus + delta))
            setWishlistFocus(next)
            // The grid is two rows of five; walking off it turns the page rather than
            // stopping, the same as the tag results.
            const nextPage = Math.floor(next / WISHLIST_PAGE)
            if (nextPage !== view.page) setView({ ...view, page: nextPage })
            return
          }
          case 'accept': {
            const item = wishlist.items[wishlistFocus]
            if (item) openDetails(item.appid, { name: item.name, art: item.capsuleUrl })
            return
          }
          default:
            return
        }
      }

      // --- 7a, the tag picker ---
      if (view.screen === 'tags') {
        const tags = tagGroups[tagGroup]?.tags ?? []
        // Group changes come from two places — LB/RB anywhere, and left/right while the
        // tabs hold focus — so the index fix-up lives in one function rather than twice.
        const stepGroup = (delta: number) => {
          if (tagGroups.length === 0) return
          const next = (tagGroup + delta + tagGroups.length) % tagGroups.length
          setTagGroup(next)
          // Column is kept but the row is not: groups differ in length, and landing
          // on a index the new group does not have would focus nothing.
          setTagIndex((i) => Math.min(i, Math.max(0, (tagGroups[next]?.tags.length ?? 1) - 1)))
        }

        /*
         * The tab strip, reached with Up out of the grid's top row.
         *
         * ⚠️ Handled before the shared switch and returns unconditionally. Falling
         * through would let the grid's own left/right run as well, so one press would
         * change group AND move the tag cursor.
         */
        if (tagZone === 'tabs') {
          switch (action) {
            case 'left':
              stepGroup(-1)
              return
            case 'right':
              stepGroup(1)
              return
            case 'down':
            case 'accept':
              setTagZone('grid')
              return
            case 'back':
              setView({ screen: 'home' })
              return
            case 'up':
              return // nothing above the tabs
            default:
              break // LB/RB and search still mean what they always mean
          }
        }

        switch (action) {
          case 'back':
            setView({ screen: 'home' })
            return
          case 'shelfPrev':
          case 'shelfNext': {
            stepGroup(action === 'shelfPrev' ? -1 : 1)
            return
          }
          case 'left':
          case 'right': {
            const delta = action === 'left' ? -1 : 1
            setTagIndex((i) => Math.min(tags.length - 1, Math.max(0, i + delta)))
            return
          }
          case 'up':
          case 'down': {
            const delta = action === 'up' ? -TAG_GRID_COLS : TAG_GRID_COLS
            // Up out of the top row lifts focus to the group tabs, the same way Up out
            // of the home screen's first shelf reaches the menu bar.
            if (action === 'up' && tagIndex < TAG_GRID_COLS) {
              setTagZone('tabs')
              return
            }
            setTagIndex((i) => {
              const next = i + delta
              return next < 0 || next > tags.length - 1 ? i : next
            })
            return
          }
          case 'accept': {
            const tag = tags[tagIndex]
            if (!tag) return
            setTagResultFocus(0)
            setSpotlightIndex(0)
            setSpotlightZone(true)
            setView({
              screen: 'tag-results',
              tagids: [tag.tagid],
              // ⚠️ Starts on the same sort the picker counted with. Steam applies each
              // sort as a filter, so opening on a different one would deliver a
              // different number from the one just promised.
              sortIndex: TAG_SORTS.indexOf(DEFAULT_TAG_SORT),
              page: 0,
            })
            return
          }
          default:
            return
        }
      }

      // --- 7b, inside a tag ---
      if (view.screen === 'tag-results') {
        const count = tagBrowse.items.length

        // The carousel zone. Left/right steps spotlights and resets the dwell timer,
        // down drops into the results.
        if (spotlightZone && spotlights.length > 0) {
          switch (action) {
            case 'back':
              setView({ screen: 'tags' })
              return
            case 'down':
              setSpotlightZone(false)
              return
            case 'left':
            case 'right':
              setSpotlightIndex(
                (i) => (i + (action === 'left' ? -1 : 1) + spotlights.length) % spotlights.length,
              )
              return
            case 'accept': {
              const game = spotlights[spotlightIndex % spotlights.length]
              if (game) openDetails(game.appid, { name: game.name, art: game.capsuleUrl })
              return
            }
            default:
              break // sort and paging fall through to the shared handling below
          }
        }

        switch (action) {
          case 'back':
            setView({ screen: 'tags' })
            return
          case 'up':
            if (spotlights.length > 0) setSpotlightZone(true)
            return
          case 'shelfPrev':
          case 'shelfNext': {
            const next =
              (view.sortIndex + (action === 'shelfPrev' ? -1 : 1) + TAG_SORTS.length) %
              TAG_SORTS.length
            setTagResultFocus(0)
            // Back to page 0: the page count changes with the sort, so page 40 of the
            // old ordering may not exist in the new one.
            setView({ ...view, sortIndex: next, page: 0 })
            return
          }
          case 'pagePrev':
          case 'pageNext': {
            const next = view.page + (action === 'pagePrev' ? -1 : 1)
            if (next < 0 || (tagBrowse.pageCount > 0 && next >= tagBrowse.pageCount)) return
            setTagResultFocus(0)
            setView({ ...view, page: next })
            return
          }
          case 'left':
          case 'right': {
            const delta = action === 'left' ? -1 : 1
            const next = tagFocus + delta
            /*
             * Walking off either end turns the page.
             *
             * ⚠️ Land on the far edge, not on index 0 — going right lands on the first
             * card of the next page, going left on the LAST card of the previous one, so
             * the cursor keeps travelling in the direction it was pushed. `pageCount`
             * is consulted rather than assumed: it is a property of the current sort,
             * and paging past the end would fetch a `start` Steam answers with nothing.
             *
             * ⚠️ `TAG_VIEW_SIZE - 1` is an intent, not a measurement — the previous page
             * has not been fetched yet and adult filtering can leave it short of five.
             * `tagFocus` clamps it against the row that actually arrives.
             */
            if (next < 0) {
              if (view.page === 0) return
              setTagResultFocus(TAG_VIEW_SIZE - 1)
              setView({ ...view, page: view.page - 1 })
              return
            }
            if (next > count - 1) {
              const page = view.page + 1
              if (tagBrowse.pageCount > 0 && page >= tagBrowse.pageCount) return
              setTagResultFocus(0)
              setView({ ...view, page })
              return
            }
            setTagResultFocus(next)
            return
          }
          case 'down':
            return // one row of five; there is nothing below it
          case 'accept': {
            const item = tagBrowse.items[tagFocus]
            if (item) openDetails(item.appid, { name: item.name, art: item.capsuleUrl })
            return
          }
          default:
            return
        }
      }

      // Y opens search from anywhere else.
      if (action === 'search') {
        setView({ screen: 'search' })
        return
      }

      /*
       * 14b — a bundle's own page. One row of cards, so left/right is the only
       * movement there is.
       *
       * ⚠️ X, not A, is the button that leaves. A walks INTO a game, which is the whole
       * reason this page exists in the client instead of being a `steam://` handoff;
       * putting the purchase on A would make the most destructive press the one people
       * hit by reflex.
       */
      if (view.screen === 'bundle') {
        const cards = bundle.bundle?.appids ?? []
        if (action === 'left' || action === 'right') {
          if (cards.length === 0) return
          const delta = action === 'left' ? -1 : 1
          setBundleIndex((i) => Math.min(Math.max(0, i + delta), cards.length - 1))
          return
        }
        if (action === 'accept') {
          const appid = cards[bundleIndex]
          if (appid !== undefined) {
            const facts = bundle.facts.get(appid)
            openDetails(appid, { name: facts?.name, art: facts?.headerUrl })
          }
          return
        }
        if (action === 'secondary') {
          void openBundleInSteam(view.bundleid)
          return
        }
        if (action === 'back') {
          /*
           * ⚠️ Back to the OFFERS block on the game you came from, not to Home and not
           * to the top of that page. You walked in from a specific row; landing anywhere
           * else means finding it again, and the whole turn is about being able to look
           * at a bundle's contents and then keep shopping.
           */
          setDetailZone('offers')
          setView({
            screen: 'details',
            appid: view.appid,
            page: 0,
            from: view.from,
            // ⚠️ No hint: we are returning to a page whose details are already loaded,
            // and inventing one from the bundle we just left would be the same
            // wrong-identity bug in the opposite direction.
          })
          return
        }
        return
      }

      // On the details page the only navigation is out of it. Swallow everything
      // else so a stray dpad press does not silently move focus on the home screen
      // underneath and dump the user somewhere unexpected on the way back.
      if (view.screen === 'details') {
        /*
         * ⚠️ The offers block eats the dpad before anything else on the page, and only
         * ever on Overview — it does not exist on the other three screens. Up from the
         * first row hands focus back to the hero; everything else stays inside.
         */
        if (detailZone === 'offers') {
          const width = offerRows[offerRow] ?? 0
          if (action === 'up') {
            if (offerCol !== undefined) {
              // Out of the item strip before out of the row: two presses to leave a
              // bundle you are inside, which is what stops a stray press losing it.
              setOfferCol(undefined)
            } else if (offerRow > 0) {
              setOfferRow((r) => r - 1)
            } else {
              setDetailZone('media')
            }
            return
          }
          if (action === 'down') {
            if (offerRow < offerRows.length - 1) {
              setOfferRow((r) => r + 1)
              // ⚠️ Reset the column on every row change. Row 2 having three items and
              // row 3 having two would otherwise leave the cursor pointing past the end
              // — the same rule `useStoreFocus` applies to shelves.
              setOfferCol(undefined)
            }
            return
          }
          if (action === 'left' || action === 'right') {
            if (width === 0) return
            const delta = action === 'left' ? -1 : 1
            const next = offerCol === undefined ? (delta > 0 ? 0 : width - 1) : offerCol + delta
            // Stepping off the left edge returns to the ROW, which is how you reach the
            // row's own action again without going up and back down.
            setOfferCol(next < 0 ? undefined : Math.min(next, width - 1))
            return
          }
          if (action === 'accept') {
            // A on an item walks into THAT game's page — DLC included. This is the
            // turn's whole point: a bundle you can browse rather than a wall of art.
            // Shared with the pointer path so the two can never disagree.
            activateOffer(offerRow, offerCol)
            return
          }
          if (action === 'secondary') {
            // X opens the bundle's page in Steam from the row itself.
            const offer = offerRow === 0 ? undefined : offerBundles[offerRow - 1]
            if (offer?.bundleid !== undefined) void openBundleInSteam(offer.bundleid)
            return
          }
          if (action === 'back') {
            if (offerCol !== undefined) {
              setOfferCol(undefined)
              return
            }
            setDetailZone('media')
            return
          }
          // Everything else (LB/RB, menu, search) falls through to the handlers below.
        }

        // LB/RB always page between the three screens, as the design specifies.
        if (action === 'shelfPrev') {
          setSectionIndex(0)
          setSectionExpanded(false)
          setSectionCursor(0)
          // Paging away from Overview unmounts the offers block, so focus cannot stay
          // in it — it would land on a zone with nothing drawn.
          if (detailZone === 'offers') setDetailZone('media')
          setView({ ...view, page: Math.max(0, view.page - 1) })
          return
        }
        if (action === 'shelfNext') {
          setSectionIndex(0)
          setSectionExpanded(false)
          setSectionCursor(0)
          if (detailZone === 'offers') setDetailZone('media')
          setView({
            ...view,
            page: Math.min(DETAIL_SCREENS.length - 1, view.page + 1),
          })
          return
        }

        /*
         * ⚠️ An OPEN filter list eats up/down before anything else on this page.
         * The list is drawn as a vertical stack, so up/down is the only direction
         * that can mean "next option" — and without this branch pressing down inside
         * an open dropdown would step to the NEXT filter while its list was still on
         * screen, which reads as the list scrolling the wrong thing.
         */
        if ((action === 'up' || action === 'down') && sectionExpanded && activeFilter) {
          const count = protonOptionCount(protonReports.reports, activeFilter)
          const delta = action === 'up' ? -1 : 1
          setSectionCursor((i) => Math.min(Math.max(0, i + delta), count - 1))
          return
        }

        // Up reaches the tab strip; Down returns to the content. Without this the
        // tabs are unreachable and LB/RB is the only way to change screen.
        if (action === 'up') {
          if (detailZone === 'media' && sections.length > 0 && sectionIndex > 0) {
            // Step back through panels before leaving the content entirely.
            setSectionIndex((i) => i - 1)
            setSectionExpanded(false)
            return
          }
          setDetailZone('tabs')
          return
        }
        if (action === 'down') {
          if (detailZone === 'tabs') {
            setDetailZone('media')
            return
          }
          if (sections.length > 0 && sectionIndex < sections.length - 1) {
            setSectionIndex((i) => i + 1)
            setSectionExpanded(false)
            return
          }
          /*
           * Down off the hero drops into the offers block — turn 14a, and only on
           * Overview, where it is drawn. ⚠️ Gated on there being something to land on:
           * `offerRows` is empty until the purchase options resolve, and a zone change
           * into an empty block would strand focus somewhere invisible.
           */
          if (view.page === 0 && offerRows.length > 0) {
            setDetailZone('offers')
            setOfferRow(0)
            setOfferCol(undefined)
          }
          return
        }

        // X toggles trailer audio while the gallery holds focus — its one meaning.
        if (action === 'secondary' && detailZone === 'media' && view.page === 0) {
          // No-op on a silent source, so the button never appears to do nothing.
          if (trailerHasAudio) setTrailerMuted((m) => !m)
          return
        }

        // The dpad drives whatever holds focus — the tab strip, or the gallery.
        if (action === 'left' || action === 'right') {
          const delta = action === 'left' ? -1 : 1
          if (detailZone === 'tabs') {
            setView({
              ...view,
              page: Math.min(Math.max(0, view.page + delta), DETAIL_SCREENS.length - 1),
            })
          } else if (view.page === 0) {
            setMediaIndex((i) => Math.min(Math.max(0, i + delta), galleryLength - 1))
          } else if (sections.length > 0) {
            // On the panel screens the dpad walks between panels. An open filter list
            // closes rather than the panel behind it moving under it.
            if (sectionExpanded) {
              setSectionExpanded(false)
              return
            }
            setSectionIndex((i) => Math.min(Math.max(0, i + delta), sections.length - 1))
          }
          return
        }
        /*
         * A on the ProtonDB tab, in three parts.
         *
         * ⚠️ Committing happens on the CLOSING press, not while the cursor moves. Each
         * of these filters re-derives the whole report list, and applying a value as
         * you arrow past it would run that four times on the way down a five-item
         * list — the exact behaviour design turn 10 removed from the settings
         * dropdown.
         */
        if (action === 'accept' && activeFilter) {
          if (sectionExpanded) {
            const value = protonOptionAt(protonReports.reports, activeFilter, sectionCursor)
            if (value !== undefined) {
              setProtonFilters((current) => ({ ...current, [activeFilter]: value }))
            }
            setSectionExpanded(false)
          } else {
            // Open ON the committed value, never on the first row — two marks
            // disagreeing about where you are is worse than no cursor at all.
            setSectionCursor(
              protonOptionIndex(protonReports.reports, activeFilter, protonFilters[activeFilter]),
            )
            setSectionExpanded(true)
          }
          return
        }
        /*
         * The archive call to action — 13b's one focusable thing before the download.
         *
         * ⚠️ It starts the SAME download Settings › Compatibility runs, through the
         * same hook, rather than deflecting to that page. Sending someone to Settings
         * to press a second button would make this a signpost rather than a control,
         * and `useProtonDump` already refuses a second concurrent run, so the two entry
         * points cannot fight. It is also the one place in the app where A spends
         * 66 MB, which is why the button says so on its face.
         */
        if (action === 'accept' && activeSection === 'pdbGet') {
          if (!protonDump.busy) protonDump.download()
          return
        }

        // A expands the focused panel where there is more to show. Collapse first,
        // so A never both opens a panel and fires the page's primary action.
        if (action === 'accept' && view.page > 0 && activeSection) {
          if (EXPANDABLE.has(activeSection)) {
            setSectionExpanded((open) => !open)
            return
          }
        }

        // B closes an expanded panel before it starts unwinding screens.
        if (action === 'back' && sectionExpanded) {
          setSectionExpanded(false)
          return
        }

        // B steps back one detail screen at a time, and only leaves the page when
        // already on the first one. Jumping straight out from screen 3 loses the
        // user's place for no reason.
        if (action === 'back') {
          setView(
            view.page > 0
              ? { ...view, page: view.page - 1 }
              : view.from === 'search'
                ? { screen: 'search' }
                : { screen: 'home' },
          )
          return
        }
        if (action === 'accept') void openInSteam(view.appid)
        return
      }

      /*
       * The calendar band is not a shelf of tiles, so A and B mean something else on
       * it: A opens the focused DAY out to full width, and B closes it again. Only
       * once a day is open does A act on an individual release.
       */
      if (onCalendarRow) {
        if (action === 'accept') {
          if (expandedDay === null) {
            setExpandedDay(focus.col)
            focusItem({ row: focus.row, col: 0 })
          } else {
            const game = calendar?.days[expandedDay]?.games[focus.col]
            if (game) openDetails(game.appid, { name: game.name, art: game.capsuleUrl })
          }
          return
        }
        if (action === 'back' && expandedDay !== null) {
          // Put focus back on the day you opened, not on column 0.
          focusItem({ row: focus.row, col: expandedDay })
          setExpandedDay(null)
          return
        }
      }

      if (onRecommendedRow && action === 'accept') {
        const game = calendar?.recommended[focus.col]
        if (game) openDetails(game.appid, { name: game.name, art: game.capsuleUrl })
        return
      }

      // A opens OUR details page. Only the explicit button on that page hands off
      // to Steam — a tile press should never bounce the user out of the app.
      if (action === 'accept') {
        if (focusedItem) {
          setDetailZone('media')
          setMediaIndex(0)
          setView({
            screen: 'details',
            appid: focusedItem.appid,
            page: 0,
            from: 'home',
            hint: { name: focusedItem.name, art: focusedItem.capsuleUrl },
          })
        }
        return
      }
      move(action)
    },
    [
      view,
      menuIndex,
      menuDisabled,
      openMenuEntry,
      settings,
      set,
      reset,
      pickerUndo,
      activateRow,
      wishlist,
      wishlistFocus,
      detailZone,
      galleryLength,
      trailerHasAudio,
      sections,
      sectionIndex,
      sectionExpanded,
      sectionCursor,
      activeSection,
      activeFilter,
      protonFilters,
      protonReports.reports,
      protonDump,
      offerRows,
      offerBundles,
      offerRow,
      offerCol,
      activateOffer,
      bundle.bundle,
      bundleIndex,
      session,
      focus.row,
      focusedItem,
      move,
      typeKey,
      resultFocus,
      searchResults,
      searchFocus,
      onCalendarRow,
      onRecommendedRow,
      expandedDay,
      calendar,
      focus.col,
      focusItem,
      openDetails,
      // ⚠️ Adding a branch to this handler means adding its state here too. Omitted,
      // the branch still runs but against a stale closure — `tagGroups` stayed `[]`
      // from a render before the tag list had loaded, so both `accept` and the group
      // switch hit their empty guards and returned. Nothing errors; the buttons just
      // quietly do nothing.
      menuIndex,
      tagGroups,
      tagGroup,
      tagIndex,
      tagZone,
      tagBrowse,
      tagFocus,
      spotlights,
      spotlightIndex,
      spotlightZone,
    ],
  )

  /*
   * ⚠️ The tuning object is memoised. `useInputActions` tears down and rebuilds its
   * subscription when the tuning changes, and every held key's timers live in that
   * closure — a fresh object literal per render would rebuild it on every keystroke
   * and leave a held direction with no repeat at all.
   */
  useInputActions(
    onAction,
    useMemo(
      () => ({
        initialDelayMs: settings.repeatDelayMs,
        repeatMs: settings.repeatRateMs,
      }),
      [settings.repeatDelayMs, settings.repeatRateMs],
    ),
  )

  // Leaving the calendar closes any opened day. Without this you come back to a band
  // that is still open, with focus.col indexing days again — pointing at nothing.
  useEffect(() => {
    if (!onCalendarRow && expandedDay !== null) setExpandedDay(null)
  }, [onCalendarRow, expandedDay])

  // Vertical shelf scrolling, same transform approach as the shelves themselves.
  const stackRef = useRef<HTMLDivElement>(null)
  // Same kind of spring as the shelves, so changing row and changing tile read as one
  // system. A MotionValue rather than state — see src/platform/motion.ts.
  const y = useSpring(0, STACK_SPRING)
  useLayoutEffect(() => {
    const section = stackRef.current?.children[focus.row] as HTMLElement | undefined
    // Measured every time because the calendar band arrives late and is far taller
    // than a shelf, which moves every offset below it.
    if (section) y.set(-Math.max(0, section.offsetTop))
  }, [focus.row, rows.length, calendarDays, y])

  // focusedItem is undefined on the calendar row (its columns are days, not tiles),
  // which would drop the ambient wash to bare background on arrival.
  const calendarArt = onCalendarRow
    ? expandedDay === null
      ? calendar?.days[focus.col]?.games[0]?.capsuleUrl
      : calendar?.days[expandedDay]?.games[focus.col]?.capsuleUrl
    : onRecommendedRow
      ? calendar?.recommended[focus.col]?.capsuleUrl
      : undefined
  const ambient = focusedItem?.capsuleUrl ?? calendarArt

  const onHome = view.screen === 'home'

  return (
    // reducedMotion="user" makes every Motion animation collapse to an instant change
    // when the OS asks for less motion. Springs are the one thing here that a
    // vestibular disorder actually reacts to, so this is not decoration.
    /*
     * `"user"` collapses every animation to an instant change when the OS asks for
     * less motion; `"always"` is the Appearance page's own row for anyone whose OS
     * does not ask but who wants it anyway. Springs are the one thing here a
     * vestibular disorder actually reacts to, so this is not decoration.
     */
    <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>
      {/*
        ⚠️ The safe-area inset is padding on the frame, not a transform or a zoom. A TV
        that overscans CROPS pixels at the edges, so the only thing that helps is
        moving the content inward — scaling it would shrink the type as well, which is
        the opposite of what someone sitting ten feet away needs.
      */}
      <main
        className="relative h-screen w-screen overflow-hidden bg-surface text-ink"
        style={{ padding: 'var(--safe-area, 0%)' }}
      >
        {/*
        Both screens paint a semi-transparent wash over the ambient art, so the one
        that is not active must be UNMOUNTED, not just covered — otherwise the home
        shelves read through the details page as ghost images.
      */}
        <AmbientArt src={settings.ambientWash ? ambient : undefined} />
        <div className="absolute inset-0 bg-[radial-gradient(94rem_59rem_at_20%_14%,rgba(30,82,160,.44),rgba(9,15,26,.9)_62%,#080d16_88%)]" />

        {/*
          ⚠️ Hidden while the menu is up. The menu draws its own header — the design
          gives 9a a Store wordmark, an input chip and the account — and at 94% scrim
          the page's own header is still faintly legible underneath, which renders as
          a doubled, slightly offset copy of each.
        */}
        {onHome && !menuOpen && (
          <header className="absolute inset-x-14 top-7.5 flex items-center gap-5">
            <span className="text-base font-extrabold uppercase tracking-[0.26em] text-ink">
              Store
            </span>
            <span className="h-4.5 w-px bg-hairline" />
            {/*
              ⚠️ Both routes named, because they are not interchangeable and the design
              says so: Up works here and only here, ☰ works everywhere. The old chip
              for Browse by Tag is gone — the Up menu is the route to it now, along
              with Search, Wishlist and Settings, none of which the header had room for.
            */}
            <span className="flex items-center gap-3 text-base font-semibold text-ink-3/45">
              {`${glyphFor('up', inputSource).label} for menu (${directionalName(inputSource)})`}
              <span className="h-4.5 w-px bg-hairline" />
              {`${glyphFor('menu', inputSource).label} from anywhere`}
            </span>

            <span className="ml-auto flex items-center gap-4.5">
              {/* Which device the prompts are currently speaking for. Worth stating
                plainly: this box is driven by a pad AND by a keyboard over SSH. */}
              <span className="flex items-center gap-2.25 rounded-full bg-ok-wash px-3.5 py-1.75 text-sm font-semibold text-pad-ok">
                <span className="h-2.25 w-2.25 rounded-full bg-ok" />
                {inputSource === 'gamepad' ? 'Controller' : 'Keyboard'}
              </span>
              {settings.showClock && <Clock hour24={settings.clock24h} />}
              <AccountChip session={session} />
            </span>
          </header>
        )}

        {onHome && (state.status === 'loading' || (state.status === 'ready' && hydrating)) && (
          <div className="absolute left-14 top-24 text-2xl text-ink-3/50">Loading Steam…</div>
        )}

        {onHome && state.status === 'error' && (
          <div className="absolute left-14 top-24 text-2xl text-amber-400">
            <div>Could not load the store.</div>
            <div className="mt-2 text-xl text-ink-3/50">{state.message}</div>
          </div>
        )}

        {onHome && state.status === 'ready' && !hydrating && (
          // The enter animation lives on this wrapper, not on the track below — that
          // one's transform belongs to the scroll spring and the two would fight.
          <motion.div
            key="home"
            {...PAGE_ENTER}
            /*
              ⚠️ `pt-4` is headroom for the focused tile's bloom, not spacing.

              The stack scrolls the focused SECTION flush against this box's content
              edge (`y.set(-section.offsetTop)`), so the only room above the focused
              card is its own heading — 2.77rem. Turn 12's bloom reaches 3.375rem, and
              the missing 0.6rem came back as a hard horizontal line across the page,
              because THIS is an `overflow-hidden` on both axes and no amount of fixing
              `Shelf.tsx` reaches it.

              It cannot be solved with `overflow-clip-margin` here the way it was on the
              shelf: this box clips vertically on purpose, and letting content bleed
              upward would show the previous row sliding under the header.

              Everything is rem, so clearing it once clears it at every ui scale.
            */
            className="absolute inset-x-0 bottom-18.5 top-24 overflow-hidden pb-4 pt-4"
          >
            <motion.div
              ref={stackRef}
              className="flex flex-col gap-3 will-change-transform"
              style={{ y }}
            >
              {rows.map((row, rowIndex) => (
                <Shelf
                  key={row.id}
                  row={row}
                  focusedCol={focus.row === rowIndex ? focus.col : null}
                  previewUrl={focus.row === rowIndex ? preview.microUrl : undefined}
                  proton={focus.row === rowIndex ? rowRatings : undefined}
                  source={inputSource}
                  padActive={inputSource === 'gamepad'}
                  onActivate={(appid) => void openInSteam(appid)}
                  onFocusItem={(col) => focusItem({ row: rowIndex, col })}
                />
              ))}

              {calendar && (
                <CalendarBand
                  days={calendar.days}
                  focusedDay={onCalendarRow ? focus.col : null}
                  expandedDay={expandedDay}
                  onOpenDay={(index) => {
                    focusItem({ row: rows.length, col: 0 })
                    setExpandedDay(index)
                  }}
                  // Keep the focused day inside the five visible columns without
                  // letting the window run past the end. While a day is opened out,
                  // focus.col indexes that day's releases, so freeze on the open day.
                  windowStart={Math.min(
                    Math.max(0, (expandedDay ?? focus.col) - Math.floor(VISIBLE_DAYS / 2)),
                    Math.max(0, calendar.days.length - VISIBLE_DAYS),
                  )}
                  onActivate={(appid) => void openInSteam(appid)}
                />
              )}

              {calendar && calendar.recommended.length > 0 && (
                <CalendarRecommended
                  games={calendar.recommended}
                  focusedIndex={onRecommendedRow ? focus.col : null}
                  onActivate={(appid) => void openInSteam(appid)}
                />
              )}
            </motion.div>
          </motion.div>
        )}

        {view.screen === 'tags' && (
          // Same containing-block trap as search, below: PAGE_ENTER transforms this
          // wrapper, which makes it the containing block for the absolutely positioned
          // screen inside it.
          <motion.div key="tags" {...PAGE_ENTER} className="absolute inset-0">
            <TagPicker
              groups={tagGroups}
              groupIndex={tagGroup}
              tagIndex={tagIndex}
              zone={tagZone}
              totalTagCount={allTags.length}
              preview={tagPreview}
              source={inputSource}
              onActivate={(tag) => {
                setTagResultFocus(0)
                setView({
                  screen: 'tag-results',
                  tagids: [tag.tagid],
                  sortIndex: TAG_SORTS.indexOf(DEFAULT_TAG_SORT),
                  page: 0,
                })
              }}
            />
          </motion.div>
        )}

        {view.screen === 'tag-results' && (
          <motion.div key="tag-results" {...PAGE_ENTER} className="absolute inset-0">
            <TagResults
              tags={view.tagids.flatMap((id) => {
                const tag = allTags.find((t) => t.tagid === id)
                return tag ? [tag] : []
              })}
              sort={browseSort}
              page={view.page}
              state={tagBrowse}
              focusedIndex={spotlightZone ? -1 : tagFocus}
              source={inputSource}
              onActivate={openDetails}
              spotlight={
                spotlights.length > 0 ? (
                  <TagSpotlight
                    games={spotlights}
                    index={spotlightIndex % spotlights.length}
                    focused={spotlightZone}
                    previewUrl={spotlightPreview.microUrl}
                    proton={spotlightProton}
                    source={inputSource}
                    onAdvance={() =>
                      setSpotlightIndex((i) => (i + 1) % Math.max(1, spotlights.length))
                    }
                    onActivate={openDetails}
                  />
                ) : undefined
              }
            />
          </motion.div>
        )}

        {view.screen === 'wishlist' && (
          <motion.div key="wishlist" {...PAGE_ENTER} className="absolute inset-0">
            <WishlistView
              state={wishlist}
              focusedIndex={wishlistFocus}
              page={view.page}
              source={inputSource}
              onActivate={openDetails}
            />
          </motion.div>
        )}

        {view.screen === 'settings' && (
          <motion.div key="settings" {...PAGE_ENTER} className="absolute inset-0">
            <SettingsView
              focus={
                {
                  page: view.page,
                  zone: view.zone,
                  col: view.col,
                  row: view.row,
                  open: view.open === true,
                  cursor: view.cursor,
                } satisfies SettingsFocus
              }
              settings={settings}
              status={status}
              update={update}
              session={session}
              version={clientVersion}
              source={inputSource}
              actionLabel={{ ...updateActionLabel, ...protonActionLabel }}
              dump={protonDump}
              onActivate={(col, row) => {
                // ⚠️ `open: false` — clicking a different row must not leave the
                // previous one's list open behind the new focus.
                setView({ ...view, zone: 'rows', col, row, open: false, cursor: undefined })
                const page = SETTINGS_PAGES[view.page]!
                const target = (col === 0 ? page.colA.rows : page.colB.rows)[row]
                if (target) activateRow(target)
              }}
            />
          </motion.div>
        )}

        {view.screen === 'search' && (
          // ⚠️ `absolute inset-0` is load-bearing, not cosmetic. PAGE_ENTER animates
          // `y`, so Motion puts a transform on this wrapper — and a transformed element
          // becomes the containing block for every absolutely positioned descendant.
          // With no size of its own (its only child is absolute) it measured 0 tall, so
          // the screen inside resolved `top-0 bottom-18.5` against nothing and collapsed
          // to 117px. The home wrapper never hit this because it carries its own
          // positioning classes.
          <motion.div key="search" {...PAGE_ENTER} className="absolute inset-0">
            <SearchView
              query={query}
              focus={searchFocus}
              results={searchResults}
              resultFocus={resultFocus}
              source={inputSource}
              onResults={onResults}
            />
          </motion.div>
        )}

        {view.screen === 'bundle' && (
          <BundlePage
            key={`bundle-${view.bundleid}`}
            bundle={bundle.bundle}
            facts={bundle.facts}
            ratings={new Map(bundleRatings)}
            loading={bundle.loading}
            index={bundleIndex}
            onPick={(cardIndex) => {
              // Focus follows the pointer here too, so B and the dpad resume from the
              // card that was clicked rather than from wherever the cursor had been.
              setBundleIndex(cardIndex)
              const appid = bundle.bundle?.appids[cardIndex]
              if (appid !== undefined) {
                const facts = bundle.facts.get(appid)
                openDetails(appid, { name: facts?.name, art: facts?.headerUrl })
              }
            }}
            source={inputSource}
          />
        )}

        {view.screen === 'details' && (
          // Same containing-block trap as search, above.
          <motion.div key={`details-${view.appid}`} {...PAGE_ENTER} className="absolute inset-0">
            <DetailsPage
              state={detailsState}
              proton={proton}
              preview={preview}
              fallbackArt={view.hint?.art}
              fallbackName={view.hint?.name}
              screen={view.page}
              zone={detailZone}
              offers={offers}
              offerRow={offerRow}
              offerCol={offerCol}
              onPickOffer={activateOffer}
              mediaIndex={mediaIndex}
              muted={trailerMuted}
              sectionIndex={sectionIndex}
              sectionExpanded={sectionExpanded}
              sectionCursor={sectionCursor}
              protonReports={protonReports}
              protonFilters={protonFilters}
              hostGpu={hostGpu}
              deviceLabel={labelFor('deviceProfile', settings.deviceProfile)}
              onAudioChange={onAudioChange}
              source={inputSource}
              onOpenInSteam={() => void openInSteam(view.appid)}
            />
          </motion.div>
        )}

        {/*
          ⚠️ Outside the AnimatePresence that swaps screens, and above it. The menu is
          raised OVER whatever you were looking at rather than replacing it — that is
          what makes "focus opens on where you already are" mean anything — so it must
          not participate in the page transition that would slide the thing underneath
          out from under it.
        */}
        {/*
          ⚠️ NO `AnimatePresence`, deliberately, and it was here until it caused a real
          bug: the exit animation ran, the overlay reached `opacity: 0` — and then was
          never unmounted. What stayed behind was a full-screen `absolute inset-0 z-20`
          element, invisible, swallowing every click on the screen underneath. Adding
          the `key` AnimatePresence wants did not fix it (this is inside StrictMode,
          which double-invokes its presence bookkeeping).
          
          A 160ms fade out is not worth a failure mode that is silent on a pad — you
          only find it with a mouse — so the menu simply unmounts. It still fades IN,
          which is the half anyone notices.
        */}
        {menuIndex !== null && (
          <UpMenu
            index={menuIndex}
            current={currentDestination(view.screen)}
            disabled={menuDisabled}
            badge={badge}
            session={session}
            source={inputSource}
            onActivate={openMenuEntry}
          />
        )}

        <ButtonLegend
          screen={
            view.screen === 'settings' && view.open === true ? 'settings-picker' : view.screen
          }
          source={inputSource}
          extra={
            /*
             * X's one and only job, shown on the one screen that has audio. It stays
             * honest about the exception: Steam's microtrailers carry no audio stream
             * at all, so on those it reads NO AUDIO dimmed rather than offering a
             * keypress that would do nothing. The tag carousel gets no X hint, because
             * X does nothing there — a pause used to live on it and was removed rather
             * than let one button mean two things a screen apart.
             */
            /*
             * ⚠️ The offers block reassigns BOTH A and X, so the tray has to say so.
             * A on the details page normally hands off to Steam; down in the offers it
             * walks into a game or a bundle page, and X — which is sound everywhere
             * else on this screen — becomes the Steam handoff. Leaving the standing
             * hints up would have the tray describing the wrong two buttons on the one
             * screen where the wrong press costs you your place.
             */
            view.screen === 'details' && detailZone === 'offers'
              ? [
                  {
                    action: 'accept' as const,
                    label:
                      offerRow === 0
                        ? 'OPEN IN STEAM'
                        : offerCol !== undefined
                          ? 'OPEN SELECTED GAME'
                          : 'OPEN BUNDLE PAGE',
                  },
                  ...(offerRow === 0
                    ? []
                    : [{ action: 'secondary' as const, label: 'BUY IN STEAM' }]),
                ]
              : view.screen === 'details' && view.page === 0 && trailerHasAudio !== undefined
                ? [
                    trailerHasAudio
                      ? {
                          action: 'secondary' as const,
                          label: trailerMuted ? 'SOUND ON' : 'MUTE',
                        }
                      : {
                          action: 'secondary' as const,
                          label: 'NO AUDIO',
                          dimmed: true,
                        },
                  ]
                : /*
                   * The ProtonDB tab's A changes meaning with the archive, so the tray
                   * says which one it is. ⚠️ This is the exception that proves the rule
                   * about contextual glyphs: A here either spends 66 MB or opens a
                   * filter list, and those are far enough apart that a single static
                   * "SELECT" would be the misleading option.
                   */
                  view.screen === 'details' && view.page === 2
                  ? protonReports.phase === 'ready'
                    ? [{ action: 'accept' as const, label: sectionExpanded ? 'CHOOSE' : 'FILTER' }]
                    : protonReports.phase === 'unavailable'
                      ? []
                      : [{ action: 'accept' as const, label: 'DOWNLOAD ARCHIVE' }]
                  : []
          }
        />
        <ControllerHud
          position={
            onHome
              ? `shelf ${focus.row + 1}/${rows.length + (calendarDays > 0 ? 2 : 0)} · col ${focus.col + 1}`
              : undefined
          }
        />
      </main>
    </MotionConfig>
  )
}
