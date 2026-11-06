import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const OWNER = { email: 'owner@example.com', password: 'e2e-secure-password', name: 'Rony Test' };

/** Logs in through the UI (performs the one-time setup if needed). */
export async function signIn(page: Page) {
  await page.goto('/');
  const setup = page.getByLabel('Einrichtungscode');
  const login = page.getByRole('button', { name: 'Anmelden' });
  await expect(setup.or(login).first()).toBeVisible();
  if (await setup.isVisible()) {
    await setup.fill('E2E-SETUP');
    await page.getByLabel('Dein Name').fill(OWNER.name);
    await page.getByLabel('E-Mail').fill(OWNER.email);
    await page.getByLabel('Passwort', { exact: true }).fill(OWNER.password);
    await page.getByLabel('Passwort wiederholen').fill(OWNER.password);
    await page.getByRole('button', { name: 'Einrichten' }).click();
  } else {
    await page.getByLabel('E-Mail').fill(OWNER.email);
    await page.getByLabel('Passwort', { exact: true }).fill(OWNER.password);
    await login.click();
  }
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).or(page.getByRole('navigation', { name: 'Schnellnavigation' })).first()).toBeVisible();
}

/** WCAG 2.1 A/AA scan; fails on serious or critical violations. */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const severe = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = severe.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `Barrierefreiheit auf ${label}`).toEqual([]);
}
