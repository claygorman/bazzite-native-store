import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { SteamLibraryProvider } from './hooks/useSteamLibrary'
import { SettingsProvider } from './hooks/useSettings'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/*
      Owned games, read once from the local Steam client. Wraps the whole app because
      every card surface asks for it independently — see hooks/useSteamLibrary.tsx for
      why this is not threaded through the data layer.
    */}
    {/*
      ⚠️ OUTSIDE the library provider, because settings decide how the app asks for
      everything else: the store region, the request timeout, offline mode and the
      ProtonDB cadence are all pushed into the platform modules by this provider's
      first effect, and a data provider mounted above it would fire its request with
      the defaults instead of the user's choices.
    */}
    <SettingsProvider>
      <SteamLibraryProvider>
        <App />
      </SteamLibraryProvider>
    </SettingsProvider>
  </React.StrictMode>,
)
