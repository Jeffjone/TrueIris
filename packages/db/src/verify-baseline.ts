import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  BaselineQuery,
  ContextInterval,
  Measurement,
} from '@trueiris/schemas';
import type { TigerStore } from './index';

export async function verifyBaselines(store: TigerStore) {
  const user = randomUUID();
  const foreign = randomUUID();
  const query: BaselineQuery = {
    range: {
      start: '2026-03-10T14:00:00.000Z',
      end: '2026-03-10T14:01:00.000Z',
      source: 'mock',
    },
    context: { kind: 'activity', activity: 'Coding' },
    timezone: 'America/Chicago',
    lookbackDays: 30,
  };
  const iso = (t: number) => new Date(t).toISOString();
  try {
    for (let day = 7; day <= 10; day++) {
      const base = Date.parse(
        `2026-03-${day.toString().padStart(2, '0')}T14:00:00Z`,
      );
      const sessionId = randomUUID();
      const rows: Measurement[] = Array.from(
        { length: day === 10 ? 15 : 210 },
        (_, second) => ({
          eventId: randomUUID(),
          sessionId,
          startedAt: iso(base),
          timestamp: iso(base + second * 1000),
          source: 'mock',
          signalQuality: 'good',
          pulseRate:
            day === 8 && second === 205
              ? 999
              : day === 10
                ? 81
                : 70 + (day - 7) * 2,
          pulseConfidence: 0.9,
          respirationRate: 0,
          respirationConfidence: 0.9,
          // Middle day tests inferred context rather than a measurement label.
          ...(day === 8
            ? second === 205
              ? { activity: 'Break' as const }
              : {}
            : { activity: 'Coding' as const }),
        }),
      );
      for (let offset = 0; offset < rows.length; offset += 120)
        await store.ingest(user, rows.slice(offset, offset + 120));
      if (day === 8) {
        const contextSession = randomUUID();
        const intervals: ContextInterval[] = Array.from(
          { length: 7 },
          (_, i) => ({
            id: randomUUID(),
            sessionId: contextSession,
            source: 'mock',
            startedAt: iso(base),
            start: iso(base + i * 30_000),
            end: iso(base + (i + 1) * 30_000),
            application: { id: 'editor', name: 'Editor' },
            windowTitle: null,
            manualActivity: null,
            classification: {
              activity: 'Coding',
              confidence: 0.9,
              reason: 'Fixture',
            },
            idle: false,
            idleSeconds: 0,
            sessionSeconds: (i + 1) * 30,
            applicationSwitches: 0,
            focusMode: false,
          }),
        );
        await store.ingestContext(user, intervals);
      }
      if (day === 10) {
        await store.ingest(user, [
          {
            ...rows[0]!,
            eventId: randomUUID(),
            timestamp: iso(base + 15_000),
            signalQuality: 'poor',
            pulseRate: 999,
          },
          {
            ...rows[0]!,
            eventId: randomUUID(),
            timestamp: iso(base + 16_000),
            talking: true,
            pulseRate: 999,
          },
          {
            ...rows[0]!,
            eventId: randomUUID(),
            timestamp: iso(base + 17_000),
            pulseConfidence: 0.1,
            pulseRate: 999,
            respirationConfidence: 0.1,
          },
          {
            ...rows[0]!,
            eventId: randomUUID(),
            timestamp: iso(base + 18_000),
            activity: 'Break',
            pulseRate: 999,
          },
        ]);
      }
    }
    // Qualifying physiology cannot establish activity evidence from uncertain or ambiguous context.
    const negativeBase = Date.parse('2026-03-06T14:00:00Z');
    const negativeSession = randomUUID();
    for (let bucket = 0; bucket < 3; bucket++) {
      const base = negativeBase + bucket * 30_000;
      await store.ingest(
        user,
        Array.from({ length: bucket === 2 ? 14 : 15 }, (_, second) => ({
          eventId: randomUUID(),
          sessionId: negativeSession,
          startedAt: iso(negativeBase),
          timestamp: iso(base + second * 1000),
          source: 'mock' as const,
          signalQuality: 'good' as const,
          pulseRate: 999,
          pulseConfidence: 0.9,
          ...(bucket === 2 ? { activity: 'Coding' as const } : {}),
        })),
      );
      if (bucket === 2) continue; // Sparse manual bucket remains below coverage minimum.
      for (let overlap = 0; overlap < (bucket === 1 ? 2 : 1); overlap++) {
        await store.ingestContext(user, [
          {
            id: randomUUID(),
            sessionId: randomUUID(),
            source: 'mock',
            startedAt: iso(base),
            start: iso(base),
            end: iso(base + 30_000),
            application: { id: 'editor', name: 'Editor' },
            windowTitle: null,
            manualActivity: null,
            classification: {
              activity: 'Coding',
              confidence: bucket === 0 ? 0.7 : 0.9,
              reason: 'Fixture',
            },
            idle: false,
            idleSeconds: 0,
            sessionSeconds: 30,
            applicationSwitches: 0,
            focusMode: false,
          },
        ]);
      }
    }
    const data = await store.baselines(user, query);
    assert.equal(data.comparisons[0].sampleCount, 21);
    assert.equal(data.comparisons[0].dayCount, 3);
    assert.equal(data.comparisons[0].baseline, 72);
    assert.equal(data.comparisons[0].current, 81);
    assert.equal(data.comparisons[0].currentCount, 15);
    assert.equal(data.comparisons[0].differencePercent, 12.5);
    assert.equal(data.comparisons[1].baseline, 0);
    assert.equal(data.comparisons[1].differencePercent, null);
    assert.equal(data.comparisons[2].state, 'insufficient_history');
    assert.equal(
      (await store.baselines(foreign, query)).comparisons[0].sampleCount,
      0,
    );
    assert.equal(
      (
        await store.baselines(user, {
          ...query,
          range: { ...query.range, source: 'live' },
        })
      ).comparisons[0].sampleCount,
      0,
    );
    assert.equal(
      (await store.baselines(user, { ...query, lookbackDays: 1 }))
        .comparisons[0].state,
      'insufficient_history',
    );
    // Local-hour grouping stays correct across the spring DST transition.
    const morning = {
      ...query,
      context: { kind: 'time_of_day' as const, period: 'morning' as const },
    };
    assert.equal(
      (await store.baselines(user, morning)).comparisons[0].sampleCount,
      23,
    );
    assert.equal(
      (await store.baselines(user, { ...morning, timezone: 'UTC' }))
        .comparisons[0].sampleCount,
      0,
    );
    const emptyCurrent = {
      ...query,
      range: {
        ...query.range,
        start: '2026-03-11T14:00:00.000Z',
        end: '2026-03-11T14:01:00.000Z',
      },
    };
    assert.equal(
      (await store.baselines(user, emptyCurrent)).comparisons[0].state,
      'no_current_data',
    );
    const similarQuery = {
      range: { start: '2026-03-06T14:00:00.000Z', end: query.range.start },
      source: 'mock' as const,
      activity: 'Coding' as const,
      limit: 2,
    };
    const matched = await store.similarSessions(user, similarQuery);
    assert.equal(matched.sessions.length, 2);
    assert.equal(matched.sessions[0]!.pulse, 74);
    assert.equal(matched.sessions[0]!.count, 210);
    assert.equal(
      (await store.similarSessions(foreign, similarQuery)).sessions.length,
      0,
    );
    assert.equal(
      (await store.similarSessions(user, { ...similarQuery, source: 'live' }))
        .sessions.length,
      0,
    );
    const clipped = await store.similarSessions(user, {
      ...similarQuery,
      range: { start: query.range.start, end: '2026-03-10T14:00:00.500Z' },
    });
    assert.equal(clipped.sessions[0]!.range.end, '2026-03-10T14:00:00.500Z');
    await store.deleteData(user);
    assert.equal(
      (await store.baselines(user, query)).comparisons[0].sampleCount,
      0,
    );
  } finally {
    for (const id of [user, foreign]) {
      await store.deleteData(id);
      await store.pool.query('DELETE FROM users WHERE id=$1', [id]);
    }
  }
}
