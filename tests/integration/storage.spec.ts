import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  measurementBatchSchema,
  type Measurement,
} from '../../packages/schemas/src/index';
import { launchSensorDesktop } from './helpers';

test('saving requires consent, recovers offline, and supports private export/deletion', async () => {
  test.setTimeout(60_000);
  const token = 'desktop-integration-only-token-32-chars';
  const observations = new Map<string, Measurement>();
  const attempts: Measurement[][] = [];
  let offline = true;
  let rejectedAuthorization = false;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health') {
      response.end(
        JSON.stringify({
          service: 'trueiris-api',
          status: 'ok',
          timestamp: new Date().toISOString(),
          integrations: {
            database: 'ready',
            reasoning: 'not_implemented',
            voice: 'not_implemented',
          },
        }),
      );
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      rejectedAuthorization = true;
      response.writeHead(401);
      response.end('{}');
      return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/data/export')) {
      response.end(
        JSON.stringify({
          measurements: [...observations.values()],
          next: null,
        }),
      );
      return;
    }
    if (request.method === 'DELETE' && request.url === '/data') {
      observations.clear();
      response.writeHead(204);
      response.end();
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      const batch = measurementBatchSchema.parse(JSON.parse(body));
      attempts.push(batch.measurements);
      if (offline) {
        response.writeHead(503);
        response.end('{}');
        return;
      }
      let accepted = 0;
      for (const m of batch.measurements)
        if (!observations.has(m.eventId)) {
          observations.set(m.eventId, m);
          accepted++;
        }
      response.end(
        JSON.stringify({
          accepted,
          duplicates: batch.measurements.length - accepted,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Server unavailable');
  const directory = await mkdtemp(join(tmpdir(), 'trueiris-export-test-'));
  const path = join(directory, 'history.jsonl');
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: `http://127.0.0.1:${address.port}`,
    TRUEIRIS_INGEST_TOKEN: token,
  });
  try {
    await expect(page.getByTestId('global-storage-status')).toHaveText(
      'Saving off',
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Start camera sensing', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Sensor provider').selectOption('mock');
    await page
      .getByRole('button', { name: 'Start mock sensor', exact: true })
      .click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.trueiris!.getSensor().then((s) => s.reading?.pulseRate),
        ),
      )
      .toBeGreaterThan(0);
    expect(attempts).toHaveLength(0);
    await page
      .getByRole('button', { name: 'Enable saving', exact: true })
      .click();
    await expect(page.getByTestId('global-storage-status')).toContainText(
      'Saving interrupted',
    );
    await expect.poll(() => attempts.length).toBeGreaterThan(1);
    expect(attempts[0]).toEqual(attempts[1]);
    offline = false;
    await expect
      .poll(() => observations.size, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(
      [...observations.values()].every(
        (m) => m.source === 'mock' && m.timestamp.endsWith('.000Z'),
      ),
    ).toBe(true);
    await expect(page.getByTestId('storage-counts')).not.toContainText(
      /^0 saved/,
    );
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await expect(page.getByTestId('global-storage-status')).toContainText(
      'Saving on',
    );
    expect(
      await page.evaluate(() => {
        const keys = Object.keys(window.trueiris!);
        return 'process' in window || JSON.stringify(keys).includes('token');
      }),
    ).toBe(false);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.screenshot({
      path: 'test-results/storage-settings.png',
      fullPage: true,
    });
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, path);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('button', { name: 'Export history', exact: true })
      .click();
    await expect(
      page.getByText('Export saved. Saving is now off.', { exact: true }),
    ).toBeVisible();
    const exported = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Measurement);
    expect(exported.length).toBe(observations.size);
    expect(exported[0]?.source).toBe('mock');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole('button', { name: 'Delete history', exact: true })
      .click();
    await expect(
      page.getByText('History deleted. Sensing and saving are now off.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(observations.size).toBe(0);
    expect(
      (await page.evaluate(() => window.trueiris!.getSensor())).phase,
    ).toBe('off');
    expect(rejectedAuthorization).toBe(false);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test('storage is unavailable without private configuration', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Enable saving', exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId('global-storage-status')).toHaveText(
      'Saving off',
    );
  } finally {
    await app.close();
  }
});

test('provider selection survives navigation and storage status refreshes before start', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Start camera sensing', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Sensor provider').selectOption('mock');
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await expect(page.getByLabel('Sensor provider')).toHaveValue('mock');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Sensor provider')).toHaveValue('mock');
    await page
      .getByRole('button', { name: 'Start mock sensor', exact: true })
      .click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.trueiris!.getSensor().then((s) => s.provider),
        ),
      )
      .toBe('mock');
  } finally {
    await app.close();
  }
});
