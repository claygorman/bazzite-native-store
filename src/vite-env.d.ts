/// <reference types="vite/client" />

/**
 * The client version, injected from package.json at build time (vite.config.ts).
 *
 * ⚠️ A build-time constant rather than an import of package.json: the About and
 * Updates pages report what is RUNNING, and importing the manifest at runtime would
 * report what is on disk beside the bundle — the same thing in dev and a different
 * thing in a packaged AppImage.
 */
declare const __APP_VERSION__: string
