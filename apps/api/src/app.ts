import { AgentService } from './agents/agent';
import type { ReasoningProvider } from './agents/provider';
import Fastify, { LogController } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  askRequestSchema,
  agentResultSchema,
  baselineQuerySchema,
  baselineDataSchema,
  healthSchema,
  measurementBatchSchema,
  exportPageSchema,
  exportCursorSchema,
  ingestionAckSchema,
  timelineQuerySchema,
  timelineDataSchema,
  contextBatchSchema,
  contextCursorSchema,
  contextExportPageSchema,
} from '@trueiris/schemas';
import { loggerOptions } from '@trueiris/shared/logging';
import { SessionConflict, type MeasurementStore } from '@trueiris/db';

interface ApiOptions {
  reasoning?: ReasoningProvider;
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
  const { store, token, userId, reasoning } = options;
  const agent =
    store && userId && reasoning
      ? new AgentService(reasoning, store, userId)
      : null;
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
        reasoning: reasoning
          ? reasoning.configured
            ? 'ready'
            : 'unavailable'
          : 'not_implemented',
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
    privateApp.post('/context/batch', async (request, reply) => {
      const parsed = contextBatchSchema.safeParse(request.body);
      if (
        !parsed.success ||
        parsed.data.intervals.some(
          (i) => Date.parse(i.end) > Date.now() + 60_000,
        )
      )
        return reply.code(400).send({ error: 'Invalid context batch' });
      try {
        return ingestionAckSchema.parse(
          await store!.ingestContext(userId!, parsed.data.intervals),
        );
      } catch (error) {
        return reply.code(error instanceof SessionConflict ? 409 : 503).send({
          error:
            'Context storage is unavailable or conflicts with saved history',
        });
      }
    });
    privateApp.get('/context/export', async (request, reply) => {
      const query = z
        .object({ cursor: contextCursorSchema.optional() })
        .strict()
        .safeParse(request.query);
      if (!query.success)
        return reply
          .code(400)
          .send({ error: 'Invalid context export request' });
      try {
        return contextExportPageSchema.parse(
          await store!.exportContextPage(userId!, query.data.cursor),
        );
      } catch {
        return reply.code(503).send({ error: 'Context export is unavailable' });
      }
    });
    privateApp.post('/agent/ask', async (request, reply) => {
      const parsed = askRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid question' });
      if (!agent) return { state: 'not_configured', data: null };
      const controller = new AbortController();
      const closed = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.on('close', closed);
      try {
        return agentResultSchema.parse(
          await agent.ask(parsed.data, controller.signal),
        );
      } finally {
        reply.raw.off('close', closed);
      }
    });
    privateApp.post('/baselines/compare', async (request, reply) => {
      const query = baselineQuerySchema.safeParse(request.body);
      if (!query.success)
        return reply.code(400).send({ error: 'Invalid baseline request' });
      try {
        return baselineDataSchema.parse(
          await store!.baselines(userId!, query.data),
        );
      } catch {
        return reply.code(503).send({ error: 'Baselines are unavailable' });
      }
    });
    privateApp.get('/timeline', async (request, reply) => {
      const query = timelineQuerySchema.safeParse(request.query);
      if (!query.success)
        return reply.code(400).send({ error: 'Invalid timeline request' });
      try {
        return timelineDataSchema.parse(
          await store!.timeline(userId!, query.data),
        );
      } catch {
        return reply.code(503).send({ error: 'Timeline is unavailable' });
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
        agent?.cancel();
        await store!.deleteData(userId!);
        return reply.code(204).send();
      } catch {
        return reply.code(503).send({ error: 'Deletion is unavailable' });
      }
    });
  });
  app.addHook('onClose', async () => {
    agent?.cancel();
    await store?.close();
  });
  return app;
}
