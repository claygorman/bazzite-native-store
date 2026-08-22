/**
 * semantic-release — the GitHub counterpart of the GitLab config used elsewhere.
 *
 * Same conventions kept deliberately: `main` only, and `tagFormat` with **no `v`
 * prefix**, so a tag is `0.2.0` rather than `v0.2.0`.
 *
 * ⚠️ Three swaps from the GitLab flavour, each forced by what this project is:
 *
 * 1. `@semantic-release/gitlab` → `@semantic-release/github`, which is also what
 *    attaches the AppImage and `latest.json` to the release — that release IS the
 *    update feed (see `platform/updates.ts`), so the assets are not a convenience.
 *
 * 2. `@semantic-release/npm` stays, but **`npmPublish: false`**. This is an
 *    application, not a library; the plugin is here only to bump `package.json`,
 *    which is where `__APP_VERSION__` comes from (vite.config.ts).
 *
 * 3. `@semantic-release/exec` is added, and it is the one that matters. A Tauri app
 *    carries its version in THREE files — `package.json`, `src-tauri/tauri.conf.json`
 *    and `src-tauri/Cargo.toml` — and the npm plugin only knows about the first. Left
 *    unsynced, the About page and the updater's own version comparison disagree with
 *    the tag, which means a release that immediately offers itself as an update.
 *
 * `package-lock.json` → `pnpm-lock.yaml`, since this repo is pnpm.
 */
export default {
  branches: ['main'],
  tagFormat: '${version}',
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/exec',
      {
        // Runs in `prepare`, before the git plugin commits — so the synced files are
        // part of the release commit rather than trailing it.
        prepareCmd: 'node scripts/sync-version.mjs ${nextRelease.version}',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: [
          'package.json',
          'pnpm-lock.yaml',
          'CHANGELOG.md',
          'src-tauri/tauri.conf.json',
          'src-tauri/Cargo.toml',
          'src-tauri/Cargo.lock',
        ],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    /*
     * ⚠️ LAST, and after `git`. The AppImage is built in a separate job that checks
     * out the tag this run creates, so the release has to exist first; that job then
     * uploads the bundle and `latest.json` onto it. Putting github earlier would
     * publish a release whose notes referenced a commit that had not landed.
     */
    '@semantic-release/github',
  ],
}
