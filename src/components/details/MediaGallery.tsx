import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TrailerPreview } from '../../platform/steam'
import type { AppDetails } from '../../types/steam'
import type { InputSource } from '../../platform/glyphs'
import { ControllerGlyph } from '../ControllerGlyph'
import { useHlsVideo } from '../../hooks/useHlsVideo'

export type MediaItem = {
  kind: 'video' | 'image'
  src: string
  thumb: string
  /** True when `src` is an HLS manifest and needs hls.js rather than a bare src. */
  adaptive?: boolean
}

/**
 * Build the gallery: trailer first, then screenshots — the order Steam's own media
 * strip uses, and the order that puts motion in front of the user first.
 */
export const buildGallery = (
  details: AppDetails | undefined,
  preview: TrailerPreview,
  fallbackArt?: string,
): MediaItem[] => {
  const items: MediaItem[] = []

  // Prefer the FULL trailer here — it is the one with audio. The silent micro clip
  // is for tile previews, where a 1.4 MB file that needs no player is the right call.
  const trailer = preview.hlsUrl ?? preview.microUrl
  if (trailer) {
    items.push({
      kind: 'video',
      src: trailer,
      adaptive: preview.hlsUrl !== undefined,
      thumb: preview.thumbnail ?? details?.screenshotThumbs[0] ?? fallbackArt ?? '',
    })
  }

  const shots = details?.screenshots ?? []
  shots.forEach((src, index) => {
    items.push({ kind: 'image', src, thumb: details?.screenshotThumbs[index] ?? src })
  })

  if (items.length === 0 && fallbackArt) {
    items.push({ kind: 'image', src: fallbackArt, thumb: fallbackArt })
  }
  return items
}

type Props = {
  items: MediaItem[]
  index: number
  /** True when the gallery holds controller focus. */
  focused: boolean
  muted: boolean
  /** Reports whether the current clip actually carries audio. undefined = unknown yet. */
  onAudioChange?: (hasAudio: boolean | undefined) => void
  /**
   * Get out of the way — the offers band below has taken focus and lifted over this.
   *
   * ⚠️ Not cosmetic. Everything on this page is absolutely positioned, and the lifted
   * band's `top` puts it ABOVE this element's `top-24`. Without retreating, the gallery
   * simply covers the offers' right-hand column: the first bundle's price, discount and
   * "Open bundle page" button all render underneath the trailer.
   */
  retreated?: boolean
  source: InputSource
}

const THUMB_GAP_REM = 0.625

/**
 * Big frame plus a flattened filmstrip, like Steam's own media viewer.
 *
 * The strip beats a row of dots because on a controller you are choosing between
 * *pictures*, and dots tell you how many there are without telling you what they are.
 * It scrolls by transform for the same reason the shelves do — with a held direction
 * this is asked to move faster than smooth-scroll can service.
 */
/** Inline so there is no asset to load and nothing for a CSP to block. */
const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden className="h-4.5 w-4.5 shrink-0">
    <path
      d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    {muted ? (
      <path
        d="M16 9.5l5 5m0-5l-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    ) : (
      <>
        <path
          d="M15.6 9a4.2 4.2 0 010 6"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M18.2 6.8a7.6 7.6 0 010 10.4"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </>
    )}
  </svg>
)

export const MediaGallery = ({
  items,
  index,
  focused,
  muted,
  onAudioChange,
  retreated,
  source,
}: Props) => {
  const stripRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  /** undefined = not determined yet. */
  const [hasAudio, setHasAudio] = useState<boolean | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  // Guard against a stale index while a new game's details are still loading.
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, items.length - 1))
  const current = items[safeIndex]

  useLayoutEffect(() => {
    const strip = stripRef.current
    const thumb = strip?.children[safeIndex] as HTMLElement | undefined
    if (!strip || !thumb) return
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const max = Math.max(0, strip.scrollWidth - strip.clientWidth)
    // Keep the focused thumbnail one slot in from the left edge so there is always
    // visible context on both sides.
    const target = thumb.offsetLeft - (thumb.offsetWidth + THUMB_GAP_REM * rem)
    setOffset(Math.min(Math.max(0, target), max))
  }, [safeIndex, items.length])

  /*
   * Whether the current source has sound — answered from WHAT IT IS, not by interrogating
   * the decoder.
   *
   * ⚠️ Steam's microtrailers carry NO audio stream at all — verified with ffprobe: a single
   * `vp9, video` stream and nothing else. The full trailer is the adaptive HLS stream, and
   * it does have audio. That is the whole question, and the source already answers it.
   *
   * ⚠️⚠️ **This used to probe `video.webkitAudioDecodedByteCount` / `video.mozHasAudio`
   * after a 1.5s timer, falling through to `report(undefined)` — "no way to tell on this
   * engine".** Both are VENDOR-PREFIXED, and on an engine carrying neither the result was
   * `undefined`, which fails the gate in `App.tsx` (`if (trailerHasAudio) …`). So X did
   * nothing, silently, and the SOUND ON / MUTE hint never appeared. Reported on the macOS
   * build 2026-08-25.
   *
   * ⚠️ The comment that justified the probe was STALE. It said real trailer audio "needs
   * the full stream through libmpv, which does not go through this element" — true when it
   * was written, and settled by SPIKE 2b: libmpv is not needed, `useHlsVideo` plays the
   * full 1080p HLS right here, audio included. The probe was answering a question that had
   * stopped being open, on evidence the engine might not supply.
   *
   * Deriving it also removes the 1.5s window where the control was dead on every engine.
   */
  useEffect(() => {
    if (current?.kind !== 'video') {
      setHasAudio(false)
      onAudioChange?.(false)
      return
    }
    // Adaptive === the full HLS trailer === has sound. Anything else is a microtrailer.
    const audible = current.adaptive === true
    setHasAudio(audible)
    onAudioChange?.(audible)
    // onAudioChange is stable (useCallback in App).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, current?.src, current?.adaptive])

  // ⚠️ `muted` must be driven imperatively. React does not reliably apply it on the
  // initial render of a <video> — the attribute is special-cased — so a declarative
  // `muted={true}` can still mount unmuted. In a living room that means a trailer
  // blaring the instant a page opens, which is exactly what the default is meant to
  // prevent. Set the property directly and keep it in sync.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, current?.src])

  const isAdaptive = current?.kind === 'video' && current.adaptive === true
  const hlsState = useHlsVideo(videoRef, isAdaptive ? current?.src : undefined, isAdaptive)

  if (!current) return null

  return (
    <div
      className={`absolute right-14 top-24 flex w-205 flex-col gap-3 transition-all duration-200 ease-out ${
        retreated ? 'pointer-events-none -translate-y-6 opacity-0' : ''
      }`}
    >
      <div
        className={[
          'relative h-97 w-full overflow-hidden rounded-lg',
          'shadow-[0_1.625rem_4.375rem_rgba(0,0,0,.7)]',
          focused
            ? 'ring-[0.3125rem] ring-focus ring-offset-[0.3125rem] ring-offset-[#080d16]'
            : '',
        ].join(' ')}
      >
        {/* The still stays mounted under the video so a failed clip is invisible. */}
        <img
          key={current.thumb}
          src={current.kind === 'video' ? current.thumb : current.src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {current.kind === 'video' && hlsState !== 'failed' && (
          <video
            ref={videoRef}
            key={current.src}
            // Adaptive streams are attached by hls.js, never by src — a bare
            // manifest src fails outright in WebKitGTK.
            src={isAdaptive ? undefined : current.src}
            autoPlay={!isAdaptive}
            // Also declared, so the element is muted from its very first frame
            // rather than only once the effect above runs.
            muted
            // Full trailers run once; the silent micro clip is a loop by nature.
            loop={!isAdaptive}
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {current.kind === 'video' && (
          <div className="absolute left-4 top-3.5 flex items-center gap-2.5 rounded-sm bg-scrim px-3 py-1.75">
            <span className="h-0 w-0 border-y-[0.375rem] border-l-[0.5625rem] border-y-transparent border-l-ink" />
            {/* Plain label only. The audio probe takes ~1.5s to resolve, so putting
                mute state here made the chip visibly change its mind. The sound hint
                lives in the button tray, where button hints belong. */}
            <span className="text-sm font-bold text-ink">
              {hlsState === 'failed'
                ? 'Trailer unavailable'
                : hlsState === 'loading'
                  ? 'Trailer · loading'
                  : hasAudio === false
                    ? 'Preview'
                    : 'Trailer'}
            </span>
          </div>
        )}
        <span className="absolute right-4 top-3.5 rounded-sm bg-scrim px-3 py-1.75 text-sm font-bold text-ink-2">
          {safeIndex + 1} / {items.length}
        </span>

        {/*
          Audio state, on the image itself. The prompt only appears while the gallery
          holds focus — an unfocused panel advertising a button press is noise — and
          it names the real situation: Steam's microtrailers carry no audio stream, so
          on those it reads "Silent preview" instead of offering a dead keypress.
        */}
        {current.kind === 'video' && (
          <div className="absolute bottom-3.5 left-4 flex items-center gap-2.5 rounded-sm bg-scrim px-3 py-1.75 text-sm font-bold text-ink-2">
            <SpeakerIcon muted={muted || hasAudio === false} />
            {hasAudio === false ? (
              <span className="text-ink-3/70">Silent preview</span>
            ) : focused ? (
              <span className="flex items-center gap-2">
                <ControllerGlyph action="secondary" source={source} size="sm" />
                to {muted ? 'unmute' : 'mute'}
              </span>
            ) : (
              <span>{muted ? 'Muted' : 'Sound on'}</span>
            )}
          </div>
        )}
      </div>

      {/* Filmstrip */}
      <div className="-mx-2 -my-2 overflow-hidden px-2 py-2">
        <div
          ref={stripRef}
          className="flex gap-2.5 transition-transform duration-200 ease-out will-change-transform"
          style={{ transform: `translate3d(${-offset}px, 0, 0)` }}
        >
          {items.map((item, i) => (
            <div
              key={`${item.src}-${i}`}
              className={[
                'relative h-18 w-32 shrink-0 overflow-hidden rounded-md transition-all duration-150',
                i === safeIndex ? 'relative z-10 opacity-100 ring-flat' : 'opacity-45',
              ].join(' ')}
            >
              <img src={item.thumb} alt="" className="h-full w-full object-cover" />
              {item.kind === 'video' && (
                <span className="absolute inset-0 grid place-items-center bg-[rgba(8,13,22,.35)]">
                  <span className="h-0 w-0 border-y-[0.5rem] border-l-[0.75rem] border-y-transparent border-l-ink" />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
