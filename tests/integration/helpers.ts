import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

/** Hardware-independent launches must never use a developer's local credentials. */
export async function launchSensorDesktop(
  scenario = 'steady',
  overrides: Record<string, string> = {},
  flags: string[] = [],
) {
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: [resolve('apps/desktop'), ...flags],
    env: {
      ...environment,
      GEMINI_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      ELEVENLABS_VOICE_ID: '',
      TRUEIRIS_VOICE_PROVIDER: 'elevenlabs',
      PRESAGE_API_KEY: '',
      TRUEIRIS_INGEST_TOKEN: '',
      DATABASE_URL: '',
      TRUEIRIS_DEMO_MODE: 'false',
      TRUEIRIS_SENSOR_PROVIDER: 'presage',
      TRUEIRIS_CONTEXT_PROVIDER: 'mock',
      TRUEIRIS_MOCK_SENSOR_SCENARIO: scenario,
      LOG_LEVEL: 'silent',
      ELECTRON_RENDERER_URL: '',
      ...overrides,
    },
  });
  return { app, page: await app.firstWindow() };
}
