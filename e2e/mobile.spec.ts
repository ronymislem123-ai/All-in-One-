import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mobile: bottom navigation, drawer and no horizontal scrolling', async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Schnellnavigation' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Ideen' }).click();
  await expect(page).toHaveURL(/\/ideas/);
  await nav.getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Sync Center' }).click();
  await expect(page).toHaveURL(/\/sync/);
  for (const path of ['/', '/projects', '/apps', '/ideas', '/knowledge', '/sync', '/conflicts', '/activity', '/backups', '/settings', '/code']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontaler Überlauf auf ${path}`).toBeLessThanOrEqual(1);
  }
});

test('reduced motion disables animations', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 400, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page);
  const dur = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim());
  expect(['0ms', '0s']).toContain(dur);
  await ctx.close();
});
