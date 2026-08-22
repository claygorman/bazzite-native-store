# Design source — do not edit, do not format

Exported from the design project **"Bazzite Native Store Redesign"**.

| File | What it is |
|---|---|
| `Native Store Client.dc.html` | The canvas document. Six 1920x1080 artboards: `5a` home, `5b` search, `5c` personal calendar, `6a`/`6b`/`6c` details pages. |
| `Store Card.dc.html` | **One configurable card**, the component every store tile is an instance of. Shape is input: `width`, `artHeight`, `artWidth`, `layout`, `surface`, `emphasis`, `pricePlacement`, `facts`. |
| `Shelf Tile.dc.html`, `Poster Card.dc.html` | Galleries that *import* `Store Card` with different shape props. A new treatment is a new instance here, never a fork of the card. |
| `Store Card - Tailwind port.dc.html` | The same card in real Tailwind classes on the same knobs, so a divergence from the inline-styled original is visible rather than theoretical. |
| `Store Card - Tailwind port.md` | **The porting spec** — tokens, class-mapping table, off-scale values, eight load-bearing layout rules, prop table, reference JSX. Read before porting or extending a card. |
| `CLAUDE.md` | The design project's own conventions (Tailwind in `.dc.html`, one configurable component). Mirrored byte-for-byte; it is scoped to this directory. |
| `github.md` | The design project's record of what it last synced from this repo, and its open gaps. |
| `support.js` | Generated runtime the documents import. |

**Import of 2026-08-21 (componentization).** The five card files above arrived together and
**no screen changed** — `Native Store Client.dc.html` and `support.js` both diffed byte-identical
against the copies already here. The import is a direction, not a redesign: stop hand-rolling a
card per surface. `docs/DESIGN-PORT.md` records where that spec has to be *converted* rather than
copied for this codebase (chiefly §4, which is authored in px against a fixed 1920 frame while this
app is rem-scaled from viewport width).

**These are generated artifacts.** They are committed so the implementation can be
diffed against the design it came from, and so a design revision shows up as a real
diff rather than a vanished URL. Re-export them rather than hand-editing, and keep
formatters off them — `.prettierignore` and `.editorconfig` both exclude this
directory.

Artboard → implementation status:

| Artboard | Screen | Status |
|---|---|---|
| `5a` | Immersive home | implemented (`src/App.tsx`) — **revised 2026-08-21: hero removed, facts moved under each tile** |
| `5b` | Search + on-screen keyboard | implemented (`src/components/SearchView.tsx`) |
| `5c` | Your Personal Calendar | **new 2026-08-21** — fifth shelf on home, day band |
| `6a` | Details — trailer fills frame | implemented (`src/components/DetailsPage.tsx`) |
| `6b` | Details — About / requirements / ProtonDB / More Like This | implemented (`src/components/details/DetailsAbout.tsx`) |
| `6c` | Details — reviews / demo / DLC / achievements / curators | implemented (`src/components/details/DetailsExtras.tsx`) |
| `7a` | Browse by Tag — picker | **new 2026-08-21** — implemented (`src/components/TagPicker.tsx`) |
| `7b` | Inside a tag — spotlight + results grid | **new 2026-08-21**, revised same day to add the featured spotlight — implemented (`src/components/TagResults.tsx`, `TagSpotlight.tsx`) |

⚠️ **7a and 7b are the boards that disagree most with the data.** `private/STEAM-ENDPOINTS.md`
§ "Tag browsing" records what each drawn number can and cannot be backed by. The short version:
counts move with the sort (one tag has five different sizes), Steam publishes no tag taxonomy so
the groups are ours, library/wishlist/owned are session-gated and absent, and the whole-tag Proton
split is replaced by a labelled sample because no endpoint can aggregate one.

⚠️ The artboards draw a `Y · FULL CALENDAR` tray hint on `5c`. There is no full-calendar screen and
Y is the global search shortcut, so that hint is deliberately **not** implemented — a tray that names
a binding the screen does not have is worse than one that stays quiet.
