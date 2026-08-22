# Store Card — Tailwind port

Reference for porting `Store Card.dc.html` into the app (React + Tailwind). The design files use
inline styles because they render without a build step; every value below was authored on Tailwind's
default scale so this port is mechanical. **Nothing here should be hand-converted from pixels — use
this table.**

Verify a port by diffing against the "Class" column, not by eyeballing the design.

---

## 1. Design tokens to add to `tailwind.config`

These are the only values that are genuinely custom. Add them once and the rest of the port uses
stock utilities.

```js
// tailwind.config.js
theme: {
  extend: {
    fontFamily: {
      sans: ['Archivo', 'sans-serif'],
    },
    colors: {
      // surfaces
      page:        '#080d16',   // app background
      plate:       '#16202c',   // card surface
      inset:       'rgb(8 13 22 / 0.45)', // note box inside a plate
      scrim:       'rgb(8 13 22 / 0.82)', // badge over artwork
      // text
      ink:         '#f4f7f9',   // focused title, primary
      'ink-soft':  'rgb(232 238 241 / 0.90)', // resting title
      'ink-mute':  'rgb(232 238 241 / 0.80)', // tier label, tag text
      'ink-faint': 'rgb(223 230 234 / 0.50)', // struck price, no-reviews
      // accents
      accent:      '#4d9be6',   // focus ring, owned badge
      'accent-hi': '#5aa9f0',   // gradient start
      'accent-lo': '#2f6fd0',   // gradient end
      sale:        'rgb(161 205 68)', // discount chip — Steam's green
      'rating-up': '#a1cd44',
      'rating-dn': '#e0ab84',
      'pad-ok':    '#b9d99c',   // controller-support text
      hairline:    'rgb(244 247 249 / 0.18)',
      chip:        'rgb(244 247 249 / 0.10)',
      'chip-soft': 'rgb(244 247 249 / 0.06)',
    },
    boxShadow: {
      plate:   '0 12px 30px rgb(0 0 0 / 0.45)',
      focused: '0 24px 54px rgb(0 0 0 / 0.70), 0 0 48px rgb(77 155 230 / 0.50)',
      'focused-bare': '0 0 48px rgb(77 155 230 / 0.45)',
      flag:    '2px 1px 5px rgb(0 0 0 / 0.35)',
    },
  },
}
```

ProtonDB tier dots (data, not theme — keep in one map):

| Tier | Hex |
| --- | --- |
| Platinum | `#b5eaff` |
| Gold | `#cfb53b` |
| Silver | `#c3ccd4` |
| Bronze | `#c08457` |
| Native | `#9ec97f` |
| Unknown | `#7d8b95` |
| Borked | `#d0685f` |

Deal-flag gradients — all `315deg`, three stops, from Steam's own CSS. Keep as a map; they are too
specific for utilities:

| Flag | Gradient |
| --- | --- |
| WEEKEND DEAL | `rgb(183,37,90) 5%, rgb(140,28,95) 50%, rgb(97,14,93) 95%` |
| TODAY'S DEAL / MIDWEEK DEAL | `rgb(16,124,101) 5%, rgb(46,121,159) 50%, rgb(55,73,132) 95%` |
| FREE WEEKEND | `rgb(150,40,165) 5%, rgb(110,32,150) 50%, rgb(74,24,130) 95%` |
| NEW RELEASE | `rgb(46,121,159) 5%, rgb(43,92,166) 50%, rgb(55,73,132) 95%` |

---

## 2. Type scale — every text style in the component

| Where | Inline | Class |
| --- | --- | --- |
| Title, standard | `700 20px/28px` | `text-xl font-bold leading-7` |
| Title, large (`emphasis="Large"`) | `700 24px/32px` | `text-2xl font-bold leading-8` |
| Price (final) | `800 20px/24px` | `text-xl font-extrabold leading-6 tabular-nums` |
| Discount chip | `800 16px/24px` | `text-base font-extrabold leading-6 tabular-nums` |
| Struck was-price | `600 14px/16px` | `text-sm font-semibold leading-4 line-through tabular-nums` |
| Rating | `700 18px/28px` | `text-lg font-bold leading-7 tabular-nums` |
| Tier label | `600 18px/28px` | `text-lg font-semibold leading-7` |
| Tag chip | `500 16px/24px` | `text-base font-medium leading-6` |
| Deal flag | `500 14px/20px` + `.025em` + uppercase | `text-sm font-medium leading-5 tracking-wide uppercase` |
| Controller badge | `700 14px/20px` | `text-sm font-bold leading-5` |
| Owned check | `800 14px/20px` | `text-sm font-extrabold leading-5` |
| Note box label | `700 12px/16px` + `.1em` + uppercase | `text-xs font-bold leading-4 tracking-widest uppercase` |
| Note box body | `500 16px/24px` | `text-base font-medium leading-6` |

**Minimum on a 1080p TV at 10 ft is 18px for secondary text.** Do not drop the rating or tier to
`text-sm` to make something fit — change the layout instead.

## 3. Spacing, radii, sizing

| Inline | Class |
| --- | --- |
| `gap:4px` / `8px` / `10px` / `12px` / `16px` | `gap-1` / `gap-2` / `gap-2.5` / `gap-3` / `gap-4` |
| `padding:16px 16px 20px` (caption, boxed) | `px-4 pt-4 pb-5` |
| `padding:4px 8px` (badge) | `px-2 py-1` |
| `padding:4px 12px` (flag, tag chip) | `px-3 py-1` |
| `padding:2px 6px` (compact discount chip) | `px-1.5 py-0.5` |
| `padding:16px` (note box) | `p-4` |
| `border-radius:4px` / `6px` / `8px` / `12px` / `9999px` | `rounded` / `rounded-md` / `rounded-lg` / `rounded-xl` / `rounded-full` |
| `outline:3px solid …; outline-offset:4px` | `outline outline-[3px] outline-offset-4` |
| divider `width:1px;height:20px` | `w-px h-5` |
| tier dot `12px` | `size-3 rounded-full` |
| owned badge `28px` | `size-7 rounded-full` |
| thumb icon `20px` | `size-5` |
| controller/A-Y glyph `24px` | `size-6 rounded-full box-border` |

**`box-border` on any bordered circle is not optional.** The Y-button glyph is `size-6` with a 2px
border; without `box-border` it lays out 28×28 and its pill grows 4px taller than its neighbour.
This shipped as a bug twice.

## 4. Off-scale values — use arbitrary utilities, do not round

These are deliberate and must survive the port exactly.

| Value | Class | Why |
| --- | --- | --- |
| card widths 336 / 440 / 512 / 688 | `w-[336px]` … | shelf geometry: 5 × 336 + 4 × 20 gap fits 1808px of a 1920 screen |
| art heights 156 / 204 / 238 / 492 | `h-[156px]` … | 156 and 238 hold Steam's 460×215 header ratio; 204 is a deliberate crop; 492 is portrait |
| side-by-side art width 272 / 312 | `w-[272px]` | leaves ≥ 344px of content column so the title doesn't ellipsise |
| `min-height:44px` (title row) | `min-h-11` | on scale, but load-bearing — see §5 |
| `min-height:40px` (facts row) | `min-h-10` | on scale, but load-bearing — see §5 |

## 5. Load-bearing rules — the port breaks without these

Each of these was a real defect during design. Porting the classes but dropping the rule
reintroduces it.

1. **Facts row keeps `min-h-10` in both price placements.** Caption height must not depend on where
   the price sits, or two cards of different widths can't share a row height.
2. **Title row keeps `min-h-11`.** Same reason, for cards with and without a discount.
3. **Price placement is derived, not fixed.** When there is a discount *and* the content column is
   under 420px, the price moves from beside the title down to the facts row. Beside the title it
   competes with the price block and truncates the name to ~46%.
4. **Title is single-line ellipsis** (`truncate` + `flex-1 min-w-0`). The `min-w-0` is required —
   without it the flex item won't shrink and the row overflows instead of ellipsising.
5. **Art uses `object-cover object-center`,** never `object-contain` or a width/height that changes
   the ratio. Widening a card at constant art height should uncover more frame, not scale the image.
6. **Dim unfocused tiles on the artwork only.** Stacking opacity on a shelf wrapper *and* the
   caption multiplies down (0.55 × 0.72 × 0.55 ≈ 0.22 alpha) and the tier label disappears at 10 ft.
   Art gets `opacity-50`/`opacity-70`; caption text stays at `opacity-80` or higher.
7. **Action pills carry `whitespace-nowrap`.** "Open in Steam" wrapping mid-phrase makes the pill
   64px against its 44px neighbour.
8. **Thumb icon hides entirely when there is no score** — never a thumbs-down for "No reviews".

## 6. Props → the component's inputs

| Prop | Type | Notes |
| --- | --- | --- |
| `art`, `title`, `price` | string | `title`, not `name` |
| `wasPrice`, `discount` | string | independent: a was-price can render without a % chip |
| `rating` | number 0–100 | 0 renders "No reviews", no thumb |
| `tier` | enum | Platinum · Gold · Silver · Bronze · Native · Unknown · Borked |
| `flag` | enum | deal flag on the artwork, `""` for none |
| `owned`, `controllerSupport`, `focused` | boolean | |
| `facts` | enum | `Rating + tier` · `Tags only` · `Both` |
| `tags` | string | comma-separated, first 8 used |
| `width`, `artHeight`, `artWidth` | number \| string | px |
| `layout` | enum | `Stacked` · `Side by side` |
| `surface` | enum | `Boxed` (plate behind the card) · `Bare` (transparent, art gets its own radius) |
| `emphasis` | enum | `Standard` · `Large` title |
| `pricePlacement` | enum | `Beside title` · `On facts row` — omit to let rule §5.3 decide |
| `note`, `noteLabel`, `noteAccent` | string | optional panel under the caption |

## 7. Reference markup — boxed, stacked, resting

```jsx
<div className="w-[336px] flex flex-col bg-plate rounded-xl overflow-hidden shadow-plate
                outline outline-[3px] outline-offset-4 outline-transparent font-sans
                transition-[outline-color,box-shadow] duration-200">
  <div className="relative shrink-0 w-full overflow-hidden">
    <img src={art} alt="" className="block w-full h-[156px] object-cover object-center" />
    {flag && (
      <span className="absolute left-0 top-0 px-3 py-1 shadow-flag text-sm font-medium leading-5
                       tracking-wide uppercase text-white"
            style={{ backgroundImage: DEAL_FLAGS[flag] }}>{flag}</span>
    )}
    {owned && (
      <span className="absolute right-2 top-2 grid place-items-center size-7 rounded-full
                       bg-accent text-[#04121f] text-sm font-extrabold leading-5
                       ring-4 ring-scrim">✓</span>
    )}
    {controllerSupport && (
      <span className="absolute left-2 bottom-2 flex items-center gap-2 px-2 py-1 rounded-md
                       bg-scrim text-sm font-bold leading-5 text-pad-ok">
        Full controller support
      </span>
    )}
  </div>

  <div className="flex-1 min-w-0 flex flex-col gap-2 px-4 pt-4 pb-5">
    <div className="flex items-center gap-3 min-h-11">
      <span className="flex-1 min-w-0 truncate text-xl font-bold leading-7 text-ink-soft">
        {title}
      </span>
      {priceBesideTitle && <PriceBlock align="end" />}
    </div>

    <div className="flex items-center gap-2.5 min-h-10 whitespace-nowrap">
      {!priceBesideTitle && <><PriceBlock /><span className="w-px h-5 bg-hairline" /></>}
      <span className={`shrink-0 flex items-center gap-2 text-lg font-bold leading-7 tabular-nums
                        ${ratingToneClass}`}>
        {rating > 0 && <ThumbIcon className={`size-5 ${rating < 70 ? 'rotate-180' : ''}`} />}
        {rating > 0 ? `${rating}%` : 'No reviews'}
      </span>
      <span className="w-px h-5 bg-hairline" />
      <span className="shrink-0 flex items-center gap-2 text-lg font-semibold leading-7 text-ink-mute">
        <span className="size-3 rounded-full" style={{ background: TIER_COLORS[tier] }} />
        {tier}
      </span>
    </div>
  </div>
</div>
```

`PriceBlock`:

```jsx
<span className="shrink-0 flex items-center gap-2">
  {discount && (
    <span className="px-2 py-1 rounded bg-sale text-[#0b1114]
                     text-base font-extrabold leading-6 tabular-nums">{discount}</span>
  )}
  <span className={`flex flex-col ${align === 'end' ? 'items-end' : ''}`}>
    {wasPrice && (
      <span className="text-sm font-semibold leading-4 line-through tabular-nums text-ink-faint">
        {wasPrice}
      </span>
    )}
    <span className="text-xl font-extrabold leading-6 tabular-nums text-white">{price}</span>
  </span>
</span>
```

Focused state swaps three classes: `outline-transparent → outline-accent`,
`shadow-plate → shadow-focused`, `text-ink-soft → text-ink`. Bare surface swaps
`bg-plate → bg-transparent`, `overflow-hidden → overflow-visible`, `gap-0 → gap-3`,
`px-4 pt-4 pb-5 → p-0`, and puts `rounded-lg` on the art panel.

---

## Porting checklist

- [ ] Tokens from §1 in `tailwind.config`, no raw hex in components except the tier/flag maps
- [ ] Every text style matches §2 — no `text-sm` on rating or tier
- [ ] `box-border` on every bordered circle (§3)
- [ ] Off-scale values as arbitrary utilities, not rounded to the nearest step (§4)
- [ ] All eight rules in §5 present
- [ ] Prop named `title`, not `name`
- [ ] Two cards of different widths at the same `artHeight` measure the same total height
- [ ] Longest real game name in the set does not ellipsise below ~85% at the narrowest width
