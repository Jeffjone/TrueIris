import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app';
import { createReasoningFixture } from '../../apps/api/src/agents/fixtures';
import {
  MockReasoningProvider,
  type ReasoningProvider,
} from '../../apps/api/src/agents/provider';
import { MockVoiceProvider } from '../../apps/api/src/voice/provider';
import { launchSensorDesktop } from './helpers';

test('built voice captures only after opt-in, displays transcripts, reasons and streams speech with interruption and text fallback', async () => {
  const fixture = createReasoningFixture(),
    token = randomUUID() + randomUUID();
  const mock = new MockReasoningProvider();
  let stall = true,
    reasoningSignal: AbortSignal | undefined;
  const reasoning: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (contents, signal) => {
      reasoningSignal = signal;
      return stall ? new Promise(() => {}) : mock.next(contents, signal);
    },
  };
  const api = buildApp('silent', {
    ...fixture,
    token,
    userId: randomUUID(),
    voice: new MockVoiceProvider(),
    reasoning,
  });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const { app, page } = await launchSensorDesktop(
    'steady',
    { TRUEIRIS_API_URL: url, TRUEIRIS_INGEST_TOKEN: token },
    ['--use-fake-device-for-media-stream'],
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.getByRole('link', { name: 'Ask Iris', exact: true }).click();
    await page.getByLabel('Iris history source').selectOption('mock');
    await page.getByLabel('Iris timezone').selectOption('UTC');
    const voice = page.getByRole('region', { name: 'Voice conversation' });
    await expect(voice).toContainText('Microphone off');
    expect(
      await page.evaluate(async () => {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
          return 'allowed';
        } catch {
          return 'denied';
        }
      }),
    ).toBe('denied');
    await voice
      .getByRole('button', { name: 'Start voice', exact: true })
      .click();
    await expect(voice.getByLabel('Partial transcript')).toContainText('Iris');
    expect(
      await page.evaluate(async () => {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach((t) => t.stop());
          return 'allowed';
        } catch {
          return 'denied';
        }
      }),
    ).toBe('denied');
    await expect(voice.getByLabel('Final transcript')).toHaveText(
      'Iris, explain the last thirty minutes.',
    );
    await expect(voice).toContainText(
      'Analyzing your question and retrieving evidence',
    );
    await voice
      .getByRole('button', { name: 'Stop voice', exact: true })
      .click();
    await expect.poll(() => reasoningSignal?.aborted).toBe(true);
    await expect(voice).toContainText('Microphone off');
    stall = false;
    await voice
      .getByRole('button', { name: 'Start voice', exact: true })
      .click();
    await expect(voice).toContainText('Iris is speaking');
    const answer = page.getByRole('region', { name: 'Iris answer' });
    await expect(answer).toContainText('12.5% above');
    await expect(
      answer.getByRole('application', { name: 'Explanation timeline chart' }),
    ).toBeVisible();
    await page.screenshot({
      path: 'test-results/voice-speaking.png',
      fullPage: true,
    });
    // The transport can finish while PCM is still queued: main must cancel that tail on lock.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.trueiris!.getVoice().then((s) => s.sessionId),
        ),
      )
      .toBe(null);
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
    await expect(voice).toContainText('Microphone off');
    await expect(answer).toContainText('12.5% above');
    await voice
      .getByRole('button', { name: 'Start voice', exact: true })
      .click();
    await expect(voice).toContainText('Iris is speaking');
    await voice.getByRole('button', { name: 'Interrupt and ask' }).click();
    await expect(voice).toContainText('Listening');
    await voice.getByRole('button', { name: 'Finish question' }).click();
    await expect(voice).toContainText('Iris is speaking');
    await expect(voice).toContainText('Microphone off', { timeout: 10000 });
    await expect(page.getByLabel('Your question')).toHaveValue(
      'Iris, explain the last 30 minutes.',
    );
    await page
      .getByLabel('Your question')
      .fill('When was my pulse lowest today?');
    await page.getByRole('button', { name: 'Ask Iris', exact: true }).click();
    await expect(answer).toContainText('The lowest accepted pulse');
    await voice
      .getByRole('button', { name: 'Start voice', exact: true })
      .click();
    await expect(voice).toContainText('Listening');
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.trueiris!.getVoice().then((s) => s.phase)),
      )
      .toBe('off');
    await page.getByRole('link', { name: 'Ask Iris', exact: true }).click();
    await expect(page.getByLabel('Your question')).toHaveValue('');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(700, 600),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await api.close();
  }
});
test('missing voice configuration leaves microphone off and typed questions usable', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await page.getByRole('link', { name: 'Ask Iris', exact: true }).click();
    await page
      .getByRole('button', { name: 'Start voice', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'Voice needs ElevenLabs and Gemini configuration',
    );
    await expect(page.getByLabel('Your question')).toBeEnabled();
    expect(
      await page.evaluate(() =>
        window.trueiris!.getVoice().then((s) => s.phase),
      ),
    ).toBe('error');
  } finally {
    await app.close();
  }
});
