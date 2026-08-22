import { currentGlyphSet, glyphFor, type InputSource } from '../platform/glyphs'
import type { InputAction } from '../platform/gamepadMapping'

/**
 * The pad, drawn.
 *
 * Ported from `Controller Glyphs.dc.html`, which the design file describes as
 * "extracted from the attached Figma file at its own geometry: 24px art in a 32px
 * frame, fill rgb(214,225,246) on plate rgb(28,33,42), letters Segoe UI Bold 17px".
 * The paths below are that file's, unmodified.
 *
 * ⚠️ These replace lettered pills. A white circle with an `A` in it is a *description*
 * of the button; the dpad cross, the bumper silhouette and the ☰ disc are the button.
 * At three metres that is the difference between reading a hint and recognising one.
 *
 * ⚠️ SVG rather than an icon font or images: it inherits `currentColor` where it should,
 * scales with the rem-based layout for free, and adds nothing for the Flatpak sandbox
 * or a CSP to resolve.
 */

/** The mono fill the whole sheet uses, and the ink that sits on it. */
const MONO = 'rgb(214,225,246)'
const ON_GLYPH = 'rgb(28,33,42)'

/**
 * The four face colours, straight from the design file.
 *
 * ⚠️ Xbox only. The artboards' own hint bars draw them coloured — `9a` has a green A
 * and a red B, `8a` adds the yellow Y — so colour is the client's house style, not a
 * decoration. But it is *this pad's* house style: a DualSense's face buttons are
 * unlit grey and a Switch's are unlabelled, so inventing colours for those sets would
 * be drawing a controller nobody owns. Every other set renders mono, which is what the
 * glyph sheet's own hint-bar sample shows.
 */
const FACE_COLOR: Record<string, string> = {
  A: 'rgb(85,164,59)',
  B: 'rgb(218,23,37)',
  X: 'rgb(3,154,201)',
  Y: 'rgb(241,213,20)',
}

/** Which drawing each action gets. Keyboard prompts never reach here. */
type Art =
  | { kind: 'face' }
  | { kind: 'dpad'; rotate: string }
  | { kind: 'bumper'; flip: boolean }
  | { kind: 'menu' }
  | { kind: 'view' }

const ART: Record<InputAction, Art> = {
  accept: { kind: 'face' },
  back: { kind: 'face' },
  search: { kind: 'face' },
  secondary: { kind: 'face' },
  // The sheet's dpad is drawn pointing LEFT at rotate(0); the rest are rotations of it.
  left: { kind: 'dpad', rotate: 'rotate(0 16 16)' },
  up: { kind: 'dpad', rotate: 'rotate(90 16 16)' },
  right: { kind: 'dpad', rotate: 'rotate(180 16 16)' },
  down: { kind: 'dpad', rotate: 'rotate(270 16 16)' },
  shelfPrev: { kind: 'bumper', flip: false },
  shelfNext: { kind: 'bumper', flip: true },
  // > The file draws bumpers only. LT and RT reuse the bumper silhouette with their
  // > own lettering, which is the convention the rest of the client already follows.
  pagePrev: { kind: 'bumper', flip: false },
  pageNext: { kind: 'bumper', flip: true },
  menu: { kind: 'menu' },
  hud: { kind: 'view' },
}

/**
 * `glyphs/dpad-union.svg` — the whole cross, solid. "The dpad", as a noun.
 *
 * ⚠️ Not what a DIRECTION prompt uses. See `DPAD_ARM_OUTLINE` below; getting these two
 * round the wrong way draws a full cross for "press up", which says nothing about up.
 *
 * Exported rather than inlined because no prompt in the app currently means "the dpad,
 * generally" — every direction hint is a specific direction. It is here so the ported
 * kit is complete, and so the next screen that wants it does not redraw it.
 */
export const DPAD_UNION_PATH =
  'M 7.5 8 C 7.776 8 8 7.776 8 7.5 L 8 0.5 C 8 0.224 8.224 0 8.5 0 L 15.5 0 C 15.776 0 16 0.224 16 0.5 L 16 7.5 C 16 7.776 16.224 8 16.5 8 L 23.5 8 C 23.776 8 24 8.224 24 8.5 L 24 15.5 C 24 15.776 23.776 16 23.5 16 L 16.5 16 C 16.224 16 16 16.224 16 16.5 L 16 23.5 C 16 23.776 15.776 24 15.5 24 L 8.5 24 C 8.224 24 8 23.776 8 23.5 L 8 16.5 C 8 16.224 7.776 16 7.5 16 L 0.5 16 C 0.224 16 0 15.776 0 15.5 L 0 8.5 C 0 8.224 0.224 8 0.5 8 L 7.5 8 Z'

/**
 * `glyphs/dpad-left.svg` — the cross drawn as an OUTLINE, so that one solid arm can be
 * laid over it. Drawn pointing left; every other direction is a rotation of it, which
 * is exactly how the sheet enumerates them (left 0°, up 90°, right 180°, down 270°).
 */
const DPAD_ARM_OUTLINE =
  'M 0.8 7 C 0.91 7 1 6.91 1 6.8 L 1 1.2 C 1 1.09 1.09 1 1.2 1 L 6.8 1 C 6.91 1 7 1.09 7 1.2 L 7 7.5 C 7 8.328 7.672 9 8.5 9 L 14.8 9 C 14.91 9 15 9.09 15 9.2 L 15 14.8 C 15 14.91 14.91 15 14.8 15 L 8.5 15 C 7.672 15 7 15.672 7 16.5 L 7 22.8 C 7 22.91 6.91 23 6.8 23 L 1.2 23 C 1.09 23 1 22.91 1 22.8 L 1 17.2 C 1 17.09 0.91 17 0.8 17 L 0.2 17 C 0.09 17 0 17.09 0 17.2 L 0 23.5 C 0 23.776 0.224 24 0.5 24 L 7.5 24 C 7.776 24 8 23.776 8 23.5 L 8 16.5 C 8 16.224 8.224 16 8.5 16 L 15.5 16 C 15.776 16 16 15.776 16 15.5 L 16 8.5 C 16 8.224 15.776 8 15.5 8 L 8.5 8 C 8.224 8 8 7.776 8 7.5 L 8 0.5 C 8 0.224 7.776 0 7.5 0 L 0.5 0 C 0.224 0 0 0.224 0 0.5 L 0 6.8 C 0 6.91 0.09 7 0.2 7 L 0.8 7 Z'

/**
 * ⚠️ The sheet also carries stick glyphs — left/right, at rest, tilted, pressed, and
 * with direction arrows. None are ported, because no prompt in this app ever names a
 * stick: the left stick mirrors the dpad (`stickMovesFocus`) and is never a binding of
 * its own, so a stick hint would be teaching a control that does not exist. Add them
 * from `Controller Glyphs.dc.html` the day one does.
 */
const BUMPER_PATH =
  'M 0.56 9.225 L 0.112 19.448 C 0.051 20.839 1.162 22 2.554 22 L 33.394 22 C 34.535 22 35.524 21.211 35.777 20.099 L 38.645 7.52 C 38.861 6.575 38.497 5.591 37.719 5.013 L 31.666 0.521 C 31.282 0.236 30.821 0.068 30.344 0.048 C 16.625 -0.537 5.988 4.356 1.513 7.441 C 0.926 7.845 0.591 8.512 0.56 9.225 Z'

/**
 * ⚠️ `Segoe UI` first, because that is the face the sheet was drawn with and it is what
 * makes an `A` sit correctly inside a 24px circle. It does not exist on Bazzite, so
 * Archivo — the app's own face — catches it, and the geometry was checked against both.
 */
const LETTER_FONT = 'Segoe UI, Archivo, sans-serif'

const Letter = ({ text, x, y, size = 17 }: { text: string; x: number; y: number; size?: number }) => (
  <text
    x={x}
    y={y}
    textAnchor="middle"
    dominantBaseline="central"
    fontFamily={LETTER_FONT}
    fontWeight="700"
    fontSize={size}
    fill={ON_GLYPH}
  >
    {text}
  </text>
)

export const ControllerGlyph = ({
  action,
  source,
  className = '',
}: {
  action: InputAction
  source: InputSource
  className?: string
}) => {
  const glyph = glyphFor(action, source)

  // A keyboard is not a pad. Telling someone at a keyboard to "press A" is wrong twice
  // over, and drawing them a bumper is wrong three times.
  if (source === 'keyboard') {
    return (
      <span
        className={`grid h-7 min-w-8.5 shrink-0 place-items-center rounded-md bg-chip-strong px-2 text-sm font-extrabold text-ink ${className}`}
      >
        {glyph.label}
      </span>
    )
  }

  const art = ART[action]

  if (art.kind === 'bumper') {
    return (
      <svg
        viewBox="0 0 39 22"
        aria-hidden
        className={`h-4.75 w-8.5 shrink-0 ${className}`}
        fill={MONO}
      >
        {/* Mirrored for the right-hand pair, which is how the sheet draws RB and RT. */}
        <g transform={art.flip ? 'translate(39,0) scale(-1,1)' : undefined}>
          <path d={BUMPER_PATH} />
        </g>
        {/* Outside the flipped group, or the lettering would be mirrored too. */}
        <Letter text={glyph.label} x={19.5} y={12.5} />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden className={`size-7.5 shrink-0 ${className}`} fill={MONO}>
      {art.kind === 'dpad' ? (
        <g transform={art.rotate}>
          <g transform="translate(4,4)">
            {/* The solid arm — the one this prompt is actually about — then the
                outline of the other three, so the cross reads as a whole. */}
            <rect x="0" y="8" width="8" height="8" rx="0.5" />
            <g transform="translate(8,0)">
              <path d={DPAD_ARM_OUTLINE} fillRule="evenodd" />
            </g>
          </g>
        </g>
      ) : (
        <>
          <circle
            cx="16"
            cy="16"
            r="12"
            fill={
              art.kind === 'face' && currentGlyphSet() === 'xbox'
                ? (FACE_COLOR[glyph.label] ?? MONO)
                : MONO
            }
          />
          {art.kind === 'face' && <Letter text={glyph.label} x={16} y={16} />}
          {art.kind === 'menu' && (
            // ☰ — three bars, the Xbox Menu button.
            <>
              <rect x="9" y="10.75" width="14" height="1.5" rx="0.25" fill={ON_GLYPH} />
              <rect x="9" y="15.25" width="14" height="1.5" rx="0.25" fill={ON_GLYPH} />
              <rect x="9" y="19.75" width="14" height="1.5" rx="0.25" fill={ON_GLYPH} />
            </>
          )}
          {art.kind === 'view' && (
            // ⊟ — the two overlapping panes of the Xbox View button.
            <>
              <rect
                x="13.5"
                y="14.5"
                width="10"
                height="8"
                rx="0.5"
                fill={MONO}
                stroke={ON_GLYPH}
                strokeWidth="1.5"
              />
              <path
                transform="translate(9,10)"
                fill={ON_GLYPH}
                fillRule="evenodd"
                d="M 1.5 6.5 L 1.5 1.5 L 8.5 1.5 L 8.5 3.5 L 10 3.5 L 10 0.5 C 10 0.224 9.776 0 9.5 0 L 0.5 0 C 0.224 0 0 0.224 0 0.5 L 0 7.5 C 0 7.776 0.224 8 0.5 8 L 3.5 8 L 3.5 6.5 L 1.5 6.5 Z"
              />
            </>
          )}
        </>
      )}
    </svg>
  )
}
