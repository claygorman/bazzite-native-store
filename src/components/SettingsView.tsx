import { useEffect, useRef, type RefObject } from 'react'
import { Prompt } from './ButtonLegend'
import { SettingsRow } from './settings/SettingsRow'
import { CacheBars, ServiceList, StatusCard, type StatusTone } from './settings/StatusCard'
import { SETTINGS_PAGES, type RowAction, type SettingsPage } from './settings/pages'
import { formatAge, formatBytes } from '../platform/systemInfo'
import { healthSummary, type ServiceHealth } from '../platform/serviceHealth'
import { describeUpdate, type UpdateState } from '../platform/updates'
import { labelFor, type Settings } from '../platform/settings'
import type { SystemStatus } from '../hooks/useSystemStatus'
import type { DumpState } from '../platform/protonDump'
import type { InputSource } from '../platform/glyphs'
import type { SessionState } from '../platform/auth'

/**
 * Where focus sits: which page, which side, and which row of it.
 *
 * ⚠️ `zone` exists because the rail IS focusable here, against the ideology doc's
 * "the rail is never focused directly". Left off column A reaches it, which is how
 * you change page without knowing what a shoulder button is.
 */
export type SettingsFocus = {
  page: number
  zone: 'rail' | 'rows'
  col: number
  row: number
  /** A has opened the focused stepper's list of values. */
  open: boolean
  /** Where the dpad sits inside that list — not the committed value. */
  cursor?: number
}

type Props = {
  focus: SettingsFocus
  settings: Settings
  status: SystemStatus
  update: UpdateState
  session: SessionState
  version: string
  source: InputSource
  /**
   * Faces that depend on state rather than on the row.
   *
   * ⚠️ Only `check-updates` uses it, and only because that one row is three actions
   * wearing one hat: Check, then Install, then Restart. A second row for each would
   * be two dead rows most of the time, which is what the doc means by "a button is an
   * action, not a state".
   */
  /**
   * Per-action overrides for a button row's FACE and its description.
   *
   * ⚠️ The description is overridable because turn 13a makes the row copy do work that
   * a static string cannot: "Nothing to cancel — the download is already on disk"
   * while indexing, "Your snapshot still works. Fetching is a choice, not a repair"
   * when a newer snapshot exists. Those sentences are the difference between a state
   * reading as a fault and reading as a choice.
   */
  actionLabel?: Partial<Record<RowAction, { label?: string; desc?: string }>>
  /** The ProtonDB snapshot's state, for the Compatibility card — turn 13a. */
  dump: { state: DumpState }
  /** Clicking a row focuses it and fires it, so a mouse behaves like the dpad. */
  onActivate: (col: number, row: number) => void
}

/**
 * Settings — design 8a–8g, with `Settings ideology.md` as the specification.
 *
 * A 22rem rail, a status card, then two columns of rows. The rail is **never
 * focused**: it is a position indicator that LB/RB drives, which is what lets every
 * dpad press belong to a row.
 *
 * ⚠️ Nothing here has a Save. Every change applies on press and the card above
 * reflects it, which is also why the card is not decoration — it is the confirmation.
 *
 * ⚠️ Roughly a dozen rows the artboards draw are missing. They are not oversights; see
 * `docs/SETTINGS.md`, and the rule that produced all of them: *no setting for
 * something the client does not own*.
 */
export const SettingsView = ({
  focus,
  settings,
  status,
  update,
  session,
  version,
  source,
  actionLabel,
  dump,
  onActivate,
}: Props) => {
  const page = SETTINGS_PAGES[focus.page] ?? SETTINGS_PAGES[0]!
  const onRail = focus.zone === 'rail'

  /*
   * Keep the focused row on screen.
   *
   * ⚠️ Needed because an open stepper GROWS its row — a five-value list is about
   * 8rem taller than the control it replaces — which can push the rows below it past
   * the fold. The grid scrolls, but nothing on a controller can drive a scrollbar, so
   * without this the row you are editing can end up under the button tray.
   *
   * ⚠️ `block: 'nearest'` and no smooth behaviour. 'nearest' scrolls only when the row
   * is actually out of view, so walking rows that already fit does not jiggle the
   * column; instant because a scroll animation here would fight `Reduce motion` and,
   * at ten feet, arriving is worth more than travelling.
   */
  const focusedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focus.page, focus.zone, focus.col, focus.row, focus.open])

  return (
    <div className="absolute inset-x-0 bottom-18.5 top-0 flex flex-col gap-6 px-14 py-7.5">
      <header className="flex shrink-0 items-center gap-5">
        <span className="text-base font-extrabold uppercase tracking-[0.26em] text-ink">Store</span>
        <span className="h-4.5 w-px bg-hairline" />
        <span className="text-base font-semibold text-ink-3/45">Settings</span>
      </header>

      <div className="flex shrink-0 items-baseline gap-5">
        <h1 className="text-display font-extrabold tracking-display text-ink">{page.title}</h1>
        <span className="text-xl font-medium text-ink-3/55">
          {session.status === 'signed-in'
            ? `Signed in as ${session.player?.personaname ?? session.steamid}`
            : 'Not signed in'}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-8">
        {/* The rail. Driven by LB/RB, never focusable — see the ideology doc §5. */}
        {/*
          ⚠️ 22rem is the artboard's 352px, converted — 352 ÷ 16, per DESIGN-PORT §1.
          This shipped at `w-44`, which is 11rem: exactly half, and almost certainly a
          44-for-88 slip rather than a decision.

          The symptom that exposed it was "Downloads & Storage" wrapping to two lines,
          leaving one entry 110px tall against its neighbours' 71. That page is now
          just "Storage", so no label currently needs the room — but the slip was real
          and 22rem is the specified value, so it stays. Do not re-derive this width
          from whatever the longest label happens to be this week.

          Vertically tighter than the artboard on purpose — seven entries share the
          height with a status card, and the extra width means less of it is needed.
        */}
        <nav className="flex w-88 shrink-0 flex-col gap-1">
          {SETTINGS_PAGES.map((p, i) => (
            /*
              ⚠️ Two states, not one. Which page you are ON is a permanent fact of the
              screen; whether the rail HOLDS FOCUS is where the next press goes. The
              selected entry stays lit while you are off in the rows — otherwise
              stepping right would appear to leave the page you are looking at — and
              the glow is what says the arrows belong to the rail now.
            */
            <span
              key={p.id}
              className={[
                'flex items-center gap-3.5 rounded-lg px-4.5 py-3 text-xl font-semibold',
                'transition-colors duration-150',
                i === focus.page ? 'bg-info-wash text-focus-ink' : 'text-ink-2/60',
                i === focus.page && onRail ? 'shadow-focused-bare' : '',
              ].join(' ')}
            >
              {/*
                ⚠️ `shrink-0`. Without it this bar is a flex child with no minimum, so
                the longest UNBREAKABLE label squeezes it to zero width and the entry
                loses its "you are here" mark while every other page keeps one. It
                showed up on Compatibility alone — "Downloads & Storage" is two words
                and wraps, so it never forced the issue.
              */}
              <span
                className={`w-1 shrink-0 rounded-sm bg-focus transition-all duration-150 ${
                  i === focus.page
                    ? onRail
                      ? 'h-8 opacity-100'
                      : 'h-5.5 opacity-100'
                    : 'h-5.5 opacity-0'
                }`}
              />
              {p.title}
            </span>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6.5">
          <PageStatus
            page={page}
            settings={settings}
            status={status}
            update={update}
            version={version}
            dump={dump}
          />

          {/*
            ⚠️ `-m-1.5 p-1.5` — the rows draw an INSET ring, but the focus glow
            (`shadow-focused-bare`) still reaches outside the box. Without the padding
            it is clipped against the column gap on one side only, which reads as a
            stray edge rather than a glow. Same rule as Shelf.tsx and TagSpotlight.tsx.
          */}
          <div className="-m-1.5 grid min-h-0 flex-1 grid-cols-2 content-start gap-x-7 gap-y-3 overflow-y-auto p-1.5">
            <Column
              title={page.colA.title}
              rows={page.colA.rows}
              settings={settings}
              actionLabel={actionLabel}
              focusedRow={!onRail && focus.col === 0 ? focus.row : -1}
              openRow={focus.open}
              cursorRow={focus.cursor}
              focusedRef={focusedRef}
              onActivate={(i) => onActivate(0, i)}
            />
            <Column
              title={page.colB.title}
              rows={page.colB.rows}
              settings={settings}
              actionLabel={actionLabel}
              focusedRow={!onRail && focus.col === 1 ? focus.row : -1}
              openRow={focus.open}
              cursorRow={focus.cursor}
              focusedRef={focusedRef}
              onActivate={(i) => onActivate(1, i)}
            />
          </div>
        </div>
      </div>

      {/* The hint bar says exactly this on every settings page and nothing more. */}
      <span className="sr-only">
        <Prompt action="accept" source={source} />
      </span>
    </div>
  )
}

const Column = ({
  title,
  rows,
  settings,
  actionLabel,
  focusedRow,
  openRow,
  cursorRow,
  focusedRef,
  onActivate,
}: {
  title: string
  rows: SettingsPage['colA']['rows']
  settings: Settings
  /**
   * Per-action overrides for a button row's FACE and its description.
   *
   * ⚠️ The description is overridable because turn 13a makes the row copy do work that
   * a static string cannot: "Nothing to cancel — the download is already on disk"
   * while indexing, "Your snapshot still works. Fetching is a choice, not a repair"
   * when a newer snapshot exists. Those sentences are the difference between a state
   * reading as a fault and reading as a choice.
   */
  actionLabel?: Partial<Record<RowAction, { label?: string; desc?: string }>>
  focusedRow: number
  openRow: boolean
  cursorRow?: number
  focusedRef: RefObject<HTMLButtonElement | null>
  onActivate: (index: number) => void
}) => (
  <div className="flex min-w-0 flex-col gap-3">
    <span className="text-sm font-bold uppercase tracking-widest text-ink-faint">{title}</span>
    {rows.map((row, i) => (
      <SettingsRow
        key={row.kind === 'button' ? row.action : row.key}
        row={row}
        settings={settings}
        action={row.kind === 'button' ? actionLabel?.[row.action] : undefined}
        focused={i === focusedRow}
        open={i === focusedRow && openRow}
        cursor={cursorRow}
        elementRef={i === focusedRow ? focusedRef : undefined}
        onActivate={() => onActivate(i)}
      />
    ))}
  </div>
)

/* ─────────────────────────── the seven cards ─────────────────────────── */

const SERVICE_TONE: Record<ServiceHealth['state'], StatusTone> = {
  ok: 'ok',
  slow: 'warn',
  down: 'bad',
}

const UPDATE_TONE: Record<UpdateState['status'], StatusTone> = {
  unsupported: 'info',
  unconfigured: 'warn',
  idle: 'info',
  checking: 'info',
  current: 'ok',
  available: 'info',
  downloading: 'info',
  ready: 'ok',
  error: 'bad',
}

/** Cache segment colours, matched to the artboard's own three. */
const HOST_COLOR: Record<string, string> = {
  store: 'var(--color-focus)',
  api: 'var(--color-ok)',
  protondb: 'var(--color-warn)',
  community: 'var(--color-rating-dn)',
  other: 'var(--color-ink-faint)',
}
const HOST_LABEL: Record<string, string> = {
  store: 'Steam store',
  api: 'Steam API',
  protondb: 'ProtonDB',
  community: 'Community',
  other: 'Other',
}

const PageStatus = ({
  page,
  settings,
  status,
  update,
  version,
  dump,
}: {
  page: SettingsPage
  settings: Settings
  status: SystemStatus
  update: UpdateState
  version: string
  /** The ProtonDB snapshot's state — turn 13a's six. */
  dump: { state: DumpState }
}) => {
  const { host, pad, cache, display, steamScale, ourScale, services, probing } = status

  switch (page.id) {
    case 'updates':
      return (
        <StatusCard
          tone={UPDATE_TONE[update.status]}
          pill={describeUpdate(update)}
          sub={
            update.status === 'current' ||
            update.status === 'available' ||
            update.status === 'error'
              ? `Checked ${formatAge(Math.round((Date.now() - update.checkedAt) / 1000))}`
              : update.status === 'unconfigured'
                ? 'No feed URL or signing key in tauri.conf.json'
                : undefined
          }
          stats={[
            { label: 'Client', value: version },
            { label: 'Channel', value: labelFor('updateChannel', settings.updateChannel) },
            { label: 'Bazzite image', value: host.image ?? '' },
            { label: 'Kernel', value: host.kernel ?? '' },
          ]}
        />
      )

    case 'appearance':
      return (
        <StatusCard
          tone="info"
          pill={`Interface at ${settings.uiScalePercent}%`}
          sub={display.hdr === true ? 'HDR available' : undefined}
          stats={[
            { label: 'Viewport', value: display.viewport },
            { label: 'Panel', value: display.physical },
            /*
             * ⚠️ Both scales, side by side, and this is the useful part. Steam derives
             * its own UI scale from the panel's physical size over EDID (2.56 on an
             * 84-inch 4K set) and applies it only to its own windows; ours comes from
             * viewport width. When they disagree, Steam is telling you this display
             * wants a larger UI than our design assumes — which is precisely what the
             * Interface scale row is for.
             */
            { label: 'Our scale', value: `${ourScale.toFixed(2)}×` },
            {
              label: 'Steam picks',
              value: steamScale ? `${steamScale.scale.toFixed(2)}×` : '',
            },
          ]}
        />
      )

    case 'controller':
      return (
        <StatusCard
          tone={pad ? 'ok' : 'warn'}
          pill={pad ? 'Connected' : 'No pad detected'}
          sub={pad?.name}
          stats={[
            {
              label: 'Battery',
              value: pad?.batteryPercent !== undefined ? `${pad.batteryPercent}%` : '',
            },
            { label: 'Power', value: pad?.power ?? '' },
            { label: 'Glyphs', value: labelFor('glyphSet', settings.glyphSet) },
            { label: 'Repeat', value: `${settings.repeatDelayMs} / ${settings.repeatRateMs} ms` },
          ]}
        />
      )

    case 'compatibility': {
      /*
       * Turn 13a's six states, in the card rather than in a row.
       *
       * ⚠️ Status belongs here because the ideology doc allows exactly four controls —
       * toggle, dropdown, button, read-only value — and "downloading" is none of them.
       * Putting it in a row would have invented a fifth control to say something the
       * card already exists to say.
       *
       * ⚠️ `unavailable` and `absent` are DIFFERENT states and must stay so. "This
       * build cannot" and "you have not fetched it" lead to different sentences and
       * different buttons; merging them makes the browser build offer a Download that
       * cannot work.
       */
      const d = dump.state
      const bytes =
        d.total === undefined
          ? undefined
          : `${formatBytes(d.downloaded ?? 0)} of ${formatBytes(d.total)}`
      const card = {
        unavailable: {
          tone: 'info' as const,
          pill: 'Not available in the browser build',
          sub: 'The report archive needs the desktop app — reports come from the API one game at a time',
        },
        absent: {
          tone: 'info' as const,
          pill: 'Not downloaded',
          sub: 'Reports come one game at a time from the API until you fetch a snapshot',
        },
        checking: {
          tone: 'info' as const,
          pill: 'Checking GitHub',
          sub: 'Asking which snapshot is current. No download yet — this costs a few KB',
        },
        downloading: {
          tone: 'info' as const,
          pill: 'Downloading',
          // ⚠️ Falls back to a byte count with no total. A missing `content-length`
          // must read as indeterminate, never as a bar at an invented percentage.
          sub: bytes ?? `${formatBytes(d.downloaded ?? 0)} so far`,
        },
        indexing: {
          tone: 'info' as const,
          pill: 'Indexing',
          sub: 'Building the local database. Around 8 seconds; there is no progress to report inside it',
        },
        ready: {
          tone: 'ok' as const,
          pill: 'Up to date',
          sub: d.snapshot
            ? `Built from the ${d.snapshot} snapshot`
            : 'Built from the local snapshot',
        },
        outdated: {
          tone: 'warn' as const,
          pill: 'Newer snapshot available',
          sub: `You have ${d.snapshot ?? '—'} · ${d.latest ?? 'a newer one'} has been published`,
        },
      }[d.phase]

      const dash = '—'
      return (
        <StatusCard
          tone={card.tone}
          pill={card.pill}
          sub={card.sub}
          stats={[
            { label: 'Snapshot', value: d.snapshot ?? dash },
            { label: 'Reports', value: d.reports?.toLocaleString('en-US') ?? dash },
            { label: 'Games', value: d.games?.toLocaleString('en-US') ?? dash },
            {
              label: 'Ratings cached',
              value: cache.byHost.protondb ? formatBytes(cache.byHost.protondb) : dash,
            },
          ]}
        >
          {d.phase === 'downloading' && d.total !== undefined && (
            <span className="block h-1.5 w-full overflow-hidden rounded-sm bg-chip">
              <span
                className="block h-1.5 rounded-sm bg-focus transition-[width] duration-200"
                style={{ width: `${Math.round(((d.downloaded ?? 0) / d.total) * 100)}%` }}
              />
            </span>
          )}
        </StatusCard>
      )
    }

    case 'downloads': {
      const segments = Object.entries(cache.byHost)
        .filter(([, bytes]) => bytes > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([host_, bytes]) => ({
          label: HOST_LABEL[host_] ?? host_,
          bytes,
          size: formatBytes(bytes),
          color: HOST_COLOR[host_] ?? HOST_COLOR.other!,
        }))
      const limitBytes = settings.cacheLimitMb * 1024 * 1024
      return (
        <StatusCard
          tone={cache.bytes > limitBytes ? 'warn' : 'info'}
          pill={`${formatBytes(cache.bytes)} cached`}
          sub={`${cache.entries} responses · limit ${labelFor('cacheLimitMb', settings.cacheLimitMb)} · newest ${formatAge(cache.newestAgeSeconds)}`}
        >
          {/* Empty is the normal state in the browser build, which has no disk cache
              at all — say that rather than drawing a bar of nothing. */}
          <CacheBars segments={segments} empty="Nothing cached to disk in this build" />
        </StatusCard>
      )
    }

    case 'network':
      return (
        <StatusCard
          tone={
            probing || !services
              ? 'info'
              : services.some((s) => s.state === 'down')
                ? 'bad'
                : services.some((s) => s.state === 'slow')
                  ? 'warn'
                  : 'ok'
          }
          pill={probing ? 'Checking…' : services ? healthSummary(services) : 'Not checked'}
          sub={`Region ${labelFor('region', settings.region)}${settings.offlineMode ? ' · offline mode on' : ''}`}
        >
          {services && (
            <ServiceList
              services={services.map((s) => ({
                label: s.label,
                state: SERVICE_TONE[s.state],
                // ⚠️ No number on a failure — "down · 8000 ms" invites reading our
                // own timeout as a measurement of the service.
                value: s.latencyMs === undefined ? 'no answer' : `${s.latencyMs} ms`,
              }))}
            />
          )}
        </StatusCard>
      )

    default:
      return (
        <StatusCard
          tone="info"
          pill={`Bazzite Store ${version}`}
          sub={host.os}
          stats={[
            { label: 'CPU', value: host.cpu ?? '' },
            { label: 'GPU', value: host.gpu ?? '' },
            { label: 'Memory', value: host.memoryGb ? `${host.memoryGb} GB` : '' },
            { label: 'Display', value: display.physical },
          ]}
        />
      )
  }
}
