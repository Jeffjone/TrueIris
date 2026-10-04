import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import type { Measurement } from '@trueiris/schemas';
import { verifyContext } from './verify-context';
import { migrate, SessionConflict, TigerStore } from './index';

// Opt-in real database check: fixtures use random owners and are always scoped/cleaned.
loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.DATABASE_URL)
  throw new Error('Set DATABASE_URL to a Timescale database');
const store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE);
const users = [randomUUID(), randomUUID(), randomUUID()];
const sessionId = randomUUID();
const base = Math.floor((Date.now() - 3600_000) / 30_000) * 30_000;
const startedAt = new Date(base).toISOString();
const measurement = (
  second: number,
  patch: Partial<Measurement> = {},
): Measurement => ({
  eventId: randomUUID(),
  sessionId,
  startedAt,
  timestamp: new Date(base + second * 1000).toISOString(),
  source: 'mock',
  signalQuality: 'good',
  pulseRate: 70 + (second % 3),
  pulseConfidence: 0.9,
  ...patch,
});
try {
  await migrate(store.pool);
  await migrate(store.pool);
  assert.equal(await store.health(), true);
  const m = [measurement(0), measurement(1), measurement(2)];
  assert.deepEqual(await store.ingest(users[0]!, m), {
    accepted: 3,
    duplicates: 0,
  });
  assert.deepEqual(await store.ingest(users[0]!, m), {
    accepted: 0,
    duplicates: 3,
  });
  assert.deepEqual(
    await store.ingest(users[0]!, [
      { ...m[0]!, eventId: randomUUID(), pulseRate: 999 },
    ]),
    { accepted: 0, duplicates: 1 },
  );
  const initial = await store.pool.query(
    'SELECT * FROM epochs WHERE user_id=$1 AND start_time=$2',
    [users[0], startedAt],
  );
  assert.equal(initial.rows[0].mean_pulse, 71);
  assert.equal(initial.rows[0].pulse_count, 3);
  assert.equal(initial.rows[0].missing_seconds, 27);
  assert.equal(
    (await store.exportPage(users[0]!)).measurements[0]?.pulseRate,
    70,
  );
  // Overlapping concurrent requests must not lose samples or double-count epochs.
  const concurrent = await Promise.all([
    store.ingest(users[0]!, [measurement(3), measurement(4)]),
    store.ingest(users[0]!, [measurement(4), measurement(5)]),
  ]);
  assert.equal(
    concurrent.reduce((sum, a) => sum + a.accepted, 0),
    3,
  );
  const epoch = await store.pool.query(
    'SELECT measurement_count FROM epochs WHERE user_id=$1 AND start_time=$2',
    [users[0], startedAt],
  );
  assert.equal(epoch.rows[0].measurement_count, 6);
  await assert.rejects(
    store.ingest(users[1]!, [measurement(6)]),
    SessionConflict,
  );
  await assert.rejects(
    store.ingest(users[0]!, [measurement(6, { source: 'live' })]),
    SessionConflict,
  );
  // A later ownership conflict rolls back the entire batch and its aggregates.
  await assert.rejects(
    store.ingest(users[0]!, [
      measurement(6),
      measurement(7, { source: 'live' }),
    ]),
    SessionConflict,
  );
  assert.equal((await store.exportPage(users[0]!)).measurements.length, 6);
  assert.equal((await store.exportPage(users[1]!)).measurements.length, 0);
  for (let start = 6; start < 510; start += 120) {
    await store.ingest(
      users[0]!,
      Array.from({ length: Math.min(120, 510 - start) }, (_, i) =>
        measurement(start + i),
      ),
    );
  }
  const page = await store.exportPage(users[0]!);
  assert.equal(page.measurements.length, 500);
  assert.ok(page.next);
  const rest = await store.exportPage(users[0]!, page.next);
  assert.equal(rest.measurements.length, 10);
  assert.equal(rest.next, null);
  assert.equal(
    new Set(
      [...page.measurements, ...rest.measurements].map((m) => m.timestamp),
    ).size,
    510,
  );
  const range = {
    start: startedAt,
    end: new Date(base + 510_000).toISOString(),
    source: 'mock' as const,
  };
  const overview = await store.timeline(users[0]!, range);
  assert.equal(overview.summary.count, 510);
  assert.equal(overview.summary.observedSeconds, 510);
  assert.equal(overview.summary.pulse.mean, 71);
  assert.equal(overview.summary.pulse.count, 510);
  assert.equal(overview.summary.hrv.mean, null);
  assert.equal(overview.points.length, 17);
  assert.equal(overview.activities.length, 1);
  assert.equal(overview.activities[0]?.activity, null);
  assert.equal(overview.gaps.length, 0);
  assert.equal((await store.timeline(users[1]!, range)).summary.count, 0);
  const contextSession = randomUUID();
  const contexts = [
    measurement(1000, { sessionId: contextSession, activity: 'Coding' }),
    measurement(1001, { sessionId: contextSession, activity: 'Break' }),
    measurement(1004, {
      sessionId: contextSession,
      activity: 'Break',
      signalQuality: 'poor',
    }),
    measurement(1005, {
      sessionId: contextSession,
      activity: 'Break',
      pulseConfidence: 0.1,
      respirationRate: 18,
      respirationConfidence: 0.9,
    }),
    measurement(1006, {
      sessionId: contextSession,
      activity: 'Break',
      talking: true,
      hrvRmssd: 35,
      hrvConfidence: 0.9,
    }),
  ];
  await store.ingest(users[0]!, contexts);
  await store.ingest(users[0]!, [
    measurement(1000, { sessionId: randomUUID(), source: 'demo_seed' }),
  ]);
  const contextRange = {
    start: new Date(base + 1000_000).toISOString(),
    end: new Date(base + 1007_000).toISOString(),
    source: 'mock' as const,
  };
  const context = await store.timeline(users[0]!, contextRange);
  assert.equal(context.summary.count, 5);
  assert.equal(context.summary.pulse.mean, 71.5);
  assert.equal(context.summary.pulse.count, 2);
  assert.equal(context.summary.respiration.mean, 18);
  assert.equal(context.summary.hrv.mean, null);
  assert.deepEqual(
    context.activities.map((p) => p.activity),
    ['Coding', 'Break', 'Break'],
  );
  assert.deepEqual(
    context.gaps.map((g) => g.kind),
    ['missing', 'withheld', 'withheld'],
  );
  assert.equal(context.gaps[0]?.start, new Date(base + 1002_000).toISOString());
  assert.equal(context.gaps[0]?.end, new Date(base + 1004_000).toISOString());
  assert.equal(context.points[0]?.start, contextRange.start);
  assert.equal(context.points[0]?.end, contextRange.end);
  const selection = await store.timeline(users[0]!, {
    ...contextRange,
    end: new Date(base + 1002_000).toISOString(),
  });
  assert.equal(selection.summary.count, 2);
  assert.equal(selection.summary.observedSeconds, 2);
  assert.equal(selection.activities.length, 2);
  assert.equal(selection.gaps.length, 0);
  assert.equal(
    (await store.timeline(users[0]!, { ...contextRange, source: 'demo_seed' }))
      .summary.count,
    1,
  );
  assert.equal(
    (await store.timeline(users[0]!, { ...contextRange, source: 'live' }))
      .summary.count,
    0,
  );
  assert.equal(
    (await store.exportPage(users[0]!, page.next!)).measurements.at(-2)
      ?.activity,
    'Break',
  );
  // Exercise all display caps without generating thousands of API round trips.
  // These direct SQL fixtures belong only to a third random mock-only owner.
  const boundedStart = new Date(base - 25.5 * 3600_000).toISOString();
  const boundedSessions = [randomUUID(), randomUUID()];
  await store.pool.query('INSERT INTO users(id) VALUES($1)', [users[2]]);
  for (const id of boundedSessions) {
    await store.pool.query(
      "INSERT INTO sessions(id,user_id,source,started_at) VALUES($1,$2,'mock',$3)",
      [id, users[2], boundedStart],
    );
    await store.pool.query(
      `INSERT INTO measurements(timestamp,event_id,user_id,session_id,source,pulse_rate,pulse_confidence,signal_quality)
      SELECT $1::timestamptz+n*interval '30 seconds',gen_random_uuid(),$2,$3,'mock',72,0.9,'good' FROM generate_series(0,3000) n`,
      [boundedStart, users[2], id],
    );
  }
  const bounded = await store.timeline(users[2]!, {
    start: boundedStart,
    end: startedAt,
    source: 'mock',
  });
  assert.equal(bounded.limited, true);
  assert.equal(bounded.points.length, 6000);
  assert.equal(bounded.activities.length, 3000);
  assert.equal(bounded.gaps.length, 3000);
  assert.equal(bounded.summary.count, 6002);
  assert.equal(bounded.summary.observedSeconds, 3001);
  assert.equal(bounded.summary.sessions, 2);
  assert.equal(bounded.summary.pulse.mean, 72);
  await verifyContext(store, users, base);
  const other = measurement(0, { sessionId: randomUUID(), source: 'live' });
  await store.ingest(users[1]!, [other]);
  await store.deleteData(users[0]!);
  assert.equal((await store.exportPage(users[0]!)).measurements.length, 0);
  assert.equal((await store.timeline(users[0]!, range)).summary.count, 0);
  assert.equal(
    (
      await store.pool.query('SELECT 1 FROM epochs WHERE user_id=$1', [
        users[0],
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(store.ingest(users[0]!, m), SessionConflict);
  assert.equal((await store.exportPage(users[1]!)).measurements.length, 1);
  console.log(
    'Timescale verification passed: migrations, hypertable, batching, idempotency, concurrent epochs, rollback, ownership, pagination, timeline ranges/quality/activity/gaps/source isolation/display caps, context consent payloads/provenance/immutable IDs/overlap/concurrency/pagination/scoping/clipping/display caps, deletion and replay protection.',
  );
} catch (error) {
  const code = (error as { code?: unknown }).code;
  const location =
    error instanceof Error
      ? error.stack?.match(/(?:verify(?:-context)?|timeline)\.ts:\d+:\d+/)?.[0]
      : undefined;
  if (typeof code === 'string' && /^[A-Z0-9_]{5,32}$/.test(code))
    console.error(`Verification error code: ${code}`);
  if (location) console.error(`Verification location: ${location}`);
  console.error(
    'Database verification failed; no credentials or private records logged. Check database setup and run checks again.',
  );
  process.exitCode = 1;
} finally {
  try {
    for (const user of users) {
      await store.deleteData(user);
      await store.pool.query('DELETE FROM users WHERE id=$1', [user]);
    }
  } catch {
    console.error(
      'Fixture cleanup failed; only isolated test owners were used.',
    );
    process.exitCode = 1;
  }
  await store.close();
}
