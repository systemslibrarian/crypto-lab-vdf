import { test } from '@playwright/test';
import { boot, driveAllStates, NARROW } from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven the way a visitor drives it: a non-numeric input rejected
 * and corrected, the VDF evaluated through its T squarings, the Wesolowski
 * proof verified and accepted, y tampered and rejected, reset, π tampered and
 * rejected, reset, four parallel workers raced, the trapdoor panel opened by
 * its summary and used to recompute y instantly, and finally the input changed
 * so every result is retired. Every resulting state is scanned in both themes
 * at desktop and phone width.
 *
 * See `gate.ts` for why nothing is injected into the page, why no hidden panel
 * is force-revealed, why every step is scanned rather than only the last one,
 * and why `violations` is not the whole oracle.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(900_000);
    await boot(page, theme);
    await driveAllStates(page, theme);
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
  });
}
