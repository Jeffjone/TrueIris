import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { MemoryExperiments } from '../../packages/db/src/experiments';
import { buildApp } from '../../apps/api/src/app';
import { createReasoningFixture } from '../../apps/api/src/agents/fixtures';
import { launchSensorDesktop } from './helpers';
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
test('built experiments persist definitions and labeled sessions, distinguish results, reject overlap, pause, export and delete', async () => {
  const fixture = createReasoningFixture(),
    experiments = new MemoryExperiments(fixture.store),
    token = randomUUID() + randomUUID(),
    owner = randomUUID();
  const api = buildApp('silent', {
    ...fixture,
    experiments,
    token,
    userId: owner,
  });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: url,
    TRUEIRIS_INGEST_TOKEN: token,
  });
  const directory = await mkdtemp(join(tmpdir(), 'trueiris-experiments-')),
    path = join(directory, 'experiment.json');
  try {
    await page.getByRole('link', { name: 'Experiments', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Create experiment' }),
    ).toBeEnabled();
    await page.getByLabel('Experiment history source').selectOption('mock');
    await page.getByLabel('Experiment timezone').selectOption('UTC');
    await page
      .getByLabel('Pulse deviation from baseline', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Create experiment' }).click();
    const detail = page.getByRole('region', { name: 'Experiment detail' });
    await expect(detail).toContainText('Insufficient data');
    const end = Date.now() - 86400_000;
    for (let i = 0; i < 7; i++) {
      const start = new Date(end - (i + 1) * 86400_000),
        duration = i < 3 ? 10 : 20;
      await page
        .getByLabel('Session condition')
        .selectOption(i < 3 ? 'Music' : 'No Music');
      await page.getByLabel('Session start').fill(localInput(start));
      await page
        .getByLabel('Session end')
        .fill(localInput(new Date(start.getTime() + duration * 60000)));
      await page.getByLabel('Session focus rating').fill(i < 3 ? '5' : '2');
      await page.getByLabel('Session notes').fill('Synthetic session note');
      await detail.getByRole('button', { name: 'Save session' }).click();
      await expect(detail).toContainText(`${i + 1} / 7 recorded sessions`);
    }
    await expect(detail).toContainText('Meaningful observed difference');
    await expect(detail).toContainText('Insufficient data'); // Sparse physiology remains absent despite complete ratings/durations.
    await detail.getByRole('button', { name: 'Save session' }).click();
    await expect(detail).toContainText('7 / 7 recorded sessions');
    await page.getByLabel('Session condition').selectOption('Music');
    await detail.getByRole('button', { name: 'Save session' }).click();
    await expect(
      page.getByRole('status', { name: 'Experiment status' }),
    ).toContainText('conflicts');
    await detail.getByRole('button', { name: 'Pause experiment' }).click();
    await expect(
      detail.getByRole('button', { name: 'Save session' }),
    ).toBeDisabled();
    await detail.getByRole('button', { name: 'Resume experiment' }).click();
    await page.reload();
    await page
      .getByRole('region', { name: 'Your experiments' })
      .getByRole('button', { name: 'Music vs No Music', exact: true })
      .click();
    await expect(detail).toContainText('7 / 7 recorded sessions');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
    await detail.getByRole('button', { name: 'Export experiment' }).click();
    await expect(
      page.getByRole('status', { name: 'Experiment status' }),
    ).toContainText('Experiment exported');
    const exported = JSON.parse(await readFile(path, 'utf8'));
    expect(exported.sessions).toHaveLength(7);
    expect(exported.experiment.definition.source).toBe('mock');
    await detail.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/personal-experiments.png',
      fullPage: true,
    });
    await detail
      .getByText('Remove this session', { exact: true })
      .first()
      .click();
    await detail
      .getByRole('button', { name: 'Confirm remove session' })
      .first()
      .click();
    await expect(detail).toContainText('6 / 7 recorded sessions');
    await expect(detail).toContainText('Insufficient data');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(700, 600),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await detail
      .getByText('Delete this experiment and its sessions', { exact: true })
      .click();
    await detail
      .getByRole('button', { name: 'Confirm delete experiment' })
      .click();
    await expect(detail).toHaveCount(0);
    expect(await experiments.list(owner)).toHaveLength(0);
    expect(
      await page.evaluate(() =>
        window.trueiris!.getSensor().then((s) => s.phase),
      ),
    ).toBe('off');
  } finally {
    await app.close();
    await api.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('experiments show missing configuration without starting any capture', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await page.getByRole('link', { name: 'Experiments', exact: true }).click();
    await expect(
      page.getByRole('status', { name: 'Experiment status' }),
    ).toContainText('Connect saved history');
    expect(
      await page.evaluate(() =>
        window.trueiris!.getVoice().then((s) => s.phase),
      ),
    ).toBe('off');
  } finally {
    await app.close();
  }
});
