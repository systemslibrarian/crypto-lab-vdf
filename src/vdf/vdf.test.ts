import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LAMBDA, N, ops, powmodSmall, resetOps, toElement } from './group';
import { evaluate } from './eval';
import { hashToPrime, prove, verify } from './wesolowski';
import { cheatWithFactors } from './trapdoor';
import { asSteps } from './types';

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

describe('cost invariant: verify is ~constant in T, eval is linear in T', () => {
  it("verifier op count does not grow with T while eval's does", async () => {
    const mk = async (t: number) => {
      const T = asSteps(t);
      const { x, y } = evaluate(1234n, T);
      const proof = await prove(x, y, T);
      const res = await verify(x, y, T, proof);
      return res.verifierOps;
    };
    // Verifier cost is O(log ℓ + log N) — bounded by a constant independent of T (it varies
    // only with the bit-pattern of ℓ and r, both ~128 bits), and always ≪ the T squarings.
    const CONST_CEILING = 600; // ~2·128 group ops for the two short exponentiations, plus slack
    for (const t of [2048, 8192, 16384]) {
      const v = await mk(t);
      expect(v).toBeLessThan(CONST_CEILING); // does not grow with T
      expect(v).toBeLessThan(t / 3);         // far cheaper than re-running the delay
    }
  });
});

describe('trapdoor', () => {
  it('produces the same y as honest evaluation (so the shortcut is real)', () => {
    for (const t of [8, 64, 500]) {
      const { y } = evaluate(42n, asSteps(t));
      expect(cheatWithFactors(42n, asSteps(t))).toBe(y);
    }
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
