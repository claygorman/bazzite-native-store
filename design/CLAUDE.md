# Project conventions — Bazzite Native Store Redesign

## Styling: use Tailwind

New design work in this project uses **Tailwind classes**, not inline styles.

Setup for a standalone page (the v4 browser build works client-side; the user is never offline):

```html
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">
  @theme { --color-plate: #16202c; /* … */ }
</style>
```

Rules:
- Declare every color, shadow and font in `@theme`. Components carry no raw hex, with two
  exceptions kept as data maps: ProtonDB tier dot colors and the deal-flag gradients.
- Use stock utilities for anything on Tailwind's scale — type `text-xs`…`text-2xl` with explicit
  `leading-*`, spacing on the 4px steps, `rounded`/`rounded-md`/`rounded-lg`/`rounded-xl`/`rounded-full`.
- Use arbitrary utilities only for deliberate off-scale values (`w-[336px]`, `h-[204px]`) and note
  why each exists.
- `Store Card - Tailwind port.md` is the source of truth for tokens, the class mapping table, and
  the load-bearing layout rules. Read it before porting or extending a card.

Exception: `.dc.html` design-component files still use inline styles — they render without a build
step and must paint as they stream. When a design lands in one of those, keep values on Tailwind's
scale so the port stays mechanical.

## Product context

A controller-first, 10-foot TV store client for Bazzite (Steam alternative front-end). 1920×1080.

- **Primary input is a controller.** Dpad moves focus, LB/RB change shelf, LT/RT page, A selects,
  Y wishlists, B backs out. Keyboard mirrors it. Show glyph hints in a bottom bar.
- **No checkout.** Buying hands off to the real Steam store listing — "Open in Steam", never
  "Add to Cart". There is no cart anywhere in the app.
- **ProtonDB compatibility is first-class**: Platinum / Gold / Silver / Bronze / Native / Unknown /
  Borked, always with its colored dot. Controller support is surfaced prominently too.
- **Minimum type size is 18px for secondary text, 20px+ for titles** — 10-foot viewing distance.
  Never shrink type to make something fit; change the layout.
- Visual language: Xbox-like glow and strong focus declaration, Steam-like blue. Plate `#16202c`
  on page `#080d16`, accent `#4d9be6`, discount chip Steam's own `rgb(161,205,68)`.
- Reuse Steam's own conventions where they're good: deal-flag gradients, the -%/was/now discount
  block, review percentages, user tags.

## Components

One configurable component, not variants-as-files:

- **`Store Card.dc.html`** — every store tile. Shape is input (`width`, `artHeight`, `artWidth`,
  `layout`, `surface`, `emphasis`, `pricePlacement`, `facts`), as is content. The title prop is
  `title`, **not** `name` — `name` is reserved by `dc-import`.
- **`Shelf Tile.dc.html`** / **`Poster Card.dc.html`** — galleries that import `Store Card` several
  times with different shape props. Add a state here, don't fork the card.
- **`Native Store Client.dc.html`** — the full screens (home, search, details).

When asked for a new card treatment, add an input to `Store Card` and a gallery instance. Only fork
a file when the thing genuinely isn't the same component.
