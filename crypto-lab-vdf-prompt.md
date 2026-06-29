# BUILD TEMPLATE (filled): crypto-lab-vdf
## Build prompt for the Verifiable Delay Functions demo

This file is the gold-standard BUILD-TEMPLATE with all seven `[FILL]` sections and the
REPO block resolved for the VDF demo. It produces the demo's cryptographic logic, UI, and
in-demo content. The SEPARATE standardization prompt (Parts 0 + A–E) is run AFTERWARD and
owns the shared header, theme toggle, README, GitHub Pages config, and scripture footer.
This build prompt deliberately stops where that one begins.

---

## REPO

- **Repo name:** `crypto-lab-vdf`
- **About / one-liner:** `Interactive demo of Verifiable Delay Functions — repeated modular squaring in a group of unknown order (Wesolowski short proof) gives provable sequential delay with fast public verification. Real BigInt math in the browser, no backend.`
- **Catalog category label:** `Advanced Primitive / Time-Based Cryptography` (cross-tags: `Randomness Beacons · Sequential Work`)
- **Catalog card title:** `Verifiable Delay Functions`
- **Tags (3–4):** `VDF · Repeated Squaring · Wesolowski Proof · Sequential Work`
- **Accent (`--accent`):** `#a78bfa` (violet — chosen to sit visually near the Time-Lock Puzzles demo; CONFIRM against the catalog palette and pick the nearest unused swatch before shipping)
- **Favicon emoji (for the standardization pass to use):** `⏳`

---

## BUILD PROMPT (everything below this line is what you paste to the model)

```
# BUILD: crypto-lab-vdf
## A Verifiable Delay Function: provable sequential work that anyone can verify instantly.

Build a new Vite + TypeScript browser demo from scratch for the Crypto Lab suite.
It ships as a static site to GitHub Pages with NO backend.

This prompt produces the demo's cryptographic logic, UI, and content ONLY. A SEPARATE
standardization prompt (Parts 0 + A–E) will afterward apply the shared header, theme
contract, README, Pages config, and scripture footer. Therefore in THIS pass:
- Do NOT hand-build a header, top bar, nav, or theme-toggle button.
- Do NOT write the final README or the in-page scripture footer.
- DO mount the app content at `id="app"`.
- DO define `--accent` on `:root` (value: #a78bfa). If light/dark palettes exist,
  define `--accent` in both.
Those two demo-side prerequisites are the only things the standardization pass needs
from you; everything else header/footer/README-related is its job, not this one.

---

## ANTI-HALLUCINATION / DISCIPLINE RULES
- Real primitives only. Use WebCrypto (SubtleCrypto) or a named, justified library for
  the actual cryptographic operations. Do NOT simulate or fake math. If a primitive is
  not available in WebCrypto, use a specific well-known library and say which.
- For the primitive that IS the teaching subject, hand-roll the inspectable parts rather
  than hiding them inside a library — transparency of internals is the point of the demo.
- No backend, no network calls, no telemetry. Everything runs in the browser.
- Any key/secret material is generated per-session in memory and never persisted.
- Follow the relevant specification exactly; do not invent structure. Spec(s):
  Wesolowski, "Efficient Verifiable Delay Functions" (EUROCRYPT 2019); Boneh, Bonneau,
  Bünz, Fisch, "Verifiable Delay Functions" (CRYPTO 2018); Pietrzak, "Simple Verifiable
  Delay Functions" (ITCS 2019) — referenced only, not implemented in this pass.
- If a correctness or security invariant below conflicts with a feature, the invariant wins.
- Write runnable tests (see TESTING) and actually run them. Do not claim behavior you
  did not execute.
- Read before you write; re-read after each change to confirm it landed.

---

## SCOPE
IN scope:
- A VDF over a group of unknown order, instantiated as an RSA group (modulus N = p·q).
  Evaluation: y = x^(2^T) mod N, computed as T sequential modular squarings.
- The Wesolowski short proof:
  - Fiat–Shamir prime challenge ℓ = Hash→prime(bin(N) ‖ bin(x) ‖ bin(y) ‖ T).
  - Prover computes q = ⌊2^T / ℓ⌋, proof π = x^q mod N.
  - Verifier computes r = 2^T mod ℓ (cheap, ℓ is small), accepts iff π^ℓ · x^r ≡ y (mod N).
- A live, animated view of the inherently-sequential evaluation (T squarings, step counter)
  contrasted with the near-instant verification (a handful of exponentiations).
- A side-by-side "Time-Lock Puzzle vs VDF" comparison driven by the same evaluation.
- An Applications section (randomness beacons, leader election, sealed-bid/anti-front-running).
- A high-level "Construction Approaches" section (repeated squaring; Wesolowski vs Pietrzak;
  RSA group vs class group) — conceptual, no extra math required of the reader.

NON-GOALS (state each as a one-line "what this isn't" note in the UI; do not let a reviewer
flag these as gaps):
- Not production-secure: the demo uses a small, hardcoded modulus so squarings are visible
  in real time. One-line UI note: "Toy modulus — for illustration, not security."
- No real trusted setup / no class-group backend. The fixed N is a stand-in for a modulus
  whose factorization nobody knows. One-line UI note: "Real VDFs need N whose factors are
  unknown to everyone (trusted setup or class groups)."
- The Pietrzak proof is described, not built (see EXTENSION SEAMS).
- No GPU/ASIC timing claims, no wall-clock 'seconds of delay' guarantees — delay is shown
  as sequential step count, not calibrated time.
- No brute-force factoring of N, no persistence of any state.

---

## SECURITY / CORRECTNESS INVARIANTS (bake in from the first commit; load-bearing)
1. The honest-evaluator path is genuinely sequential: eval() performs T real modular
   squarings in a loop and NEVER uses p, q, or φ(N) to shortcut. The factorization must not
   be reachable from the evaluation code path.
2. Verification is genuinely cheap and never re-runs the delay: verify() uses the Wesolowski
   identity (one exponentiation by ℓ, one by r = 2^T mod ℓ). It must not contain a loop of T
   squarings. A test asserts verify's modmul count is O(log ℓ + log N), independent of T.
3. The verifier trusts nothing the prover sends without checking: a claimed output y or proof
   π is accepted ONLY if π^ℓ · x^r ≡ y (mod N). No "looks plausible" acceptance.
4. Fail-closed: any tampered x, y, π, or T causes verify() to return false. There is no code
   path that silently accepts a bad triple.
5. The Fiat–Shamir challenge ℓ is bound to ALL of (N, x, y, T). Re-deriving ℓ from a different
   y must change ℓ, so a swapped output cannot reuse an old proof.
6. The trapdoor "instant cheat" mode (using φ(N) to compute y = x^(2^T mod φ(N)) without the
   loop) is an ISOLATED, clearly-labeled module. It can never be the default, is visibly
   marked as "what an honest evaluator cannot do — the security assumption is that nobody
   knows N's factors," and is never wired into the verification path.

---

## ARCHITECTURE
Keep the inspectable crypto in small, separately-testable modules:
- src/vdf/group.ts        — RSA-group params (fixed demo N), modmul, modpow, and the single
                            sequential `square` primitive used by eval. BigInt throughout.
- src/vdf/eval.ts         — `evaluate(x, T)`: T sequential squarings → y. No trapdoor access.
- src/vdf/wesolowski.ts   — `prove(x, y, T)` and `verify(x, y, T, proof)`; the Fiat–Shamir
                            `hashToPrime(...)` challenge derivation.
- src/vdf/trapdoor.ts     — ISOLATED `cheatWithFactors(x, T)`; imports p, q only here; never
                            imported by eval.ts or wesolowski.ts. Exists to demonstrate the
                            assumption, gated behind an explicit "reveal the trapdoor" toggle.
- src/vdf/types.ts        — branded types: GroupElement, Challenge (prime), Proof, Steps(T).
- src/ui/                 — evaluate panel, verify panel, comparison panel, applications,
                            construction-approaches; the step-counter animation.
- index.html              — content mounts at id="app"; :root defines --accent (#a78bfa);
                            NO header/footer (standardization pass owns those).

---

## UI
Central interaction / the "aha": the user sets an input x and a difficulty T (sequential
steps) and presses **Evaluate**. A step counter ticks up 0 → T as the squarings run, visibly
taking time and visibly refusing to go faster when the user tries to "skip ahead" (there is no
skip button on the honest path). Then the user presses **Verify**: a short proof is checked in
a flash, and the panel shows the verifier did only a handful of operations vs the evaluator's
T. The gap between the two counters IS the lesson.

Panels:
1. **Evaluate** — input x (text/number → group element), difficulty slider T (e.g. 2^4 … 2^14,
   capped so the browser stays responsive), live step counter + progress bar, resulting y.
   "Parallelism doesn't help" note: an optional 'try N workers' control that visibly does NOT
   reduce the step count (sequential dependency), reinforcing the delay property.
2. **Verify** — shows the proof π and the challenge ℓ, runs verify(), reports accept/reject
   with the operation-count contrast (verifier ops ≪ evaluator ops). A **Tamper** control lets
   the user flip a bit of y or π and watch verification reject (fail-closed).
3. **Time-Lock Puzzle vs VDF** — side-by-side: both require sequential work; ONLY the VDF gives
   a short, publicly-checkable proof. Make explicit that a time-lock puzzle has no fast public
   verification.
4. **Applications** — randomness beacons, blockchain leader election, fair lotteries / sealed-bid,
   anti-front-running. High-level, one sentence each.
5. **Construction Approaches** — repeated squaring; Wesolowski (short proof, prime challenge)
   vs Pietrzak (log T elements, no prime needed); RSA group vs class group (no trusted setup).
6. **Reveal the trapdoor** (collapsed, clearly labeled) — shows that knowing p, q computes y
   instantly, and states this is exactly the capability the VDF assumes no one has.

Below 640px: panels stack to a single column; the step counter and op-count contrast remain
legible; the comparison table becomes stacked cards.

---

## VISUAL SEMANTICS
Governing rule: color tracks the integrity of the verification result and the honesty of the
work, NOT the raw fact that "something computed."
- A valid proof verifying: green check + the word "Verified" + the op-count contrast. Pair
  icon + text + color always (WCAG 1.4.1).
- A tampered y or π rejected: red alarm + "Rejected (tampered)" + which value failed the
  identity check. Rejection is the SUCCESS state here — make it read as the demo working, not
  as an error the user caused.
- The honest sequential evaluation: a steadily advancing counter/bar in the accent color;
  it must look like effort that cannot be shortcut. The "try parallel workers" control, when
  used, must NOT speed it up — show the unchanged step count.
- The trapdoor cheat: render in a distinct warning style (amber/striped), labeled "assumption
  broken — evaluator cannot really do this." Never green, never presented as a faster honest path.
- Verify all states survive grayscale and deuteranopia (icon + text carry the meaning).

---

## EDGE CASES (each: defined behavior + a teaching tooltip)
- T = 0: y = x; proof trivial; tooltip "zero delay — degenerate VDF."
- T = 1: single squaring; verify still uses the Wesolowski identity, not a loop.
- T above the responsiveness cap: clamp with a visible warning ("capped so the page stays
  responsive — real VDFs run far higher T").
- x not in the group / x = 0, 1, or N−1: normalize into the group or reject with a tooltip
  explaining why these are degenerate (no real delay).
- Non-integer / empty input: reject before evaluation with a clear message; never feed junk
  into BigInt math.
- Tampered y: verify returns false (identity fails); tooltip "output changed ⇒ challenge ℓ
  changes ⇒ proof no longer matches."
- Tampered π: verify returns false; tooltip "proof must satisfy π^ℓ · x^r ≡ y."
- Mismatched T at verify time: verify returns false; the challenge binds T.

---

## TESTING
Add runnable tests (Vitest preferred) and confirm they pass before finishing. Cover:
- Correctness of eval: for small T, evaluate(x, T) equals direct modpow(x, 2^T mod ord, N)
  computed via a reference path, and equals naive T-fold squaring.
- Wesolowski round-trip: verify(x, y, T, prove(x, y, T)) === true for a spread of x and T.
- Fail-closed: flipping any bit of y, π, or changing T makes verify return false.
- Challenge binding: hashToPrime is a prime and changes when any of (N, x, y, T) changes.
- Cost invariant: verify performs O(log ℓ + log N) modmuls — assert its modmul count does NOT
  grow with T, while eval's does grow linearly in T (instrument a counter).
- Trapdoor isolation: cheatWithFactors(x, T) equals evaluate(x, T) (same y) AND a static check
  / test confirms eval.ts and wesolowski.ts never import trapdoor.ts.

---

## ACCESSIBILITY / MOBILE
- All interactive controls (sliders, evaluate/verify buttons, tamper toggle, trapdoor reveal)
  keyboard-operable with visible focus rings.
- State conveyed by icon + text + color, never color alone.
- Long monospace values (N, x, y, π, ℓ) in a horizontally-scrollable box with a copy button
  rather than wrapped, when wrapping would destroy meaningful structure.
- Text inputs are real <textarea>/<input> with <label>, not contenteditable divs.
- Layout stacks cleanly below 640px.

---

## EXTENSION SEAMS (leave seams, don't build yet)
- Pietrzak proof as an alternative prover/verifier: define wesolowski.ts behind a small
  `VdfProver` interface { prove, verify } so a `pietrzak.ts` can drop in without touching the
  UI. Add `// [extension] point` at the interface and where the UI selects the prover.
- Class-group backend: isolate the group operations in group.ts behind a `Group` interface
  (mul, square, identity, encode) so an imaginary-quadratic-class-group implementation can
  replace the RSA group with no trusted setup. Mark the seam.
- Randomness-beacon chaining: shape evaluate() so its output can feed the next round's input,
  enabling a future multi-round beacon view. Mark the seam; do not build the beacon now.

---

## DEFINITION OF DONE
- `npm run dev` serves the working demo locally.
- The core interaction works and produces the intended "aha": the evaluator's T-step delay vs
  the verifier's handful of operations is visible and the proof verifies; tampering rejects.
- Tests pass (state the count and what they cover).
- Content mounts at `id="app"`; `:root` defines `--accent` = #a78bfa.
- NO header, top bar, theme toggle, README, or scripture footer added here — those are
  applied by the Parts 0 + A–E standardization prompt next.

Report a one-line summary when done:
`✓ crypto-lab-vdf — demo logic + UI + tests complete, ready for Parts 0 + A–E`
```

---

## PIPELINE (for your own reference — not part of the pasted prompt)

1. The seven `[FILL]` sections + REPO block above are resolved for VDF.
2. Create the GitHub repo `crypto-lab-vdf` with the About one-liner above.
3. Paste the BUILD PROMPT block to Opus / Claude Code → working demo.
4. Run the existing **Parts 0 + A–E standardization prompt** on the result (header,
   theme, README, Pages config, footer, head/favicon).
5. Add the catalog card (title, tags, accent) to the `crypto-lab` index — confirm the accent
   against the live palette first.
6. Deploy and verify the live URL.

---

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
