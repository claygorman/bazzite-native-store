import type { ReactNode } from 'react'

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info'

const TONE: Record<StatusTone, { wash: string; ink: string; dot: string }> = {
  ok: { wash: 'bg-ok-wash', ink: 'text-pad-ok', dot: 'bg-ok' },
  warn: { wash: 'bg-warn-wash', ink: 'text-warn', dot: 'bg-warn' },
  bad: { wash: 'bg-bad-wash', ink: 'text-bad', dot: 'bg-bad' },
  info: { wash: 'bg-info-wash', ink: 'text-focus-ink', dot: 'bg-focus' },
}

export type Stat = { label: string; value: string }

type Props = {
  tone: StatusTone
  /** The headline claim — "Up to date", "Deal feed degraded". */
  pill: string
  /** One line of context beside the pill. */
  sub?: string
  /** Up to four facts. Fewer is fine; padding it out with filler is not. */
  stats?: readonly Stat[]
  /** Anything richer than a stat quartet — the cache bars, the service list. */
  children?: ReactNode
}

/**
 * The card every settings page opens with.
 *
 * > Every page answers a status question before it offers a control. From ten feet
 * > away, that card is often the whole reason someone came here, and they leave
 * > without touching a row.
 *
 * ⚠️ Not focusable, and it holds no controls. Its action — "Check for updates",
 * "Re-check services" — lives as an ordinary row in a column instead, because the doc
 * gives focus exactly two homes (a row, or the page via LB/RB) and a third focusable
 * region floating above them would need its own rule for how you leave it. The one
 * thing lost is the design's focus-lands-on-the-action behaviour on Updates; the
 * action is instead the first row of the first column, which is where focus lands
 * anyway.
 *
 * ⚠️ A stat with nothing behind it is dropped, not rendered blank. `host_info` returns
 * `None` for every field off Linux, so on a Mac this card shows what it can and says
 * nothing about the rest — which is the honest reading of "we could not look".
 */
export const StatusCard = ({ tone, pill, sub, stats, children }: Props) => {
  const t = TONE[tone]
  const present = (stats ?? []).filter((s) => s.value.length > 0)
  return (
    <div className="flex shrink-0 items-center gap-9 rounded-xl border border-hairline bg-plate px-7.5 py-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3.5">
          <span
            className={`flex items-center gap-2.5 rounded-full px-3.5 py-1.75 text-base font-semibold ${t.wash} ${t.ink}`}
          >
            <span className={`size-2.5 rounded-full ${t.dot}`} />
            {pill}
          </span>
          {sub !== undefined && sub.length > 0 && (
            <span className="text-base font-medium text-ink-faint">{sub}</span>
          )}
        </div>

        {present.length > 0 && (
          <div className="grid grid-cols-4 gap-5">
            {present.map((stat) => (
              <span key={stat.label} className="flex min-w-0 flex-col gap-1.75">
                <span className="text-sm font-bold uppercase tracking-widest text-ink-faint">
                  {stat.label}
                </span>
                {/* `break-words` because a kernel string is one 30-character token and
                    will otherwise push the grid wider than the card. */}
                <span className="text-lg font-semibold leading-tight tabular-nums text-ink break-words">
                  {stat.value}
                </span>
              </span>
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  )
}

/** The Downloads page's cache breakdown — one stacked bar plus a legend. */
export const CacheBars = ({
  segments,
  empty,
}: {
  segments: readonly { label: string; bytes: number; size: string; color: string }[]
  empty: string
}) => {
  const total = segments.reduce((n, s) => n + s.bytes, 0)
  if (total === 0) return <span className="text-base font-medium text-ink-faint">{empty}</span>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-4 overflow-hidden rounded-full bg-chip-soft">
        {segments.map((s) => (
          <span
            key={s.label}
            style={{ width: `${(s.bytes / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6.5 gap-y-2">
        {segments.map((s) => (
          <span
            key={s.label}
            className="flex items-center gap-2.25 text-base font-semibold text-ink-mute"
          >
            <span className="size-2.75 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="tabular-nums text-ink-faint">{s.size}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** The Network page's four upstreams. */
export const ServiceList = ({
  services,
}: {
  services: readonly { label: string; state: StatusTone; value: string }[]
}) => (
  <div className="grid grid-cols-2 gap-x-8.5 gap-y-3">
    {services.map((s) => (
      <span
        key={s.label}
        className="flex min-w-0 items-center gap-2.75 text-lg font-semibold text-ink-mute"
      >
        <span className={`size-2.75 shrink-0 rounded-full ${TONE[s.state].dot}`} />
        {s.label}
        <span className="ml-auto tabular-nums text-ink-faint">{s.value}</span>
      </span>
    ))}
  </div>
)
