// Branded/strict types so the unsafe substitutions the demo warns about are hard to make
// by accident. A GroupElement is always reduced mod N; Steps is always a non-negative T.

export type GroupElement = bigint & { readonly __brand: 'GroupElement' };
export type Steps = number & { readonly __brand: 'Steps' };

/** A Wesolowski short proof: the Fiat–Shamir prime challenge and the proof element π. */
export interface Proof {
  /**
   * prime challenge ℓ = hashToPrime(N, x, y, T) — included for display. The verifier
   * re-derives ℓ itself and rejects a proof whose transmitted ℓ disagrees, so this field can
   * never smuggle in a challenge the transcript did not produce.
   */
  readonly l: bigint;
  /** π = x^⌊2^T / ℓ⌋ mod N */
  readonly pi: GroupElement;
}

/** Result of verifying, with the operation-count contrast that is the whole point. */
export interface VerifyResult {
  readonly ok: boolean;
  /** which check failed, for fail-closed messaging */
  readonly reason: 'verified' | 'identity-failed' | 'out-of-range' | 'bad-input' | 'challenge-mismatch';
  /** mod-N group multiplications the verifier performed (≈ constant in T) */
  readonly verifierOps: number;
}

/**
 * Upper bound on T for this toy implementation. prove() materializes 2^T as a BigInt
 * (a T-bit number), which is fine at demo scale and does not scale to real VDF
 * difficulties — a production Wesolowski prover computes ⌊2^T/ℓ⌋ without ever holding
 * 2^T. The core refuses anything beyond toy scale so that limit is enforced, not
 * merely hoped for; the UI slider tops out far below it at 2^14.
 */
export const MAX_STEPS = 1 << 20;

export function asSteps(t: number): Steps {
  if (!Number.isInteger(t) || t < 0) throw new Error('T must be a non-negative integer');
  if (t > MAX_STEPS) {
    throw new Error(`T must be <= ${MAX_STEPS}: this toy prover materializes 2^T as a BigInt`);
  }
  return t as Steps;
}
