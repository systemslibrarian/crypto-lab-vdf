import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LAMBDA, N, ops, powmodSmall, resetOps, toElement } from './group';
import { evaluate } from './eval';
import { hashToPrime, prove, verify } from './wesolowski';
import { cheatWithFactors } from './trapdoor';
import { raceWorkers, sliceSteps } from './parallel';
import { MAX_STEPS, asSteps } from './types';

describe('evaluation correctness', () => {
  it('T sequential squarings equal x^(2^T) mod N via the group-order shortcut', () => {
    for (const t of [0, 1, 5, 13, 64]) {
      const { x, y } = evaluate(42n, asSteps(t));
      const shortExp = powmodSmall(2n, BigInt(t), LAMBDA); // 2^T mod λ(N)
      const reference = powmodSmall(x, shortExp, N);
      expect(y).toBe(reference);
    }
  });

  it('eval performs exactly T mod-N squarings', () => {
    resetOps();
    evaluate(7n, asSteps(1000));
    expect(ops()).toBe(1000);
  });
});

describe('Wesolowski round-trip', () => {
  it('accepts an honest proof across inputs and difficulties', async () => {
    for (const [input, t] of [[3n, 8], [42n, 64], [12345n, 257], [99n, 1024]] as const) {
      const { x, y } = evaluate(input, asSteps(t));
      const proof = await prove(x, y, asSteps(t));
      const res = await verify(x, y, asSteps(t), proof);
      expect(res.ok).toBe(true);
      expect(res.reason).toBe('verified');
    }
  });
});

describe('fail-closed', () => {
  it('rejects a tampered output y', async () => {
    const t = asSteps(128);
    const { x, y } = evaluate(42n, t);
    const proof = await prove(x, y, t);
    const res = await verify(x, ((y + 1n) % N) as typeof y, t, proof);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('identity-failed');
  });

  it('rejects a tampered proof π', async () => {
    const t = asSteps(128);
    const { x, y } = evaluate(42n, t);
    const proof = await prove(x, y, t);
    const res = await verify(x, y, t, { l: proof.l, pi: ((proof.pi + 1n) % N) as typeof proof.pi });
    expect(res.ok).toBe(false);
  });

  it('rejects a mismatched T (challenge binds T)', async () => {
    const t = asSteps(128);
    const { x, y } = evaluate(42n, t);
    const proof = await prove(x, y, t);
    const res = await verify(x, y, asSteps(129), proof);
    expect(res.ok).toBe(false);
  });

  it('rejects a non-canonical proof π + N', async () => {
    // groupPow() reduces its base mod N, so π and π+N are the same group element and the
    // identity held: an ALTERED proof verified, under a page that promises "a real VDF must
    // reject any altered output or proof". π is now range-checked like x and y.
    const t = asSteps(64);
    const { x, y } = evaluate(42n, t);
    const proof = await prove(x, y, t);
    expect((await verify(x, y, t, proof)).ok, 'the untampered proof still verifies').toBe(true);
    const res = await verify(x, y, t, { l: proof.l, pi: (proof.pi + N) as typeof proof.pi });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('bad-input');
    const negative = await verify(x, y, t, { l: proof.l, pi: 0n as typeof proof.pi });
    expect(negative.ok).toBe(false);
    expect(negative.reason).toBe('bad-input');
  });

  it('rejects a proof whose transmitted ℓ disagrees with the derived challenge', async () => {
    // verify() derives ℓ itself, which is the cryptographically load-bearing half — but the
    // proof object also CARRIES an ℓ, and the page displays it as part of the proof. Ignoring
    // the field entirely meant an altered ℓ still verified, against the page's own promise
    // that a real VDF must reject any altered output or proof.
    const t = asSteps(64);
    const { x, y } = evaluate(42n, t);
    const proof = await prove(x, y, t);
    expect((await verify(x, y, t, proof)).ok, 'the untampered proof still verifies').toBe(true);
    const res = await verify(x, y, t, { l: proof.l + 2n, pi: proof.pi });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('challenge-mismatch');
    // The check runs AFTER the identity so a tampered x, y or T still reports as the identity
    // failure it is — only an altered ℓ field on an otherwise-honest proof lands here.
    const tamperedY = await verify(x, ((y + 1n) % N) as typeof y, t, proof);
    expect(tamperedY.reason).toBe('identity-failed');
  });

  it('rejects an out-of-range output', async () => {
    const t = asSteps(8);
    const { x, y } = evaluate(42n, t);
    const proof = await prove(x, y, t);
    const res = await verify(x, (N + 5n) as typeof y, t, proof);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('out-of-range');
  });
});

describe('Fiat–Shamir challenge binding', () => {
  it('challenge is prime and changes when y changes', async () => {
    const x = toElement(42n);
    const { y } = evaluate(42n, asSteps(64));
    const l1 = await hashToPrime(x, y, asSteps(64));
    const l2 = await hashToPrime(x, ((y + 1n) % N) as typeof y, asSteps(64));
    expect(l1).not.toBe(l2);
    // Miller–Rabin sanity: ℓ has no tiny factors and is odd
    expect(l1 % 2n).toBe(1n);
    for (const p of [3n, 5n, 7n, 11n, 13n]) expect(l1 % p === 0n).toBe(false);
  });
});

describe('toy-scale bounds', () => {
  it('the core API refuses difficulties beyond MAX_STEPS', () => {
    // prove() materializes 2^T as a T-bit BigInt — fine at demo scale, not at real VDF
    // difficulty. The bound makes "toy-scale" enforced rather than hoped for, and the UI
    // slider maximum (2^14) sits far inside it.
    expect(() => asSteps(MAX_STEPS)).not.toThrow();
    expect(() => asSteps(MAX_STEPS + 1)).toThrow(/toy prover/);
    expect(() => asSteps(2 ** 14)).not.toThrow();
    expect(2 ** 14).toBeLessThanOrEqual(MAX_STEPS);
  });
});

describe('prover cost is real, and stated', () => {
  /**
   * The page used to caption ℓ and π "Short proof (computed once by the evaluator)", which
   * read as: the T squarings were the cost, the proof falls out. It does not — prove() runs a
   * second square-and-multiply by ⌊2^T/ℓ⌋, roughly another T group operations. Measured here
   * so the UI's stated number rests on the same engine.
   */
  it('prove() spends ~T more group operations at large T, and zero in the π = 1 regime', async () => {
    // π = 1 regime: 2^T < ℓ (~2^127), so ⌊2^T/ℓ⌋ = 0 and groupPow does nothing.
    for (const t of [16, 32, 64]) {
      const T = asSteps(t);
      const { x, y } = evaluate(42n, T);
      resetOps();
      const proof = await prove(x, y, T);
      expect(ops(), `prove ops at T=${t}`).toBe(0);
      expect(proof.pi).toBe(1n);
    }
    // Real regime: the quotient has ~T-128 bits, so the second exponentiation is ~linear in T.
    const T = asSteps(2048);
    const { x, y } = evaluate(42n, T);
    resetOps();
    await prove(x, y, T);
    const proveOps = ops();
    expect(proveOps, 'a second exponentiation, not a freebie').toBeGreaterThan(1500);
    expect(proveOps, 'still ~linear in T, not worse').toBeLessThan(2 * 2048);
  });
});

/** Every difficulty the shipped slider can select: 2^4 … 2^14. */
const SLIDER_T = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((e) => asSteps(2 ** e));

describe('cost invariant: verify is ~constant in T, eval is linear in T', () => {
  /**
   * The old version of this test ran t ∈ {2048, 8192, 16384} only and asserted
   * `verifierOps < t / 3`. That is true at those three values and FALSE at five of the
   * eleven the slider can actually reach — the test was scoped past its own counterexample,
   * and the page shipped "≈ 1× cheaper to verify than to compute" beside 16 and 208.
   *
   * The honest invariant is a bound, not a comparison: the verifier's cost does not GROW
   * with T. Whether it is the cheaper side is then a fact about T, and the test asserts that
   * BOTH regimes exist so no rendering may state the comparison unconditionally.
   */
  const verifierOpsAt = async (t: number) => {
    const T = asSteps(t);
    const { x, y } = evaluate(1234n, T);
    const proof = await prove(x, y, T);
    const res = await verify(x, y, T, proof);
    return res.verifierOps;
  };

  it("verifier op count does not grow with T while eval's does", async () => {
    // Verifier cost is O(log ℓ + log N) — bounded by a constant independent of T (it varies
    // only with the bit-pattern of ℓ and r, both ~128 bits).
    const CONST_CEILING = 600; // ~2·128 group ops for the two short exponentiations, plus slack
    for (const t of SLIDER_T) {
      const v = await verifierOpsAt(t);
      expect(v, `T=${t}`).toBeGreaterThan(0);
      expect(v, `T=${t}`).toBeLessThan(CONST_CEILING); // does not grow with T
    }
    // Eval cost, by contrast, is exactly T.
    for (const t of SLIDER_T) {
      resetOps();
      evaluate(1234n, t);
      expect(ops(), `T=${t}`).toBe(t);
    }
  });

  it('the slider reaches difficulties where verifying costs MORE than evaluating', async () => {
    const dearer: number[] = [];
    const cheaper: number[] = [];
    for (const t of SLIDER_T) {
      ((await verifierOpsAt(t)) >= t ? dearer : cheaper).push(t);
    }
    // Both regimes must be reachable. If either list is empty the page's cost tile could
    // state its comparison unconditionally — and this test would have nothing to say.
    expect(dearer.length, `no difficulty where verify costs more: ${JSON.stringify(dearer)}`)
      .toBeGreaterThan(0);
    expect(cheaper.length).toBeGreaterThan(0);
    // Documented measurement: T = 16…256 are the dear ones.
    expect(Math.min(...dearer)).toBe(16);
    expect(Math.max(...cheaper)).toBe(16384);
  });
});

describe('trapdoor', () => {
  it('produces the same y as honest evaluation (so the shortcut is real)', () => {
    for (const t of [8, 64, 500, 2048, 16384]) {
      const { y } = evaluate(42n, asSteps(t));
      expect(cheatWithFactors(42n, asSteps(t))).toBe(y);
    }
  });

  /**
   * The shortcut is constant in T, NOT free — and the old test asserted only that it lands on
   * the same y, at t ∈ {8, 64, 500}, every one of which is inside the range where the
   * "shortcut" is the SLOWER path. Meanwhile the panel said "no delay at all" and "skipped
   * all 128 squarings" while the trapdoor did 129 operations against the honest 128.
   *
   * Cause: cheatWithFactors reduces 2^T mod λ(N), and λ(N) is 511 bits, so for every T ≤ 510
   * the reduction is a no-op and groupPow spends T+1 operations.
   */
  it('costs ~constant work in T — which is MORE than the honest run at small T', () => {
    const cost = (t: number) => {
      resetOps();
      cheatWithFactors(42n, asSteps(t));
      return ops();
    };
    const CONST_CEILING = 900; // ~1.5·|λ(N)| group ops, whatever T is
    const slower: number[] = [];
    const faster: number[] = [];
    for (const t of SLIDER_T) {
      const c = cost(t);
      expect(c, `T=${t}`).toBeLessThan(CONST_CEILING); // constant in T, unlike the honest path
      (c < t ? faster : slower).push(t);
    }
    // Both regimes must exist, or "no delay at all" could be printed unconditionally.
    expect(slower.length, `no difficulty where the trapdoor is slower: ${JSON.stringify(slower)}`)
      .toBeGreaterThan(0);
    expect(faster.length).toBeGreaterThan(0);
    // The measured facts the panel's conditional prose is built on.
    expect(cost(16)).toBe(17);          // one operation MORE than the 16 honest squarings
    expect(Math.max(...slower)).toBe(512);
    expect(Math.min(...faster)).toBe(1024);
  });

  it('is isolated: eval.ts and wesolowski.ts never import the trapdoor or group order', () => {
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const file of ['./eval.ts', './wesolowski.ts']) {
      // Scan only the import statements, not the cautionary comments (which mention the names).
      const imports = read(file).match(/^\s*import\b[^\n]*$/gm) ?? [];
      const joined = imports.join('\n');
      expect(joined).not.toMatch(/trapdoor/);
      expect(joined).not.toMatch(/\bLAMBDA\b/);
      expect(joined).not.toMatch(/\bPHI\b/);
    }
  });
});

describe('parallel workers cannot shorten the chain', () => {
  it('splits T into slices that sum to exactly T', () => {
    for (const [t, w] of [[16, 4], [1024, 4], [17, 4], [3, 4]] as const) {
      const slices = sliceSteps(t, w);
      expect(slices).toHaveLength(w);
      expect(slices.reduce((a, b) => a + b, 0)).toBe(t);
    }
  });

  it('chained workers do exactly T squarings and reproduce the honest y', () => {
    for (const t of [16, 256, 1000]) {
      const T = asSteps(t);
      const { y } = evaluate(42n, T);
      resetOps();
      const race = raceWorkers(42n, T);
      expect(race.totalSteps).toBe(t);
      expect(race.chainedY).toBe(y);
      // Both strategies together spend 2T squarings plus the combine multiplies.
      expect(ops()).toBe(2 * t + race.workers);
    }
  });

  it('workers started together finish sooner and land on a different value', () => {
    for (const t of [16, 256, 1000]) {
      const T = asSteps(t);
      const race = raceWorkers(42n, T);
      expect(race.parallelWallClockSteps).toBeLessThan(race.totalSteps);
      expect(race.startedTogetherY).not.toBe(race.chainedY);
      expect(race.startedTogetherMatches).toBe(false);
    }
  });
});
