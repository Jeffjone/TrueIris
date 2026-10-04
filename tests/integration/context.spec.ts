import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ContextInterval } from '../../packages/schemas/src';
import type { MeasurementStore } from '../../packages/db/src';
import { buildApp } from '../../apps/api/src/app';
import { launchSensorDesktop } from './helpers';
const empty = { count: 0, mean: null, min: null, max: null, confidence: null };

test('desktop context has independent consent, optional titles, manual override, focus, history/export/delete and reload cleanup', async () => {
  test.setTimeout(60_000);
  const intervals = new Map<string, ContextInterval>();
  const store: MeasurementStore = {
    baselines: async () => {
      throw new Error('Unavailable');
    },
    health: async () => true,
    ingest: async () => ({ accepted: 0, duplicates: 0 }),
    exportPage: async () => ({ measurements: [], next: null }),
    close: async () => {},
    ingestContext: async (_user, input) => {
      let accepted = 0;
      for (const i of input)
        if (!intervals.has(i.id)) {
          intervals.set(i.id, i);
          accepted++;
        }
      return { accepted, duplicates: input.length - accepted };
    },
    exportContextPage: async () => ({
      intervals: [...intervals.values()],
      next: null,
    }),
    deleteData: async () => {
      intervals.clear();
    },
    timeline: async (_user, range) => ({
      range,
      points: [],
      activities: [],
      gaps: [],
      summary: {
        count: 0,
        observedSeconds: 0,
        sessions: 0,
        pulse: empty,
        respiration: empty,
        hrv: empty,
      },
      limited: false,
      contexts: [...intervals.values()]
        .filter(
          (i) =>
            i.source === range.source &&
            i.start < range.end &&
            i.end > range.start,
        )
        .map((i) => ({
          ...i,
          start: i.start < range.start ? range.start : i.start,
          end: i.end > range.end ? range.end : i.end,
        })),
    }),
  };
  const token = randomUUID() + randomUUID();
  const server = buildApp('silent', { store, token, userId: randomUUID() });
  const url = await server.listen({ host: '127.0.0.1', port: 0 });
  const directory = await mkdtemp(join(tmpdir(), 'trueiris-context-test-'));
  const path = join(directory, 'context.jsonl');
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: url,
    TRUEIRIS_INGEST_TOKEN: token,
  });
  try {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.getByTestId('global-context-status')).toHaveText(
      'Desktop context off',
    );
    await expect(page.getByLabel('Include window titles')).not.toBeChecked();
    await page
      .getByRole('button', { name: 'Start desktop context', exact: true })
      .click();
    await expect(page.getByTestId('context-status')).toHaveText(
      'Mock desktop context on',
    );
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.trueiris!.getContext().then((s) => s.applicationSwitches),
        ),
      )
      .toBeGreaterThan(0);
    expect(intervals.size).toBe(0);
    expect(
      await page.evaluate(() =>
        window.trueiris!.getSensor().then((s) => s.phase),
      ),
    ).toBe('off');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('button', { name: 'Enable saving', exact: true })
      .click();
    const consent = Date.now();
    await expect
      .poll(() => intervals.size, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(
      [...intervals.values()].every(
        (i) =>
          i.source === 'mock' &&
          i.windowTitle === null &&
          Date.parse(i.start) >= consent - 100,
      ),
    ).toBe(true);
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await page.getByLabel('CURRENT ACTIVITY').selectOption('Studying');
    await page.getByLabel('Focus mode').check();
    await page.getByLabel('Include window titles').check();
    await expect
      .poll(
        () =>
          [...intervals.values()].some(
            (i) =>
              i.focusMode &&
              i.manualActivity === 'Studying' &&
              i.windowTitle === 'Mock window',
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page
      .getByRole('button', { name: 'Stop desktop context', exact: true })
      .click();
    await expect(page.getByTestId('global-context-status')).toHaveText(
      'Desktop context off',
    );
    await expect(page.getByLabel('Include window titles')).not.toBeChecked();
    await page.getByRole('link', { name: 'Timeline', exact: true }).click();
    await page.getByLabel('History source').selectOption('mock');
    await expect(
      page.getByTestId('desktop-context-band').first(),
    ).toBeVisible();
    await expect(
      page.getByText('No accepted pulse readings', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Inspect period', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Desktop observations', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Period details' }),
    ).toContainText('Selected by you');
    await page.screenshot({
      path: 'test-results/desktop-context-timeline.png',
      fullPage: true,
    });
    await page.getByRole('slider', { name: 'Period end' }).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page
      .getByRole('button', { name: 'Inspect period', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Period details' }),
    ).toContainText('No saved observations in the selected period.');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, path);
    await page
      .getByRole('button', { name: 'Export context', exact: true })
      .click();
    await expect(
      page.getByText('Export saved. Saving is now off.', { exact: true }),
    ).toBeVisible();
    const exported = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as ContextInterval);
    expect(exported.length).toBe(intervals.size);
    expect(exported.every((i) => i.source === 'mock')).toBe(true);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole('button', { name: 'Delete history', exact: true })
      .click();
    await expect.poll(() => intervals.size).toBe(0);
    await page
      .getByRole('button', { name: 'Start desktop context', exact: true })
      .click();
    await expect(page.getByTestId('context-status')).toHaveText(
      'Mock desktop context on',
    );
    await page.reload();
    await expect(page.getByTestId('global-context-status')).toHaveText(
      'Desktop context off',
    );
    await expect(page.getByLabel('Focus mode')).not.toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('native desktop worker reads foreground app without titles and stops on screen lock', async () => {
  test.skip(
    process.env.TRUEIRIS_TEST_NATIVE_CONTEXT !== 'true',
    'Explicit native check; use TRUEIRIS_TEST_NATIVE_CONTEXT=true on a supported desktop.',
  );
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_CONTEXT_PROVIDER: 'desktop',
  });
  try {
    await page
      .getByRole('button', { name: 'Start desktop context', exact: true })
      .click();
    await expect(page.getByTestId('context-status')).toHaveText(
      'Desktop context on',
    );
    const snapshot = await page.evaluate(() => window.trueiris!.getContext());
    expect(snapshot.application).not.toBeNull();
    expect(snapshot.windowTitle).toBeNull();
    expect(snapshot.storage.enabled).toBe(false);
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('lock-screen');
    });
    await expect(page.getByTestId('global-context-status')).toHaveText(
      'Desktop context off',
    );
    expect(
      await page.evaluate(() =>
        window.trueiris!.getContext().then((s) => s.application),
      ),
    ).toBeNull();
  } finally {
    await app.close();
  }
});
