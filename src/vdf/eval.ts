// The honest evaluator: y = x^(2^T) mod N, computed as T sequential modular squarings.
//
// INVARIANT (load-bearing): this path does T real squarings in a loop and NEVER touches
// P, Q, PHI, or LAMBDA. The delay cannot be shortcut without the group order, which the
// evaluator does not know. The import list below is the proof — group order is not in it.

import { groupSquare, toElement } from './group';
import type { GroupElement, Steps } from './types';

export interface EvalResult {
  readonly x: GroupElement;
  readonly y: GroupElement;
  readonly t: Steps;
}

/** Evaluate the VDF synchronously: T sequential squarings. Returns x (normalized) and y. */
export function evaluate(input: bigint, t: Steps): EvalResult {
  const x = toElement(input);
  let y = x;
  for (let i = 0; i < t; i++) {
    y = groupSquare(y);
  }
  return { x, y, t };
}

/**
 * Stepwise evaluator for the animated UI: advances `chunk` squarings per call so the page can
 * paint the counter between chunks. Identical math to evaluate(); still strictly sequential —
 * each square depends on the previous, so no chunking, worker, or batch can reduce the count.
 */
export function* evaluateSteps(
  input: bigint,
  t: Steps,
  chunk = 256,
): Generator<{ done: number; total: number; current: GroupElement }, EvalResult, void> {
  const x = toElement(input);
  let y = x;
  let done = 0;
  while (done < t) {
    const upto = Math.min(done + chunk, t);
    for (; done < upto; done++) y = groupSquare(y);
    yield { done, total: t, current: y };
  }
  return { x, y, t };
}
