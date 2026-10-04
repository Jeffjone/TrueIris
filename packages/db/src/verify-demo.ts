import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TigerStore } from './index';
export async function verifyDemo(store: TigerStore, owners: string[]) {
  const [owner, other] = owners as [string, string];
  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const live = {
    eventId: randomUUID(),
    sessionId: randomUUID(),
    timestamp: new Date(now.getTime() - 1000).toISOString(),
    startedAt: new Date(now.getTime() - 1000).toISOString(),
    source: 'live' as const,
    pulseRate: 72,
    pulseConfidence: 0.9,
    signalQuality: 'good' as const,
  };
  await store.ingest(owner, [live]);
  const mock = {
    ...live,
    eventId: randomUUID(),
    sessionId: randomUUID(),
    source: 'mock' as const,
  };
  const unrelated = {
    ...live,
    eventId: randomUUID(),
    sessionId: randomUUID(),
    source: 'demo_seed' as const,
  };
  await store.ingest(owner, [mock, unrelated]);
  await store.ingest(other, [
    {
      ...live,
      eventId: randomUUID(),
      sessionId: randomUUID(),
      source: 'demo_seed',
    },
  ]);
  const seeded = await store.demo.seed(owner, now);
  assert.equal(
    (await store.demo.seed(owner, now)).measurementCount,
    seeded.measurementCount,
  );
  assert.equal(await store.demo.get(other), null);
  const snapshot = await store.pool.query(
    "SELECT count(*)::int AS n FROM measurements WHERE user_id=$1 AND source='demo_seed'",
    [owner],
  );
  assert.equal(snapshot.rows[0].n, seeded.measurementCount + 1);
  const coding = seeded.episodes.filter((e) => e.activity === 'Coding').at(-1)!;
  const timeline = await store.timeline(owner, coding.range);
  assert.equal(timeline.summary.count, coding.readings);
  assert.ok(Math.abs(timeline.summary.pulse.mean! - coding.pulse) < 1e-8);
  const baseline = await store.baselines(owner, {
    range: coding.range,
    context: { kind: 'activity', activity: 'Coding' },
    timezone: 'UTC',
    lookbackDays: 30,
  });
  assert.equal(baseline.comparisons[0].state, 'ready');
  assert.ok(baseline.comparisons[0].dayCount >= 7);
  const experiment = await store.experiments.get(
    owner,
    seeded.experimentIds[0]!,
  );
  assert.equal(experiment.sessions.length, 7);
  assert.equal(experiment.comparisons[1]!.state, 'meaningful_difference');
  const later = await store.demo.seed(owner, new Date(now.getTime() + 60_000));
  assert.equal(later.episodes.length, seeded.episodes.length);
  assert.equal(
    (
      await store.pool.query(
        'SELECT 1 FROM measurements WHERE user_id=$1 AND session_id=$2',
        [owner, unrelated.sessionId],
      )
    ).rowCount,
    1,
  );
  await store.demo.clear(owner);
  assert.equal(await store.demo.get(owner), null);
  assert.equal((await store.timeline(owner, coding.range)).summary.count, 0);
  assert.equal((await store.experiments.list(owner)).length, 0);
  assert.deepEqual(
    new Set((await store.exportPage(owner)).measurements.map((m) => m.source)),
    new Set(['live', 'mock']),
  );
  assert.equal(
    (await store.exportPage(other)).measurements[0]?.source,
    'demo_seed',
  );
  // A queued seed accepted before deletion must not restore historical data.
  const lock = await store.pool.connect();
  let rejected: Promise<void>;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
    rejected = assert.rejects(
      store.demo.seed(owner, now),
      /Demo preparation predates deletion/,
    );
    await lock.query('UPDATE users SET deleted_before=$2 WHERE id=$1', [
      owner,
      new Date(),
    ]);
    await lock.query('COMMIT');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  await rejected;
  assert.equal(await store.demo.get(owner), null);
  assert.equal((await store.timeline(owner, coding.range)).summary.count, 0);
  // A later explicit request can prepare fresh, clearly generated history.
  assert.equal(
    (await store.demo.seed(owner)).measurementCount,
    seeded.measurementCount,
  );
  await store.demo.clear(owner);
  console.log(
    'Demo SQL checks passed: deterministic seed, exact summaries, supported baselines, experiment comparisons, isolated refresh, deletion replay barrier and source-only clearing; live and foreign records preserved.',
  );
}
