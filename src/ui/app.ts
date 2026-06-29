// Crypto Lab — Verifiable Delay Functions: UI orchestration.
// All cryptography lives in ../vdf; this file only renders and wires controls.

import { N, resetOps } from '../vdf/group';
import { evaluateSteps, type EvalResult } from '../vdf/eval';
import { prove, verify } from '../vdf/wesolowski';
import { cheatWithFactors } from '../vdf/trapdoor';
import { asSteps, type GroupElement, type Proof } from '../vdf/types';

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

function monoBox(label: string, value: bigint, tampered = false): HTMLElement {
  const text = value.toString();
  const box = el('div', { class: 'mono-box' }, [
    el('span', { class: 'label' }, [label]),
    text,
  ]);
  if (tampered) {
    box.style.borderColor = 'var(--alarm)';
    box.append(el('span', { class: 'label', style: 'color:var(--alarm);margin-left:.6rem' }, ['(tampered)']));
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
  return el('header', { class: 'lede' }, [
    el('h1', {}, ['Verifiable Delay Functions']),
    el('p', { class: 'sub' }, [
      'A puzzle that takes a long, unskippable time to solve — yet anyone can check the answer in an instant.',
    ]),
    el('div', {}, [el('span', { class: 'toy-note' }, ['Toy modulus — for illustration, not security.'])]),
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
        ' fast public proof — only the holder of a secret can open it. The VDF keeps the delay and adds public, cheap verification.',
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
  const p = panel('2', 'Evaluate the VDF', 'Choose an input and a difficulty T (sequential steps), then run it. Watch the work accrue one squaring at a time.');

  const input = el('input', { type: 'text', id: 'vdf-input', value: '42', inputmode: 'numeric', autocomplete: 'off' });
  const tExp = el('input', { type: 'range', id: 'vdf-t', min: '4', max: '14', value: '11', step: '1' });
  const tVal = el('span', { class: 'slider-val' }, []);
  const setTLabel = () => { tVal.textContent = `T = 2^${tExp.value} = ${(2 ** Number(tExp.value)).toLocaleString()} steps`; };
  tExp.addEventListener('input', setTLabel);
  setTLabel();

  const bar = el('span', {});
  const progress = el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'evaluation progress' }, [bar]);
  const counter = el('div', { class: 'counter' }, ['Idle — press Evaluate.']);
  const output = el('div', { id: 'eval-output' });

  const evalBtn = el('button', { type: 'button', id: 'eval-btn' }, ['Evaluate']);
  const verifyEnable = () => document.getElementById('verify-btn')?.removeAttribute('disabled');

  evalBtn.addEventListener('click', () => {
    let inputBig: bigint;
    try { inputBig = BigInt((input.value || '0').trim()); }
    catch { counter.innerHTML = '<span style="color:var(--alarm)">⚠ Enter a whole number.</span>'; return; }

    const t = asSteps(2 ** Number(tExp.value));
    evalBtn.setAttribute('disabled', '');
    document.getElementById('verify-btn')?.setAttribute('disabled', '');
    output.replaceChildren();
    resetOps();

    const gen = evaluateSteps(inputBig, t, 256);
    const tick = () => {
      const next = gen.next();
      if (!next.done) {
        const { done, total } = next.value;
        bar.style.width = `${(done / total) * 100}%`;
        counter.innerHTML = `Squaring <b>${done.toLocaleString()}</b> / ${total.toLocaleString()} — each step needs the previous one.`;
        requestAnimationFrame(tick);
        return;
      }
      bar.style.width = '100%';
      const res = next.value;
      counter.innerHTML = `Done — <b>${res.t.toLocaleString()}</b> sequential squarings.`;
      void finalizeEval(res, output, evalBtn, verifyEnable);
    };
    requestAnimationFrame(tick);
  });

  p.append(
    el('div', { class: 'row' }, [
      el('div', { class: 'field' }, [el('label', { for: 'vdf-input' }, ['Input x']), input]),
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
): Promise<void> {
  state.result = res;
  state.shownY = res.y;
  output.replaceChildren(
    monoBox('N =', N),
    monoBox('x =', res.x),
    monoBox('y =', res.y),
    el('p', { class: 'counter' }, ['Generating the short proof…']),
  );
  const proof = await prove(res.x, res.y, res.t);
  state.proof = proof;
  state.shownPi = proof.pi;
  output.replaceChildren(
    monoBox('N =', N),
    monoBox('x =', res.x),
    monoBox('y =', res.y),
    el('p', { class: 'counter' }, ['Short proof (computed once by the evaluator):']),
    monoBox('ℓ =', proof.l),
    monoBox('π =', proof.pi),
  );
  evalBtn.removeAttribute('disabled');
  verifyEnable();
}

function workersControl(): HTMLElement {
  const lanes = el('div', { class: 'workers-lanes' },
    Array.from({ length: 4 }, () => el('div', { class: 'lane' }, [el('span', {})])));
  const note = el('div', { class: 'workers-note', hidden: true }, [
    'Four "workers" — and the step count is unchanged. Each squaring needs the output of the one before it, so the work is a single dependency chain. Parallelism cannot shorten it. ',
    em('That inherent sequentiality is the delay.'),
  ]);
  const btn = el('button', { type: 'button', class: 'secondary' }, ['Try 4 parallel workers']);
  btn.addEventListener('click', () => {
    note.hidden = false;
    lanes.querySelectorAll<HTMLElement>('.lane > span').forEach((s, i) => {
      s.style.transition = 'none'; s.style.width = '0';
      // all lanes advance together but none finishes sooner — they're stuck waiting on each other
      setTimeout(() => { s.style.transition = 'width 1.2s linear'; s.style.width = `${25 + i * 0}%`; }, 30);
    });
  });
  return el('div', {}, [el('div', { style: 'margin-top:.6rem' }, [btn]), lanes, note]);
}

// ── 3. Verify ────────────────────────────────────────────────────────────────
function verifyPanel(): HTMLElement {
  const p = panel('3', 'Verify — fast', 'The verifier re-derives the challenge ℓ from (N, x, y, T) and checks one identity. It never re-runs the T squarings, and it trusts nothing it was handed.');

  const result = el('div', { id: 'verify-result' });
  const verifyBtn = el('button', { type: 'button', id: 'verify-btn', disabled: true }, ['Verify']);
  const tamperY = el('button', { type: 'button', class: 'danger' }, ['Tamper with y']);
  const tamperPi = el('button', { type: 'button', class: 'danger' }, ['Tamper with π']);
  const reset = el('button', { type: 'button', class: 'secondary' }, ['Reset tamper']);

  const refreshOutput = () => {
    if (!state.result || state.shownY === null || state.shownPi === null) return;
    const out = document.getElementById('eval-output');
    if (!out || !state.proof) return;
    out.replaceChildren(
      monoBox('N =', N),
      monoBox('x =', state.result.x),
      monoBox('y =', state.shownY, state.shownY !== state.result.y),
      el('p', { class: 'counter' }, ['Short proof (computed once by the evaluator):']),
      monoBox('ℓ =', state.proof.l),
      monoBox('π =', state.shownPi, state.shownPi !== state.proof.pi),
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

function markStale(result: HTMLElement): void {
  result.replaceChildren(el('div', { class: 'status warn' }, [
    el('span', { class: 'ico' }, ['↻']),
    el('div', {}, ['Inputs changed — press Verify to re-check.']),
  ]));
}

function renderVerify(host: HTMLElement, ok: boolean, reason: string, t: number, verifierOps: number): void {
  const evalOps = t;
  const speedup = Math.max(1, Math.round(evalOps / Math.max(1, verifierOps)));
  const reasonText = ok
    ? 'The identity π^ℓ · x^r ≡ y holds. Output accepted.'
    : reason === 'out-of-range'
      ? 'Output is outside the group [0, N). Rejected before any check.'
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
      el('div', { class: 'cell' }, [
        el('div', { class: 'big' }, [`≈ ${speedup.toLocaleString()}×`]),
        el('div', { class: 'cap' }, ['cheaper to verify than to compute']),
      ]),
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
      el('tr', {}, [el('td', {}, ['Fast public verification']), el('td', {}, [no('No ✗')]), el('td', {}, [yes('Yes ✓')])]),
      el('tr', {}, [el('td', {}, ['Anyone can check, no secret needed']), el('td', {}, [no('No ✗ — needs the trapdoor to open')]), el('td', {}, [yes('Yes ✓ — short proof')])]),
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
  const out = el('div', {});
  const btn = el('button', { type: 'button', class: 'danger' }, ['Compute y instantly using the secret factors']);
  btn.addEventListener('click', () => {
    if (!state.result) { out.replaceChildren(el('p', { class: 'counter' }, ['Evaluate something first.'])); return; }
    const r = state.result;
    const cheated = cheatWithFactors(r.x, r.t);
    const matches = cheated === r.y;
    out.replaceChildren(
      monoBox('y (via secret factors) =', cheated),
      el('div', { class: 'status warn' }, [
        el('span', { class: 'ico' }, ['⚠']),
        el('div', {}, [
          el('span', {}, [matches ? 'Same y — no delay at all.' : 'Computed instantly.']),
          el('small', {}, [`Knowing N’s factorization collapsed 2^${r.t} into a tiny exponent (mod the group order) and skipped all ${r.t.toLocaleString()} squarings. A VDF is secure precisely because no one is supposed to be able to do this.`]),
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
