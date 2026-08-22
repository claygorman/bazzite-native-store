import assert from 'node:assert/strict'
import { isAdultContent } from './contentFilter.ts'

/*
 * Fixtures are REAL descriptor sets, captured from the live home rows 2026-08-21.
 * The point of the test is the boundary: [1,5] and [1,3,4,5] both contain descriptor 1,
 * and only the second must be filtered. Filtering on 1 would remove Persona.
 */
const cases: Array<[string, number[] | undefined, boolean]> = [
  ['Big Tiddy Goth Baddie', [1, 3, 4, 5], true],
  ['TOYS 18+', [1, 3, 4, 5], true],
  ['Sky Yacht - Waves of Desire', [1, 3, 4, 5], true],
  ['My Sexy Fairies', [1, 2, 3, 4, 5], true],
  ['27-year-old Female Teacher', [1, 3, 4, 5], true],
  ['Persona 3 Reload', [1, 5], false],
  ['Persona 5 Royal', [1, 5], false],
  ['KOTAMON', [1, 5], false],
  ['Call of Duty: Modern Warfare 4', [2, 5], false],
  ['S.T.A.L.K.E.R. 2', [2, 5], false],
  ['Black Myth: Wukong', [2, 5], false],
  ['How to Fish', [5], false],
  ['unlabelled item', [], false],
  ['not hydrated yet', undefined, false],
  ['adult-only alone', [3], true],
  ['frequent nudity alone', [4], true],
]

let failed = 0
for (const [name, descriptors, expected] of cases) {
  const actual = isAdultContent(descriptors)
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expected ? 'hide' : 'keep'}  ${name}`)
}

assert.equal(failed, 0, `${failed} content-filter cases failed`)
console.log('\nall passed')
