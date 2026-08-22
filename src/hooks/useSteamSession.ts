import { useCallback, useEffect, useState } from 'react'
import { loadSession, type SessionState } from '../platform/auth'

export const useSteamSession = () => {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })

  const refresh = useCallback(() => {
    loadSession()
      .then(setSession)
      // A failed session lookup is "not signed in", not an error worth a banner.
      .catch(() => setSession({ status: 'signed-out' }))
  }, [])

  useEffect(refresh, [refresh])

  return { session, refresh }
}
