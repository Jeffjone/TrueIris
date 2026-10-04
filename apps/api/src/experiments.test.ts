import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { MemoryExperiments } from '@trueiris/db';
import { buildApp } from './app';
import { createReasoningFixture } from './agents/fixtures';
import { ExperimentClient } from '../../desktop/src/main/experiments';
it('runs authenticated, bounded experiment actions through main without allowing caller identities or supplied metrics', async () => {
  const { store } = createReasoningFixture(),
    experiments = new MemoryExperiments(store),
    token = randomUUID() + randomUUID(),
    owner = randomUUID();
  const api = buildApp('silent', { store, experiments, token, userId: owner });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const client = new ExperimentClient(url, token);
  const definition = {
    title: 'Music',
    hypothesis: 'Do sessions differ?',
    conditions: ['Music', 'No Music'] as [string, string],
    minimumSessions: 7,
    source: 'mock' as const,
    timezone: 'UTC',
    activity: 'Coding' as const,
    criteria: [
      { metric: 'session_duration' as const, meaningfulDifference: 5 },
    ],
  };
  try {
    expect(
      (await new ExperimentClient(url, 'wrong').action({ type: 'list' })).state,
    ).toBe('unauthorized');
    expect(
      (
        await new ExperimentClient('http://remote.example', token).action({
          type: 'list',
        })
      ).state,
    ).toBe('not_configured');
    const result = await client.action({ type: 'create', definition });
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Missing fixture');
    const id = result.data.selected!.experiment.id;
    expect((await experiments.list(owner)).map((e) => e.id)).toEqual([id]);
    expect(await experiments.list(randomUUID())).toEqual([]);
    const malformed = await api.inject({
      method: 'POST',
      url: '/experiments/action',
      headers: { authorization: `Bearer ${token}` },
      payload: { type: 'create', definition, userId: randomUUID() },
    });
    expect(malformed.statusCode).toBe(400);
    const raw = {
      condition: 'Music',
      range: {
        start: '2026-10-03T10:00:00.000Z',
        end: '2026-10-03T10:01:00.000Z',
        source: 'mock' as const,
      },
      rating: null,
      notes: null,
    };
    expect(
      (await client.action({ type: 'record', id, input: raw })).state,
    ).toBe('ready');
    const forged = await api.inject({
      method: 'POST',
      url: '/experiments/action',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'record',
        id,
        input: { ...raw, metrics: { pulse: 999 } },
      },
    });
    expect(forged.statusCode).toBe(400);
    expect(
      (
        await client.action({
          type: 'record',
          id,
          input: { ...raw, condition: 'No Music' },
        })
      ).state,
    ).toBe('conflict');
    expect((await client.action({ type: 'get', id: randomUUID() })).state).toBe(
      'not_found',
    );
    expect((await client.action({ type: 'remove', id })).state).toBe('ready');
  } finally {
    await api.close();
  }
});
