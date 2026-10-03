import { describe, expect, it } from 'vitest';
import { healthSchema } from '@trueiris/schemas';
import { buildApp } from './app';

describe('API foundation', () => {
  it('returns validated liveness with honest integration states', async () => {
    const app = buildApp('silent');
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const health = healthSchema.parse(response.json());
      expect(Object.values(health.integrations)).toEqual([
        'unavailable',
        'not_implemented',
        'not_implemented',
      ]);
      expect(response.body).not.toMatch(/apiKey|DATABASE_URL|password/);
    } finally {
      await app.close();
    }
  });
  it('does not accidentally expose unimplemented routes', async () => {
    const app = buildApp('silent');
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/measurements' })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});

import { vi } from 'vitest';
import { SessionConflict, type MeasurementStore } from '@trueiris/db';
const token = 'test-only-token-with-at-least-32-characters';
const userId = '00000000-0000-4000-8000-000000000001';
const measurement = {
  eventId: '00000000-0000-4000-8000-000000000002',
  sessionId: '00000000-0000-4000-8000-000000000003',
  timestamp: '2026-10-03T12:00:01.000Z',
  startedAt: '2026-10-03T12:00:00.000Z',
  source: 'mock' as const,
  signalQuality: 'good' as const,
  pulseRate: 72,
  pulseConfidence: 0.9,
};
function fakeStore(): MeasurementStore {
  return {
    health: vi.fn(async () => true),
    ingest: vi.fn(async () => ({ accepted: 1, duplicates: 0 })),
    exportPage: vi.fn(async () => ({
      measurements: [measurement],
      next: null,
    })),
    deleteData: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}
describe('authenticated ingestion', () => {
  it('binds writes to server identity and protects ingestion/export/deletion', async () => {
    const store = fakeStore();
    const app = buildApp('silent', { store, token, userId });
    try {
      for (const [method, url] of [
        ['POST', '/measurements/batch'],
        ['GET', '/data/export'],
        ['DELETE', '/data'],
      ] as const) {
        expect((await app.inject({ method, url })).statusCode).toBe(401);
        expect(
          (
            await app.inject({
              method,
              url,
              headers: { authorization: 'Bearer incorrect' },
            })
          ).statusCode,
        ).toBe(401);
      }
      const response = await app.inject({
        method: 'POST',
        url: '/measurements/batch',
        headers: { authorization: `Bearer ${token}` },
        payload: { measurements: [measurement] },
      });
      expect(response.statusCode).toBe(200);
      expect(store.ingest).toHaveBeenCalledWith(userId, [measurement]);
      const rejected = await app.inject({
        method: 'POST',
        url: '/measurements/batch',
        headers: { authorization: `Bearer ${token}` },
        payload: { measurements: [{ ...measurement, userId: 'forged' }] },
      });
      expect(rejected.statusCode).toBe(400);
      expect(store.ingest).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  it('reports unavailable dependencies honestly, without raw errors', async () => {
    const store = fakeStore();
    vi.mocked(store.health).mockResolvedValue(false);
    vi.mocked(store.ingest).mockRejectedValue(
      new Error('private-db-password SQL measurement'),
    );
    const app = buildApp('silent', { store, token, userId });
    try {
      expect((await app.inject('/health')).json().integrations.database).toBe(
        'unavailable',
      );
      const response = await app.inject({
        method: 'POST',
        url: '/measurements/batch',
        headers: { authorization: `Bearer ${token}` },
        payload: { measurements: [measurement] },
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toMatch(/private-db-password|SQL|measurement/);
      vi.mocked(store.ingest).mockRejectedValue(new SessionConflict());
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/measurements/batch',
            headers: { authorization: `Bearer ${token}` },
            payload: { measurements: [measurement] },
          })
        ).statusCode,
      ).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('requires configuration, bounds payloads and prevents future timestamps', async () => {
    const unconfigured = buildApp('silent');
    expect(
      (
        await unconfigured.inject({
          method: 'POST',
          url: '/measurements/batch',
        })
      ).statusCode,
    ).toBe(503);
    await unconfigured.close();
    const store = fakeStore();
    const app = buildApp('silent', { store, token, userId });
    try {
      for (const measurements of [
        [],
        Array(121).fill(measurement),
        [{ ...measurement, timestamp: '2099-01-01T00:00:00.000Z' }],
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/measurements/batch',
              headers: { authorization: `Bearer ${token}` },
              payload: { measurements },
            })
          ).statusCode,
        ).toBe(400);
      expect(store.ingest).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('scopes exports/deletion and closes the pool', async () => {
    const store = fakeStore();
    const app = buildApp('silent', { store, token, userId });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/data/export',
          headers: { authorization: `Bearer ${token}` },
        })
      ).json(),
    ).toEqual({ measurements: [measurement], next: null });
    expect(store.exportPage).toHaveBeenCalledWith(userId, undefined);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/data',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(204);
    expect(store.deleteData).toHaveBeenCalledWith(userId);
    await app.close();
    expect(store.close).toHaveBeenCalledOnce();
  });
  it('rate-limits the authenticated token', async () => {
    const app = buildApp('silent', { store: fakeStore(), token, userId });
    try {
      for (let i = 0; i < 180; i++)
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/data/export',
              headers: { authorization: `Bearer ${token}` },
            })
          ).statusCode,
        ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/data/export',
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(429);
    } finally {
      await app.close();
    }
  });
});

it('rejects malformed cursors and oversized payloads before database access', async () => {
  const store = fakeStore();
  const app = buildApp('silent', { store, token, userId });
  try {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/data/export?cursor=not-a-cursor',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(400);
    expect(store.exportPage).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/measurements/batch',
          headers: { authorization: `Bearer ${token}` },
          payload: { data: 'x'.repeat(256 * 1024) },
        })
      ).statusCode,
    ).toBe(413);
    expect(store.ingest).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
