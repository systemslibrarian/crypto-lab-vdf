// "Can four workers finish it sooner?" — computed, not asserted.
//
// The panel that uses this used to be four CSS lanes plus a sentence stating the
// conclusion. The conclusion was true, but nothing on the page computed it: the
// lanes animated to a fixed width and the note was hardcoded. This module runs
// the two strategies for real so the page can show what each one produces.
//
// Strategy A (chained): the T squarings are split into W slices, and each worker
//   starts from the previous worker's output. The slices sum to exactly T, and
//   the result is bit-identical to evaluate() — the workers bought nothing,
//   because worker k cannot begin until worker k-1 has finished.
//
// Strategy B (started together): every worker starts from x at the same instant,
//   does its own slice, and the outputs are combined. Wall-clock length is the
//   longest slice — a real speedup — but the answer is a DIFFERENT number, so
//   the speedup is not a speedup, it is a wrong answer. That is the delay: the
//   chain has no shortcut, only alternatives that do not compute y.
//
// This module never touches P, Q, PHI, or LAMBDA — see group.ts.

import { N, groupMul, groupSquare, toElement } from './group';
import type { GroupElement, Steps } from './types';

export interface RaceResult {
  readonly workers: number;
  /** Squarings assigned to each worker; these sum to exactly T. */
  readonly stepsPerWorker: number[];
  /** Sum of the slices — must equal T. */
  readonly totalSteps: number;
  /** Steps on the critical path if the workers really did run at once. */
  readonly parallelWallClockSteps: number;
  /** Chained workers: the honest answer, identical to evaluate(x, T).y. */
  readonly chainedY: GroupElement;
  /** Workers started together from x, outputs combined: a different value. */
  readonly startedTogetherY: GroupElement;
  /** True when the started-together strategy happened to reproduce y. */
  readonly startedTogetherMatches: boolean;
}

/** Split `t` steps across `workers` slices as evenly as possible (sums to t). */
export function sliceSteps(t: number, workers: number): number[] {
  if (workers < 1) throw new Error('workers must be >= 1');
  const base = Math.floor(t / workers);
  const extra = t % workers;
  return Array.from({ length: workers }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Run both strategies over the same input and step budget. Pure computation —
 * every number the panel prints comes from here.
 */
export function raceWorkers(input: bigint, t: Steps, workers = 4): RaceResult {
  const x = toElement(input);
  const stepsPerWorker = sliceSteps(t, workers);

  // A: chained — each worker resumes where the previous one stopped.
  let chained = x;
  for (const slice of stepsPerWorker) {
    for (let i = 0; i < slice; i++) chained = groupSquare(chained);
  }

  // B: started together — every worker squares its own slice starting from x,
  // and the outputs are combined the only way independent shares can be.
  let combined = 1n as GroupElement;
  for (const slice of stepsPerWorker) {
    let share = x;
    for (let i = 0; i < slice; i++) share = groupSquare(share);
    combined = groupMul(combined, share);
  }
  const startedTogetherY = (((combined % N) + N) % N) as GroupElement;

  return {
    workers,
    stepsPerWorker,
    totalSteps: stepsPerWorker.reduce((a, b) => a + b, 0),
    parallelWallClockSteps: Math.max(...stepsPerWorker),
    chainedY: chained,
    startedTogetherY,
    startedTogetherMatches: startedTogetherY === chained,
  };
}
