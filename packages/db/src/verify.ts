import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import type { Measurement } from '@trueiris/schemas';
import { migrate, SessionConflict, TigerStore } from './index';

// Opt-in real database check: fixtures use random owners and are always scoped/cleaned.
loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.DATABASE_URL)
  throw new Error('Set DATABASE_URL to a Timescale database');
const store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE);
const users = [randomUUID(), randomUUID()];
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
  const other = measurement(0, { sessionId: randomUUID(), source: 'live' });
  await store.ingest(users[1]!, [other]);
  await store.deleteData(users[0]!);
  assert.equal((await store.exportPage(users[0]!)).measurements.length, 0);
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
    'Timescale verification passed: migrations, hypertable, batching, idempotency, concurrent epochs, rollback, ownership, pagination, deletion and replay protection.',
  );
} catch {
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
