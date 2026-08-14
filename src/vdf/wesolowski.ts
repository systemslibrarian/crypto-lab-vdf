// The Wesolowski short proof (EUROCRYPT 2019).
//
// Prover (already paid the T-squaring cost) produces a tiny proof π. Verifier checks it with
// a handful of group operations — NO loop of T squarings. This is the property a plain
// time-lock puzzle lacks.
//
// HONESTY NOTE: the proof is tiny, but in this simple implementation GENERATING it is not.
// prove() runs a second square-and-multiply exponentiation by ⌊2^T/ℓ⌋ — roughly another T
// group operations on top of the evaluation — and it materializes 2^T as a T-bit BigInt
// (bounded by MAX_STEPS in types.ts). Production Wesolowski provers stream the quotient and
// generate π far more efficiently. Only VERIFICATION is cheap; the UI states the measured
// prover cost rather than implying the proof falls out of the evaluation for free.
//
// Identity:  given y = x^(2^T) mod N and prime challenge ℓ = H(N,x,y,T),
//            π = x^⌊2^T/ℓ⌋ mod N  and  r = 2^T mod ℓ,
//            verification accepts iff  π^ℓ · x^r ≡ y  (mod N).
//
// INVARIANT: this module never imports P, Q, PHI, or LAMBDA — prover and verifier do not
// know the group order. See group.ts.

import { N, groupMul, groupPow, ops, powmodSmall } from './group';
import type { GroupElement, Proof, Steps, VerifyResult } from './types';

const enc = new TextEncoder();

/**
 * Miller–Rabin PROBABLE-prime test with the first twelve prime bases. Fixed small bases are
 * proven deterministic only up to ~3.3e24 (~81 bits), so for a 128-bit candidate this is a
 * probabilistic check, not a primality proof — ample for a demo challenge drawn from SHA-256
 * output, but a production verifier would use a routine with a justified error bound.
 */
function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n % p === 0n) return n === p;
  }
  let d = n - 1n;
  let r = 0n;
  while ((d & 1n) === 0n) { d >>= 1n; r++; }
  for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    let x = powmodSmall(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 0n; i < r - 1n; i++) {
      x = (x * x) % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return new Uint8Array(digest);
}

/**
 * Fiat–Shamir challenge: a ~128-bit prime ℓ bound to ALL of (N, x, y, T). Changing any of
 * them changes ℓ, so a swapped output cannot reuse an old proof.
 */
export async function hashToPrime(x: GroupElement, y: GroupElement, t: Steps): Promise<bigint> {
  const base = `${N}|${x}|${y}|${t}|`;
  for (let counter = 0; counter < 1 << 20; counter++) {
    const digest = await sha256(enc.encode(base + counter));
    let cand = 0n;
    for (let i = 0; i < 16; i++) cand = (cand << 8n) | BigInt(digest[i]!); // 128 bits
    cand |= 1n;                 // odd
    cand |= 1n << 127n;         // full width
    if (isProbablePrime(cand)) return cand;
  }
  throw new Error('hashToPrime exhausted counter (unreachable in practice)');
}

/**
 * Generate the short proof. This costs the prover a SECOND exponentiation of ~T group
 * operations (see the honesty note above) — acceptable here because the prover is the slow
 * party by design, but not "for free" and not how a production prover does it.
 */
export async function prove(x: GroupElement, y: GroupElement, t: Steps): Promise<Proof> {
  const l = await hashToPrime(x, y, t);
  const exp2T = 1n << BigInt(t);     // T-bit BigInt — toy-scale only; asSteps() bounds T
  const q = exp2T / l;               // ⌊2^T / ℓ⌋
  const pi = groupPow(x, q);
  return { l, pi };
}

/**
 * Verify a claimed (x, y, T, proof). Fail-closed: any tampering returns ok:false.
 * The verifier derives ℓ itself — it does not trust proof.l. Cost is ~constant in T.
 */
export async function verify(x: GroupElement, y: GroupElement, t: Steps, proof: Proof): Promise<VerifyResult> {
  const yReduced = ((y % N) + N) % N;
  if (y < 0n || y >= N || x <= 0n || x >= N) {
    return { ok: false, reason: 'out-of-range', verifierOps: 0 };
  }
  // π must be canonically encoded in [1, N). groupPow() silently reduces its base mod N, so
  // without this check π and π+N are the same proof and an "altered proof" would be ACCEPTED —
  // which the page's own hint ("a real VDF must reject any altered output or proof") denies.
  if (proof.pi <= 0n || proof.pi >= N) {
    return { ok: false, reason: 'bad-input', verifierOps: 0 };
  }
  const before = ops();
  const l = await hashToPrime(x, y, t);          // re-derive challenge from the claimed values
  const r = powmodSmall(2n, BigInt(t), l);       // cheap mod-ℓ pre-step (uncounted)
  const lhs = groupMul(groupPow(proof.pi, l), groupPow(x as GroupElement, r));
  const verifierOps = ops() - before;
  if (lhs !== yReduced) {
    return { ok: false, reason: 'identity-failed', verifierOps };
  }
  // The proof object carries ℓ for display, and the identity above deliberately uses the
  // DERIVED ℓ, never the transmitted one. But silently accepting a proof whose ℓ field
  // disagrees with the transcript would mean an altered ℓ still verified, against the page's
  // own fail-closed promise. Checked after the identity so a tampered x, y or T — which also
  // shifts the derived challenge — still reports as the identity failure it is; only an
  // altered ℓ field on an otherwise-honest proof lands here.
  if (proof.l !== l) {
    return { ok: false, reason: 'challenge-mismatch', verifierOps };
  }
  return { ok: true, reason: 'verified', verifierOps };
}
