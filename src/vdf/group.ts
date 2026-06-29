// The RSA-style group of unknown order used by the VDF.
//
// N = P·Q with P, Q two random 256-bit primes generated once for this demo. In a real VDF
// nobody may know P and Q (trusted setup, or a class group with no setup). Here they are
// public ONLY so the isolated trapdoor module (trapdoor.ts) can demonstrate the assumption
// the security of the VDF rests on. eval.ts and wesolowski.ts must NEVER import P, Q, PHI,
// or LAMBDA — the honest evaluator and the verifier do not know them.
//
// Toy modulus: small enough that thousands of squarings run in real time in the browser,
// far too small for real security. This is for illustration, not for protecting anything.

import type { GroupElement } from './types';

export const P = 63659609771464787763506238825988808423089133633009476273322247847180157128159n;
export const Q = 113776022267090676420109220872936349326751982767123955818977915472126921170523n;
export const N = P * Q;

// Euler φ and Carmichael λ — the trapdoor. Quarantined here; only trapdoor.ts reads them.
export const PHI = (P - 1n) * (Q - 1n);
function gcdBig(a: bigint, b: bigint): bigint { while (b) { [a, b] = [b, a % b]; } return a < 0n ? -a : a; }
export const LAMBDA = ((P - 1n) * (Q - 1n)) / gcdBig(P - 1n, Q - 1n);

// ── Instrumentation ──────────────────────────────────────────────────────────
// Count ONLY mod-N group multiplications — the expensive, sequential operations. This lets a
// test prove eval grows linearly in T while verify stays ~constant in T. Cheap mod-ℓ
// arithmetic (ℓ ~128 bits) is deliberately not counted; it is the verifier's cheap pre-step.
let _ops = 0;
export function resetOps(): void { _ops = 0; }
export function ops(): number { return _ops; }

/** One mod-N multiply (counted). */
export function groupMul(a: GroupElement, b: GroupElement): GroupElement {
  _ops++;
  return ((a * b) % N) as GroupElement;
}

/** One mod-N squaring (counted) — the single primitive the sequential delay is built from. */
export function groupSquare(a: GroupElement): GroupElement {
  _ops++;
  return ((a * a) % N) as GroupElement;
}

/** Square-and-multiply exponentiation in the group (counted). Used by the cheap verifier. */
export function groupPow(base: GroupElement, exp: bigint): GroupElement {
  let result = 1n as GroupElement;
  let b = (((base % N) + N) % N) as GroupElement;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = groupMul(result, b);
    e >>= 1n;
    if (e > 0n) b = groupSquare(b);
  }
  return result;
}

/** Map arbitrary user input to a group element coprime to N (so trapdoor/Euler identity holds). */
export function toElement(input: bigint): GroupElement {
  let x = ((input % N) + N) % N;
  if (x < 2n) x += 2n;
  // Nudge into the coprime, non-degenerate range. With a 512-bit N this loop is essentially never taken.
  while (gcdBig(x, N) !== 1n || x <= 1n || x >= N - 1n) {
    x = (x + 1n) % N;
    if (x < 2n) x = 2n;
  }
  return x as GroupElement;
}

/** Uncounted plain-BigInt modular exponentiation — for the cheap mod-ℓ pre-step only. */
export function powmodSmall(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

export { gcdBig };
