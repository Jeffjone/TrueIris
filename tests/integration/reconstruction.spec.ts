import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app';
import { createReasoningFixture } from '../../apps/api/src/agents/fixtures';
import {
  MockReasoningProvider,
  type ReasoningProvider,
} from '../../apps/api/src/agents/provider';
import { launchSensorDesktop } from './helpers';
test('timeline selection reconstructs scoped recorded events, cites a narrative, cancels and clears on source changes', async () => {
  const fixture = createReasoningFixture(),
    mock = new MockReasoningProvider();
  let stalled = false;
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (c, s) => (stalled ? new Promise(() => {}) : mock.next(c, s)),
  };
  const token = randomUUID() + randomUUID(),
    api = buildApp('silent', {
      ...fixture,
      token,
      userId: randomUUID(),
      reasoning: provider,
    });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const { app, page } = await launchSensorDesktop('steady', {
    TRUEIRIS_API_URL: url,
    TRUEIRIS_INGEST_TOKEN: token,
  });
  try {
    await page.getByRole('link', { name: 'Timeline', exact: true }).click();
    await page.getByLabel('Display timezone').selectOption('UTC');
    await page.getByLabel('History source').selectOption('mock');
    await page
      .getByRole('button', { name: 'Inspect period', exact: true })
      .click();
    const reconstruction = page.getByRole('region', {
      name: 'Event reconstruction',
    });
    await reconstruction
      .getByRole('button', { name: 'What happened here?', exact: true })
      .click();
    await expect(
      reconstruction.getByRole('heading', { name: 'Recorded sequence' }),
    ).toBeVisible();
    await expect(reconstruction).toContainText('Visual Studio Code');
    await expect(reconstruction).toContainText('Unrecorded time');
    await expect(reconstruction).not.toContainText('PRIVATE TITLE');
    await expect(
      reconstruction.getByRole('link', {
        name: 'Evidence for e1.f1',
        exact: true,
      }),
    ).toBeVisible();
    await reconstruction.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/event-reconstruction.png',
      fullPage: true,
    });
    stalled = true;
    await reconstruction
      .getByRole('button', { name: 'What happened here?', exact: true })
      .click();
    await reconstruction
      .getByRole('button', { name: 'Cancel reconstruction' })
      .click();
    await expect(
      reconstruction.getByRole('button', {
        name: 'What happened here?',
        exact: true,
      }),
    ).toBeEnabled();
    await page.getByLabel('History source').selectOption('live');
    await expect(page.getByRole('region', { name: 'Iris answer' })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() =>
        window.trueiris!.getSensor().then((s) => s.phase),
      ),
    ).toBe('off');
  } finally {
    await app.close();
    await api.close();
  }
});
