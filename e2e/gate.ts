import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this replaced
 *     pushed `*{opacity:1!important}` through `addStyleTag`, and then called a
 *     `revealAll()` that stripped `[hidden]` from every element on the page —
 *     which in this lab means the invalid-input alert and the parallel-workers
 *     note were forced on screen at the same time as everything else. Neither
 *     was ever measured in the state a visitor actually reaches it in, and the
 *     combined document was one no visitor can load. It also opened the one
 *     `<details>` on the page — the trapdoor panel — as a side effect of that
 *     same sweep rather than by clicking its summary, so the closed state was
 *     never scanned and the open one was never reached the way a reader
 *     reaches it.
 *
 *  2. IT DROVE THE WHOLE LAB AND SCANNED ONCE, AT THE END. That is a distinct
 *     failure from never driving at all, and it is worth naming: every state
 *     the old drive built — the proof rows, the successful verification, the
 *     workers note — was constructed and thrown away unmeasured, because only
 *     the final frame was ever handed to axe. This gate scans after every
 *     single step.
 *
 *  3. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. axe over an empty container passes having checked
 *     nothing. At first paint `#eval-output` is empty, `#verify-btn` is
 *     disabled, and `#verify-result` holds nothing: no N, no x, no y, no ℓ, no
 *     π, no verdict. `.status.alarm` — the rejected verification, which is the
 *     entire claim of a VDF proof — requires evaluating, tampering and
 *     verifying again, and the old gate never tampered at all.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab's
 * reduced-motion block collapses durations to 0.01ms rather than setting
 * `animation: none`, which is the safe form — a cancelled animation loses its
 * end state, a zero-length one still lands on it.
 *
 * `aria-hidden` subtrees are excluded. The cost of that exclusion is stated
 * plainly: text removed from the accessibility tree AND painted at zero opacity
 * is not checked here.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page, because a silent no-op there would mean
 * an emulation that silently did nothing would leave the gate certifying a
 * different rendering than the one it claims to.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  // The whole page is built by `src/ui/app.ts` into an empty `#app`, so a
  // navigation that resolves proves nothing.
  await expect(page.locator('#eval-btn')).toBeVisible();
  await expect(page.locator('#verify-btn')).toBeVisible();
  await expect(page.locator('#workers-btn')).toBeVisible();
  // The regions that carry the lab's claims are genuinely empty here, which is
  // the whole reason `driveAllStates` exists.
  await expect(page.locator('#eval-output')).toBeEmpty();
  await expect(page.locator('#verify-btn')).toBeDisabled();
  await expect(page.locator('#verify-result')).toBeEmpty();
  // Both of the panels the old `revealAll()` used to force on screen are
  // hidden here, as they are for every visitor on arrival.
  await expect(page.locator('#vdf-input-err')).toBeHidden();
  await expect(page.locator('#workers-note')).toBeHidden();

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: every value it shows is a full 2048-bit modular integer
 * printed in decimal — N, x, y, ℓ and π — and it also lays out a two-column
 * comparison table of time-lock puzzles against VDFs.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. That
    // cost a run elsewhere in this fleet, and this lab has the same decoy:
    // every `.mono-box` holding a 2048-bit integer is its own `overflow-x:
    // auto` scroller.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    // Prefer an unclipped culprit; fall back to the widest clipped one rather
    // than reporting nothing, so the message always names something to look at.
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Five assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters more here than in most labs, since
 *    almost every tinted surface is a `color-mix()` axe declines to resolve.
 *    Everything else in that bucket is a real result axe simply could not
 *    finish — including `aria-prohibited-attr`, which is where an `aria-label`
 *    on a role-less div hides, a defect that never reaches the violations array
 *    at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  expect(violations, `axe violations in state: ${label}`).toEqual([]);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([]);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  expect(contrast, `measured contrast failures in state: ${label}`).toEqual([]);

  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}


/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Four things shape this drive:
 *
 *  - THE REJECTED VERIFICATION IS THE CLAIM. A VDF proof is only interesting
 *    because it refuses altered output. `.status.alarm` and the `(tampered)`
 *    marker on the affected `.mono-box` exist nowhere else, and the gate this
 *    replaces never pressed a tamper button — so it verified once, saw
 *    `.status.ok`, and certified a page on which two of the three status
 *    flavours had never been painted. Both tamper paths are driven separately,
 *    because they mark different boxes: y and π.
 *
 *  - `.status.warn` IS A THIRD FLAVOUR, and it is reached two different ways —
 *    by retiring a result (changing the input after evaluating) and by opening
 *    the trapdoor. Both are visited.
 *
 *  - THE HIDDEN PANELS ARE DRIVEN, NOT UNHIDDEN. `#vdf-input-err` and
 *    `#workers-note` ship `hidden`. The old gate stripped the attribute from
 *    both at once; here the error is produced by typing something that is not
 *    a number, and the note by pressing the button that computes it.
 *
 *  - EVERY WAIT IS ON A COMPLETION SIGNAL. Evaluation is a generator pumped by
 *    `requestAnimationFrame` and verification is async, so each is awaited on
 *    the button re-enabling or the output rendering, never on a timeout.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  await scan(page, `${theme} / first paint`);

  await page.locator('a.cl-skip-link').focus();
  await scan(page, `${theme} / skip link focused`);

  // ── The invalid-input alert, reached the way a visitor reaches it ─────────
  await page.locator('#vdf-input').fill('not a number');
  await page.locator('#eval-btn').click();
  await expect(page.locator('#vdf-input-err')).toBeVisible();
  await expect(page.locator('#vdf-input')).toHaveAttribute('aria-invalid', 'true');
  await scan(page, `${theme} / invalid input rejected`);

  await page.locator('#vdf-input').fill('42');
  await expect(page.locator('#vdf-input-err')).toBeHidden();
  await scan(page, `${theme} / input corrected`);

  // ── Evaluate: the T squarings, then the proof ────────────────────────────
  await page.locator('#eval-btn').click();
  await expect(page.locator('#eval-btn')).toBeEnabled({ timeout: 180_000 });
  await expect(page.locator('#eval-output')).toContainText('π');
  await expect(page.locator('#verify-btn')).toBeEnabled();
  await scan(page, `${theme} / evaluated, proof rendered`);

  // ── Verify: accepted ─────────────────────────────────────────────────────
  await page.locator('#verify-btn').click();
  await expect(page.locator('#verify-result .status.ok')).toBeVisible({ timeout: 120_000 });
  await scan(page, `${theme} / proof accepted`);

  // ── Tamper with y, then with π: the two rejection paths ──────────────────
  for (const [label, button, box] of [
    ['y', 'Tamper with y', 'y'],
    ['π', 'Tamper with π', 'pi'],
  ] as const) {
    await page.getByRole('button', { name: button }).click();
    // Tampering marks the result stale first — its own colour, `.status.warn`.
    await expect(page.locator('#verify-result .status.warn')).toBeVisible();
    await expect(page.locator(`.mono-box[data-mono="${box}"]`)).toContainText('(tampered)');
    await scan(page, `${theme} / ${label} tampered, verdict marked stale`);

    await page.locator('#verify-btn').click();
    await expect(page.locator('#verify-result .status.alarm')).toBeVisible({ timeout: 120_000 });
    await scan(page, `${theme} / tampered ${label} rejected`);

    await page.getByRole('button', { name: 'Reset tamper' }).click();
    await expect(page.locator(`.mono-box[data-mono="${box}"]`)).not.toContainText('(tampered)');
    await page.locator('#verify-btn').click();
    await expect(page.locator('#verify-result .status.ok')).toBeVisible({ timeout: 120_000 });
  }
  await scan(page, `${theme} / tamper reset, proof accepted again`);

  // ── The parallel-workers explainer ───────────────────────────────────────
  await page.locator('#workers-btn').click();
  await expect(page.locator('#workers-note')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#workers-together-y')).not.toBeEmpty();
  await scan(page, `${theme} / four parallel workers raced`);

  // ── The trapdoor, opened by its summary rather than by force ─────────────
  await expect(page.locator('details.trapdoor')).not.toHaveAttribute('open', '');
  await page.locator('details.trapdoor > summary').click();
  await expect(page.locator('details.trapdoor')).toHaveAttribute('open', '');
  await scan(page, `${theme} / trapdoor panel opened`);

  await page.locator('details.trapdoor button.danger').click();
  await expect(page.locator('.mono-box[data-mono="trapdoor-y"]')).toBeVisible();
  await expect(page.locator('details.trapdoor .status.warn')).toBeVisible();
  await scan(page, `${theme} / y recomputed instantly from the secret factors`);

  // ── Retiring the result: the stale state, and every panel torn back down ─
  await page.locator('#vdf-input').fill('43');
  await expect(page.locator('#eval-output')).toBeEmpty();
  await expect(page.locator('#verify-btn')).toBeDisabled();
  await expect(page.locator('#workers-note')).toBeHidden();
  await scan(page, `${theme} / input changed, result retired`);
}
