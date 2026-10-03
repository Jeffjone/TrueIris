import Fastify, { LogController } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  healthSchema,
  measurementBatchSchema,
  exportPageSchema,
  exportCursorSchema,
  ingestionAckSchema,
} from '@trueiris/schemas';
import { loggerOptions } from '@trueiris/shared/logging';
import { SessionConflict, type MeasurementStore } from '@trueiris/db';

interface ApiOptions {
  store?: MeasurementStore;
  token?: string;
  userId?: string;
}
export function buildApp(logLevel = 'info', options: ApiOptions = {}) {
  // Request URLs/query strings may contain data cursors; log only fixed events.
  const app = Fastify({
    logger: loggerOptions(logLevel),
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 256 * 1024,
  });
  const { store, token, userId } = options;
  let windowStart = Date.now();
  let requests = 0;
  app.setErrorHandler((error, _request, reply) => {
    void reply
      .code((error as { statusCode?: number }).statusCode === 413 ? 413 : 400)
      .send({ error: 'Invalid request' });
  });
  app.get('/health', async () =>
    healthSchema.parse({
      service: 'trueiris-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      integrations: {
        database: store && (await store.health()) ? 'ready' : 'unavailable',
        reasoning: 'not_implemented',
        voice: 'not_implemented',
      },
    }),
  );
  app.register(async (privateApp) => {
    privateApp.addHook('onRequest', async (request, reply) => {
      if (!token || !userId)
        return reply.code(503).send({ error: 'Storage is not configured' });
      const actual = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return reply.code(401).send({ error: 'Unauthorized' });
      if (Date.now() - windowStart >= 60_000) {
        windowStart = Date.now();
        requests = 0;
      }
      // Single-user token quota, unaffected by attacker-controlled IP headers.
      if (++requests > 180)
        return reply
          .header('Retry-After', '60')
          .code(429)
          .send({ error: 'Too many requests' });
      if (!store)
        return reply.code(503).send({ error: 'Storage is unavailable' });
    });
    privateApp.post('/measurements/batch', async (request, reply) => {
      const parsed = measurementBatchSchema.safeParse(request.body);
      if (
        !parsed.success ||
        parsed.data.measurements.some(
          (m) => Date.parse(m.timestamp) > Date.now() + 60_000,
        )
      )
        return reply.code(400).send({ error: 'Invalid measurement batch' });
      try {
        return ingestionAckSchema.parse(
          await store!.ingest(userId!, parsed.data.measurements),
        );
      } catch (error) {
        if (error instanceof SessionConflict)
          return reply
            .code(409)
            .send({ error: 'Session ownership or provenance mismatch' });
        app.log.warn({ event: 'database_ingestion_failed' });
        return reply
          .code(503)
          .send({ error: 'Storage is temporarily unavailable' });
      }
    });
    privateApp.get('/data/export', async (request, reply) => {
      const query = z
        .object({ cursor: exportCursorSchema.optional() })
        .strict()
        .safeParse(request.query);
      if (!query.success)
        return reply.code(400).send({ error: 'Invalid export request' });
      try {
        return exportPageSchema.parse(
          await store!.exportPage(userId!, query.data.cursor),
        );
      } catch {
        return reply.code(503).send({ error: 'Export is unavailable' });
      }
    });
    privateApp.delete('/data', async (_request, reply) => {
      try {
        await store!.deleteData(userId!);
        return reply.code(204).send();
      } catch {
        return reply.code(503).send({ error: 'Deletion is unavailable' });
      }
    });
  });
  app.addHook('onClose', async () => {
    await store?.close();
  });
  return app;
}
