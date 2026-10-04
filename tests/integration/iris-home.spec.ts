import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app';
import { createReasoningFixture } from '../../apps/api/src/agents/fixtures';
import { MockReasoningProvider } from '../../apps/api/src/agents/provider';
import { MockVoiceProvider } from '../../apps/api/src/voice/provider';
import { launchSensorDesktop } from './helpers';

test('Iris home has symmetrical faceless navigation, immediate voice, explicit recording, keyboard recovery and small-screen layout', async () => {
  const { app, page } = await launchSensorDesktop('steady', {}, [], '/');
  try {
    await expect(
      page.getByRole('heading', { name: 'Hi, I’m Iris' }),
    ).toBeVisible();
    const orbit = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(orbit.getByRole('link')).toHaveCount(6);
    await expect(orbit.locator('.iris-eye')).toHaveCount(0);
    await expect(page.locator('.iris-eye')).toHaveCount(2);
    const initial = await page.evaluate(async () => ({
      voice: await window.trueiris!.getVoice(),
      context: await window.trueiris!.getContext(),
      sensor: await window.trueiris!.getSensor(),
      storage: await window.trueiris!.getStorage(),
    }));
    expect(initial.voice.phase).toBe('off');
    expect(initial.context.phase).toBe('off');
    expect(initial.sensor.phase).toBe('off');
    expect(initial.storage.enabled).toBe(false);
    await page.screenshot({
      path: 'test-results/iris-home.png',
      fullPage: true,
    });
    const iris = page.getByRole('button', {
      name: 'Talk to Iris',
      exact: true,
    });
    await iris.focus();
    await page.keyboard.press('Enter');
    await expect(orbit).toBeHidden();
    await expect(page.getByRole('alert')).toContainText('Voice needs');
    await expect(page.getByLabel('Prefer a little note?')).toBeVisible();
    await page.screenshot({
      path: 'test-results/iris-focused.png',
      fullPage: true,
    });
    await iris.focus();
    await page.keyboard.press('Escape');
    await expect(orbit).toBeVisible();
    await page
      .getByRole('button', { name: 'Record my activity', exact: true })
      .click();
    await expect(
      page.getByLabel('Save this activity to history'),
    ).not.toBeChecked();
    await page
      .getByRole('button', { name: 'Start activity recording', exact: true })
      .click();
    await expect(orbit).toBeHidden();
    await expect(
      page.getByRole('button', {
        name: 'Stop activity recording',
        exact: true,
      }),
    ).toBeVisible();
    const captured = await page.evaluate(async () => ({
      context: await window.trueiris!.getContext(),
      sensor: await window.trueiris!.getSensor(),
      storage: await window.trueiris!.getStorage(),
    }));
    expect(captured.context.phase).toBe('running');
    expect(captured.context.provider).toBe('mock');
    expect(captured.context.options.windowTitles).toBe(false);
    expect(captured.sensor.phase).toBe('off');
    expect(captured.storage.enabled).toBe(false);
    await page.getByLabel('Activity to record').selectOption('Reading');
    await page
      .getByRole('button', { name: 'Stop activity recording', exact: true })
      .click();
    await expect(orbit).toBeVisible();
    expect(
      (await page.evaluate(() => window.trueiris!.getContext())).phase,
    ).toBe('off');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page
        .locator('.iris-character')
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    for (const width of [700, 400, 320]) {
      await app.evaluate(({ BrowserWindow }, w) => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.setMinimumSize(320, 400);
        window?.setSize(w, 700);
      }, width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: 'test-results/iris-compact.png',
      fullPage: true,
    });
    await orbit.getByRole('link', { name: 'Timeline', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Today’s timeline.' }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'TrueIris home', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Hi, I’m Iris' }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test('clicking Iris runs the existing voice pipeline with transcripts, cited answers and explicit activity saving', async () => {
  const fixture = createReasoningFixture();
  const token = randomUUID() + randomUUID();
  const api = buildApp('silent', {
    ...fixture,
    token,
    userId: randomUUID(),
    voice: new MockVoiceProvider(),
    reasoning: new MockReasoningProvider(),
  });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const { app, page } = await launchSensorDesktop(
    'steady',
    { TRUEIRIS_API_URL: url, TRUEIRIS_INGEST_TOKEN: token },
    ['--use-fake-device-for-media-stream'],
    '/',
  );
  try {
    await page
      .getByRole('button', { name: 'Talk to Iris', exact: true })
      .click();
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeHidden();
    await expect(page.getByLabel('Partial transcript')).toContainText('Iris');
    await expect(page.getByLabel('Final transcript')).toContainText(
      'last thirty minutes',
    );
    await expect(
      page.getByRole('region', { name: 'Iris answer' }),
    ).toContainText('Supporting evidence', { timeout: 15000 });
    await page
      .getByRole('button', {
        name: 'Done for now · show my views',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeVisible();
    expect((await page.evaluate(() => window.trueiris!.getVoice())).phase).toBe(
      'off',
    );
    await page
      .getByRole('button', { name: 'Record my activity', exact: true })
      .click();
    await page.getByLabel('Save this activity to history').check();
    await page
      .getByRole('button', { name: 'Start activity recording', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Stop activity recording',
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.trueiris!.getStorage())).enabled,
    ).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Talk with Iris', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Talk with Iris', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Talk to Iris', exact: true })
      .click();
    await expect(page.getByLabel('Final transcript')).toContainText(
      'last thirty minutes',
    );
    expect(
      (await page.evaluate(() => window.trueiris!.getContext())).phase,
    ).toBe('running');
    await page
      .getByRole('button', {
        name: 'Done for now · show my views',
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.trueiris!.getStorage())).enabled,
      )
      .toBe(false);
    expect(
      (await page.evaluate(() => window.trueiris!.getContext())).phase,
    ).toBe('off');
  } finally {
    await app.close();
    await api.close();
  }
});
