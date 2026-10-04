import assert from 'node:assert/strict';
import { ExperimentConflict, ExperimentNotFound } from './experiments';
import type { TigerStore } from './index';
/** Synthetic metadata and isolated owners only; no user recordings or provider calls. */
export async function verifyExperiments(store: TigerStore, owners: string[]) {
  const [owner, other] = owners as [string, string];
  const definition = {
    title: 'Synthetic experiment',
    hypothesis: 'Synthetic duration comparison',
    conditions: ['Music', 'No Music'] as [string, string],
    minimumSessions: 7,
    source: 'mock' as const,
    timezone: 'UTC',
    activity: 'Coding' as const,
    criteria: [
      { metric: 'session_duration' as const, meaningfulDifference: 5 },
      { metric: 'focus_rating' as const, meaningfulDifference: 1 },
      { metric: 'pulse_deviation' as const, meaningfulDifference: 10 },
    ],
  };
  const experiment = await store.experiments.create(owner, definition);
  await assert.rejects(
    store.experiments.get(other, experiment.id),
    ExperimentNotFound,
  );
  const end = Date.now() - 86400_000;
  for (let i = 0; i < 7; i++) {
    const start = new Date(end - (i + 1) * 86400_000).toISOString();
    const duration = i < 3 ? 10 : 20;
    const input = {
      condition: i < 3 ? 'Music' : 'No Music',
      range: {
        source: 'mock' as const,
        start,
        end: new Date(Date.parse(start) + duration * 60000).toISOString(),
      },
      rating: i < 3 ? 5 : 2,
      notes: 'Synthetic fixture',
    };
    // More requests than pool connections must still serialize without starving
    // the lock holder's evidence queries. Every retry returns the same session.
    const results = await Promise.all(
      Array.from({ length: i === 0 ? 6 : 2 }, () =>
        store.experiments.record(owner, experiment.id, input),
      ),
    );
    for (const result of results) assert.equal(result.sessions.length, i + 1);
    assert.equal(new Set(results.map((r) => r.sessions[0]!.id)).size, 1);
    await assert.rejects(
      store.experiments.record(owner, experiment.id, {
        ...input,
        condition: i < 3 ? 'No Music' : 'Music',
      }),
      ExperimentConflict,
    );
  }
  const result = await store.experiments.get(owner, experiment.id);
  assert.equal(result.comparisons[0]!.state, 'meaningful_difference');
  assert.equal(result.comparisons[1]!.difference, -3);
  assert.equal(result.comparisons[2]!.state, 'insufficient_data');
  assert.equal(
    result.sessions.every((s) => s.metrics.pulse_deviation === null),
    true,
  );
  await store.experiments.status(owner, experiment.id, 'paused');
  await assert.rejects(
    store.experiments.record(owner, experiment.id, result.sessions[0]!.input),
    ExperimentConflict,
  );
  await store.experiments.status(owner, experiment.id, 'completed');
  assert.equal(
    (await store.experiments.get(owner, experiment.id)).experiment.status,
    'completed',
  );
  await store.experiments.removeSession(
    owner,
    experiment.id,
    result.sessions[0]!.id,
  );
  assert.equal(
    (await store.experiments.get(owner, experiment.id)).sessions.length,
    6,
  );
  await store.deleteData(owner);
  assert.equal((await store.experiments.list(owner)).length, 0);
  const newer = await store.experiments.create(owner, definition);
  await assert.rejects(
    store.experiments.record(owner, newer.id, result.sessions[0]!.input),
    ExperimentConflict,
  );
  await store.experiments.remove(owner, newer.id);
  assert.equal(
    (
      await store.pool.query(
        'SELECT 1 FROM experiment_sessions WHERE user_id=$1',
        [owner],
      )
    ).rowCount,
    0,
  );
  console.log(
    'Experiment database checks passed: ownership, immutable definitions, concurrent idempotency, overlap, sparse evidence, practical comparisons, status, session removal, cascading deletion and replay protection.',
  );
}
