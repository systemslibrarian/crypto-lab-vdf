import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are already gated on the VDF/Wesolowski tests;
 * this gates them on accessibility the same way. Scans the whole page with every
 * collapsible expanded and every live demo driven, in both dark and light themes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{transition:none!important;animation:none!important;opacity:1!important}`,
  });
}

async function revealAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = true;
    // Reveal any class/attr-hidden panels so their contents get scanned.
    for (const h of document.querySelectorAll('[hidden]')) h.removeAttribute('hidden');
  });
}

async function driveDemos(page: Page): Promise<void> {
  // Evaluate the VDF (small T so it finishes fast).
  await page.locator('#vdf-t').evaluate((elm) => {
    const input = elm as HTMLInputElement;
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#eval-btn').click();
  // Proof generation is async; wait for the proof rows (ℓ / π) to appear.
  await expect(page.locator('#eval-output')).toContainText('π', { timeout: 15_000 });

  // Verify (enabled once the proof exists).
  await page.locator('#verify-btn').click();
  await expect(page.locator('#verify-result')).toContainText(/Verified|Rejected/, { timeout: 15_000 });

  // Parallel-workers explainer.
  const workers = page.getByRole('button', { name: 'Try 4 parallel workers' });
  if (await workers.count()) await workers.first().click();

  // Trapdoor path (inside a <details>, already opened by revealAll).
  const trap = page.getByRole('button', { name: /Compute y instantly/ });
  if (await trap.count()) await trap.first().click();
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#app h1')).toBeVisible();
  await killMotion(page);
  await revealAll(page);
  await driveDemos(page);
  await revealAll(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#app h1')).toBeVisible();
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await killMotion(page);
  await revealAll(page);
  await driveDemos(page);
  await revealAll(page);
  await scan(page);
});
