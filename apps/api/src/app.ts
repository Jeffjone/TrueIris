import Fastify from 'fastify';
import { healthSchema } from '@trueiris/schemas';
import { loggerOptions } from '@trueiris/shared/logging';

export function buildApp(logLevel = 'info') {
  const app = Fastify({
    logger: loggerOptions(logLevel),
    bodyLimit: 256 * 1024,
  });
  app.get('/health', () =>
    healthSchema.parse({
      service: 'trueiris-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      integrations: {
        database: 'not_implemented',
        reasoning: 'not_implemented',
        voice: 'not_implemented',
      },
    }),
  );
  return app;
}
