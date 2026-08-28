/**
 * Tile tints, derived from a name (U9).
 *
 * Lives here rather than inside `EntityIcon` because the marketing site
 * renders the same tiles and must show the same colours. One definition means
 * the site cannot drift from the product; a second copy would look identical
 * on the day it was written and diverge on the first change.
 */

export const TINTS = ['#e8734a', '#4a7fc1', '#4aa86a', '#8b6ec9', '#e0a63c', '#d64550', '#4a9c9c']

/**
 * Picks a stable tint for a name.
 *
 * Sum of code points, not a hash: this only needs to be stable and spread out,
 * and a cryptographic hash here would be noise.
 */
export function tintFor(seed: string): string {
  let total = 0
  for (let i = 0; i < seed.length; i++) total += seed.charCodeAt(i)
  return TINTS[total % TINTS.length]!
}
