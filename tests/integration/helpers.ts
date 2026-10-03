import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

/** Hardware-independent launches must never use a developer's local credentials. */
export async function launchSensorDesktop(scenario = 'steady') {
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: [resolve('apps/desktop')],
    env: {
      ...environment,
      PRESAGE_API_KEY: '',
      TRUEIRIS_SENSOR_PROVIDER: 'presage',
      TRUEIRIS_MOCK_SENSOR_SCENARIO: scenario,
      LOG_LEVEL: 'silent',
      ELECTRON_RENDERER_URL: '',
    },
  });
  return { app, page: await app.firstWindow() };
}
