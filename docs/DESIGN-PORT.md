# Porting the Store Card spec into this codebase

`design/Store Card - Tailwind port.md` is the design project's porting spec, and it is good — §5's
eight rules are each a real defect with the reason attached. Follow it.

This file records the places where it must be **converted rather than copied**, because it is
authored against assumptions this app does not hold. Read both. Where they disagree, this file
wins for app code and the spec wins for `design/`.

---

## 1. Sizes are px there and rem here — convert every one

The spec's §4 says "use arbitrary utilities, do not round", and lists `w-[336px]`, `h-[204px]` and
friends. **Do not copy those classes.** Two independent reasons:

- This app derives its root font size from viewport width — `html { font-size: clamp(12px, 0.8333vw,
34px) }` — so the viewport is always 120rem across and a browser window is a faithful preview of
  the TV. A literal `w-[336px]` renders 336 _physical_ pixels on a 3840-wide panel: about a sixth of
  the intended size, at couch distance.
- Arbitrary values are out by house rule. The codebase went from 182 of them to zero.

The conversion is mechanical and exact. Design px ÷ 16 = rem; Tailwind's spacing step is 0.25rem, so
the class number is **`n = rem × 4`**. Every §4 value lands on a quarter step:

| Design | rem   | Class   |     | Design         | rem    | Class      |
| ------ | ----- | ------- | --- | -------------- | ------ | ---------- |
| 336    | 21    | `w-84`  |     | 156            | 9.75   | `h-39`     |
| 340    | 21.25 | `w-85`  |     | 204            | 12.75  | `h-51`     |
| 440    | 27.5  | `w-110` |     | 236            | 14.75  | `h-59`     |
| 512    | 32    | `w-128` |     | 238            | 14.875 | `h-59.5`   |
| 688    | 43    | `w-172` |     | 492            | 30.75  | `h-123`    |
| 272    | 17    | `w-68`  |     | 44 (title row) | 2.75   | `min-h-11` |
| 312    | 19.5  | `w-78`  |     | 40 (facts row) | 2.5    | `min-h-10` |

⚠️ Tailwind escapes the dot in decimal classes, so a generated `h-59.5` appears in the CSS as
`.h-59\.5`. Grepping the build output with `grep -F ".h-59.5"` finds nothing and looks like the
class was dropped. It wasn't.

The same applies to **shadows**, which the spec writes in px (`0 12px 30px …`, `0 0 48px …`). They
are stored in `src/index.css` as rem for the same reason — a px glow would stay 48 physical pixels
while everything around it doubled.

## 1b. The card is width-first; three of our four surfaces are not

`Store Card` takes `width` and derives everything from it, because the design draws
fixed-width cards onto a fixed 1920 frame. Only the shelf tile actually works that way
here. A search result fills its results column, a calendar recommendation is a flex
child, and a calendar poster is sized by the row's fixed **height** — the "row shouldn't
get taller, just wider" rule.

So `width` is **optional**. Omitted, the card takes its size from its parent and the
derived rules (§5.3, compatibility placement) fall to their narrow branch, since they
cannot measure and stacking is the safe failure — a block on its own line is never
unreadable, whereas one competing for a line it does not fit gets its type shrunk, which
§2 forbids.

⚠️ `shrink-0` on the card root is not about width. In a flex **column** it is what stops
the card being squeezed vertically to nothing. Making it conditional on `width` produced
eight search results 1352px wide and 0px tall.

**Still not ported:** the calendar's poster and recommendation cards. Both are
height- or container-derived in ways that would mean adding sizing modes to `StoreCard`
to serve two callers — making the shared component worse to avoid two small forks. The
poster in particular carries hard-won behaviour (constant-height expansion, a
single-weight ring chosen because posters are light art as often as dark). Left alone
deliberately, not overlooked.

## 2. The type scale is one step larger here, on purpose

§2 states its values "were authored on Tailwind's default scale so this port is mechanical", and
gives 20/28 for titles, 18/28 for rating and tier.

Our `@theme` overrides the scale — `text-lg` is 19px, `text-xl` is 21px — and that override is
load-bearing. The _previous_ design revision specified 13/15/17/19/21, and every one of those sat
just above a Tailwind default stop (12/14/16/18/20). Snapping to the nearest therefore shrank the
entire UI by ~5%, which is the wrong direction for a screen read from three metres.

So following §2's class column renders about 5% **larger** than the design draws it. That is the
safe direction and the one the spec's own rule demands — _"Never shrink type to make something fit;
change the layout instead."_

**Consequence: §2 is a mapping table, not a pixel-exact check.** Use it to pick the class. Do not
use it to verify a rendered pixel height.

## 3. Names the spec has that we already had

One colour with two names is worse than a lookup, so these are **not** duplicated into `@theme`:

| Spec             | Ours      | Note                                                                               |
| ---------------- | --------- | ---------------------------------------------------------------------------------- |
| `page` #080d16   | `surface` | identical                                                                          |
| `accent` #4d9be6 | `focus`   | `--color-focus` was changed from #5aa9f0 to match; #5aa9f0 survives as `accent-hi` |

And one false friend:

⚠️ **`plate` is not `surface-raised`.** `plate` (#16202c) is the card surface the design puts behind
art and caption. `surface-raised` (#101725) is the darker fill used for art placeholders and empty
states. They are different colours for different jobs; substituting either for the other is a bug
that looks like a rounding error.

## 4. Rules the spec does not know about

The design has never seen live Steam data. These survive any port, and each is a defect that already
shipped once:

1. **Gate `comingSoon` before formatting a price.** `formatPrice(0)` returns `'Free'`, and unreleased
   titles report `final_price: 0` with no per-item flag — so every upcoming game advertises itself as
   free. The release date is the only price-shaped fact that matters before launch.
2. **Gate the review percentage on `review_count`.** `percent_positive` is `0` for a game with no
   reviews, which rendered as a confident "0% 👎".
3. **A pre-order discount is not a sale.** Unreleased titles can carry one; showing it stacks
   "-10% / $15.99 / Coming Soon" — three contradictory prices — on one tile.
4. **Content descriptors are not optional.** The endpoints do no filtering of their own; see
   `src/platform/contentFilter.ts`.
5. **Never write `outline-none` in a base class list.** In Tailwind v4 it sets `outline-style: none`,
   and the focused-variant `outline-[3px]`/`outline-<color>` utilities set width and colour but never
   re-enable the style — so the ring silently never renders. The spec's own markup is safe because
   `outline` is always present and only the _colour_ swaps between transparent and accent. Keep it
   that way.
6. **Nothing painted on a tile may exceed the clip container's escape hatch.** A shelf scrolls by
   clipping; a shadow or ring reaching past the hatch is sliced into a hard rectangle that
   reads as "a weird grey square", not as a clipped shadow. See §1 above and `Shelf.tsx`.

7. **Put the page margin on the CHILDREN, not on the box that clips.** The corollary to rule 6,
   and the thing that actually makes it satisfiable.

   A clipping box narrowed to content width clips at that narrower edge, so anything a child
   paints outside itself — a glow, a ring, a drop shadow — dies against the _layout_, with lit
   screen either side of the cut. That is what reads as a seam: not the cut, but the fact that
   there is visibly more room next to it.

   Keep the clipping box **full-bleed** and give the margin to the children that want it — the
   title row and the scrolling track each carry their own `px-14` in `Shelf.tsx`. Same margin,
   same alignment, but now the cut lands on the display edge, where it is invisible because
   there is nothing beyond it to compare against.

   ⚠️ The failure mode this replaces is a ratchet: each time the paint gets clipped you shrink
   the paint, or pad the parent and push the children further inward, and neither ever reaches
   the edge. Turn 12 shrank the tile's bloom from 54px to 36px before the layout was recognised
   as the real problem — after which the design's own number went back in untouched. If you find
   yourself trimming a shadow to fit a container, check what the container's width is doing first.

## 5. Data the spec's props need, and where it comes from

| Prop                                              | Source                                                     | Notes                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `rating`, `price`, `wasPrice`, `discount`, `flag` | `IStoreBrowseService/GetItems`                             | batched, keyless — one request per screen                                                                          |
| `controllerSupport`                               | same call, `categories.controller_categoryids`             | `28` full, `18` partial — see `private/STEAM-ENDPOINTS.md`                                                         |
| `tier`                                            | ProtonDB, a second host                                    | per-app, lazy, 24h TTL; unrated apps return **HTML**, not JSON                                                     |
| Deck verdict                                      | same GetItems call, `platforms.steam_deck_compat_category` | shown alongside the ProtonDB tier, not instead of it                                                               |
| `tags`                                            | `GetLocalizedNameForTags`                                  | `GetItems` returns tagids, never names                                                                             |
| `owned`                                           | **no anonymous source**                                    | `dynamicstore/userdata` fails _silently_ (HTTP 200, empty arrays). The badge does not render rather than guessing. |

---

## The Xbox glyph kit

`Controller Glyphs.dc.html` in the design project is a real icon sheet, not a mockup — the file
says it was "extracted from the attached Figma file at its own geometry: 24px art in a 32px frame,
fill `rgb(214,225,246)` on plate `rgb(28,33,42)`, letters Segoe UI Bold 17px". It is ported
verbatim in `src/components/ControllerGlyph.tsx`; the path data is copied, not redrawn.

The design project's own `CLAUDE.md` states the colour rule, and it is the whole point of the kit:

> Face buttons are colored: A `rgb(85,164,59)`, B `rgb(218,23,37)`, X `rgb(3,154,201)`,
> Y `rgb(241,213,20)`, letter always `rgb(28,33,42)`. Bumpers, dpad, sticks and the menu/view
> buttons stay mono `rgb(214,225,246)`.

⚠️ **Colour is Xbox-only.** A DualSense's face buttons are unlit grey and a Switch's are
unlabelled, so the `playstation` / `nintendo` / `deck` glyph sets render mono. Inventing colours for
those would be drawing a controller nobody owns.

⚠️ **Two dpad paths, and they are not interchangeable.** `glyphs/dpad-union.svg` is the whole cross
solid — "the dpad" as a noun. `glyphs/dpad-left.svg` is the cross as an _outline_, so one solid arm
can be laid over it; that is what a direction prompt uses, rotated (left 0°, up 90°, right 180°,
down 270°). Using the union for "press up" draws a full cross that says nothing about up.

⚠️ **LT and RT reuse the bumper silhouette.** The sheet draws bumpers only and says so explicitly.
The right-hand pair is the same path mirrored — with the lettering kept _outside_ the mirrored
group, or `RB` renders backwards.

Not ported: the stick glyphs (rest, tilted, pressed, per-direction). No prompt in this app names a
stick — the left stick mirrors the dpad and is never a binding of its own — so drawing one would
teach a control that does not exist. They are in the sheet when one does.

Everything on screen goes through `Prompt` / `ControllerGlyph`. ⚠️ If you find yourself writing a
circle with a letter in it, you are re-implementing this component; four separate places had done
exactly that before the kit landed.
