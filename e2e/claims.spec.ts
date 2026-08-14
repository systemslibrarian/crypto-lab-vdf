import { expect, test, type Page } from '@playwright/test';

/**
 * Functional gate for the claims this page makes on screen.
 *
 * The a11y spec proves the page is reachable; this one proves it is HONEST.
 * Every headline — "Verified", "Rejected", "Same y — no delay at all", the
 * eval-vs-verify cost tiles, the parallel-workers exhibit — is checked against
 * values the page itself computed and rendered, never against a fixed sentence.
 * Every tamper path must reach the failure state AND name its cause. Any
 * uncaught page exception fails the test that provoked it.
 */

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? [], 'uncaught page errors').toEqual([]);
});

/** Value of a rendered mono box, exactly as the page printed it. */
async function mono(page: Page, key: string): Promise<string> {
  const value = await page.locator(`[data-mono="${key}"]`).first().getAttribute('data-value');
  expect(value, `mono box "${key}" is present`).not.toBeNull();
  return value!;
}

/** Set the difficulty slider to 2^exponent and run the evaluation to completion. */
async function evaluateAt(page: Page, exponent: number): Promise<number> {
  await page.locator('#vdf-t').evaluate((node, value) => {
    const input = node as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, exponent);
  await page.locator('#eval-btn').click();
  // The proof element only appears once the T squarings AND prove() are done.
  await expect(page.locator('[data-mono="pi"]')).toHaveCount(1, { timeout: 120_000 });
  return 2 ** exponent;
}

async function verifyOnce(page: Page): Promise<void> {
  await page.locator('#verify-btn').click();
  await expect(page.locator('#verify-result')).toContainText(/Verified|Rejected/u, { timeout: 60_000 });
}

function digits(text: string | null): number {
  return Number((text ?? '').replace(/[^\d]/gu, ''));
}

test('an evaluation reports the same step count the difficulty control asked for', async ({ page }) => {
  await page.goto('.');
  const steps = await evaluateAt(page, 6); // 2^6 = 64 sequential squarings

  await expect(page.locator('#vdf-t')).toHaveAttribute(
    'aria-valuetext',
    `2 to the 6, ${steps.toLocaleString()} sequential steps`
  );
  const counter = page.locator('.counter').first();
  await expect(counter).toContainText(`Done — ${steps.toLocaleString()} sequential squarings`);
  await expect(page.locator('.progress')).toHaveAttribute('aria-valuenow', '100');

  // x is the user input mapped into the group; y, ℓ and π are all in range [0, N).
  const n = BigInt(await mono(page, 'n'));
  for (const key of ['x', 'y', 'pi']) {
    const value = BigInt(await mono(page, key));
    expect(value >= 0n && value < n, `${key} lies in the group [0, N)`).toBe(true);
  }
  expect(await mono(page, 'x'), 'input 42 maps to the group element 42').toBe('42');
  expect(BigInt(await mono(page, 'l')) > 0n).toBe(true);
});

/**
 * The proof caption states the prover cost its own run measured.
 *
 * The old caption — "Short proof (computed once by the evaluator)" — let the run read as
 * squarings, free proof, cheap verify. prove() actually performs a second exponentiation of
 * ~T group operations, except at low T where ⌊2^T/ℓ⌋ = 0 and π is the constant 1. Both
 * regimes are driven and the printed sentence must carry the measured number, not a vibe.
 */
test('the proof caption states the measured prover cost, in both regimes', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('.');

  // π = 1 regime: 2^64 is below the 128-bit challenge, so generating π costs nothing.
  await evaluateAt(page, 6);
  const zeroCaption = page.locator('#prove-cost');
  await expect(zeroCaption).toHaveAttribute('data-prove-ops', '0');
  await expect(zeroCaption).toContainText('cost no group operations');
  expect(await mono(page, 'pi'), 'the caption claims π = 1 and the rendered π must agree').toBe('1');

  // Real regime: the caption must print the same count its data attribute carries, and that
  // count must be real work on the same order as the evaluation itself.
  const steps = await evaluateAt(page, 11);
  const caption = page.locator('#prove-cost');
  const proveOps = Number(await caption.getAttribute('data-prove-ops'));
  expect(proveOps, 'the prover did real work').toBeGreaterThan(0);
  expect(proveOps, 'a second exponentiation ~linear in T').toBeLessThan(2 * steps);
  await expect(caption).toContainText(`${proveOps.toLocaleString()} more mod-N operations`);
  await expect(caption).not.toContainText('computed once by the evaluator');
});

/**
 * The cost tiles, at every difficulty the slider can select.
 *
 * The previous version of this test ran the slider MAXIMUM only and asserted
 * `speedup === Math.max(1, Math.round(evalOps / verifierOps))` — it recomputed the very
 * clamp it was supposed to be checking, so the clamp could never fail it. At the five lowest
 * slider positions the true ratio is below 1, `Math.round` took it to 0, the clamp printed
 * "≈ 1×", and the caption read "cheaper to verify than to compute" directly beside the two
 * op counts that disprove it (16 evaluate, 208 verify).
 *
 * What is asserted now is the CLAIM: whichever direction the caption states must be the
 * direction the two op counts show, and the printed factor must be the ratio of the larger
 * to the smaller. And the "more expensive" regime must actually be observed, so the test
 * cannot pass by never reaching the state it exists to police.
 */
test('the cost tiles state the direction their own two numbers show, at every difficulty', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('.');

  const seen = new Set<string>();
  let checked = 0;

  for (const exponent of [4, 6, 9, 11, 14]) {
    const steps = await evaluateAt(page, exponent);
    await verifyOnce(page);
    await expect(page.locator('#verify-result')).toContainText('Verified');

    const tiles = page.locator('.opcontrast .cell .big');
    await expect(tiles).toHaveCount(3);
    const evalOps = digits(await tiles.nth(0).textContent());
    const verifierOps = digits(await tiles.nth(1).textContent());

    // Tile 1 must be the same number of squarings the evaluate panel just reported.
    expect(evalOps, `eval tile matches the difficulty run at 2^${exponent}`).toBe(steps);
    await expect(page.locator('.counter').first()).toContainText(evalOps.toLocaleString());
    expect(verifierOps, `verifier did real work at 2^${exponent}`).toBeGreaterThan(0);

    // Tile 3 is a claim about the other two. It must agree with them.
    const caption = (await page.locator('#cost-ratio .cap').textContent()) ?? '';
    const factorText = (await page.locator('#cost-ratio .big').textContent()) ?? '';
    const factor = Number(factorText.replace(/[^\d.]/gu, ''));
    const saysCheaper = /^cheaper/u.test(caption.trim());
    const saysDearer = /more expensive/u.test(caption);
    expect(saysCheaper !== saysDearer, `caption picks exactly one direction: "${caption}"`).toBe(true);

    expect(
      saysCheaper,
      `at 2^${exponent} the page says "${caption.trim()}" while evaluate=${evalOps} and verify=${verifierOps}`
    ).toBe(verifierOps < evalOps);

    const trueFactor = saysCheaper ? evalOps / verifierOps : verifierOps / evalOps;
    expect(trueFactor, `a direction-corrected ratio is never below 1 (2^${exponent})`).toBeGreaterThanOrEqual(1);
    expect(
      Math.abs(factor - trueFactor) / trueFactor,
      `printed ${factorText} vs computed ${trueFactor.toFixed(2)} at 2^${exponent}`
    ).toBeLessThan(0.06);

    // The explanatory note must match the same direction.
    const note = (await page.locator('#cost-note').textContent()) ?? '';
    expect(/larger than the delay itself/u.test(note), `note direction at 2^${exponent}`).toBe(!saysCheaper);

    seen.add(saysCheaper ? 'cheaper' : 'dearer');
    checked++;
  }

  expect(checked, 'difficulties actually driven').toBe(5);
  // Non-vacuity: if the slider never reaches the regime where verification is the expensive
  // side, this test proves nothing about the clamp it exists to catch — so it fails.
  expect(
    [...seen].sort(),
    'both cost regimes must be reachable from the shipped slider'
  ).toEqual(['cheaper', 'dearer']);
});

test('tampering with y is rejected, names the cause, and recovers on reset', async ({ page }) => {
  await page.goto('.');
  await evaluateAt(page, 6);
  await verifyOnce(page);
  await expect(page.locator('#verify-result')).toContainText('Verified');
  const honestY = await mono(page, 'y');

  await page.getByRole('button', { name: 'Tamper with y' }).click();
  // Editing what the verifier is handed retires the previous verdict immediately.
  await expect(page.locator('#verify-result')).toContainText('Inputs changed');
  await expect(page.locator('#verify-result')).not.toContainText('Verified');

  const tamperedY = await mono(page, 'y');
  expect(tamperedY, 'the shown y actually changed').not.toBe(honestY);
  expect(
    (BigInt(tamperedY) ^ BigInt(honestY)) === 1n,
    'tampering flips exactly the low bit'
  ).toBe(true);
  await expect(page.locator('[data-mono="y"]')).toContainText('(tampered)');

  await verifyOnce(page);
  const result = page.locator('#verify-result');
  await expect(result).toContainText('Rejected');
  await expect(result, 'the rejection names what failed').toContainText('identity π^ℓ · x^r ≡ y failed');
  await expect(result).toContainText('altered');
  await expect(result).not.toContainText('Verified');

  // Fail-closed is not fail-stuck: resetting the tamper verifies again.
  await page.getByRole('button', { name: 'Reset tamper' }).click();
  await expect(page.locator('#verify-result')).toContainText('Inputs changed');
  expect(await mono(page, 'y')).toBe(honestY);
  await verifyOnce(page);
  await expect(page.locator('#verify-result')).toContainText('Verified');
});

test('tampering with the proof π is rejected and names the cause', async ({ page }) => {
  await page.goto('.');
  await evaluateAt(page, 11); // the shipped default; π here is a real group element
  const honestPi = await mono(page, 'pi');
  expect(BigInt(honestPi), 'π is a non-degenerate group element at this difficulty')
    .toBeGreaterThan(1n);

  await page.getByRole('button', { name: 'Tamper with π' }).click();
  const tamperedPi = await mono(page, 'pi');
  expect(tamperedPi).not.toBe(honestPi);
  await expect(page.locator('[data-mono="pi"]')).toContainText('(tampered)');
  // y was NOT touched, so only the proof can be at fault.
  await expect(page.locator('[data-mono="y"]')).not.toContainText('(tampered)');

  await verifyOnce(page);
  await expect(page.locator('#verify-result')).toContainText('Rejected');
  await expect(page.locator('#verify-result')).toContainText('identity π^ℓ · x^r ≡ y failed');
});

/**
 * A rejection that happens before the identity check does no group work, so there is no cost
 * comparison to print. The tile used to compute `Math.max(1, Math.round(T / Math.max(1, 0)))`
 * and caption it "cheaper to verify than to compute" — "≈ 64× cheaper" sitting beside its own
 * "0 mod-N operations to verify".
 *
 * The state is reachable: at T ≤ 64 the challenge ℓ is wider than 2^T, so ⌊2^T/ℓ⌋ = 0 and the
 * proof element is the constant 1; the Tamper-with-π button flips its low bit to 0, which is
 * outside the group.
 */
test('a run rejected before the identity check prints no cost comparison', async ({ page }) => {
  await page.goto('.');
  await evaluateAt(page, 6);
  expect(await mono(page, 'pi'), 'the degenerate π = 1 regime the tamper drives out of range')
    .toBe('1');

  await page.getByRole('button', { name: 'Tamper with π' }).click();
  expect(await mono(page, 'pi')).toBe('0');
  await verifyOnce(page);

  const result = page.locator('#verify-result');
  await expect(result).toContainText('Rejected');
  await expect(result, 'the rejection names what failed').toContainText('non-canonical encoding');

  const verifierOps = digits(await page.locator('.opcontrast .cell .big').nth(1).textContent());
  expect(verifierOps, 'no group operations were performed').toBe(0);
  await expect(page.locator('#cost-ratio .cap')).toContainText('no comparison');
  await expect(page.locator('#cost-ratio .cap')).not.toContainText('cheaper');
  await expect(page.locator('#cost-note')).toContainText('Nothing was measured on this run');
});

test('the parallel-workers exhibit computes its own conclusion', async ({ page }) => {
  // Count Web Worker constructions so the panel's "no Web Worker was created" is checked
  // against the browser, not taken on the panel's word.
  await page.addInitScript(() => {
    const w = window as unknown as { __workersMade: number; Worker: typeof Worker };
    w.__workersMade = 0;
    const Real = w.Worker;
    w.Worker = new Proxy(Real, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        w.__workersMade++;
        return new target(...args);
      },
    });
  });
  await page.goto('.');
  const steps = await evaluateAt(page, 8); // 256 squarings, split 4 ways
  const honestY = await mono(page, 'y');
  const counterBefore = await page.locator('.counter').first().textContent();

  await page.locator('#workers-btn').click();
  const note = page.locator('#workers-note');
  await expect(note).toBeVisible();

  const chained = await note.locator('#workers-chained').textContent();
  // The slice arithmetic is printed: the parts must sum to the whole.
  const sum = /Chained across 4 workers: ([\d + ]+) =/u.exec(chained ?? '');
  expect(sum, `slice arithmetic not found in: ${chained}`).not.toBeNull();
  const slices = sum![1].split('+').map((s) => Number(s.trim()));
  expect(slices).toHaveLength(4);
  expect(slices.reduce((a, b) => a + b, 0), 'slices sum to T').toBe(steps);
  expect(chained).toContain(`${steps.toLocaleString()} squarings`);
  expect(chained).toContain('the same y');

  // Four workers chained reproduce the honest y exactly...
  expect(await mono(page, 'chained-y'), 'chained workers reproduce y').toBe(honestY);

  // ...and workers started together produce a DIFFERENT number, which is why
  // the "speed-up" is not one. Both values are computed, not asserted in prose.
  const together = await page.locator('#workers-together-y').textContent();
  expect(together, 'started-together result is a real value').toMatch(/^\d+$/u);
  expect(together, 'started together lands somewhere else').not.toBe(honestY);
  await expect(note.locator('#workers-together')).toContainText('a different number');
  expect(Number(/(\d[\d,]*) steps deep on the critical path/u.exec(
    await note.locator('#workers-together').textContent() ?? ''
  )?.[1].replace(/,/gu, '')), 'critical-path depth is one slice').toBe(steps / 4);

  // Nothing here is a Web Worker and nothing was timed, so the panel must say so rather than
  // let "wall clock" imply a measurement it never took.
  const fidelity = note.locator('#workers-fidelity');
  await expect(fidelity).toContainText('no Web Worker was created and nothing was timed');
  await expect(fidelity).toContainText('dependency-chain depth, not measured wall-clock time');
  expect(
    await page.evaluate(() => (window as unknown as { __workersMade: number }).__workersMade),
    'the panel says no Web Worker was created; the counted constructions must agree'
  ).toBe(0);
  await expect(note).not.toContainText('wall clock each');

  // The exhibit must not quietly change the run it is describing.
  expect(await page.locator('.counter').first().textContent()).toBe(counterBefore);
  expect(await mono(page, 'y')).toBe(honestY);
});

/**
 * The trapdoor headline, at both ends of the slider.
 *
 * The old version ran exponent 7 only and asserted the page said "Same y — no delay at all"
 * and "skipped all 128 squarings". At T = 128 the trapdoor path does 129 mod-N operations
 * against the honest 128: the test pinned a sentence its own difficulty disproves, and every
 * difficulty it could have chosen (t ∈ {8, 64, 500} in the unit test, 7 here) sat inside the
 * range where the shortcut is the slower path.
 *
 * The claim now asserted is the relationship: whatever the headline says about speed must be
 * what the two printed op counts show, and both regimes must be observed.
 */
test('the trapdoor headline states the speed its own two op counts show', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('.');
  await page.locator('details.trapdoor summary').click();

  const seen = new Set<string>();
  for (const exponent of [4, 14]) {
    await evaluateAt(page, exponent);
    const honestY = await mono(page, 'y');
    await page.getByRole('button', { name: 'Compute y instantly using the secret factors' }).click();

    const cheated = await mono(page, 'trapdoor-y');
    expect(cheated, `trapdoor shortcut lands on the honest y at 2^${exponent}`).toBe(honestY);

    const cost = page.locator('#trapdoor-cost');
    const honestOps = Number(await cost.getAttribute('data-honest-ops'));
    const trapdoorOps = Number(await cost.getAttribute('data-trapdoor-ops'));
    expect(honestOps, `honest op count at 2^${exponent}`).toBe(2 ** exponent);
    expect(trapdoorOps, `trapdoor did real work at 2^${exponent}`).toBeGreaterThan(0);
    // Both numbers are on screen, not only in attributes.
    await expect(cost).toContainText(honestOps.toLocaleString());
    await expect(cost).toContainText(trapdoorOps.toLocaleString());

    const headline = (await page.locator('#trapdoor-headline').textContent()) ?? '';
    const claimsFaster = /delay collapsed/u.test(headline);
    const claimsNotFaster = /was not faster/u.test(headline);
    expect(claimsFaster !== claimsNotFaster, `headline picks one: "${headline}"`).toBe(true);
    expect(
      claimsFaster,
      `at 2^${exponent} the page says "${headline}" while honest=${honestOps} and trapdoor=${trapdoorOps}`
    ).toBe(trapdoorOps < honestOps);

    seen.add(claimsFaster ? 'faster' : 'not-faster');
  }

  // Non-vacuity: the small-T regime, where the "shortcut" costs more than the honest run, is
  // the whole reason this headline is conditional. If it never occurs, the test fails.
  expect(
    [...seen].sort(),
    'both trapdoor regimes must be reachable from the shipped slider'
  ).toEqual(['faster', 'not-faster']);
});

test('regression: editing an input retires the result it was computed from', async ({ page }) => {
  await page.goto('.');
  await evaluateAt(page, 6);
  await verifyOnce(page);
  await expect(page.locator('#verify-result')).toContainText('Verified');

  await page.fill('#vdf-input', '43');

  // A "Verified ✓" panel must not survive the input it was computed from.
  await expect(page.locator('#verify-result')).toContainText('Input changed');
  await expect(page.locator('#verify-result')).not.toContainText('Verified');
  await expect(page.locator('#eval-output')).toBeEmpty();
  await expect(page.locator('#verify-btn')).toBeDisabled();
  await expect(page.locator('.counter').first()).toContainText('Input changed');

  // Changing the difficulty retires it too — including the trapdoor exhibit, which prints the
  // honest step count of the run it was computed from and so states T as a fact.
  await evaluateAt(page, 6);
  await expect(page.locator('#verify-btn')).toBeEnabled();
  await page.locator('details.trapdoor summary').click();
  await page.getByRole('button', { name: 'Compute y instantly using the secret factors' }).click();
  await expect(page.locator('#trapdoor-cost'), 'the exhibit really did render a comparison')
    .toContainText('Honest path: 64 sequential squarings');

  await page.locator('#vdf-t').evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#eval-output')).toBeEmpty();
  await expect(page.locator('#verify-btn')).toBeDisabled();
  await expect(
    page.locator('#trapdoor-output'),
    'a trapdoor comparison must not outlive the difficulty it was computed at'
  ).toBeEmpty();

  // Controls are not permanently dead: evaluating again restores everything,
  // and the new x is the one that was typed.
  await evaluateAt(page, 7);
  expect(await mono(page, 'x')).toBe('43');
  await expect(page.locator('#verify-btn')).toBeEnabled();
  await verifyOnce(page);
  await expect(page.locator('#verify-result')).toContainText('Verified');
});

/**
 * The retirement rule has to cover a run that has not finished yet.
 *
 * `retireResult` returned early while `state.result` was still null — which is precisely the
 * window in which an evaluation is in flight. Measured in Chromium: 1,321 ms at the slider
 * maximum, 216 ms at the shipped default, with the input field and slider both live and the
 * counter visibly advancing. Editing x from 42 to 43 during it left x = 42, y for 42, a proof
 * for 42 and an enabled Verify button on screen beside an input reading 43.
 */
test('regression: changing an input mid-evaluation retires the run that is still going', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('.');
  await page.locator('#vdf-t').evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = '14';                       // 16,384 squarings — the longest window
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#eval-btn').click();

  // The run must genuinely be in flight, or this test proves nothing: fail if the evaluation
  // finishes before the counter is ever caught mid-chain.
  await expect(
    page.locator('.counter').first(),
    'the evaluation must be caught while it is still running'
  ).toContainText('Squaring', { timeout: 30_000 });

  await page.fill('#vdf-input', '43');

  // Give the superseded run every chance to finish and write itself to the page.
  await page.waitForTimeout(3_000);

  await expect(page.locator('#eval-output'), 'no result from the retired run').toBeEmpty();
  await expect(page.locator('#verify-btn')).toBeDisabled();
  await expect(page.locator('.counter').first()).toContainText('Input changed');
  expect(await page.locator('#vdf-input').inputValue()).toBe('43');
  await expect(page.locator('[data-mono="y"]')).toHaveCount(0);

  // And the controls are not left dead: evaluating again works, on the NEW input.
  await evaluateAt(page, 6);
  expect(await mono(page, 'x'), 'the run that lands is the one for the current input').toBe('43');
  await verifyOnce(page);
  await expect(page.locator('#verify-result')).toContainText('Verified');
});

test('regression: non-numeric input is refused with a visible, announced error', async ({ page }) => {
  await page.goto('.');
  const error = page.locator('#vdf-input-err');

  // The `[hidden]` trap: `.field-err` sets display:block, which beats the UA
  // `[hidden] { display: none }` unless the page overrides it. Before the fix
  // this empty role="alert" rendered on every load.
  await expect(error).toBeHidden();

  await page.fill('#vdf-input', 'not-a-number');
  await page.locator('#eval-btn').click();
  await expect(error).toBeVisible();
  await expect(error).toContainText('Enter a whole number');
  await expect(page.locator('#vdf-input')).toHaveAttribute('aria-invalid', 'true');
  // Nothing was evaluated, so nothing may be verified.
  await expect(page.locator('#eval-output')).toBeEmpty();
  await expect(page.locator('#verify-btn')).toBeDisabled();

  // ...and it clears once the input is valid again.
  await page.fill('#vdf-input', '7');
  await evaluateAt(page, 5);
  await expect(error).toBeHidden();
  await expect(page.locator('#vdf-input')).not.toHaveAttribute('aria-invalid', 'true');
  expect(await mono(page, 'x')).toBe('7');
});

test('regression: no element carrying the hidden attribute is still rendered', async ({ page }) => {
  await page.goto('.');
  await evaluateAt(page, 4);

  const leaks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[hidden]'))
      .filter((node) => getComputedStyle(node as HTMLElement).display !== 'none')
      .map((node) => ({
        tag: (node as HTMLElement).tagName.toLowerCase(),
        cls: (node as HTMLElement).className?.toString().slice(0, 60) ?? '',
        display: getComputedStyle(node as HTMLElement).display,
      }))
  );
  expect(leaks, `elements marked hidden that still render: ${JSON.stringify(leaks)}`).toEqual([]);
});
