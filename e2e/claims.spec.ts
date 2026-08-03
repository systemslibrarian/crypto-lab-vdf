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

test('the cost tiles are consistent with each other and with the run they describe', async ({ page }) => {
  await page.goto('.');
  const steps = await evaluateAt(page, 14); // the slider maximum: 16,384 squarings
  await verifyOnce(page);

  await expect(page.locator('#verify-result')).toContainText('Verified');
  const tiles = page.locator('.opcontrast .cell .big');
  await expect(tiles).toHaveCount(3);

  const evalOps = digits(await tiles.nth(0).textContent());
  const verifierOps = digits(await tiles.nth(1).textContent());
  const speedup = digits(await tiles.nth(2).textContent());

  // Tile 1 must be the same number of squarings the evaluate panel just reported.
  expect(evalOps, 'eval tile matches the difficulty that was run').toBe(steps);
  await expect(page.locator('.counter').first()).toContainText(evalOps.toLocaleString());

  // Tile 2 is real work: a handful of group operations, never zero, never T.
  expect(verifierOps).toBeGreaterThan(0);
  expect(verifierOps, 'verifying must not cost re-running the delay').toBeLessThan(evalOps / 3);

  // Tile 3 is the ratio of the other two, not an independent claim.
  expect(speedup).toBe(Math.max(1, Math.round(evalOps / verifierOps)));
  expect(speedup, 'the whole point: verification is much cheaper').toBeGreaterThan(1);
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
  await evaluateAt(page, 6);
  const honestPi = await mono(page, 'pi');

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

test('the parallel-workers exhibit computes its own conclusion', async ({ page }) => {
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
  expect(Number(/(\d[\d,]*) steps of wall clock/u.exec(
    await note.locator('#workers-together').textContent() ?? ''
  )?.[1].replace(/,/gu, '')), 'wall-clock steps are one slice').toBe(steps / 4);

  // The exhibit must not quietly change the run it is describing.
  expect(await page.locator('.counter').first().textContent()).toBe(counterBefore);
  expect(await mono(page, 'y')).toBe(honestY);
});

test('the trapdoor reproduces the same y it claims to, without the delay', async ({ page }) => {
  await page.goto('.');
  await evaluateAt(page, 7);
  const honestY = await mono(page, 'y');

  await page.locator('details.trapdoor summary').click();
  await page.getByRole('button', { name: /secret factors/u }).click();

  const cheated = await mono(page, 'trapdoor-y');
  // The headline "Same y — no delay at all" must be backed by the two values.
  expect(cheated, 'trapdoor shortcut lands on the honest y').toBe(honestY);
  const status = page.locator('details.trapdoor .status');
  await expect(status).toContainText('Same y — no delay at all');
  await expect(status).toContainText('skipped all 128 squarings');
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

  // Changing the difficulty retires it too.
  await evaluateAt(page, 6);
  await expect(page.locator('#verify-btn')).toBeEnabled();
  await page.locator('#vdf-t').evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#eval-output')).toBeEmpty();
  await expect(page.locator('#verify-btn')).toBeDisabled();

  // Controls are not permanently dead: evaluating again restores everything,
  // and the new x is the one that was typed.
  await evaluateAt(page, 7);
  expect(await mono(page, 'x')).toBe('43');
  await expect(page.locator('#verify-btn')).toBeEnabled();
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
