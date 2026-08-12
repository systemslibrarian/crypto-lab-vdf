// Crypto Lab — Verifiable Delay Functions: UI orchestration.
// All cryptography lives in ../vdf; this file only renders and wires controls.

import { N, ops, resetOps } from '../vdf/group';
import { evaluateSteps, type EvalResult } from '../vdf/eval';
import { raceWorkers } from '../vdf/parallel';
import { prove, verify } from '../vdf/wesolowski';
import { cheatWithFactors } from '../vdf/trapdoor';
import { asSteps, type GroupElement, type Proof } from '../vdf/types';

/** Lanes drawn, and workers actually run, by the parallelism control. */
const WORKERS = 4;

// ── tiny DOM helpers ─────────────────────────────────────────────────────────
type Attrs = Record<string, string | number | boolean | EventListener>;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'html') {
      node.innerHTML = String(v);
    } else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) node.append(c);
  return node;
}

function monoBox(label: string, value: bigint, tampered = false, key = ''): HTMLElement {
  const text = value.toString();
  const box = el('div', { class: 'mono-box' }, [
    el('span', { class: 'label' }, [label]),
    text,
  ]);
  if (key) {
    // Machine-readable handle on the exact value shown, so a test can compare
    // the numbers two panels display without parsing the label out of the text.
    box.setAttribute('data-mono', key);
    box.setAttribute('data-value', text);
  }
  if (tampered) {
    box.style.borderColor = 'var(--alarm)';
    box.append(el('span', { class: 'label', style: 'color:var(--alarm-text);margin-left:.6rem' }, ['(tampered)']));
  }
  box.append(
    el('button', {
      class: 'copy-btn',
      type: 'button',
      'aria-label': `Copy ${label}`,
      onclick: (e: Event) => {
        navigator.clipboard?.writeText(text);
        (e.currentTarget as HTMLButtonElement).textContent = 'copied';
        setTimeout(() => ((e.currentTarget as HTMLButtonElement).textContent = 'copy'), 1000);
      },
    }, ['copy']),
  );
  return box;
}

// ── shared demo state ────────────────────────────────────────────────────────
interface State {
  result: EvalResult | null;
  proof: Proof | null;
  shownY: GroupElement | null;  // what the verifier is handed (may be tampered)
  shownPi: GroupElement | null; // proof element handed to the verifier (may be tampered)
}
const state: State = { result: null, proof: null, shownY: null, shownPi: null };

function flipLowBit(v: GroupElement): GroupElement {
  return ((((v ^ 1n) % N) + N) % N) as GroupElement;
}

export function mount(root: HTMLElement): void {
  root.append(
    lede(),
    whatIsPanel(),
    evaluatePanel(),
    verifyPanel(),
    comparisonPanel(),
    applicationsPanel(),
    constructionsPanel(),
    trapdoorPanel(),
  );
}

// ── 0. Lede ──────────────────────────────────────────────────────────────────
function lede(): HTMLElement {
  return el('header', { class: 'cl-hero' }, [
    el('div', { class: 'cl-hero-main' }, [
      el('h1', { class: 'cl-hero-title' }, ['VDF']),
      el('p', { class: 'cl-hero-sub' }, ['Verifiable Delay Function · Wesolowski proof']),
      el('p', { class: 'cl-hero-desc' }, [
        'Evaluate a VDF by repeated modular squaring, watch the sequential work accrue, then verify the short Wesolowski proof almost instantly — and try to cheat with the trapdoor.',
      ]),
      el('div', {}, [el('span', { class: 'toy-note' }, ['Toy modulus — for illustration, not security.'])]),
    ]),
    el('aside', { class: 'cl-hero-why', 'aria-label': 'Why it matters' }, [
      el('span', { class: 'cl-hero-why-label' }, ['WHY IT MATTERS']),
      el('p', { class: 'cl-hero-why-text' }, [
        'VDFs give the internet a clock nobody can fast-forward: under the repeated-squaring assumption no number of parallel machines shortens the chain, though faster hardware still makes each individual step quicker. That makes them a building block of hard-to-bias randomness beacons, fair leader election, and front-running-resistant systems.',
      ]),
    ]),
  ]);
}

// ── 1. What is a VDF ─────────────────────────────────────────────────────────
function whatIsPanel(): HTMLElement {
  const p = panel('1', 'What is a VDF?', '');
  p.append(
    el('div', { class: 'whatis' }, [
      el('p', {}, [
        'A ', strong('Verifiable Delay Function'),
        ' has two properties at once: evaluating it requires a prescribed amount of ',
        strong('sequential work'),
        ' (the delay — it cannot be sped up by adding machines), and the result comes with a short proof anyone can ',
        strong('verify quickly'), '.',
      ]),
      el('p', { class: 'analogy' }, [
        'Like a sealed hourglass: turning it over and waiting takes real time, but a glance confirms the sand has run.',
      ]),
      el('p', {}, [
        'Contrast it with neighbours: a ', strong('hash'),
        ' is fast both ways; ', strong('proof-of-work'),
        ' is parallelizable (more miners = faster); a ', strong('time-lock puzzle'),
        ' has the delay but ', em('no'),
        ' fast public proof. Anyone can open a time-lock puzzle by performing the T sequential squarings — that is the whole point of the construction (Rivest–Shamir–Wagner, 1996); its trapdoor, the factorization of N, only lets the ',
        em('creator'),
        ' build the puzzle without doing the work. What it lacks is a proof: to check a claimed answer you must redo the T squarings yourself (or hold the trapdoor). The VDF keeps the delay and adds public, cheap verification.',
      ]),
      el('p', {}, [
        'This demo uses repeated squaring in a group of unknown order: ',
        el('code', {}, ['y = x^(2^T) mod N']),
        '. Each squaring depends on the one before, so computing y needs T steps in a row. The ',
        strong('Wesolowski proof'),
        ' then lets a verifier confirm y with only a handful of operations.',
      ]),
    ]),
  );
  return p;
}

// ── 2. Evaluate ──────────────────────────────────────────────────────────────
function evaluatePanel(): HTMLElement {
  // "one squaring at a time" was false about what you watch: evaluateSteps() advances 256
  // squarings per animation frame, so the counter jumps in chunks. The squarings themselves
  // are sequential — that is the claim worth making, and it is the true one.
  const p = panel('2', 'Evaluate the VDF', 'Choose an input and a difficulty T (sequential steps), then run it. The counter advances in chunks of up to 256 so the page can paint, but every squaring waits on the one before it.');

  const input = el('input', {
    type: 'text', id: 'vdf-input', value: '42', inputmode: 'numeric',
    autocomplete: 'off', 'aria-describedby': 'vdf-input-err',
  });
  const inputErr = el('span', { id: 'vdf-input-err', class: 'field-err', role: 'alert', hidden: true });
  const tExp = el('input', { type: 'range', id: 'vdf-t', min: '4', max: '14', value: '11', step: '1' });
  const tVal = el('span', { class: 'slider-val' }, []);
  const setTLabel = () => {
    const steps = (2 ** Number(tExp.value)).toLocaleString();
    tVal.textContent = `T = 2^${tExp.value} = ${steps} steps`;
    tExp.setAttribute('aria-valuetext', `2 to the ${tExp.value}, ${steps} sequential steps`);
  };
  tExp.addEventListener('input', setTLabel);
  setTLabel();

  const bar = el('span', {});
  const progress = el('div', {
    class: 'progress', role: 'progressbar', 'aria-label': 'evaluation progress',
    'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0,
  }, [bar]);
  const counter = el('div', { class: 'counter', role: 'status', 'aria-live': 'polite' }, ['Idle — press Evaluate.']);
  const output = el('div', { id: 'eval-output' });

  const evalBtn = el('button', { type: 'button', id: 'eval-btn' }, ['Evaluate']);
  const verifyEnable = () => document.getElementById('verify-btn')?.removeAttribute('disabled');

  /**
   * Generation counter for evaluation runs. A run writes its result only while it is still
   * the current one.
   *
   * `retireResult` alone was not enough: it returned early when `state.result` was still null,
   * which is exactly the window in which an evaluation is IN FLIGHT. Measured in Chromium at
   * the slider maximum, that window is 1,321 ms (216 ms at the shipped default) — the counter
   * is visibly advancing and the input field and slider are both live. Editing x from 42 to 43
   * during it left the page showing x = 42, y for 42, a proof for 42 and an enabled Verify
   * button beside an input reading 43: the exact "verdict outliving its input" failure
   * `retireResult` exists to prevent.
   */
  let runId = 0;
  let running = false;

  /**
   * A result belongs to the x and T it was computed from. Editing either one
   * used to leave the y, the proof and a "Verified ✓" status on screen next to
   * inputs they were never computed from — the verdict outliving its input.
   * Changing a control now retires the whole run, in flight or finished.
   */
  const retireResult = (): void => {
    const wasRunning = running;
    runId++;        // any in-flight tick or awaited prove() now belongs to a superseded run
    running = false;
    if (!state.result && !state.proof && !wasRunning) return;
    evalBtn.removeAttribute('disabled');
    state.result = null;
    state.proof = null;
    state.shownY = null;
    state.shownPi = null;
    output.replaceChildren();
    counter.textContent = 'Input changed — press Evaluate to re-run.';
    bar.style.width = '0';
    progress.setAttribute('aria-valuenow', '0');
    document.getElementById('verify-btn')?.setAttribute('disabled', '');
    const verifyResult = document.getElementById('verify-result');
    if (verifyResult) markStale(verifyResult, 'Input changed — press Evaluate to re-run, then Verify.');
    const workersNote = document.getElementById('workers-note');
    if (workersNote) { workersNote.replaceChildren(); workersNote.hidden = true; }
    // The trapdoor panel was the one exhibit retirement never reached. It prints the honest
    // step count of the run it was computed from ("Honest path: 16,384 sequential squarings"),
    // so leaving it up after the difficulty changes states the wrong T as fact — the same
    // verdict-outliving-its-input failure this function exists to prevent, in the panel whose
    // whole point is a cost comparison.
    document.getElementById('trapdoor-output')?.replaceChildren();
  };
  /**
   * The invalid-input state belongs to the value that was invalid.
   *
   * `aria-invalid="true"` and the "⚠ Enter a whole number." alert were only
   * ever cleared inside the Evaluate handler, so typing a correct value left
   * the field still announcing itself as invalid until the user pressed
   * Evaluate again. A screen-reader user who fixed the field was told it was
   * still broken — the same class of bug as the verdict outliving its input,
   * which the block above already fixes for the result. `retireResult` cannot
   * carry this: it returns early when there is no result, which is exactly the
   * case here.
   */
  const clearInvalid = (): void => {
    if (!input.hasAttribute('aria-invalid')) return;
    input.removeAttribute('aria-invalid');
    inputErr.hidden = true;
    inputErr.textContent = '';
  };
  input.addEventListener('input', clearInvalid);
  input.addEventListener('input', retireResult);
  tExp.addEventListener('input', retireResult);

  evalBtn.addEventListener('click', () => {
    let inputBig: bigint;
    try {
      inputBig = BigInt((input.value || '0').trim());
      input.removeAttribute('aria-invalid');
      inputErr.hidden = true;
      inputErr.textContent = '';
    } catch {
      input.setAttribute('aria-invalid', 'true');
      inputErr.hidden = false;
      inputErr.textContent = '⚠ Enter a whole number.';
      input.focus();
      return;
    }

    const t = asSteps(2 ** Number(tExp.value));
    const myRun = ++runId;
    running = true;
    evalBtn.setAttribute('disabled', '');
    document.getElementById('verify-btn')?.setAttribute('disabled', '');
    output.replaceChildren();
    resetOps();

    const gen = evaluateSteps(inputBig, t, 256);
    const isCurrent = () => myRun === runId;
    const tick = () => {
      if (!isCurrent()) return;   // an input changed: this run no longer describes the page
      const next = gen.next();
      if (!next.done) {
        const { done, total } = next.value;
        const pct = (done / total) * 100;
        bar.style.width = `${pct}%`;
        progress.setAttribute('aria-valuenow', String(Math.round(pct)));
        counter.innerHTML = `Squaring <b>${done.toLocaleString()}</b> / ${total.toLocaleString()} — each step needs the previous one.`;
        requestAnimationFrame(tick);
        return;
      }
      bar.style.width = '100%';
      progress.setAttribute('aria-valuenow', '100');
      const res = next.value;
      counter.innerHTML = `Done — <b>${res.t.toLocaleString()}</b> sequential squarings.`;
      void finalizeEval(res, output, evalBtn, verifyEnable, isCurrent).then(() => {
        if (isCurrent()) running = false;
      });
    };
    requestAnimationFrame(tick);
  });

  p.append(
    el('div', { class: 'row' }, [
      el('div', { class: 'field' }, [el('label', { for: 'vdf-input' }, ['Input x']), input, inputErr]),
      el('div', { class: 'field' }, [el('label', { for: 'vdf-t' }, ['Difficulty']), tExp, tVal]),
      el('div', {}, [evalBtn]),
    ]),
    progress,
    counter,
    workersControl(),
    output,
  );
  return p;
}

async function finalizeEval(
  res: EvalResult,
  output: HTMLElement,
  evalBtn: HTMLElement,
  verifyEnable: () => void,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  state.result = res;
  state.shownY = res.y;
  output.replaceChildren(
    monoBox('N =', N, false, 'n'),
    monoBox('x =', res.x, false, 'x'),
    monoBox('y =', res.y, false, 'y'),
    el('p', { class: 'counter' }, ['Generating the short proof…']),
  );
  const proof = await prove(res.x, res.y, res.t);
  // prove() awaits: an input may have changed while it ran, and retireResult has already
  // cleared state. Writing the proof here would resurrect the retired run.
  if (!isCurrent()) return;
  state.proof = proof;
  state.shownPi = proof.pi;
  output.replaceChildren(
    monoBox('N =', N, false, 'n'),
    monoBox('x =', res.x, false, 'x'),
    monoBox('y =', res.y, false, 'y'),
    el('p', { class: 'counter' }, ['Short proof (computed once by the evaluator):']),
    monoBox('ℓ =', proof.l, false, 'l'),
    monoBox('π =', proof.pi, false, 'pi'),
  );
  evalBtn.removeAttribute('disabled');
  verifyEnable();
}

/**
 * "Try 4 parallel workers" — a computation, not an animation.
 *
 * This control used to fill four CSS lanes to a fixed width and print a
 * hardcoded sentence saying the step count was unchanged. True, but nothing on
 * the page had computed it. It now runs both strategies over the SAME x and T
 * the evaluate panel just used (see ../vdf/parallel.ts) and prints what each
 * one produced: chained workers reproduce y in exactly T squarings, and workers
 * started together finish in T/4 wall-clock steps but land on a different
 * number. Every figure below is read out of that result.
 */
function workersControl(): HTMLElement {
  const lanes = el('div', { class: 'workers-lanes', id: 'workers-lanes' },
    Array.from({ length: WORKERS }, () => el('div', { class: 'lane' }, [el('span', {})])));
  const note = el('div', { class: 'workers-note', id: 'workers-note', hidden: true });
  // Named a simulation because it is one: raceWorkers() runs every slice synchronously on the
  // main thread. Nothing here is timed and no Web Worker is created, so "wall clock" was a
  // measurement the page never took. The honest quantity is dependency-chain depth.
  const btn = el('button', { type: 'button', class: 'secondary', id: 'workers-btn' }, ['Simulate splitting the chain across 4 workers']);

  btn.addEventListener('click', () => {
    note.hidden = false;
    if (!state.result) {
      note.replaceChildren('Evaluate something first — then this simulates splitting the same x and T across four workers.');
      return;
    }
    const r = state.result;
    const race = raceWorkers(r.x, r.t, WORKERS);
    const matchesHonestRun = race.chainedY === r.y;

    // Lanes fill one after another: the dependency chain, drawn to scale.
    lanes.querySelectorAll<HTMLElement>('.lane > span').forEach((s, i) => {
      s.style.transition = 'none';
      s.style.width = '0';
      setTimeout(() => {
        s.style.transition = `width .5s linear ${i * 0.5}s`;
        s.style.width = '100%';
      }, 30);
    });

    note.replaceChildren(
      el('p', { id: 'workers-chained' }, [
        `Chained across ${race.workers} workers: ${race.stepsPerWorker.join(' + ')} = `,
        strong(`${race.totalSteps.toLocaleString()} squarings`),
        ` — exactly the ${r.t.toLocaleString()} the single-threaded run needed, and it lands on `,
        strong(matchesHonestRun ? 'the same y' : 'a different y'),
        '. Worker 2 cannot start until worker 1 finishes, so four workers bought nothing.',
      ]),
      el('p', { id: 'workers-together' }, [
        `Started together instead — ${race.parallelWallClockSteps.toLocaleString()} steps deep on the critical path each — the chain is four times shorter, and the combined output is `,
        strong(race.startedTogetherMatches ? 'the same y' : 'a different number'),
        ': ',
        el('code', { id: 'workers-together-y' }, [race.startedTogetherY.toString()]),
        '. ',
        em('A shorter chain that lands on the wrong number is not a speed-up — that inherent sequentiality is the delay.'),
      ]),
      monoBox('y (workers chained) =', race.chainedY, false, 'chained-y'),
      el('p', { class: 'hint', id: 'workers-fidelity' }, [
        'Both strategies ran synchronously in this one browser thread — no Web Worker was created and nothing was timed. The step counts above are dependency-chain depth, not measured wall-clock time. And this defeats the ',
        em('obvious'),
        ' divide-and-combine strategy, not every conceivable one: that no parallel shortcut exists at all is the repeated-squaring assumption, which four simulated lanes cannot prove.',
      ]),
    );
  });

  return el('div', {}, [el('div', { style: 'margin-top:.6rem' }, [btn]), lanes, note]);
}

// ── 3. Verify ────────────────────────────────────────────────────────────────
function verifyPanel(): HTMLElement {
  // NOT "it never re-runs the T squarings": at the slider's lowest settings 2^T is smaller
  // than the 128-bit challenge ℓ, so r = 2^T mod ℓ is 2^T itself and the verifier's
  // square-and-multiply does the whole exponentiation. What is true at every T is that the
  // verifier's cost does not GROW with T — measured 208…398 operations across T = 16…16,384.
  const p = panel('3', 'Verify — fast', 'The verifier re-derives the challenge ℓ from (N, x, y, T) and checks one identity, at a cost that does not grow with T. It trusts nothing it was handed.');

  const result = el('div', { id: 'verify-result', role: 'status', 'aria-live': 'polite' });
  const verifyBtn = el('button', { type: 'button', id: 'verify-btn', disabled: true }, ['Verify']);
  const tamperY = el('button', { type: 'button', class: 'danger' }, ['Tamper with y']);
  const tamperPi = el('button', { type: 'button', class: 'danger' }, ['Tamper with π']);
  const reset = el('button', { type: 'button', class: 'secondary' }, ['Reset tamper']);

  const refreshOutput = () => {
    if (!state.result || state.shownY === null || state.shownPi === null) return;
    const out = document.getElementById('eval-output');
    if (!out || !state.proof) return;
    out.replaceChildren(
      monoBox('N =', N, false, 'n'),
      monoBox('x =', state.result.x, false, 'x'),
      monoBox('y =', state.shownY, state.shownY !== state.result.y, 'y'),
      el('p', { class: 'counter' }, ['Short proof (computed once by the evaluator):']),
      monoBox('ℓ =', state.proof.l, false, 'l'),
      monoBox('π =', state.shownPi, state.shownPi !== state.proof.pi, 'pi'),
    );
  };

  tamperY.addEventListener('click', () => { if (state.shownY !== null) { state.shownY = flipLowBit(state.shownY); refreshOutput(); markStale(result); } });
  tamperPi.addEventListener('click', () => { if (state.shownPi !== null) { state.shownPi = flipLowBit(state.shownPi); refreshOutput(); markStale(result); } });
  reset.addEventListener('click', () => {
    if (state.result && state.proof) { state.shownY = state.result.y; state.shownPi = state.proof.pi; refreshOutput(); markStale(result); }
  });

  verifyBtn.addEventListener('click', () => {
    if (!state.result || !state.proof || state.shownY === null || state.shownPi === null) return;
    verifyBtn.setAttribute('disabled', '');
    void (async () => {
      const r = state.result!;
      const res = await verify(r.x, state.shownY!, r.t, { l: state.proof!.l, pi: state.shownPi! });
      renderVerify(result, res.ok, res.reason, r.t, res.verifierOps);
      verifyBtn.removeAttribute('disabled');
    })();
  });

  p.append(
    el('div', { class: 'row' }, [
      el('div', {}, [verifyBtn]),
      el('div', {}, [tamperY]),
      el('div', {}, [tamperPi]),
      el('div', {}, [reset]),
    ]),
    el('p', { class: 'hint', style: 'margin:.7rem 0 0' }, ['Evaluate first, then verify. Tamper, then verify again — a real VDF must reject any altered output or proof.']),
    result,
  );
  return p;
}

function markStale(result: HTMLElement, message = 'Inputs changed — press Verify to re-check.'): void {
  result.replaceChildren(el('div', { class: 'status warn' }, [
    el('span', { class: 'ico' }, ['↻']),
    el('div', {}, [message]),
  ]));
}

/**
 * The verifier's cost is ~constant in T (≈370 mod-N operations, whatever T is); the
 * evaluator's is exactly T. So which one is cheaper DEPENDS ON T, and below T ≈ 400 the
 * verifier is the expensive one.
 *
 * This tile used to print `Math.max(1, Math.round(evalOps / verifierOps))` under the caption
 * "cheaper to verify than to compute". At the slider's five lowest positions (T = 16…256,
 * measured: 16 vs 208, 32 vs 227, 64 vs 258, 128 vs 383, 256 vs 381) the true ratio is below
 * 1, `Math.round` took it to 0, and the `Math.max(1, …)` clamp printed "≈ 1×" — a number the
 * run never produced, under a caption the run contradicts, right beside the two op counts
 * that disprove it. The ratio is now signed: it names its own direction.
 */
function costRatio(evalOps: number, verifierOps: number): { cheaper: boolean; text: string; cap: string } {
  const cheaper = verifierOps < evalOps;
  const factor = cheaper
    ? evalOps / Math.max(1, verifierOps)
    : verifierOps / Math.max(1, evalOps);
  return {
    cheaper,
    text: `≈ ${factor >= 10 ? Math.round(factor).toLocaleString() : factor.toFixed(1)}×`,
    cap: cheaper
      ? 'cheaper to verify than to compute'
      : 'more expensive to verify than to compute at this T',
  };
}

function renderVerify(host: HTMLElement, ok: boolean, reason: string, t: number, verifierOps: number): void {
  const evalOps = t;
  const ratio = costRatio(evalOps, verifierOps);
  /**
   * A rejection that happens BEFORE the identity check costs zero group operations, and a
   * cost comparison drawn from zero is not a measurement. The old tile printed
   * `Math.max(1, Math.round(t / Math.max(1, 0)))` = T and captioned it "cheaper to verify
   * than to compute" — "≈ 64× cheaper" beside its own "0 mod-N operations to verify".
   */
  const preCheckReject = !ok && verifierOps === 0;
  const reasonText = ok
    ? 'The identity π^ℓ · x^r ≡ y holds. Output accepted.'
    : reason === 'out-of-range'
      ? 'Output is outside the group [0, N). Rejected before any check.'
      : reason === 'bad-input'
        ? 'The proof element π is outside the group [0, N) — non-canonical encoding. Rejected before any check.'
        : 'The identity π^ℓ · x^r ≡ y failed — the output or proof was altered. Rejected.';
  host.replaceChildren(
    el('div', { class: `status ${ok ? 'ok' : 'alarm'}` }, [
      el('span', { class: 'ico' }, [ok ? '✓' : '✗']),
      el('div', {}, [
        el('span', {}, [ok ? 'Verified' : 'Rejected']),
        el('small', {}, [reasonText]),
      ]),
    ]),
    el('div', { class: 'opcontrast' }, [
      el('div', { class: 'cell evalc' }, [
        el('div', { class: 'big' }, [evalOps.toLocaleString()]),
        el('div', { class: 'cap' }, ['mod-N squarings to evaluate (sequential)']),
      ]),
      el('div', { class: 'cell verifyc' }, [
        el('div', { class: 'big' }, [verifierOps.toLocaleString()]),
        el('div', { class: 'cap' }, ['mod-N operations to verify']),
      ]),
      el('div', { class: 'cell', id: 'cost-ratio' }, [
        el('div', { class: 'big' }, [preCheckReject ? '—' : ratio.text]),
        el('div', { class: 'cap' }, [
          preCheckReject ? 'no comparison — this run was rejected before any check' : ratio.cap,
        ]),
      ]),
    ]),
    el('p', { class: 'hint', id: 'cost-note', style: 'margin:.7rem 0 0' }, [
      preCheckReject
        ? 'Nothing was measured on this run: the input failed its range check, so the verifier did no group operations at all.'
        : ratio.cheaper
          ? `The verifier's cost does not grow with T — it did ${verifierOps.toLocaleString()} operations here and would do about as many at any difficulty. That is the whole point: the gap widens with every notch of the slider.`
          : `The verifier's cost does not grow with T — it does roughly this many operations at any difficulty. At T = ${evalOps.toLocaleString()} that fixed cost is larger than the delay itself, so verifying is the expensive side here. Raise the difficulty: the gap only opens once T exceeds the verifier's fixed cost.`,
    ]),
  );
}

// ── 4. Comparison ────────────────────────────────────────────────────────────
function comparisonPanel(): HTMLElement {
  const p = panel('4', 'Time-lock puzzle vs VDF', 'Both impose sequential delay. Only the VDF lets the whole world check the result cheaply.');
  const yes = (s: string) => el('span', { class: 'yes' }, [s]);
  const no = (s: string) => el('span', { class: 'no' }, [s]);
  p.append(
    el('table', { class: 'cmp' }, [
      el('tr', {}, [el('th', {}, ['Property']), el('th', {}, ['Time-lock puzzle']), el('th', {}, ['VDF'])]),
      el('tr', {}, [el('td', {}, ['Requires sequential work']), el('td', {}, [yes('Yes ✓')]), el('td', {}, [yes('Yes ✓')])]),
      el('tr', {}, [el('td', {}, ['Resists parallel speedup']), el('td', {}, [yes('Yes ✓')]), el('td', {}, [yes('Yes ✓')])]),
      el('tr', {}, [el('td', {}, ['Anyone can solve it, no secret needed']), el('td', {}, [yes('Yes ✓ — just do the T squarings')]), el('td', {}, [yes('Yes ✓ — just do the T squarings')])]),
      el('tr', {}, [el('td', {}, ['Ships a succinct proof of the result']), el('td', {}, [no('No ✗')]), el('td', {}, [yes('Yes ✓ — one short proof')])]),
      el('tr', {}, [el('td', {}, ['Cost for a third party to check an answer']), el('td', {}, [no('Redo all T squarings (or hold the trapdoor)')]), el('td', {}, [yes('A handful of operations')])]),
      el('tr', {}, [el('td', {}, ['Typical use']), el('td', {}, ['Send a message into the future']), el('td', {}, ['Publicly trustworthy delay & randomness'])]),
    ]),
  );
  return p;
}

// ── 5. Applications ──────────────────────────────────────────────────────────
function applicationsPanel(): HTMLElement {
  const p = panel('5', 'Where VDFs are used', 'High-level — each relies on "delay that everyone can trust without re-doing the work."');
  p.append(el('ul', { class: 'apps' }, [
    li('Randomness beacons', 'Feed many parties’ inputs through a VDF so no one can grind or bias the result — the delay outlasts any attempt to manipulate it.'),
    li('Blockchain leader election', 'Pick the next proposer from a value no participant could have predicted or skewed in advance.'),
    li('Fair lotteries & sealed-bid auctions', 'Lock in commitments, then reveal a verifiably-delayed outcome nobody could front-run.'),
    li('Anti front-running', 'Order or reveal transactions only after a mandatory, publicly-checkable delay, blunting mempool sniping.'),
  ]));
  return p;
}

// ── 6. Constructions ─────────────────────────────────────────────────────────
function constructionsPanel(): HTMLElement {
  const p = panel('6', 'How VDFs are built (high level)', 'You do not need the math to get the shape of it.');
  p.append(el('ul', { class: 'constructions' }, [
    li('Repeated squaring', 'y = x^(2^T) mod N in a group of unknown order. The unknown order is what makes the T squarings unavoidable — this demo’s engine.'),
    li('Wesolowski proof', 'A single short group element π plus a prime challenge. Tiny proof, very fast verification — what this demo checks.'),
    li('Pietrzak proof', 'A recursive halving argument: ~log T group elements, no prime sampling, statistically sound. A natural alternative prover.'),
    li('RSA group vs class group', 'An RSA modulus needs a trusted setup so nobody knows the factors; an imaginary-quadratic class group needs no setup at all.'),
  ]));
  return p;
}

// ── 7. Trapdoor (isolated, clearly labeled) ──────────────────────────────────
function trapdoorPanel(): HTMLElement {
  const out = el('div', { id: 'trapdoor-output' });
  const btn = el('button', { type: 'button', class: 'danger' }, ['Compute y instantly using the secret factors']);
  /**
   * The shortcut's cost is ~constant in T, not zero — and "constant" is bigger than a small T.
   *
   * `cheatWithFactors` reduces 2^T mod λ(N) and then exponentiates by the result. When
   * 2^T < λ(N) — which is every T ≤ 510, i.e. the slider's six lowest positions — the
   * reduction is a no-op, the exponent IS 2^T, and square-and-multiply spends T+1 group
   * operations: measured 17 vs 16, 33 vs 32, 65 vs 64, 129 vs 128, 257 vs 256, 755 vs 512.
   * The trapdoor path did MORE work than the honest one, while the panel said "no delay at
   * all" and "skipped all 128 squarings". Both numbers are now measured and the verdict is
   * conditional on them; the asymptotic point (constant vs linear in T) is what the panel
   * teaches, and it is true at every setting.
   */
  btn.addEventListener('click', () => {
    if (!state.result) { out.replaceChildren(el('p', { class: 'counter' }, ['Evaluate something first.'])); return; }
    const r = state.result;
    const before = ops();
    const cheated = cheatWithFactors(r.x, r.t);
    const trapdoorOps = ops() - before;
    const honestOps = r.t;
    const matches = cheated === r.y;
    const faster = trapdoorOps < honestOps;
    const headline = !matches
      ? 'Different y — the shortcut did not reproduce the honest output.'
      : faster
        ? 'Same y — and the delay collapsed.'
        : 'Same y — but at this T the shortcut was not faster.';
    out.replaceChildren(
      monoBox('y (via secret factors) =', cheated, false, 'trapdoor-y'),
      el('p', {
        class: 'counter', id: 'trapdoor-cost',
        'data-honest-ops': honestOps, 'data-trapdoor-ops': trapdoorOps,
      }, [
        `Honest path: ${honestOps.toLocaleString()} sequential squarings. Trapdoor path: ${trapdoorOps.toLocaleString()} mod-N operations.`,
      ]),
      el('div', { class: 'status warn' }, [
        el('span', { class: 'ico' }, ['⚠']),
        el('div', {}, [
          el('span', { id: 'trapdoor-headline' }, [headline]),
          el('small', {}, [
            faster
              ? `Knowing N’s factorization collapsed 2^${r.t.toLocaleString()} to an exponent smaller than the group order, so the shortcut cost ${trapdoorOps.toLocaleString()} operations instead of ${honestOps.toLocaleString()} sequential squarings. That cost barely moves as T grows, so the gap widens with every notch of the slider. A VDF is secure precisely because no one is supposed to be able to do this.`
              : `Reducing 2^${r.t.toLocaleString()} modulo the group order only helps once 2^T exceeds it, so at this difficulty the shortcut cost ${trapdoorOps.toLocaleString()} operations — more than the ${honestOps.toLocaleString()} honest squarings. Its cost is roughly the size of the modulus and stays there however large T gets; raise the difficulty and the same shortcut collapses a delay of any length. A VDF is secure precisely because no one is supposed to be able to do this.`,
          ]),
        ]),
      ]),
    );
  });

  const d = el('details', { class: 'trapdoor' }, [
    el('summary', {}, ['⚠ Reveal the trapdoor — what the VDF assumes nobody can do']),
    el('p', {}, [
      'The honest evaluator does not know how N factors, so it must grind through every squaring. Anyone who ',
      em('did'),
      ' know the factors could shortcut the whole thing. This isolated path uses the secret factors to prove the point — it is never the default and is never part of evaluation or verification.',
    ]),
    el('div', {}, [btn]),
    out,
  ]);
  return d;
}

// ── shared small builders ────────────────────────────────────────────────────
function panel(num: string, title: string, hint: string): HTMLElement {
  const p = el('section', { class: 'panel' }, [
    el('h2', {}, [el('span', { class: 'num' }, [num]), title]),
  ]);
  if (hint) p.append(el('p', { class: 'hint' }, [hint]));
  return p;
}
function li(title: string, body: string): HTMLElement {
  return el('li', {}, [strong(title + ' — '), body]);
}
function strong(s: string): HTMLElement { return el('strong', {}, [s]); }
function em(s: string): HTMLElement { return el('em', {}, [s]); }
