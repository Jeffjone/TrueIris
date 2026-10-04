import { _electron as electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const executablePath = require('electron') as string;
const launchEnvironment = { ...process.env };
// Editor-hosted terminals may force Electron to act as Node.
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

for (const connected of [true, false]) {
  test(`production desktop works with API ${connected ? 'connected' : 'offline'}`, async () => {
    const application = await electron.launch({
      executablePath,
      args: [resolve('apps/desktop')],
      env: {
        ...launchEnvironment,
        TRUEIRIS_API_URL: connected
          ? 'http://127.0.0.1:3099'
          : 'http://127.0.0.1:1',
        TRUEIRIS_DEMO_MODE: 'false',
        LOG_LEVEL: 'silent',
        PRESAGE_API_KEY: '',
        ELEVENLABS_API_KEY: '',
        ELEVENLABS_VOICE_ID: '',
        TRUEIRIS_INGEST_TOKEN: '',
        DATABASE_URL: '',
        TRUEIRIS_SENSOR_PROVIDER: 'presage',
        ELECTRON_RENDERER_URL: '',
      },
    });
    try {
      const page = await application.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await expect(
        page.getByRole('heading', { name: 'Your state, in context.' }),
      ).toBeVisible();
      await expect(page.getByRole('status')).toHaveText(
        connected ? 'API connected' : 'API unavailable',
      );
      const isolation = await page.evaluate(() => ({
        bridgeKeys: Object.keys(window.trueiris ?? {}),
        hasRequire: 'require' in window,
        hasProcess: 'process' in window,
      }));
      expect(isolation).toEqual({
        bridgeKeys: [
          'getDemo',
          'prepareDemo',
          'experimentAction',
          'exportExperiment',
          'getVoice',
          'startVoice',
          'stopVoice',
          'sendVoiceAudio',
          'finishVoice',
          'onVoice',
          'reconstructEvents',
          'askIris',
          'cancelIris',
          'getStatus',
          'getStorage',
          'setStorageEnabled',
          'exportData',
          'deleteData',
          'getBaselines',
          'getTimeline',
          'setActivity',
          'getContext',
          'startContext',
          'stopContext',
          'setContextOptions',
          'onContext',
          'exportContext',
          'getSensor',
          'startSensor',
          'stopSensor',
          'onSensor',
        ],
        hasRequire: false,
        hasProcess: false,
      });
      if (connected)
        await page.screenshot({ path: 'test-results/foundation-desktop.png' });
      await page.evaluate(() => {
        window.open('about:blank');
      });
      expect(
        await application.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      ).toBe(1);
      for (const label of [
        'Timeline',
        'Patterns',
        'Ask Iris',
        'Experiments',
        'Settings',
        'Live',
      ]) {
        await page.getByRole('link', { name: label, exact: true }).click();
        await expect(page.locator('main h1')).toBeVisible();
      }
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(700, 600);
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      const statusBounds = await page.getByRole('status').boundingBox();
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      expect(statusBounds).not.toBeNull();
      expect(
        (statusBounds?.y ?? viewportHeight) + (statusBounds?.height ?? 0),
      ).toBeLessThanOrEqual(viewportHeight);
      if (connected)
        await page.screenshot({ path: 'test-results/foundation-compact.png' });
    } finally {
      await application.close();
    }
  });
}
