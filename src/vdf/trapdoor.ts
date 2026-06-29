// ISOLATED trapdoor module — the ONLY file that reads the group order (LAMBDA).
//
// It demonstrates what the VDF assumes NO ONE can do: with the factorization of N you can
// collapse 2^T into a tiny exponent and compute y instantly, skipping the T squarings. The
// security of the VDF is exactly the assumption that this knowledge is unavailable.
//
// This is NEVER the default path and is NEVER wired into eval.ts or wesolowski.ts. It exists
// only behind an explicit "reveal the trapdoor" control so the lesson is concrete.

import { LAMBDA, groupPow, powmodSmall, toElement } from './group';
import type { GroupElement, Steps } from './types';

/**
 * Compute y = x^(2^T) mod N the dishonest way: reduce the exponent 2^T modulo the group
 * order λ(N) first, then a single short exponentiation. Produces the SAME y as evaluate(),
 * but without the sequential delay — which is precisely why N's factors must stay secret.
 */
export function cheatWithFactors(input: bigint, t: Steps): GroupElement {
  const x = toElement(input);
  const shortExp = powmodSmall(2n, BigInt(t), LAMBDA); // 2^T mod λ(N) — the shortcut
  return groupPow(x, shortExp);
}
