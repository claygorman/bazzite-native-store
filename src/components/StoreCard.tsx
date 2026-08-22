import { useId, type ReactNode } from 'react'
import { TileFocusLight } from './TileFocusLight'
import { DECK_COMPAT_LABEL, type ControllerSupport, type DeckCompat } from '../types/steam'
import { DEAL_FLAG_GRADIENTS } from '../platform/steam'

/**
 * Every store tile in the app, as one component.
 *
 * Ported from `design/Store Card.dc.html` against the spec in
 * `design/Store Card - Tailwind port.md`. Read `docs/DESIGN-PORT.md` first — it records
 * the places that spec has to be CONVERTED rather than copied for this codebase, and
 * the rules the design has never seen live Steam data for.
 *
 * The governing idea from the design project's own conventions: *"When asked for a new
 * card treatment, add an input and a gallery instance. Only fork a file when the thing
 * genuinely isn't the same component."* Before this existed there were four
 * hand-rolled cards — shelf tile, calendar poster, calendar recommendation, search
 * result — each re-deriving price gating, ring treatment and dim rules, and each having
 * drifted from the others.
 */

/* ─────────────────────────── shape ─────────────────────────── */

/**
 * Card shapes, in **rem**.
 *
 * ⚠️ The spec's §4 table is px against a fixed 1920 frame. This app derives its root
 * font size from viewport width, so px would render a shelf tile at a sixth of its
 * intended size on the 4K panel. Conversion is design-px ÷ 16; every §4 value lands on
 * a quarter step. See docs/DESIGN-PORT.md §1 for the full table.
 *
 * Numbers rather than Tailwind classes because the shape is an INPUT and two of the
 * layout rules are derived from it arithmetically (§5.3, and the compatibility
 * placement below) — a class string cannot be measured. Keeping them all in one table
 * is what stops the numbers from scattering back into the markup.
 */
export const CARD_SIZES = {
  /** 336x156 — the shelf default. */
  shelf: { width: 21, artHeight: 9.75 },
  /** 440x204 — a wider shelf. 204 is a deliberate crop, not the header ratio. */
  shelfWide: { width: 27.5, artHeight: 12.75 },
  /** 512x238 — focused, stacked. 238 holds Steam's 460x215 ratio. */
  focusedStacked: { width: 32, artHeight: 14.875 },
  /** 688x236 with 272 of art — focused, art beside the facts. */
  focusedSide: { width: 43, artHeight: 14.75, artWidth: 17, layout: 'side' as const },
  /** 340x492 — portrait. */
  poster: { width: 21.25, artHeight: 30.75 },
} satisfies Record<string, Partial<CardShape>>

type CardShape = {
  /**
   * rem. **Optional** — omit to let the parent size the card.
   *
   * ⚠️ The design's model is width-first, because it draws fixed-width cards onto a
   * fixed 1920 frame. Three of this app's four card surfaces are the other way round:
   * a search result fills its results column, a recommendation is a flex child, and a
   * calendar poster is sized by the row's fixed HEIGHT. Forcing them all through a
   * chosen width would mean laying out the app to suit the component.
   *
   * When it is omitted the derived rules (§5.3, and compatibility placement) take their
   * narrow branch, since they cannot measure and stacking is the safe failure: a block
   * on its own line is never unreadable, whereas one competing for a line it does not
   * fit gets its type shrunk, which §2 forbids.
   */
  width: number
  /** rem */
  artHeight: number
  /** rem — side-by-side only. */
  artWidth: number
  layout: 'stacked' | 'side'
  /** `boxed` puts a plate behind art AND caption; `bare` lets the page through. */
  surface: 'boxed' | 'bare'
  emphasis: 'standard' | 'large'
  /**
   * How much vertical room the caption reserves.
   *
   * ⚠️ `compact` is the artboard's own 7b card, not a fudge to make something fit: a
   * 19px/22px single-line name and one 38px facts row, against `comfortable`'s 20px
   * name in a 44px row and a 40px facts row. The tag grid gets 236px of frame for a
   * whole row of results, which a comfortable card cannot live in.
   *
   * The §5.1/§5.2 invariant still holds — every card at the same density reserves the
   * same heights, so a row shares one height. What changes is which set of minimums,
   * never whether they exist. Do NOT mix densities within one row.
   */
  density: 'comfortable' | 'compact'
  /** Omit to let rule §5.3 decide. */
  pricePlacement: 'title' | 'facts'
  facts: 'ratingTier' | 'tags' | 'both'
}

/**
 * Below this much content column, blocks move to their own row instead of competing.
 *
 * The spec sets it at 420px for the price (§5.3); the same threshold governs the
 * compatibility block here, because it is the same failure — too many shrink-resistant
 * items on one line, resolved by shrinking type, which §2 forbids outright.
 */
const NARROW_CONTENT_REM = 26.25

/** Horizontal padding a boxed caption spends before content, both sides. */
const BOXED_PADDING_REM = 2

/* ─────────────────────────── facts ─────────────────────────── */

/** Positive-review threshold for the green/amber split. */
const GOOD_REVIEW_PCT = 80
/** Below this Steam's own thumb points down. */
const THUMB_DOWN_PCT = 70

/** Gamepad silhouette, holes punched with `evenodd` so it reads as a pad and not a blob. */
const PAD_PATH =
  'M8.2 7h7.6c2.9 0 5.35 2.15 5.74 5.02l.42 3.06A2.79 2.79 0 0 1 19.2 18.2c-.93 0-1.8-.46-2.32-1.23' +
  'l-1.06-1.57a1.2 1.2 0 0 0-1-.53H9.18c-.4 0-.77.2-1 .53l-1.06 1.57A2.8 2.8 0 0 1 4.8 18.2' +
  'A2.79 2.79 0 0 1 2.04 15.08l.42-3.06A5.8 5.8 0 0 1 8.2 7Z' +
  'M6.95 9.7h1.3v1.25h1.25v1.3H8.25v1.25h-1.3v-1.25H5.7v-1.3h1.25Z' +
  'M16.2 9.35a.78.78 0 1 1 0 1.56.78.78 0 1 1 0-1.56Z' +
  'M18.05 11.2a.78.78 0 1 1 0 1.56.78.78 0 1 1 0-1.56Z' +
  'M16.2 13.05a.78.78 0 1 1 0 1.56.78.78 0 1 1 0-1.56Z' +
  'M14.35 11.2a.78.78 0 1 1 0 1.56.78.78 0 1 1 0-1.56Z'

/**
 * Controller support, as Steam's own Big Picture glyph rather than a sentence.
 *
 * The pad is drawn twice: once faint underneath, once bright and clipped. Full support
 * clips nothing so the whole pad is lit; partial clips to the left half, so the glyph
 * is literally half filled. That is Steam's convention, which anyone who has used Big
 * Picture already reads without a legend.
 *
 * ⚠️ Why a glyph and not the design's "Full controller support" text: the text is a
 * sentence laid over the artwork of every tile on the shelf, and at that rate it stops
 * being information and becomes texture. A 1.5rem glyph is cheap enough that the
 * POSITIVE case can be shown at all — with the text badge it had to be suppressed.
 *
 * The clip needs a document-unique id; two cards sharing one would make every glyph on
 * the shelf take whichever clip mounted last.
 */
const ControllerGlyph = ({ support }: { support: Exclude<ControllerSupport, 'none'> }) => {
  const clipId = useId()
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={support === 'full' ? 'Full controller support' : 'Partial controller support'}
      className="size-6 drop-shadow-[0_0_0.125rem_rgba(0,0,0,.9)]"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={support === 'full' ? 24 : 12} height="24" />
        </clipPath>
      </defs>
      <path d={PAD_PATH} fillRule="evenodd" fill="currentColor" opacity={0.35} />
      <path d={PAD_PATH} fillRule="evenodd" fill="currentColor" clipPath={`url(#${clipId})`} />
    </svg>
  )
}

/**
 * Dot colours for Valve's Deck verdict, reusing the palette rather than inventing one.
 *
 * `unknown` deliberately has no entry — an unknown verdict renders nothing at all,
 * never a grey dot labelled "Unknown". A store that says "Unknown" about half its
 * catalogue has taught the reader to ignore that slot.
 */
const DECK_DOT: Partial<Record<DeckCompat, string>> = {
  verified: 'var(--color-rating-up)',
  playable: 'var(--color-rating-dn)',
  unsupported: '#d0685f',
}

/**
 * How much attention this card has, which decides how far it recedes.
 *
 * ⚠️ Three states, not two, and the two opacities are NOT the same number — that is
 * spec §5.6, and it is a rule rather than a taste. Stacking dimming on a wrapper and
 * on the caption multiplies down (0.55 x 0.72 x 0.55 ~ 0.22 alpha) and the tier label
 * simply disappears at ten feet. Art dims; caption text stays at 0.8 or above. The
 * mapping lives here so no caller can get it wrong.
 */
export type CardAttention = 'focused' | 'nearby' | 'away'

const ART_OPACITY: Record<CardAttention, number> = { focused: 1, nearby: 0.72, away: 0.5 }
const CAPTION_OPACITY: Record<CardAttention, number> = { focused: 1, nearby: 0.92, away: 0.8 }

/* ─────────────────────────── props ─────────────────────────── */

export type StoreCardProps = Partial<CardShape> & {
  /** ⚠️ `title`, not `name` — the design project reserves `name` for `dc-import`. */
  title: string
  art?: string
  /** Already formatted. The card does no price logic; see docs/DESIGN-PORT.md §4. */
  price?: string
  wasPrice?: string
  /** e.g. `-30%`. Independent of `wasPrice` — either can appear without the other. */
  discount?: string
  /** 0-100. `undefined` is "not hydrated"; the slot holds its place rather than popping in. */
  rating?: number
  /** ProtonDB tier: a dot colour and a label. `undefined` while the request is out. */
  tier?: { dot: string; label: string }
  /** Valve's own verdict. Shown ALONGSIDE the tier — they are different claims. */
  deck?: DeckCompat
  flag?: string
  owned?: boolean
  controllerSupport?: ControllerSupport
  tags?: readonly string[]
  attention?: CardAttention
  /** Overlays the art once focused — the microtrailer. The design has no equivalent. */
  media?: ReactNode
  /** Replaces the art when it fails to load. */
  artFallback?: ReactNode
  /** Fires when the artwork 404s, so the caller can switch to `artFallback`. */
  onArtError?: () => void
  onActivate?: () => void
}

/**
 * Boxed for the home shelves — **settled by design turn 12**, after shipping as bare.
 *
 * A plate behind art AND caption, so each tile reads as an object. That is what lets
 * the PLATE carry the focus glow instead of the artwork having to: bare art with a
 * caption floating on the page has nothing to light up, which is why the shipped
 * version's focus treatment was a ring drawn around the two of them together.
 *
 * ⚠️ Still not verified at 4K from a sofa — the question that removed the hero panel.
 * The design's answer is recorded here; the television has not seen it yet.
 */
export const SHELF_SURFACE: CardShape['surface'] = 'boxed'

/* ─────────────────────────── component ─────────────────────────── */

export const StoreCard = ({
  title,
  art,
  price,
  wasPrice,
  discount,
  rating,
  tier,
  deck,
  flag,
  owned,
  controllerSupport,
  tags,
  attention = 'away',
  media,
  artFallback,
  onArtError,
  onActivate,
  width,
  artHeight = CARD_SIZES.shelf.artHeight,
  artWidth = 17,
  layout = 'stacked',
  surface = 'bare',
  emphasis = 'standard',
  pricePlacement,
  facts = 'ratingTier',
  density = 'comfortable',
}: StoreCardProps) => {
  const compact = density === 'compact'
  const side = layout === 'side'
  const boxed = surface === 'boxed'
  const focused = attention === 'focused'

  // 0 when the parent sizes us — see `CardShape.width`. Selects the narrow branch.
  const contentRem =
    width === undefined ? 0 : width - (side ? artWidth : 0) - (boxed ? BOXED_PADDING_REM : 0)

  /*
   * §5.3 — beside the title a discount block competes with the name and truncates it to
   * about 46%. Still true, but turn 12 replaced the derivation with a fixed position.
   *
   * ⚠️ It used to depend on whether THIS item had a discount, which meant price sat
   * beside the title on a full-price tile and dropped a row on a discounted one — so it
   * landed somewhere different on adjacent tiles in the same shelf and the eye had to
   * hunt for it. Fixing the position also gives the title its full width back, which is
   * why a short name like WARDOGS no longer leaves a gap before a right-aligned price.
   *
   * The narrow branch is what a shelf tile always took anyway; the wide layouts
   * (focusedSide, poster) pass `pricePlacement` explicitly when they want otherwise.
   */
  const priceOnFacts =
    pricePlacement === undefined ? contentRem < NARROW_CONTENT_REM : pricePlacement === 'facts'

  const showTags = facts === 'tags' || facts === 'both'
  const showRating = facts !== 'tags'

  // Deck verdict and ProtonDB tier are different claims — Valve testing a build on its
  // own hardware, versus aggregated community reports — so neither substitutes for the
  // other and both are shown. Two dots plus two labels do not fit a shelf tile's facts
  // row beside a price, so on a narrow card they take their own line. Same reasoning as
  // §5.3, applied to a block the design did not have.
  const deckLabel = deck !== undefined ? DECK_COMPAT_LABEL[deck] : ''
  const hasCompat = showRating || deckLabel !== ''
  /*
   * ⚠️ Derived from the SHAPE alone — never from whether this particular item happens
   * to have a Deck verdict or a resolved tier.
   *
   * Making it conditional on the content was the obvious version and it was wrong
   * twice. Measured on the live home rows: only 13 of 74 items carry a Deck verdict, so
   * a content-gated row produced tiles of two different heights (347px and 395px) side
   * by side in one shelf, and the bottom of the row went ragged — which is the exact
   * failure §5.1 and §5.2 reserve their minimum heights to prevent. It would also have
   * reflowed a tile under a focus ring you were looking at, a second after focusing it,
   * when ProtonDB finally answered.
   *
   * So the row is reserved, not earned. It costs ~2.5rem on tiles that have nothing to
   * say yet, and it was never free anyway: the tier slot is deliberately held open even
   * while empty so the label cannot pop in and shove the row sideways mid-scroll.
   */
  // A compact card has no room for a second facts line, and does not need one: the
  // grid never passes a ProtonDB tier (it is fetched lazily per focused row, which a
  // five-up grid has no equivalent of), so compatibility is one label, not two.
  const compatOnOwnRow = !compact && hasCompat && contentRem < NARROW_CONTENT_REM

  const Root = onActivate ? 'button' : 'div'

  return (
    <Root
      {...(onActivate ? { type: 'button' as const, onClick: onActivate } : {})}
      style={width === undefined ? undefined : { width: `${width}rem` }}
      className={[
        // ⚠️ `shrink-0` unconditionally. It is not about the chosen width — in a flex
        // COLUMN it is what stops the card being squeezed vertically to nothing, which
        // is exactly what happened to the search results when this was made
        // width-dependent: eight cards, 1352px wide, 0px tall.
        'group relative min-w-0 shrink-0 text-left transition-all duration-200 ease-out',
        side ? 'flex' : 'flex flex-col',
        // ⚠️ The ring must never be `outline-none` plus width/colour utilities — see
        // the utility definition in index.css. It is always present; only the colour
        // changes, which is also what gives it something to animate from.
        // ⚠️ A boxed plate carries its focus as light, not as a ring — turn 12. The two
        // must not both fire: a ring outside a bloom draws a hard edge around the soft
        // one and the tile reads as a boxed box.
        boxed ? '' : focused ? 'card-ring z-10' : 'card-ring-off',
        boxed
          ? [
              // ⚠️ NOT `overflow-hidden`, which is what it used to be. The focus bloom
              // is painted by children whose shadows have to reach outside the plate,
              // and an element's own overflow clips its children's shadows. The art
              // panel rounds its own top corners instead — that clipping was the only
              // job the plate's overflow was doing.
              'isolate rounded-xl',
              // The black drop shadow stays on the plate itself and stays STATIC — it is
              // deliberately not part of the breathing pair. See index.css.
              focused ? 'z-10 bg-plate-focus shadow-tile-drop' : 'bg-plate shadow-plate',
            ].join(' ')
          : // Bare: only the art panel carries a surface, and the caption sits on the
            // page. Must stay `overflow-visible` or the ring is shaved off.
            `gap-3 overflow-visible ${focused ? 'card-ring z-10' : 'card-ring-off'}`,
      ].join(' ')}
    >
      {boxed && focused && <TileFocusLight />}
      <div
        className={[
          'relative shrink-0 overflow-hidden',
          // ⚠️ The art rounds its OWN top corners now. The plate used to do it with
          // `overflow-hidden`, which it can no longer afford — see the root above.
          // Top only: the art bleeds to the plate edge and the caption sits beneath it.
          boxed ? (side ? 'rounded-l-xl' : 'rounded-t-xl') : 'rounded-lg',
          side ? '' : 'w-full',
        ].join(' ')}
        style={{
          opacity: ART_OPACITY[attention],
          ...(side
            ? { width: `${artWidth}rem`, minHeight: `${artHeight}rem` }
            : { height: `${artHeight}rem` }),
        }}
      >
        {art === undefined && artFallback !== undefined ? (
          artFallback
        ) : (
          // §5.5 — `object-cover object-center`, never `object-contain`. Widening a
          // card at constant art height must uncover more frame, not scale the image.
          <img
            src={art}
            alt=""
            loading="lazy"
            draggable={false}
            onError={onArtError}
            className="block h-full w-full object-cover object-center"
          />
        )}

        {media}

        {flag !== undefined && (
          <span
            className="absolute left-0 top-0 px-3 py-1 text-sm font-medium uppercase leading-5 tracking-wide text-white shadow-flag"
            style={{ backgroundImage: DEAL_FLAG_GRADIENTS[flag] }}
          >
            {flag}
          </span>
        )}

        {/* Only when a session actually told us. `undefined` is "unknown", never
            "not owned" — there is no anonymous source. */}
        {owned === true && (
          <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-focus text-sm font-extrabold leading-5 text-ink-on-accent ring-4 ring-scrim">
            ✓
          </span>
        )}

        {/*
          The glyph is capable of both declared states; WHICH are worth showing is the
          caller's policy — see `Tile`.

          ⚠️ `none` has no glyph on purpose. It is the one state that cannot be drawn
          honestly: Steam omits `controller_categoryids` both for genuinely keyboard-only
          games and for anything whose developer has not filled the field in, so a
          crossed-out pad would be a confident claim built on an absence.
        */}
        {controllerSupport !== undefined && controllerSupport !== 'none' && (
          <span
            className={[
              'absolute bottom-2 left-2 flex items-center rounded-md bg-scrim p-1',
              controllerSupport === 'full' ? 'text-pad-ok' : 'text-ink-mute',
            ].join(' ')}
          >
            <ControllerGlyph support={controllerSupport} />
          </span>
        )}
      </div>

      <div
        className={[
          'flex min-w-0 flex-1 flex-col gap-2 transition-opacity duration-200',
          boxed ? (compact ? 'px-3.5 pb-3.5 pt-3' : 'px-4 pb-5 pt-4') : '',
          compact ? 'gap-1.5' : '',
        ].join(' ')}
        style={{ opacity: CAPTION_OPACITY[attention] }}
      >
        {/* §5.2 — `min-h-11` holds whether or not a price sits here, so two cards of
            different widths can share a row height. */}
        <div className={`flex items-center gap-3 ${compact ? 'min-h-5.5' : 'min-h-11'}`}>
          {/* §5.4 — `min-w-0` is required. Without it the flex item refuses to shrink
              and the row overflows instead of ellipsising. */}
          <span
            className={[
              'min-w-0 flex-1 truncate font-bold',
              emphasis === 'large'
                ? 'text-2xl leading-8'
                : compact
                  ? 'text-lg leading-snug'
                  : 'text-xl leading-7',
              focused ? 'text-ink' : 'text-ink-soft',
            ].join(' ')}
          >
            {title}
          </span>
          {!priceOnFacts && (
            <PriceBlock price={price} wasPrice={wasPrice} discount={discount} align="end" />
          )}
        </div>

        {/* §5.1 — `min-h-10` in BOTH price placements, same reason as above. */}
        <div
          className={`flex items-center gap-2.5 overflow-hidden whitespace-nowrap ${
            compact ? 'min-h-9.5' : 'min-h-10'
          }`}
        >
          {priceOnFacts && (
            <>
              <PriceBlock price={price} wasPrice={wasPrice} discount={discount} />
              {(showRating || !compatOnOwnRow) && <Divider />}
            </>
          )}

          {showRating && <RatingFact rating={rating} />}

          {!compatOnOwnRow && hasCompat && (
            <>
              {showRating && <Divider />}
              <CompatFacts tier={tier} deck={deck} deckLabel={deckLabel} />
            </>
          )}
        </div>

        {compatOnOwnRow && (
          // `min-h-7` reserves exactly the one `leading-7` line its labels occupy.
          // Without it the row is 16px tall while the tier is still unresolved (just
          // the dot) and 37px once ProtonDB answers — so tiles in one shelf ended up
          // 373px and 395px, and the row went ragged along the bottom. Same rule as
          // §5.1 and §5.2: reserve the height, do not let the content earn it.
          <div className="flex min-h-7 items-center gap-2.5 overflow-hidden whitespace-nowrap">
            <CompatFacts tier={tier} deck={deck} deckLabel={deckLabel} />
          </div>
        )}

        {showTags && tags !== undefined && tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {tags.slice(0, 8).map((tag) => (
              <span
                key={tag}
                className="rounded bg-chip px-3 py-1 text-base font-medium leading-6 text-ink-mute"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Root>
  )
}

/* ─────────────────────────── parts ─────────────────────────── */

const Divider = () => <span className="h-5 w-px flex-none bg-hairline" />

/**
 * The -%/was/now block.
 *
 * ⚠️ The card formats nothing. `formatPrice(0)` returns 'Free' and unreleased titles
 * report `final_price: 0` with no per-item flag, so a card that formatted its own price
 * would advertise every upcoming game as free. Callers hand in finished strings, having
 * already gated on `comingSoon`.
 */
const PriceBlock = ({
  price,
  wasPrice,
  discount,
  align,
}: {
  price?: string
  wasPrice?: string
  discount?: string
  align?: 'end'
}) => {
  if (price === undefined && discount === undefined) return null
  return (
    <span className="flex flex-none items-center gap-2">
      {discount !== undefined && (
        <span className="rounded bg-sale px-1.5 py-0.5 text-base font-extrabold leading-6 tabular-nums text-ink-on-light">
          {discount}
        </span>
      )}
      <span className={`flex flex-col ${align === 'end' ? 'items-end' : ''}`}>
        {/* Hidden rather than falling back to the final price: `originalPriceCents` is
            undefined when nothing is discounted, and a strikethrough over today's price
            is a lie. */}
        {wasPrice !== undefined && (
          <span className="text-sm font-semibold leading-4 tabular-nums text-ink-faint line-through">
            {wasPrice}
          </span>
        )}
        {price !== undefined && (
          <span className="text-xl font-extrabold leading-6 tabular-nums text-white">{price}</span>
        )}
      </span>
    </span>
  )
}

/**
 * Review percentage with Steam's thumb.
 *
 * §5.8 — the thumb hides entirely when there is no score. A thumbs-down next to "No
 * reviews" reads as a verdict, and it is the opposite of one.
 */
const RatingFact = ({ rating }: { rating?: number }) => (
  <span
    className={[
      'flex flex-none items-center gap-2 text-lg font-bold leading-7 tabular-nums',
      rating === undefined
        ? 'text-ink-faint'
        : rating >= GOOD_REVIEW_PCT
          ? 'text-rating-up'
          : 'text-rating-dn',
    ].join(' ')}
  >
    {rating !== undefined && (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={`size-5 shrink-0 ${rating < THUMB_DOWN_PCT ? 'rotate-180' : ''}`}
      >
        <path d="M2 10h4v11H2zM21.6 10.2c-.4-.5-1-.8-1.7-.8h-4.3l.7-3.4c.2-.9-.1-1.8-.7-2.4-.5-.5-1.4-.4-1.8.2L9.4 9.4c-.3.4-.4.8-.4 1.2V19c0 1.1.9 2 2 2h6.5c.9 0 1.7-.6 1.9-1.5l1.8-7.3c.2-.7 0-1.4-.4-2z" />
      </svg>
    )}
    {rating !== undefined ? `${rating}%` : 'No reviews'}
  </span>
)

/**
 * Compatibility: Valve's Deck verdict and the ProtonDB tier, together.
 *
 * Both are labelled with their source. Two coloured dots with bare words next to them
 * ("Verified", "Gold") would be two unattributed claims that sometimes disagree, and
 * the reader has no way to tell which is which at three metres.
 *
 * ⚠️ The tier dot stays grey and unlabelled until ProtonDB answers, rather than being
 * absent — ratings are fetched a row at a time, so most tiles legitimately have none,
 * and a slot that appears late shoves the whole row sideways as you scroll.
 */
const CompatFacts = ({
  tier,
  deck,
  deckLabel,
}: {
  tier?: { dot: string; label: string }
  deck?: DeckCompat
  deckLabel: string
}) => (
  <>
    {deckLabel !== '' && deck !== undefined && (
      <span className="flex flex-none items-center gap-2 text-lg font-semibold leading-7 text-ink-mute">
        <span
          className="size-3 flex-none rounded-full"
          style={{ background: DECK_DOT[deck] ?? 'transparent' }}
        />
        Deck {deckLabel}
      </span>
    )}
    {/*
      Nothing at all until ProtonDB answers — no placeholder dot.

      An earlier version held a grey dot open here to stop the label popping in and
      shoving the row. That job now belongs to the row's own `min-h-7`, and the dot
      cannot shift anything anyway because the tier is last on the line. What it did
      instead was leave a lone grey bullet under the price on every tile Steam has no
      Deck verdict for, which reads as an artifact rather than as a placeholder.
    */}
    {tier !== undefined && (
      <span className="flex min-w-0 items-center gap-2 text-lg font-semibold leading-7 text-ink-mute">
        <span className="size-3 flex-none rounded-full" style={{ background: tier.dot }} />
        <span className="truncate">Proton {tier.label}</span>
      </span>
    )}
  </>
)
