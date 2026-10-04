import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '../../packages/shared/src/config';
import { TigerStore } from '../../packages/db/src/index';
import { buildApp } from '../../apps/api/src/app';
import { launchSensorDesktop } from './helpers';

test('built desktop saves labeled mock measurements and epochs through the real API into Timescale and displays their timeline', async () => {
  test.skip(
    process.env.TRUEIRIS_TEST_DATABASE !== 'true',
    'Run pnpm test:persistence with a configured Timescale database.',
  );
  test.setTimeout(60_000);
  loadWorkspaceEnvironment();
  const env = parseEnvironment(process.env);
  if (!env.DATABASE_URL)
    throw new Error('Set DATABASE_URL for the explicit database check');
  const store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE);
  const userId = randomUUID();
  const token = randomUUID() + randomUUID();
  const api = buildApp('silent', { store, userId, token });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: url,
    TRUEIRIS_INGEST_TOKEN: token,
  });
  try {
    await expect.poll(() => store.health(), { timeout: 15_000 }).toBe(true);
    await page.getByLabel('CURRENT ACTIVITY').selectOption('Coding');
    await expect(page.getByLabel('CURRENT ACTIVITY')).toHaveValue('Coding');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(2);
    await page
      .getByRole('button', { name: 'Enable saving', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Start desktop context', exact: true })
      .click();
    await page.getByLabel('Sensor provider').selectOption('mock');
    await page
      .getByRole('button', { name: 'Start mock sensor', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            window.trueiris!.getStorage().then((s) => s.saved),
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () => (await store.exportContextPage(userId)).intervals.length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    const desktopContexts = await store.exportContextPage(userId);
    expect(
      desktopContexts.intervals.every(
        (i) =>
          i.source === 'mock' &&
          i.manualActivity === 'Coding' &&
          i.windowTitle === null,
      ),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Stop desktop context', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop saving', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop sensing', exact: true })
      .click();
    const rows = await store.exportPage(userId);
    expect(rows.measurements.length).toBeGreaterThan(0);
    expect(
      rows.measurements.every(
        (m) =>
          m.source === 'mock' &&
          m.activity === 'Coding' &&
          m.pulseRate !== undefined &&
          m.timestamp.endsWith('.000Z'),
      ),
    ).toBe(true);
    const result = await store.pool.query(
      'SELECT * FROM epochs WHERE user_id=$1',
      [userId],
    );
    expect(result.rowCount).toBeGreaterThan(0);
    expect(
      result.rows.reduce((sum, e) => sum + Number(e.measurement_count), 0),
    ).toBe(rows.measurements.length);
    expect(
      result.rows.every(
        (e) =>
          e.source === 'mock' &&
          e.pulse_count > 0 &&
          e.mean_pulse > 0 &&
          e.mean_respiration > 0 &&
          e.mean_hrv > 0 &&
          e.respiration_count > 0 &&
          e.hrv_count > 0 &&
          e.coverage > 0,
      ),
    ).toBe(true);
    await page.getByRole('link', { name: 'Timeline', exact: true }).click();
    await page.getByLabel('Display timezone').selectOption('UTC');
    await expect(
      page.getByRole('heading', {
        name: 'No saved live observations in this period.',
      }),
    ).toBeVisible();
    await page.getByLabel('History source').selectOption('mock');
    const chart = page.getByRole('application', {
      name: 'Today timeline chart',
    });
    await expect(chart).toBeVisible();
    await expect(
      page.getByTestId('desktop-context-band').first(),
    ).toBeVisible();
    await chart.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Selected period', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Period details' })
        .getByText('Coding', { exact: true }),
    ).toBeVisible();
    const timeline = await store.timeline(userId, {
      start: rows.measurements[0]!.timestamp,
      end: new Date(
        Date.parse(rows.measurements.at(-1)!.timestamp) + 1000,
      ).toISOString(),
      source: 'mock',
    });
    expect(timeline.summary.count).toBe(rows.measurements.length);
    expect(timeline.activities.every((p) => p.activity === 'Coding')).toBe(
      true,
    );
  } finally {
    await app.close();
    try {
      await store.deleteData(userId);
      await store.pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await api.close();
    }
  }
});
