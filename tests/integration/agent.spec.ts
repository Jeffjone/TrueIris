import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app';
import { createReasoningFixture } from '../../apps/api/src/agents/fixtures';
import {
  MockReasoningProvider,
  type ReasoningProvider,
} from '../../apps/api/src/agents/provider';
import { launchSensorDesktop } from './helpers';

test('built Ask Iris retrieves scoped cited evidence, switches source, cancels and clears on navigation', async () => {
  const { store, scopes } = createReasoningFixture();
  const mock = new MockReasoningProvider();
  let stalled = false;
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (contents, signal) =>
      stalled ? new Promise(() => {}) : mock.next(contents, signal),
  };
  const token = randomUUID() + randomUUID(),
    userId = randomUUID();
  const api = buildApp('silent', { store, token, userId, reasoning: provider });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: url,
    TRUEIRIS_INGEST_TOKEN: token,
  });
  try {
    await page.getByRole('link', { name: 'Ask Iris', exact: true }).click();
    await page.getByLabel('Iris history source').selectOption('mock');
    await page.getByLabel('Iris timezone').selectOption('UTC');
    await page
      .getByLabel('Your question')
      .fill(
        'When was my pulse lowest today? Compare it with my usual coding baseline.',
      );
    await page.getByRole('button', { name: 'Ask Iris', exact: true }).click();
    const answer = page.getByRole('region', { name: 'Iris answer' });
    await expect(answer).toContainText('MOCK REASONING');
    await expect(answer).toContainText('12.5% above');
    await expect(
      answer.getByRole('link', { name: 'Evidence for e1.f1', exact: true }),
    ).toBeVisible();
    await expect(answer).not.toContainText('PRIVATE TITLE');
    expect(
      scopes.every((s) => s.userId === userId && s.range.source === 'mock'),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        window.trueiris!.getSensor().then((s) => s.phase),
      ),
    ).toBe('off');
    await page.screenshot({
      path: 'test-results/ask-iris-evidence.png',
      fullPage: true,
    });
    await page.getByLabel('Iris history source').selectOption('live');
    await expect(answer).toHaveCount(0);
    await page
      .getByLabel('Your question')
      .fill('When was my pulse lowest today?');
    await page.getByRole('button', { name: 'Ask Iris', exact: true }).click();
    await expect(answer).toContainText('No accepted pulse readings');
    await expect(answer).not.toContainText('76.5 bpm');
    stalled = true;
    await page.getByRole('button', { name: 'Ask Iris', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Cancel request' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel request' }).click();
    await expect(answer).toHaveCount(0);
    stalled = false;
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await page.getByRole('link', { name: 'Ask Iris', exact: true }).click();
    await expect(page.getByLabel('Your question')).toHaveValue('');
    await expect(answer).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(700, 600),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await api.close();
  }
});

test('Ask Iris reports configuration failures without activating sensing', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await page.getByRole('link', { name: 'Ask Iris', exact: true }).click();
    await page.getByLabel('Your question').fill('How am I doing?');
    await page.getByRole('button', { name: 'Ask Iris', exact: true }).click();
    await expect(
      page.getByText(
        'Connect Gemini and saved history in Settings to ask Iris.',
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.trueiris!.getSensor().then((s) => s.phase),
      ),
    ).toBe('off');
  } finally {
    await app.close();
  }
});
