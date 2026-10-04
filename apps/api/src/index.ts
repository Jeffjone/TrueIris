import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import {
  GeminiReasoningProvider,
  MockReasoningProvider,
} from './agents/provider';
import { ElevenLabsVoiceProvider, MockVoiceProvider } from './voice/provider';
import { buildApp } from './app';
import { TigerStore } from '@trueiris/db';

loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
const app = buildApp(env.LOG_LEVEL, {
  voice:
    env.TRUEIRIS_VOICE_PROVIDER === 'mock'
      ? new MockVoiceProvider()
      : new ElevenLabsVoiceProvider(
          env.ELEVENLABS_API_KEY,
          env.ELEVENLABS_VOICE_ID,
          env.ELEVENLABS_TTS_MODEL,
        ),
  reasoning:
    env.TRUEIRIS_REASONING_PROVIDER === 'mock'
      ? new MockReasoningProvider()
      : new GeminiReasoningProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL),
  ...(env.DATABASE_URL
    ? { store: new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE) }
    : {}),
  ...(env.TRUEIRIS_INGEST_TOKEN ? { token: env.TRUEIRIS_INGEST_TOKEN } : {}),
  demoMode: env.TRUEIRIS_DEMO_MODE,
  userId: env.TRUEIRIS_DEMO_MODE
    ? env.TRUEIRIS_DEMO_USER_ID
    : env.TRUEIRIS_USER_ID,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({
    host: env.TRUEIRIS_API_HOST,
    port: env.TRUEIRIS_API_PORT,
  });
} catch {
  app.log.error(
    { event: 'api_start_failed' },
    'Could not start API; check host and port',
  );
  process.exitCode = 1;
}
