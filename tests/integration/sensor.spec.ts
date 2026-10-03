import { expect, test } from '@playwright/test';
import { launchSensorDesktop as launch } from './helpers';
import { resolve } from 'node:path';
test('explicit mock stream updates UI, survives routing, and stops on reload', async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByTestId('capture-status')).toHaveText(
      'Sensing is off',
    );
    await page
      .getByRole('combobox', { name: 'Sensor provider' })
      .selectOption('mock');
    await page.getByRole('button', { name: 'Start mock sensor' }).click();
    await expect(page.getByTestId('pulse-value')).toHaveText(/7[2-6]BPM/);
    await expect(page.getByTestId('capture-status')).toHaveText(
      'Mock sensor · no camera',
    );
    const state = await page.evaluate(() => window.trueiris?.getSensor());
    expect(state?.reading?.source).toBe('mock');
    await page.getByRole('link', { name: 'Timeline', exact: true }).click();
    await expect(page.getByTestId('global-capture-status')).toHaveText(
      'Mock sensor · no camera',
    );
    await expect(
      page.getByRole('button', { name: 'Stop sensor', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Stop sensing' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Stop sensing' }).click();
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await expect(page.getByTestId('pulse-value')).toHaveText('—BPM');
    await page.getByRole('button', { name: 'Start mock sensor' }).click();
    await expect(page.getByTestId('pulse-value')).toHaveText(/7[2-6]BPM/);
    await page.reload();
    await expect(page.getByTestId('capture-status')).toHaveText(
      'Sensing is off',
    );
    await expect(page.getByTestId('pulse-value')).toHaveText('—BPM');
  } finally {
    await app.close();
  }
});
test('missing credentials do not open a camera or expose secrets', async () => {
  const { app, page } = await launch();
  try {
    await page.getByRole('button', { name: 'Start camera sensing' }).click();
    await expect(page.getByTestId('sensor-message')).toHaveText(
      'Presage needs a connection.',
    );
    const state = await page.evaluate(() => window.trueiris?.getSensor());
    expect(state).toMatchObject({
      phase: 'error',
      issue: 'missing_key',
      reading: null,
    });
    expect(Object.keys(state ?? {})).toEqual([
      'provider',
      'phase',
      'issue',
      'reading',
      'sessionId',
      'startedAt',
    ]);
  } finally {
    await app.close();
  }
});
for (const scenario of [
  'no_face',
  'low_confidence',
  'talking',
  'network',
] as const) {
  test(`mock ${scenario} clears or withholds pulse`, async () => {
    const { app, page } = await launch(scenario);
    try {
      await page
        .getByRole('combobox', { name: 'Sensor provider' })
        .selectOption('mock');
      await page.getByRole('button', { name: 'Start mock sensor' }).click();
      const messages = {
        no_face: 'No face detected.',
        low_confidence: 'Low confidence.',
        talking: 'Talking detected.',
        network: 'Presage is unavailable.',
      };
      await expect(page.getByTestId('sensor-message')).toHaveText(
        messages[scenario],
      );
      await expect(page.getByTestId('pulse-value')).toHaveText('—BPM');
    } finally {
      await app.close();
    }
  });
}
test('native Presage runtime loads in the built utility process without capture', async () => {
  test.skip(
    process.platform !== 'darwin' || process.arch !== 'arm64',
    'Native loader verified on demo platform; hardware-independent tests run everywhere.',
  );
  const { app } = await launch();
  try {
    const result = await app.evaluate(
      ({ utilityProcess }, worker) =>
        new Promise<unknown>((resolveResult) => {
          const child = utilityProcess.fork(worker, [], { stdio: 'pipe' });
          child.stdout?.resume();
          child.stderr?.resume();
          const timer = setTimeout(() => {
            child.kill();
            resolveResult(null);
          }, 15000);
          child.on('message', (message) => {
            clearTimeout(timer);
            resolveResult(message);
          });
          child.on('exit', (code) => {
            if (code !== 0) {
              clearTimeout(timer);
              resolveResult(null);
            }
          });
          child.postMessage({ kind: 'probe' });
        }),
      resolve('apps/desktop/out/main/presage-worker.js'),
    );
    expect(result).toEqual({ kind: 'probe', version: '3.4.0' });
  } finally {
    await app.close();
  }
});
