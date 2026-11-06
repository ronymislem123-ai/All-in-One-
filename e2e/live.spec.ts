import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });
let page: Page;
let bearer: Record<string, string>;
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SESSION = 'e2e/werkstatt';

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme: 'dark' });
  page = await context.newPage();
  await signIn(page);
  const t = await page.request.post('/api/tokens', { data: { name: 'e2e-live', scopes: ['ingest', 'read'] }, headers: { 'x-omega-csrf': '1' } });
  expect(t.status()).toBe(201);
  bearer = { authorization: `Bearer ${(await t.json()).token}` };
});
test.afterAll(async () => { await page.context().close(); });

const send = async (events: unknown[]) => {
  const r = await page.request.post(`/api/ingest/v1/live/sessions/${encodeURIComponent(SESSION)}/events`, { data: { schema: 'omega.live/v1', events }, headers: bearer });
  expect(r.status()).toBe(200);
  return (await r.json()) as { summary: { applied: number; rejected: number } };
};

test('werkstatt: empty state explains how to connect Claude', async () => {
  await page.goto('/live');
  await expect(page.getByRole('heading', { name: 'Noch keine Live-Sitzung' })).toBeVisible();
  await expect(page.getByText('omega_live_start').first()).toBeVisible();
  await expectAccessible(page, 'Werkstatt (leer)');
});

test('werkstatt: a streamed session shows progress, tasks, log, screenshots and updates live via SSE', async () => {
  const start = await page.request.post('/api/ingest/v1/live/sessions', {
    headers: bearer,
    data: {
      externalId: SESSION, title: 'E2E Raumschiff-App', goal: 'Live mitverfolgen', state: 'building', phase: 'Frontend', now: 'Cockpit-Ansicht wird gebaut',
      milestones: [{ key: 'design', label: 'Design', progress: 100 }, { key: 'frontend', label: 'Frontend', progress: 50 }, { key: 'backend', label: 'Backend' }],
      tasks: [{ key: 't1', title: 'Datenmodell', status: 'done' }, { key: 't2', title: 'Cockpit-Ansicht', status: 'doing' }, { key: 't3', title: 'Tests' }],
    },
  });
  expect(start.status()).toBe(201);
  const r = await send([
    { eventId: 'r1', kind: 'research', title: 'Bestehende Komponenten gesichtet', body: 'Design-Tokens und `Card` werden wiederverwendet.' },
    { eventId: 'd1', kind: 'decision', title: 'SSE statt WebSocket', body: 'Weniger Abhängigkeiten.' },
    { eventId: 's1', kind: 'screenshot', title: 'Erstes Cockpit', image: { mime: 'image/png', base64: PNG_1x1, caption: 'Rohfassung' } },
    { eventId: 'p1', kind: 'preview', title: 'Dev-Server läuft', preview: { url: 'http://127.0.0.1:5173/', note: 'Vite' } },
  ]);
  expect(r.summary).toMatchObject({ applied: 4, rejected: 0 });

  await page.goto('/live');
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Raumschiff-App' })).toBeVisible();
  await expect(page.getByText('Cockpit-Ansicht wird gebaut')).toBeVisible();
  await expect(page.getByText('live verbunden')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('progressbar', { name: 'Design: 100 %' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Gesamtfortschritt 50 von 100' })).toBeVisible(); // (100 + 50 + 0) / 3
  await expect(page.getByText('Cockpit-Ansicht', { exact: true })).toBeVisible();
  await expect(page.getByText('jetzt', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Erstes Cockpit' }).first()).toBeVisible();
  await expect(page.getByText('http://127.0.0.1:5173/').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Werkstatt' })).toContainText('live');

  // filter the log
  await page.getByRole('button', { name: 'Entscheidung', exact: true }).click();
  await expect(page.getByText('SSE statt WebSocket')).toBeVisible();
  await expect(page.getByText('Bestehende Komponenten gesichtet')).toBeHidden();
  await page.getByRole('button', { name: 'Alles', exact: true }).click();
  await expectAccessible(page, 'Werkstatt');

  // a new event arrives without reloading the page
  await send([{ eventId: 'b1', kind: 'build', title: 'Cockpit-Komponente geschrieben' }, { eventId: 'm1', kind: 'milestone', title: 'Frontend fertig', milestone: { key: 'frontend', progress: 100 } }]);
  await expect(page.getByText('Cockpit-Komponente geschrieben')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('progressbar', { name: 'Frontend: 100 %' })).toBeVisible({ timeout: 10_000 });

  // lightbox
  await page.getByRole('img', { name: 'Erstes Cockpit' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Erstes Cockpit' })).toBeVisible();
  await page.keyboard.press('Escape');

  // finishing from the UI
  await page.getByRole('button', { name: 'Abschließen' }).click();
  await expect(page.getByText('Abgeschlossen', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Werkstatt' })).not.toContainText('live');
});
