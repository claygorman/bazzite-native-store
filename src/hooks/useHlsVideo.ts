import { useEffect, useState, type RefObject } from 'react'

export type HlsState = 'idle' | 'loading' | 'playing' | 'failed'

/**
 * Attach an HLS stream to a <video>, via hls.js where the engine needs it.
 *
 * ⚠️ `<video src="….m3u8">` does NOT work in WebKitGTK — `canPlayType` returns `''`
 * and a bare src fails with error 4. MSE is what does the work, and it is verified
 * good on the target (WebKitGTK 2.52.5: 1080p, real time, no errors). Safari and
 * iOS *do* play HLS natively, so check for that first and skip the library there.
 *
 * hls.js is imported dynamically — it is ~400 KB, and most of the app never plays a
 * full trailer.
 */
export const useHlsVideo = (
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | undefined,
  enabled: boolean,
): HlsState => {
  const [state, setState] = useState<HlsState>('idle')

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src || !enabled) {
      setState('idle')
      return
    }

    setState('loading')
    let cancelled = false
    let destroy: (() => void) | undefined

    const onPlaying = () => !cancelled && setState('playing')
    video.addEventListener('playing', onPlaying)

    // Native HLS (Safari/iOS). Cheaper and better integrated than the library.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      void video.play().catch(() => undefined)
    } else {
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return
          if (!Hls.isSupported()) {
            setState('failed')
            return
          }
          const hls = new Hls({ enableWorker: false })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            // Non-fatal errors are routine on adaptive streams — hls.js recovers.
            // Only a fatal one means the trailer will not play.
            if (data.fatal && !cancelled) setState('failed')
          })
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            void video.play().catch(() => undefined)
          })
          hls.loadSource(src)
          hls.attachMedia(video)
          destroy = () => hls.destroy()
        })
        .catch(() => !cancelled && setState('failed'))
    }

    return () => {
      cancelled = true
      video.removeEventListener('playing', onPlaying)
      destroy?.()
      video.removeAttribute('src')
      video.load() // release the decoder rather than leaving it buffering off-screen
    }
  }, [videoRef, src, enabled])

  return state
}
