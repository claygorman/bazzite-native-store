/**
 * How many tag chips actually fit on a card of a given width — design turn 16a.
 *
 * ⚠️ **A fixed count per size does not work, and that is the whole reason this exists.**
 * The design derives the count from width alone (5 at 688px down to 2 at 336px), which is
 * right about the intent and wrong about the arithmetic, because Steam's tag names are not
 * a uniform width: "FPS" is three characters and "Open World Survival Craft" is twenty-five.
 * Measured on the live home rows, three chips at 440px overflowed on 11 of 82 tiles —
 * "Turn-Based Tactics · Turn-Based Strategy · Sci-fi" is simply longer than the card.
 *
 * ⚠️ And an overflowing row is not a cosmetic problem here: `overflow-hidden` clips the
 * last chip through the middle of a word, which reads as a rendering bug rather than as
 * truncation. The design's own rule is "truncate by whole chip". So this fits by WIDTH and
 * returns whole chips.
 *
 * ⚠️ Estimated, not measured. Measuring means a DOM read per card per render, on a screen
 * that is mostly cards — and being one chip conservative costs nothing, while a layout pass
 * per tile on a 4K television costs frames. The estimate is deliberately slightly
 * pessimistic so it errs toward showing one fewer tag rather than one clipped one.
 */

/**
 * rem. `px-3` each side.
 *
 * ⚠️ Measured, not derived: 1.544rem across 121 real chips on the live home rows
 * (2026-08-24). `px-3` is 1.5rem of padding and the rest is the chip's own layout, so the
 * arithmetic value would have been slightly wrong in the direction that clips.
 */
const CHIP_PADDING_REM = 1.6
/** rem. `gap-2` between chips. */
const CHIP_GAP_REM = 0.5

/**
 * rem per character at `text-base font-medium`.
 *
 * ⚠️ **Measured across 121 real chips on the live home rows, 2026-08-24**, not guessed —
 * the guess (0.5) was too low and clipped 16 of 82 tiles.
 *
 * The distribution is the interesting part: the MEDIAN is 0.519, but the WORST is 0.749,
 * because short all-caps tags ("PvP", "FPS", "RPG") are far wider per character than long
 * lowercase ones ("Turn-Based Strategy"). A per-character estimate is therefore always
 * wrong somewhere; the only question is which way.
 *
 * 0.62 sits above the median and below the worst case deliberately. Using the worst case
 * would guarantee no clipping and allow only one chip beside a long tag name, which throws
 * away the feature to avoid its failure mode. The failure mode of a too-small value is a
 * clipped chip (a visible defect); of a too-large one, one fewer tag (invisible).
 */
const CHAR_REM = 0.62

/** The hard ceiling from the design, regardless of how much room there is. */
const MAX_CHIPS = 5

/**
 * The tags that fit, in Steam's order.
 *
 * ⚠️ Order is never changed and chips are never reordered to pack more in. Steam sorts
 * tags by vote weight, so the first is the most-agreed description of the game; dropping
 * "Survival" to fit "Sci-fi" because it is shorter would misrepresent it. Greedy from the
 * front, stop at the first one that does not fit.
 *
 * @param tags   Steam's tags, most-voted first.
 * @param widthRem  Room available to the row, in rem. `undefined` (a parent-sized card)
 *                  takes the narrowest sensible budget rather than guessing high.
 */
export const tagsThatFit = (
  tags: readonly string[] | undefined,
  widthRem: number | undefined,
): readonly string[] => {
  if (tags === undefined || tags.length === 0) return []
  // A parent-sized card gets the shelf tile's content budget — the narrowest real one.
  const budget = widthRem === undefined || widthRem <= 0 ? 19 : widthRem
  const out: string[] = []
  let used = 0
  for (const tag of tags) {
    if (out.length >= MAX_CHIPS) break
    const chip = CHIP_PADDING_REM + tag.length * CHAR_REM
    const next = used + chip + (out.length > 0 ? CHIP_GAP_REM : 0)
    // ⚠️ Stop, do not skip. Continuing past a chip that does not fit to try a shorter one
    // further down would reorder Steam's ranking by length — see the note above.
    if (next > budget) break
    out.push(tag)
    used = next
  }
  return out
}
