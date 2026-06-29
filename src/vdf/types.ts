// Branded/strict types so the unsafe substitutions the demo warns about are hard to make
// by accident. A GroupElement is always reduced mod N; Steps is always a non-negative T.

export type GroupElement = bigint & { readonly __brand: 'GroupElement' };
export type Steps = number & { readonly __brand: 'Steps' };

/** A Wesolowski short proof: the Fiat–Shamir prime challenge and the proof element π. */
export interface Proof {
  /** prime challenge ℓ = hashToPrime(N, x, y, T) — included for display; the verifier re-derives it. */
  readonly l: bigint;
  /** π = x^⌊2^T / ℓ⌋ mod N */
  readonly pi: GroupElement;
}

/** Result of verifying, with the operation-count contrast that is the whole point. */
export interface VerifyResult {
  readonly ok: boolean;
  /** which check failed, for fail-closed messaging */
  readonly reason: 'verified' | 'identity-failed' | 'out-of-range' | 'bad-input';
  /** mod-N group multiplications the verifier performed (≈ constant in T) */
  readonly verifierOps: number;
}

export function asSteps(t: number): Steps {
  if (!Number.isInteger(t) || t < 0) throw new Error('T must be a non-negative integer');
  return t as Steps;
}
