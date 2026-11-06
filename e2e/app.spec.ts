import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });
let page: Page;

test.beforeAll(async ({ browser, baseURL }) => {
  // an explicit context (required by axe) that keeps the session across the serial tests
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme: 'dark' });
  page = await context.newPage();
  await signIn(page);
});
test.afterAll(async () => { await page.context().close(); });

test('dashboard shows real data and integration status honestly', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rony');
  await expect(page.getByText('144', { exact: true })).toBeVisible();
  // not configured integrations are shown as such – never as successful
  await expect(page.getByText('Claude (MCP / Ingest-API)')).toBeVisible();
  await expect(page.getByText(/Nicht eingerichtet/).first()).toBeVisible();
});

test('create a project, add a module, edit notes and find it via the command palette', async () => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('E2E Raumschiff');
  await dialog.getByLabel('Kurzbeschreibung').fill('Ein Testprojekt aus dem Browser');
  await dialog.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Raumschiff');
  await page.getByRole('button', { name: 'Unterobjekt' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Antrieb');
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('link', { name: /Antrieb/ })).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('dialog').getByLabel('Persönliche Notizen').fill('Nur für mich');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Nur für mich')).toBeVisible();
  await page.getByRole('button', { name: 'Zu Favoriten' }).click();
  await expect(page.getByRole('button', { name: 'Aus Favoriten entfernen' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('Raumschiff');
  await expect(page.getByRole('option', { name: /E2E Raumschiff/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('cycle prevention and version history in the UI', async () => {
  await page.goto('/projects?q=Raumschiff');
  await page.getByRole('link', { name: /E2E Raumschiff/ }).first().click();
  await page.getByRole('tab', { name: /Versionen/ }).click();
  await expect(page.getByRole('cell', { name: 'v1' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'v2' })).toBeVisible();
});

test('idea hub: discover locally, open an idea and turn it into a project with a brief', async () => {
  await page.goto('/ideas');
  await expect(page.getByText('KI nicht eingerichtet · lokale Bibliothek')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mit Claude generieren' })).toBeDisabled();
  await page.getByRole('button', { name: 'Kleine Tools' }).click();
  await page.getByRole('button', { name: 'Aus Bibliothek' }).click();
  await expect(page.getByText(/Lokale Bibliothek ·/)).toBeVisible();
  await page.locator('article h3').first().click();
  await page.getByRole('button', { name: 'Entwicklungsauftrag' }).click();
  await expect(page.getByRole('dialog')).toContainText('# Entwicklungsauftrag');
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).first().click();
  await page.getByRole('button', { name: 'Als Projekt übernehmen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByRole('link', { name: /Entwicklungsauftrag/ })).toBeVisible();
});

test('app store: an app becomes available only after a successful check', async () => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Anwendung', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Ideenzentrale');
  await d.getByLabel('Anwendungsart').selectOption('internal');
  await d.getByLabel('Startpunkt').fill('/ideas');
  await d.getByRole('button', { name: 'Speichern' }).click();
  const card = page.locator('article').filter({ hasText: 'Ideenzentrale' });
  await expect(card.getByText('Nicht geprüft')).toBeVisible();
  await card.getByRole('button', { name: 'Prüfen' }).click();
  await expect(card.getByText('Verfügbar (geprüft)')).toBeVisible();
});

test('claude import via markdown file creates a project; re-import creates no duplicates', async () => {
  const md = `---\nomega: project\nexternalId: e2e-import\nname: Importiertes Projekt\nstatus: in_development\n---\n# Importiertes Projekt\n\nAus einer Datei.\n\n## Module\n- Login | in_development\n- Export\n`;
  for (let i = 0; i < 2; i++) {
    await page.goto('/sync?tab=import');
    await page.getByLabel('… oder Markdown/Text einfügen').fill(md);
    await page.getByRole('button', { name: 'Vorschau' }).click();
    await expect(page.getByText('markdown-project')).toBeVisible();
    await page.getByRole('button', { name: 'Importieren' }).click();
    await expect(page.getByText(i === 0 ? 'Übernommen: 3' : 'Bereits verarbeitet: 3')).toBeVisible();
  }
  await page.goto('/projects?q=Importiertes');
  await expect(page.getByText('1 Projekt')).toBeVisible();
});

test('similar names never merge: duplicate import becomes a conflict that can be resolved', async () => {
  await page.goto('/sync?tab=import');
  await page.getByLabel('… oder Markdown/Text einfügen').fill(`---\nomega: project\nexternalId: e2e-raumschiff-2\nname: E2E-Raumschiff\n---\nÄhnlicher Name`);
  await page.getByRole('button', { name: 'Vorschau' }).click();
  await page.getByRole('button', { name: 'Importieren' }).click();
  await expect(page.getByText('Konflikt: 1')).toBeVisible();
  await page.goto('/conflicts');
  await page.getByRole('link', { name: /ähnelt bestehenden Einträgen/ }).click();
  await page.getByRole('radio', { name: /E2E Raumschiff/ }).check();
  await page.getByRole('radio', { name: /Bestehendes Projekt verwenden/ }).check();
  await page.getByRole('button', { name: 'Entscheidung anwenden' }).click();
  await expect(page.getByText('Keine offenen Konflikte')).toBeVisible();
});

test('backup: create, verify and restore with typed confirmation; trash restore', async () => {
  await page.goto('/backups');
  await page.getByLabel('Notiz zur Sicherung').fill('E2E');
  await page.getByRole('button', { name: 'Jetzt sichern' }).click();
  await expect(page.getByText('Sicherung erstellt und verifiziert')).toBeVisible();
  await expect(page.getByRole('cell', { name: /E2E/ })).toBeVisible();
  await page.getByRole('button', { name: 'Alles' }).first().click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('button', { name: 'Vollständig wiederherstellen' })).toBeDisabled();
  await confirm.getByLabel(/Zur Bestätigung/).fill('WIEDERHERSTELLEN');
  await confirm.getByRole('button', { name: 'Vollständig wiederherstellen' }).click();
  await expect(page.getByText('Wiederherstellung abgeschlossen').first()).toBeVisible();
  // still signed in after the restore
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rony');
});

test('accessibility (WCAG 2.1 AA, axe) on all main views', async () => {
  for (const [path, label] of [['/', 'Dashboard'], ['/projects', 'Bibliothek'], ['/apps', 'App Store'], ['/ideas', 'Idea Hub'], ['/knowledge', 'Wissen'], ['/sync', 'Sync Center'], ['/conflicts', 'Konflikte'], ['/activity', 'Chronik'], ['/backups', 'Backups'], ['/settings', 'Einstellungen'], ['/settings?tab=integrations', 'Integrationen'], ['/code', 'Code Explorer']]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectAccessible(page, label);
  }
  const project = page.getByRole('link', { name: /E2E Raumschiff/ });
  await page.goto('/projects');
  await project.first().click();
  await page.waitForLoadState('networkidle');
  await expectAccessible(page, 'Projektraum');
});

test('light mode is a full theme, not an inversion', async () => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Hell', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(244, 245, 250)');
  await expectAccessible(page, 'Einstellungen (hell)');
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
});

test('keyboard: skip link, focus visible and dialog focus trap', async () => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); // wait until the app is rendered
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await expect(page.getByRole('dialog').getByLabel('Name')).toBeFocused();
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
