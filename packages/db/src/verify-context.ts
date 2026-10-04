import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ContextInterval } from '@trueiris/schemas';
import { SessionConflict, type TigerStore } from './index';

/** Isolated fixtures share the outer runner's cleanup; never use the configured real owner. */
export async function verifyContext(
  store: TigerStore,
  users: string[],
  base: number,
) {
  const sessionId = randomUUID();
  const iso = (value: number) => new Date(value).toISOString();
  const interval = (
    second: number,
    patch: Partial<ContextInterval> = {},
  ): ContextInterval => ({
    id: randomUUID(),
    sessionId,
    source: 'mock',
    startedAt: iso(base),
    start: iso(base + second * 1000),
    end: iso(base + (second + 1) * 1000),
    application: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
    windowTitle: null,
    manualActivity: null,
    classification: {
      activity: 'Coding',
      confidence: 0.9,
      reason: 'A code editor is the foreground application.',
    },
    idle: false,
    idleSeconds: 0,
    sessionSeconds: second + 1,
    applicationSwitches: 0,
    focusMode: false,
    ...patch,
  });
  const first = interval(0);
  assert.deepEqual(await store.ingestContext(users[0]!, [first]), {
    accepted: 1,
    duplicates: 0,
  });
  assert.deepEqual(await store.ingestContext(users[0]!, [first]), {
    accepted: 0,
    duplicates: 1,
  });
  await assert.rejects(
    store.ingestContext(users[0]!, [
      { ...first, windowTitle: 'Changed after ingestion' },
    ]),
    SessionConflict,
  );
  await assert.rejects(
    store.ingestContext(users[1]!, [first]),
    SessionConflict,
  );
  await assert.rejects(
    store.ingestContext(users[0]!, [interval(1, { source: 'live' })]),
    SessionConflict,
  );
  await assert.rejects(
    store.ingestContext(users[0]!, [interval(0)]),
    SessionConflict,
  );
  await assert.rejects(
    store.ingestContext(users[0]!, [
      interval(1),
      interval(2, { source: 'live' }),
    ]),
    SessionConflict,
  );
  assert.equal((await store.exportContextPage(users[0]!)).intervals.length, 1);
  const second = interval(1, {
    focusMode: true,
    manualActivity: 'Studying',
    classification: {
      activity: 'Studying',
      confidence: 1,
      reason: 'Selected by you.',
    },
  });
  const race = await Promise.all([
    store.ingestContext(users[0]!, [second]),
    store.ingestContext(users[0]!, [second]),
  ]);
  assert.equal(
    race.reduce((sum, a) => sum + a.accepted, 0),
    1,
  );
  for (let start = 2; start < 510; start += 60)
    await store.ingestContext(
      users[0]!,
      Array.from({ length: Math.min(60, 510 - start) }, (_, i) =>
        interval(start + i),
      ),
    );
  const page = await store.exportContextPage(users[0]!);
  assert.equal(page.intervals.length, 500);
  assert.ok(page.next);
  const rest = await store.exportContextPage(users[0]!, page.next);
  assert.equal(rest.intervals.length, 10);
  assert.equal(rest.next, null);
  assert.equal(
    new Set([...page.intervals, ...rest.intervals].map((i) => i.id)).size,
    510,
  );
  assert.equal((await store.exportContextPage(users[1]!)).intervals.length, 0);
  const range = {
    start: iso(base + 500),
    end: iso(base + 1500),
    source: 'mock' as const,
  };
  const timeline = await store.timeline(users[0]!, range);
  assert.equal(timeline.contexts?.length, 2);
  assert.equal(timeline.contexts[0]?.start, range.start);
  assert.equal(timeline.contexts[1]?.end, range.end);
  assert.equal(timeline.contexts[1]?.focusMode, true);
  assert.equal((await store.timeline(users[1]!, range)).contexts?.length, 0);
  assert.equal(
    (await store.timeline(users[0]!, { ...range, source: 'live' })).contexts
      ?.length,
    0,
  );
  // A context-only period is inspectable without inventing physiology.
  const detached = interval(1800, { sessionId: randomUUID(), source: 'live' });
  await store.ingestContext(users[1]!, [detached]);
  const contextOnly = await store.timeline(users[1]!, {
    start: detached.start,
    end: detached.end,
    source: 'live',
  });
  assert.equal(contextOnly.summary.count, 0);
  assert.equal(contextOnly.contexts?.length, 1);
  // Bounded details on an otherwise empty owner; direct SQL avoids API round trips.
  const boundedStart = base - 25.5 * 3600_000,
    boundedSession = randomUUID();
  const large = Array.from({ length: 3001 }, (_, i) =>
    interval(i * 30, {
      sessionId: boundedSession,
      startedAt: iso(boundedStart),
      start: iso(boundedStart + i * 30_000),
      end: iso(boundedStart + i * 30_000 + 1000),
    }),
  );
  await store.pool.query(
    'INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING',
    [users[2]],
  );
  await store.pool.query(
    "INSERT INTO context_sessions(id,user_id,source,started_at) VALUES($1,$2,'mock',$3)",
    [boundedSession, users[2], iso(boundedStart)],
  );
  await store.pool.query(
    `INSERT INTO context_intervals(id,user_id,session_id,source,start_time,end_time,payload) SELECT (value->>'id')::uuid,$2,(value->>'sessionId')::uuid,'mock',(value->>'start')::timestamptz,(value->>'end')::timestamptz,value FROM jsonb_array_elements($1::jsonb)`,
    [JSON.stringify(large), users[2]],
  );
  const bounded = await store.timeline(users[2]!, {
    start: iso(boundedStart),
    end: iso(base),
    source: 'mock',
  });
  assert.equal(bounded.contexts?.length, 3000);
  assert.equal(bounded.limited, true);
  await store.deleteData(users[0]!);
  const watermark = await store.pool.query<{
    deleted_before: Date;
    precise: boolean;
  }>(
    "SELECT deleted_before,deleted_before<>date_trunc('second',deleted_before) AS precise FROM users WHERE id=$1",
    [users[0]],
  );
  assert.equal(watermark.rows[0]?.precise, true);
  // A delayed session that began in the deletion millisecond must not replay,
  // even with a fresh interval ID. Second-rounded watermarks lose this boundary.
  const boundary = watermark.rows[0]!.deleted_before.getTime();
  const sameMillisecond = interval(0, {
    id: randomUUID(),
    sessionId: randomUUID(),
    startedAt: iso(boundary),
    start: iso(boundary),
    end: iso(boundary + 1),
  });
  await assert.rejects(
    store.ingestContext(users[0]!, [sameMillisecond]),
    SessionConflict,
  );

  assert.equal((await store.exportContextPage(users[0]!)).intervals.length, 0);
  assert.equal((await store.timeline(users[0]!, range)).contexts?.length, 0);
  await assert.rejects(
    store.ingestContext(users[0]!, [first]),
    SessionConflict,
  );
  assert.equal((await store.exportContextPage(users[1]!)).intervals.length, 1);
}
