import { useEffect, useState } from 'react'
import { subscribeInput } from '../platform/input'
import type { InputSource } from '../platform/glyphs'

/**
 * The device the user last actually used.
 *
 * Defaults to `gamepad`: this is a TV application launched from a game library, so
 * a controller is the assumption until something proves otherwise. It flips on the
 * first keyboard event and back on the first pad event, which is how games handle
 * it — the prompts should describe the thing currently in your hands.
 */
export const useInputSource = (): InputSource => {
  const [source, setSource] = useState<InputSource>('gamepad')

  useEffect(
    () =>
      subscribeInput((event) => {
        if (event.pressed) setSource(event.source)
      }),
    [],
  )

  return source
}
