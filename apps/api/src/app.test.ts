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
    baselines: vi.fn(),
    timeline: vi.fn(),
    ingestContext: vi.fn(async () => ({ accepted: 1, duplicates: 0 })),
    exportContextPage: vi.fn(async () => ({ intervals: [], next: null })),
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

it('authenticates and scopes bounded timeline reads, rejecting ownership overrides', async () => {
  const store = fakeStore();
  const query = {
    start: '2026-10-04T00:00:00.000Z',
    end: '2026-10-04T01:00:00.000Z',
    source: 'mock',
  };
  const empty = {
    count: 0,
    mean: null,
    min: null,
    max: null,
    confidence: null,
  };
  const data = {
    range: query,
    points: [],
    activities: [],
    gaps: [],
    summary: {
      count: 0,
      observedSeconds: 0,
      sessions: 0,
      pulse: empty,
      respiration: empty,
      hrv: empty,
    },
    limited: false,
  };
  vi.mocked(store.timeline).mockResolvedValue(
    data as Awaited<ReturnType<MeasurementStore['timeline']>>,
  );
  const app = buildApp('silent', { store, token, userId });
  const url = '/timeline?' + new URLSearchParams(query);
  try {
    expect((await app.inject(url)).statusCode).toBe(401);
    expect(
      (
        await app.inject({ url, headers: { authorization: `Bearer ${token}` } })
      ).json(),
    ).toEqual(data);
    expect(store.timeline).toHaveBeenCalledWith(userId, query);
    for (const bad of [
      url + '&userId=forged',
      url.replace('source=mock', 'source=mixed'),
      url.replace('01%3A00', '00%3A00'),
    ]) {
      expect(
        (
          await app.inject({
            url: bad,
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(store.timeline).toHaveBeenCalledTimes(1);
    vi.mocked(store.timeline).mockRejectedValue(
      new Error('private SQL secret'),
    );
    const failed = await app.inject({
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toMatch(/private|SQL|secret/);
  } finally {
    await app.close();
  }
});

describe('private desktop context routes', () => {
  const interval = {
    id: '00000000-0000-4000-8000-000000000005',
    sessionId: '00000000-0000-4000-8000-000000000006',
    source: 'mock' as const,
    startedAt: '2026-10-03T12:00:00.000Z',
    start: '2026-10-03T12:00:00.000Z',
    end: '2026-10-03T12:00:01.000Z',
    application: { id: 'test.code', name: 'Visual Studio Code' },
    windowTitle: null,
    manualActivity: null,
    classification: {
      activity: 'Coding' as const,
      confidence: 0.9,
      reason: 'Code editor foreground.',
    },
    idle: false,
    idleSeconds: 0,
    sessionSeconds: 1,
    applicationSwitches: 0,
    focusMode: false,
  };
  it('requires auth and binds context ingestion/export to server identity', async () => {
    const store = fakeStore();
    vi.mocked(store.exportContextPage).mockResolvedValue({
      intervals: [interval],
      next: null,
    });
    const app = buildApp('silent', { store, token, userId });
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/context/batch',
            payload: { intervals: [interval] },
          })
        ).statusCode,
      ).toBe(401);
      expect((await app.inject('/context/export')).statusCode).toBe(401);
      const headers = { authorization: `Bearer ${token}` };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/context/batch',
            headers,
            payload: { intervals: [interval] },
          })
        ).statusCode,
      ).toBe(200);
      expect(store.ingestContext).toHaveBeenCalledWith(userId, [interval]);
      expect(
        (await app.inject({ url: '/context/export', headers })).json(),
      ).toEqual({ intervals: [interval], next: null });
      expect(store.exportContextPage).toHaveBeenCalledWith(userId, undefined);
    } finally {
      await app.close();
    }
  });
  it('rejects identity spoofing, future/bad bounds and unknown fields before storage', async () => {
    const store = fakeStore(),
      app = buildApp('silent', { store, token, userId });
    try {
      const headers = { authorization: `Bearer ${token}` };
      for (const patch of [
        { userId: 'forged' },
        { end: interval.start },
        { end: '2026-10-03T12:00:31.000Z' },
        {
          start: new Date(Date.now() + 90_000).toISOString(),
          end: new Date(Date.now() + 91_000).toISOString(),
        },
        {
          classification: {
            activity: 'Unknown',
            confidence: 1.5,
            reason: 'invalid',
          },
        },
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/context/batch',
              headers,
              payload: { intervals: [{ ...interval, ...patch }] },
            })
          ).statusCode,
        ).toBe(400);
      expect(store.ingestContext).not.toHaveBeenCalled();
      expect(
        (await app.inject({ url: '/context/export?cursor=bad', headers }))
          .statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it('maps ownership/overlap conflicts and hides storage errors', async () => {
    const store = fakeStore(),
      app = buildApp('silent', { store, token, userId });
    const headers = { authorization: `Bearer ${token}` };
    try {
      vi.mocked(store.ingestContext).mockRejectedValue(new SessionConflict());
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/context/batch',
            headers,
            payload: { intervals: [interval] },
          })
        ).statusCode,
      ).toBe(409);
      vi.mocked(store.ingestContext).mockRejectedValue(
        new Error('private-window-title SQL db-secret'),
      );
      const response = await app.inject({
        method: 'POST',
        url: '/context/batch',
        headers,
        payload: { intervals: [interval] },
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toMatch(/private-window-title|SQL|db-secret/);
      vi.mocked(store.exportContextPage).mockResolvedValue({
        intervals: [{ ...interval, unexpected: 'private' } as typeof interval],
        next: null,
      });
      expect(
        (await app.inject({ url: '/context/export', headers })).statusCode,
      ).toBe(503);
    } finally {
      await app.close();
    }
  });
});

import { compareAgainstBaseline } from '../../../packages/analytics/src';
it('authenticates, scopes and strictly bounds baseline comparisons', async () => {
  const store = fakeStore();
  const query = {
    range: {
      start: '2026-03-10T14:00:00.000Z',
      end: '2026-03-10T14:01:00.000Z',
      source: 'mock' as const,
    },
    context: { kind: 'activity' as const, activity: 'Coding' as const },
    timezone: 'UTC',
    lookbackDays: 30,
  };
  const comparisons = (['pulse', 'respiration', 'hrv'] as const).map((m) =>
    compareAgainstBaseline(
      m,
      null,
      0,
      {
        sampleCount: 0,
        dayCount: 0,
        mean: null,
        variance: null,
        measurementConfidence: null,
      },
      query.context,
    ),
  );
  vi.mocked(store.baselines).mockResolvedValue({
    query,
    historyStart: '2026-02-08T14:00:00.000Z',
    historyEnd: query.range.start,
    comparisons: comparisons as [
      (typeof comparisons)[number],
      (typeof comparisons)[number],
      (typeof comparisons)[number],
    ],
  });
  const app = buildApp('silent', { store, token, userId });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/baselines/compare',
          payload: query,
        })
      ).statusCode,
    ).toBe(401);
    const request = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/baselines/compare',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });
    for (const patch of [
      { userId: 'forged' },
      { lookbackDays: 31 },
      { timezone: 'invalid' },
    ])
      expect((await request({ ...query, ...patch })).statusCode).toBe(400);
    expect(store.baselines).not.toHaveBeenCalled();
    expect((await request(query)).statusCode).toBe(200);
    expect(store.baselines).toHaveBeenCalledWith(userId, query);
    vi.mocked(store.baselines).mockRejectedValue(new Error('private SQL'));
    const failed = await request(query);
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private SQL');
  } finally {
    await app.close();
  }
});
