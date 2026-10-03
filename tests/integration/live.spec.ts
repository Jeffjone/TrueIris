import { expect, test } from '@playwright/test';
import { SENSOR_CHANNELS } from '../../packages/shared/src/index';
import { sensorSnapshotSchema } from '../../packages/schemas/src/index';
import { launchSensorDesktop } from './helpers';

function durationSeconds(value: string | null) {
  return (value ?? '')
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}
test('live metrics update with confidence, manual context, and a session clock across routes', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await expect(page.getByTestId('session-duration')).toHaveText('—');
    await expect(page.getByTestId('current-application')).toHaveText(
      'Context off',
    );
    await page
      .getByRole('combobox', { name: 'Current activity' })
      .selectOption('Coding');
    await page
      .getByRole('combobox', { name: 'Sensor provider' })
      .selectOption('mock');
    await page.getByRole('button', { name: 'Start mock sensor' }).click();
    await expect(page.getByTestId('signal-quality')).toHaveText('Calibrating');
    await expect(page.getByTestId('signal-quality')).toHaveText(
      'Excellent signal',
    );
    await expect(page.getByTestId('pulse-confidence')).toHaveText('92%');
    await expect(page.getByTestId('respiration-value')).toHaveText(
      /14\.\d\s*\/min/,
    );
    await expect(page.getByTestId('hrv-value')).toHaveText(/4[12]\s*ms/);
    await expect(page.getByTestId('pulse-stage')).toHaveAttribute(
      'data-signal',
      'accepted',
    );
    const firstPulse = await page.getByTestId('pulse-value').textContent();
    await expect(page.getByTestId('pulse-value')).not.toHaveText(firstPulse!);
    const state = await page.evaluate(() => window.trueiris?.getSensor());
    expect(state?.startedAt).toBeTruthy();
    await expect
      .poll(async () =>
        durationSeconds(
          await page.getByTestId('session-duration').textContent(),
        ),
      )
      .toBeGreaterThan(0);
    const before = durationSeconds(
      await page.getByTestId('session-duration').textContent(),
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    expect(
      (await page.evaluate(() => window.trueiris?.getSensor()))?.startedAt,
    ).toBe(state?.startedAt);
    expect(
      durationSeconds(await page.getByTestId('session-duration').textContent()),
    ).toBeGreaterThanOrEqual(before);
    await expect(
      page.getByRole('combobox', { name: 'Current activity' }),
    ).toHaveValue('Coding');
    await page
      .getByRole('button', { name: 'Stop sensing', exact: true })
      .click();
    await expect(page.getByTestId('session-duration')).toHaveText('—');
    await expect(page.getByTestId('signal-quality')).toHaveText(
      'Not connected',
    );
    await expect(page.getByTestId('pulse-confidence')).toHaveText('—');
    await expect(page.getByTestId('pulse-stage')).toHaveAttribute(
      'data-signal',
      'unavailable',
    );
    await page.getByRole('button', { name: 'Start mock sensor' }).click();
    await expect(page.getByTestId('session-duration')).toHaveText('00:00');
    expect(
      (await page.evaluate(() => window.trueiris?.getSensor()))?.startedAt,
    ).not.toBe(state?.startedAt);
    await page.reload();
    await expect(page.getByTestId('session-duration')).toHaveText('—');
    await expect(
      page.getByRole('combobox', { name: 'Current activity' }),
    ).toHaveValue('');
  } finally {
    await app.close();
  }
});

for (const [scenario, quality] of [
  ['no_face', 'No face detected'],
  ['low_confidence', 'Low confidence'],
  ['no_camera', 'Camera unavailable'],
  ['talking', 'Talking detected'],
] as const) {
  test(`live ${scenario} state does not animate or invent a pulse`, async () => {
    const { app, page } = await launchSensorDesktop(scenario);
    try {
      await page
        .getByRole('combobox', { name: 'Sensor provider' })
        .selectOption('mock');
      await page.getByRole('button', { name: 'Start mock sensor' }).click();
      await expect(page.getByTestId('signal-quality')).toHaveText(quality);
      await expect(page.getByTestId('pulse-value')).toHaveText('—BPM');
      await expect(page.getByTestId('pulse-stage')).toHaveAttribute(
        'data-signal',
        'unavailable',
      );
      expect(
        await page
          .locator('.iris-halo')
          .evaluate((element) => getComputedStyle(element).animationName),
      ).toBe('none');
      if (scenario === 'low_confidence') {
        await expect(page.getByTestId('pulse-confidence')).toHaveText('20%');
        await expect(
          page.getByText('Value withheld', { exact: true }),
        ).toBeVisible();
      }
    } finally {
      await app.close();
    }
  });
}

test('responsive live view preserves metrics, context, and stop access with reduced motion', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await page
      .getByRole('combobox', { name: 'Sensor provider' })
      .selectOption('mock');
    await page.getByRole('button', { name: 'Start mock sensor' }).click();
    await expect(page.getByTestId('signal-quality')).toHaveText(
      'Excellent signal',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page
        .locator('.iris-halo')
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    expect(
      await page
        .locator('.pulse-number')
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setMinimumSize(320, 480),
    );
    for (const [width, height] of [
      [1180, 800],
      [700, 600],
      [390, 844],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]!.setContentSize(
            size.width,
            size.height,
          ),
        { width: width!, height: height! },
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth <= window.innerWidth &&
              document.querySelector('main')!.scrollWidth <=
                document.querySelector('main')!.clientWidth,
          ),
        )
        .toBe(true);
      for (const id of [
        'pulse-value',
        'respiration-value',
        'hrv-value',
        'signal-quality',
        'current-application',
        'session-duration',
      ]) {
        await page.getByTestId(id).scrollIntoViewIfNeeded();
        await expect(page.getByTestId(id)).toBeInViewport();
      }
      const stop = page.getByRole('button', {
        name: 'Stop sensor',
        exact: true,
      });
      await expect(stop).toBeInViewport();
      await page.locator('main').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(stop).toBeInViewport();
      await page.locator('main').evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({ path: `test-results/live-mock-${width}.png` });
    }
    await page
      .getByRole('button', { name: 'Stop sensor', exact: true })
      .click();
    await expect(page.getByTestId('signal-quality')).toHaveText(
      'Not connected',
    );
  } finally {
    await app.close();
  }
});

test('validated mock IPC updates recover from good signal through a signal gap to excellent', async () => {
  const { app, page } = await launchSensorDesktop();
  try {
    await page
      .getByRole('combobox', { name: 'Sensor provider' })
      .selectOption('mock');
    await page.getByRole('button', { name: 'Start mock sensor' }).click();
    await expect(page.getByTestId('signal-quality')).toHaveText(
      'Excellent signal',
    );
    const current = sensorSnapshotSchema.parse(
      await page.evaluate(() => window.trueiris?.getSensor()),
    );
    await page
      .getByRole('button', { name: 'Stop sensor', exact: true })
      .click();
    await expect(page.getByTestId('signal-quality')).toHaveText(
      'Not connected',
    );
    // Feed deterministic labeled mock events through the real validated preload;
    // the stopped provider cannot race these updates. No production test hooks.
    for (const [issue, quality, pulse] of [
      ['none', 'good', 75],
      ['no_face', 'unavailable', null],
      ['none', 'excellent', 76],
    ] as const) {
      const snapshot = sensorSnapshotSchema.parse({
        ...current,
        issue,
        reading:
          pulse === null
            ? null
            : {
                ...current.reading,
                pulseRate: pulse,
                pulseConfidence: quality === 'good' ? 0.62 : 0.92,
                signalQuality: quality,
              },
      });
      await app.evaluate(
        ({ BrowserWindow }, data) =>
          BrowserWindow.getAllWindows()[0]!.webContents.send(
            data.channel,
            data.snapshot,
          ),
        { channel: SENSOR_CHANNELS.update, snapshot },
      );
      await expect(page.getByTestId('signal-quality')).toHaveText(
        issue === 'no_face'
          ? 'No face detected'
          : quality === 'good'
            ? 'Good signal'
            : 'Excellent signal',
      );
      await expect(page.getByTestId('pulse-value')).toHaveText(
        `${pulse ?? '—'}BPM`,
      );
      await expect(page.getByTestId('pulse-confidence')).toHaveText(
        pulse === null ? '—' : quality === 'good' ? '62%' : '92%',
      );
    }
  } finally {
    await app.close();
  }
});
