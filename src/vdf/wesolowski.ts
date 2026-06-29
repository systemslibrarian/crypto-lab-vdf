// The Wesolowski short proof (EUROCRYPT 2019).
//
// Prover (already paid the T-squaring cost) produces a tiny proof π. Verifier checks it with
// a handful of group operations — NO loop of T squarings. This is the property a plain
// time-lock puzzle lacks.
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

/** Miller–Rabin probable-prime test (deterministic enough for a ~128-bit demo challenge). */
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

/** Generate the short proof. The prover may be expensive; it already did the T squarings. */
export async function prove(x: GroupElement, y: GroupElement, t: Steps): Promise<Proof> {
  const l = await hashToPrime(x, y, t);
  const exp2T = 1n << BigInt(t);     // prover-side big exponent — fine, prover is the slow party
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
  const before = ops();
  const l = await hashToPrime(x, y, t);          // re-derive challenge from the claimed values
  const r = powmodSmall(2n, BigInt(t), l);       // cheap mod-ℓ pre-step (uncounted)
  const lhs = groupMul(groupPow(proof.pi, l), groupPow(x as GroupElement, r));
  const verifierOps = ops() - before;
  const ok = lhs === yReduced;
  return { ok, reason: ok ? 'verified' : 'identity-failed', verifierOps };
}
