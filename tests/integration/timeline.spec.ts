import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { MeasurementStore } from '../../packages/db/src/index';
import { buildApp } from '../../apps/api/src/app';
import type { TimelineData, TimelineQuery } from '../../packages/schemas/src';
import { launchSensorDesktop } from './helpers';

const empty = { count: 0, mean: null, min: null, max: null, confidence: null };
function fixture(query: TimelineQuery, now: number): TimelineData {
  const start = Date.parse(query.start),
    end = Date.parse(query.end);
  const day = new Date(now).setUTCHours(0, 0, 0, 0);
  const base = Math.floor((day + (now - day) * 0.25) / 30_000) * 30_000;
  const sessionId = '00000000-0000-4000-8000-000000000005';
  const iso = (time: number) => new Date(time).toISOString();
  const stats = (mean: number) => ({
    count: 30,
    mean,
    min: mean - 2,
    max: mean + 2,
    confidence: 0.9,
  });
  const points = [0, 30, 90, 120]
    .map((second, i) => ({
      start: iso(base + second * 1000),
      end: iso(base + (second + 30) * 1000),
      first: iso(base + second * 1000),
      last: iso(base + (second + 29) * 1000),
      sessionId,
      count: 30,
      pulse: stats(72 + i),
      respiration: stats(17 + i),
      hrv: i === 2 ? empty : stats(35 + i),
    }))
    .filter(
      (p) =>
        query.source === 'mock' &&
        Date.parse(p.start) >= start &&
        Date.parse(p.start) < end,
    );
  const active = points.length > 0;
  const summaryMetric = (key: 'pulse' | 'respiration' | 'hrv') => {
    const rows = points.map((p) => p[key]).filter((s) => s.count > 0);
    const count = rows.reduce((sum, s) => sum + s.count, 0);
    if (!count) return empty;
    return {
      count,
      mean: rows.reduce((sum, s) => sum + s.mean! * s.count, 0) / count,
      min: Math.min(...rows.map((s) => s.min!)),
      max: Math.max(...rows.map((s) => s.max!)),
      confidence:
        rows.reduce((sum, s) => sum + s.confidence! * s.count, 0) / count,
    };
  };

  return {
    range: query,
    points,
    activities: active
      ? [
          {
            start: iso(Math.max(start, base)),
            end: iso(Math.min(end, base + 30_000)),
            sessionId,
            activity: 'Coding' as const,
          },
          ...(end > base + 30_000 && start < base + 60_000
            ? [
                {
                  start: iso(Math.max(start, base + 30_000)),
                  end: iso(Math.min(end, base + 60_000)),
                  sessionId,
                  activity: 'Break' as const,
                },
              ]
            : []),
          ...(end > base + 90_000
            ? [
                {
                  start: iso(Math.max(start, base + 90_000)),
                  end: iso(Math.min(end, base + 150_000)),
                  sessionId,
                  activity: 'Studying' as const,
                },
              ]
            : []),
        ].filter((p) => Date.parse(p.end) > Date.parse(p.start))
      : [],
    gaps:
      active && start < base + 90_000 && end > base + 60_000
        ? [
            {
              start: iso(Math.max(start, base + 60_000)),
              end: iso(Math.min(end, base + 90_000)),
              sessionId,
              kind: 'missing',
            },
          ]
        : [],
    summary: {
      count: points.length * 30,
      observedSeconds: points.length * 30,
      sessions: active ? 1 : 0,
      pulse: summaryMetric('pulse'),
      respiration: summaryMetric('respiration'),
      hrv: summaryMetric('hrv'),
    },
    limited: false,
  };
}

test('built timeline separates sources, selects points and periods, zooms, shows gaps and recovers from errors', async () => {
  let mode: 'ready' | 'offline' | 'limited' | 'malformed' = 'ready';
  const requests: TimelineQuery[] = [];
  const fixtureNow = Date.now();
  const store: MeasurementStore = {
    health: async () => true,
    ingestContext: async () => ({ accepted: 0, duplicates: 0 }),
    exportContextPage: async () => ({ intervals: [], next: null }),
    ingest: async () => ({ accepted: 0, duplicates: 0 }),
    exportPage: async () => ({ measurements: [], next: null }),
    deleteData: async () => {},
    close: async () => {},
    timeline: async (_userId, query) => {
      requests.push(query);
      if (mode === 'offline') throw new Error('private connection details');
      const data = fixture(query, fixtureNow);
      if (mode === 'limited') data.limited = true;
      if (mode === 'malformed')
        return { ...data, private: 'invalid' } as TimelineData;
      return data;
    },
  };
  // Each test owns its local token; no developer key or history is accessed.
  const token = randomUUID() + randomUUID();
  const server = buildApp('silent', { store, token, userId: randomUUID() });
  const url = await server.listen({ host: '127.0.0.1', port: 0 });
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: url,
    TRUEIRIS_INGEST_TOKEN: token,
  });
  try {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
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
    await page.getByLabel('Display timezone').selectOption('Asia/Tokyo');
    await expect(page.getByLabel('History source')).toHaveValue('mock');
    await page.getByLabel('Display timezone').selectOption('UTC');
    await expect(page.getByLabel('History source')).toHaveValue('mock');
    await expect(chart).toBeVisible();

    await expect(page.getByTestId('activity-band')).toHaveCount(3);
    await expect(page.getByTestId('context-change')).toHaveCount(1);
    await expect(page.getByTestId('signal-gap')).toHaveCount(1);
    await expect(page.getByTestId('pulse-segment')).toHaveCount(2);
    await chart.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Selected period', exact: true }),
    ).toBeVisible();
    const details = page.getByRole('region', { name: 'Period details' });
    await expect(details.getByText('Coding', { exact: true })).toBeVisible();
    await expect(
      details.getByText('Desktop observations appear separately below.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      details.getByText('30 saved readings', { exact: false }),
    ).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(details.getByText('Break', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Zoom to period' }).click();
    await expect(
      page.getByRole('heading', { name: 'A closer view.' }),
    ).toBeVisible();
    const bounds = await chart.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(
      bounds!.x + bounds!.width * 0.35,
      bounds!.y + bounds!.height * 0.3,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds!.x + bounds!.width * 0.85,
      bounds!.y + bounds!.height * 0.3,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(
      page.getByRole('heading', { name: 'Selected period', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Reset to Today' }).click();
    await page.getByRole('button', { name: 'Inspect period' }).click();
    await expect(
      details.getByText('No saved signal', { exact: true }),
    ).toBeVisible();
    await page.locator('main').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: 'test-results/timeline-mock.png',
      fullPage: true,
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(700, 600),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/timeline-compact.png' });
    await expect
      .poll(() =>
        chart
          .locator('text')
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBeGreaterThanOrEqual(10);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(350, 500);
      window.setSize(390, 700);
    });
    await expect
      .poll(() =>
        chart.evaluate((el) =>
          Number(el.getAttribute('viewBox')!.split(' ')[2]),
        ),
      )
      .toBeLessThan(400);
    await expect
      .poll(() =>
        chart
          .locator('text')
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBeGreaterThanOrEqual(10);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const ticks = await chart
      .locator('.timeline-tick-label')
      .evaluateAll((elements) =>
        elements.map((el) => {
          const b = el.getBoundingClientRect();
          return { x: b.x, right: b.right };
        }),
      );
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(
      ticks.every(
        (tick, index) => index === 0 || ticks[index - 1]!.right <= tick.x,
      ),
    ).toBe(true);
    await chart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/timeline-narrow.png' });
    mode = 'limited';
    await page.getByRole('button', { name: 'Refresh history' }).click();
    await expect(
      page.getByText('Display limit reached. This chart is partial;', {
        exact: false,
      }),
    ).toBeVisible();
    mode = 'offline';
    await page.getByRole('button', { name: 'Refresh history' }).click();
    await expect(
      page
        .getByRole('heading', { name: 'Saved history is unavailable.' })
        .first(),
    ).toBeVisible();
    await expect(chart).toHaveCount(0);
    mode = 'ready';
    await page.getByRole('button', { name: 'Refresh history' }).click();
    await expect(chart).toBeVisible();
    await page.getByLabel('History source').selectOption('demo_seed');
    await expect(
      page.getByRole('heading', {
        name: 'No saved demo seed observations in this period.',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Selected period' }),
    ).toHaveCount(0);
    await page.getByLabel('History source').selectOption('mock');
    await expect(chart).toBeVisible();
    mode = 'malformed';
    await page.getByRole('button', { name: 'Refresh history' }).click();
    await expect(
      page.getByRole('heading', { name: 'Saved history is unavailable.' }),
    ).toBeVisible();
    expect(
      requests.some((q) => Date.parse(q.end) - Date.parse(q.start) <= 30_000),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await server.close();
  }
});

test('timeline configuration state and manual activity clear on reload', async () => {
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: 'http://127.0.0.1:1',
  });
  try {
    await page.getByLabel('CURRENT ACTIVITY').selectOption('Coding');
    await expect(page.getByLabel('CURRENT ACTIVITY')).toHaveValue('Coding');
    await page.getByRole('link', { name: 'Timeline', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Connect your saved history.' }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await expect(page.getByLabel('CURRENT ACTIVITY')).toHaveValue('');
  } finally {
    await app.close();
  }
});
