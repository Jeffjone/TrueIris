import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { buildApp } from './app';

loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
const app = buildApp(env.LOG_LEVEL);

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
