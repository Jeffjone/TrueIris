import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '../../packages/shared/src/config';
import { TigerStore } from '../../packages/db/src/index';
import { buildApp } from '../../apps/api/src/app';
import { MockReasoningProvider } from '../../apps/api/src/agents/provider';
import { launchSensorDesktop } from './helpers';
test('explicit demo works without database or camera credentials, labels fallback, and keeps diagnostics outside presentation', async () => {
  const { app, page } = await launchSensorDesktop(
    'steady',
    {
      TRUEIRIS_DEMO_MODE: 'true',
    },
    [],
    '/demo',
  );
  try {
    await expect(
      page.getByRole('heading', { name: 'A moment becomes a pattern.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Demo provenance' }),
    ).toContainText('Historical samples are generated');
    await expect(
      page.getByRole('complementary', { name: 'Demo provenance' }),
    ).toContainText('Connect the dedicated demo API');
    await expect(page.getByText('API connected', { exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() =>
        window.trueiris!.getSensor().then((s) => s.phase),
      ),
    ).toBe('off');
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await expect(page.getByLabel('Sensor provider')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Start live signal', exact: true })
      .click();
    await expect(page.getByTestId('capture-status')).toContainText(
      'Demo fallback',
    );
    await expect(page.getByTestId('pulse-value')).not.toContainText('—');
    const snapshot = await page.evaluate(() => window.trueiris!.getSensor());
    expect(snapshot.provider).toBe('mock');
    expect(snapshot.reading?.source).toBe('mock');
    expect(snapshot.fallbackIssue).toBe('missing_key');
    await page
      .getByRole('button', { name: 'Stop sensing', exact: true })
      .click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Connection status' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Demo diagnostics' }),
    ).toContainText('separate demo identity');
    expect(
      await page.evaluate(() =>
        window.trueiris!.getStorage().then((s) => s.enabled),
      ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});
test('built dedicated demo automatically prepares real Tiger history and presents source-separated live fallback, days, patterns, questions and experiments', async () => {
  test.skip(
    process.env.TRUEIRIS_TEST_DATABASE !== 'true',
    'Run pnpm test:demo for the isolated real Tiger demonstration.',
  );
  test.setTimeout(120_000);
  loadWorkspaceEnvironment();
  const env = parseEnvironment(process.env);
  if (!env.DATABASE_URL)
    throw new Error('Configure DATABASE_URL for the explicit demo check');
  const owner = randomUUID(),
    token = randomUUID() + randomUUID(),
    store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE);
  const api = buildApp('silent', {
    store,
    userId: owner,
    token,
    demoMode: true,
    reasoning: new MockReasoningProvider(),
  });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  let app: Awaited<ReturnType<typeof launchSensorDesktop>>['app'] | undefined;
  try {
    await expect
      .poll(async () => Boolean(await store.demo.get(owner)), {
        timeout: 25_000,
      })
      .toBe(true);
    const desktop = await launchSensorDesktop(
      'steady',
      {
        TRUEIRIS_DEMO_MODE: 'true',
        TRUEIRIS_API_URL: url,
        TRUEIRIS_INGEST_TOKEN: token,
      },
      [],
      '/demo',
    );
    app = desktop.app;
    const page = desktop.page;
    await expect(
      page.getByRole('region', { name: 'Sample week' }),
    ).toBeVisible();
    const dataset = (await store.demo.get(owner))!;
    await expect(
      page.getByRole('region', { name: 'Sample week' }),
    ).toContainText('33 sample periods');
    await page.screenshot({
      path: 'test-results/dedicated-demo-home.png',
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await page.getByLabel('CURRENT ACTIVITY').selectOption('Coding');
    await page
      .getByRole('button', { name: 'Start live signal', exact: true })
      .click();
    await expect(page.getByTestId('capture-status')).toContainText(
      'Demo fallback',
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('button', { name: 'Enable saving', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          Number(
            (
              await store.pool.query(
                "SELECT count(*)::int AS n FROM measurements WHERE user_id=$1 AND source='mock'",
                [owner],
              )
            ).rows[0].n,
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await expect(page.getByTestId('global-storage-status')).toContainText(
      'Saving current observations',
    );
    await page
      .getByRole('button', { name: 'Stop saving', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop sensing', exact: true })
      .click();
    await page.getByRole('link', { name: 'Timeline', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Sample history.' }),
    ).toBeVisible();
    await expect(page.getByLabel('History source')).toHaveCount(0);
    const earlier = dataset.episodes[0]!.range.start.slice(0, 10);
    await page.getByLabel('Sample day').fill(earlier);
    await expect(
      page.getByRole('region', { name: 'Saved history' }),
    ).toBeVisible();
    await expect(
      page.getByText('demo_seed · generated sample history · UTC', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Patterns', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: 'Coding and meeting periods differ in this sample',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('demo_seed · illustrative', { exact: true }),
    ).toHaveCount(2);
    await page.screenshot({
      path: 'test-results/dedicated-demo-patterns.png',
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Ask Iris', exact: true }).click();
    await expect(page.getByLabel('Iris history source')).toHaveCount(0);
    await page
      .getByRole('button', {
        name: 'Iris, explain the last 30 minutes.',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('region', { name: 'Iris answer' }),
    ).toContainText('demo_seed', { timeout: 25_000 });
    await expect(
      page.getByRole('region', { name: 'Explanation timeline' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Experiments', exact: true }).click();
    await page
      .getByRole('button', { name: 'Demo · Music vs No Music', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Experiment detail' }),
    ).toContainText('7 / 7 recorded sessions');
    await expect(
      page.getByRole('region', { name: 'Experiment detail' }),
    ).toContainText('Meaningful observed difference');
    await expect(
      page.getByText(
        'Demo experiment ratings and condition assignments are fictional. Designed differences illustrate the comparison rules; they are not personal findings.',
        { exact: true },
      ),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(700, 600),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await store.pool.query(
          "SELECT count(*)::int AS n FROM measurements WHERE user_id=$1 AND source='demo_seed'",
          [owner],
        )
      ).rows[0].n,
    ).toBe(dataset.measurementCount);
  } finally {
    await app?.close();
    await store.deleteData(owner);
    await store.pool.query('DELETE FROM users WHERE id=$1', [owner]);
    await api.close();
  }
});
