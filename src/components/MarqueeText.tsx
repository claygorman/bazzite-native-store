import { useEffect, useRef, useState } from 'react'

type Props = {
  children: string
  className?: string
  /** Scroll speed in px/sec at the 1920 reference. Slow: this is read at 10 feet. */
  pxPerSecond?: number
}

/**
 * Text that sits still when it fits, and scans across when it does not.
 *
 * A fixed-height band cannot wrap — the hero is 140px and a second line runs
 * straight through the shelf below it — so long titles have to truncate. Truncating
 * *permanently* means titles like "KOTAMON: My Sis Found A Super-Rare Card In Her
 * Cereal Box…" are never readable at all. A periodic scan is the console answer.
 *
 * Three things that matter for it not to feel cheap:
 *
 * 1. **Only animate on actual overflow.** Measured, not guessed. A title that fits
 *    must not drift, and drifting text is far more distracting than static text.
 * 2. **Hold at both ends.** Continuous scrolling is unreadable; the eye needs a
 *    beat to catch the start and the end.
 * 3. **Constant speed regardless of length.** Duration is derived from distance, so
 *    a slightly-too-long title does not crawl while a very long one races.
 *
 * Honours `prefers-reduced-motion`, where it stays truncated.
 */
export const MarqueeText = ({ children, className = '', pxPerSecond = 42 }: Props) => {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [distance, setDistance] = useState(0)

  useEffect(() => {
    const viewport = viewportRef.current
    const text = textRef.current
    if (!viewport || !text) return

    const measure = () => {
      // scrollWidth of the text vs the visible width of its container.
      const overflow = Math.ceil(text.scrollWidth - viewport.clientWidth)
      setDistance(overflow > 4 ? overflow : 0) // ignore sub-pixel rounding
    }

    measure()
    // Re-measure on layout changes: font loading and viewport resizing both change
    // the answer, and the root font-size here is derived from viewport width.
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(text)
    return () => observer.disconnect()
  }, [children])

  const animate = distance > 0
  // Travel time plus the holds baked into the keyframes.
  const durationSeconds = animate ? (distance / pxPerSecond) * 2 + 4 : 0

  return (
    <span
      ref={viewportRef}
      className={`block overflow-hidden whitespace-nowrap ${className}`}
      title={children}
    >
      <span
        ref={textRef}
        className={
          animate
            ? 'inline-block will-change-transform motion-safe:animate-marquee'
            : 'block truncate'
        }
        style={
          animate
            ? ({
                '--marquee-distance': `${distance}px`,
                animationDuration: `${durationSeconds}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </span>
    </span>
  )
}
