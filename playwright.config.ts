import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/integration',
  workers: 1,
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm start:api',
    url: 'http://127.0.0.1:3099/health',
    reuseExistingServer: false,
    env: {
      TRUEIRIS_API_HOST: '127.0.0.1',
      TRUEIRIS_API_PORT: '3099',
      LOG_LEVEL: 'silent',
      GEMINI_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      ELEVENLABS_VOICE_ID: '',
      TRUEIRIS_VOICE_PROVIDER: 'elevenlabs',
      TRUEIRIS_REASONING_PROVIDER: 'gemini',
      DATABASE_URL: '',
      TRUEIRIS_DEMO_MODE: 'false',
      TRUEIRIS_INGEST_TOKEN: '',
    },
  },
});
