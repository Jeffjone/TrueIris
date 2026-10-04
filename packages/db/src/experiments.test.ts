import { expect, it } from 'vitest';
import {
  experimentDefinitionSchema,
  experimentSessionSchema,
} from '@trueiris/schemas';
import {
  MemoryExperiments,
  ExperimentConflict,
  ExperimentNotFound,
} from './experiments';
import { createReasoningFixture } from '../../../apps/api/src/agents/fixtures';
const definition = experimentDefinitionSchema.parse({
  title: 'Music',
  hypothesis: 'Do sessions differ?',
  conditions: ['Music', 'No Music'],
  minimumSessions: 7,
  source: 'mock',
  timezone: 'UTC',
  activity: 'Coding',
  criteria: [
    { metric: 'session_duration', meaningfulDifference: 5 },
    { metric: 'focus_rating', meaningfulDifference: 1 },
    { metric: 'pulse_deviation', meaningfulDifference: 10 },
  ],
});
const input = {
  condition: 'Music',
  range: {
    start: '2026-10-03T10:00:00.000Z',
    end: '2026-10-03T10:01:00.000Z',
    source: 'mock' as const,
  },
  rating: 5,
  notes: null,
};
it('computes session evidence, keeps provenance, prevents duplicates/overlaps and respects status and owner', async () => {
  const { store } = createReasoningFixture(),
    experiments = new MemoryExperiments(store);
  const e = await experiments.create('owner', definition);
  const [first, retry] = await Promise.all([
    experiments.record('owner', e.id, input),
    experiments.record('owner', e.id, input),
  ]);
  expect(first.sessions).toHaveLength(1);
  expect(retry.sessions).toHaveLength(1);
  expect(
    (
      await experiments.record('owner', e.id, {
        ...input,
        range: {
          ...input.range,
          start: input.range.start.replace('.000Z', 'Z'),
          end: input.range.end.replace('.000Z', 'Z'),
        },
      })
    ).sessions,
  ).toHaveLength(1);
  expect(first.sessions[0]?.metrics).toMatchObject({
    session_duration: 1,
    focus_rating: 5,
    pulse_deviation: 12.5,
  });
  expect(first.sessions[0]?.evidence.retrospective).toBe(true);
  await expect(
    experiments.record('owner', e.id, { ...input, condition: 'No Music' }),
  ).rejects.toBeInstanceOf(ExperimentConflict);
  await expect(experiments.get('other', e.id)).rejects.toBeInstanceOf(
    ExperimentNotFound,
  );
  await expect(
    experiments.record('owner', e.id, {
      ...input,
      range: { ...input.range, source: 'live' },
    }),
  ).rejects.toBeInstanceOf(ExperimentConflict);
  await experiments.status('owner', e.id, 'paused');
  await expect(experiments.record('owner', e.id, input)).rejects.toBeInstanceOf(
    ExperimentConflict,
  );
  await experiments.status('owner', e.id, 'active');
  const sparse = await experiments.record('owner', e.id, {
    ...input,
    range: {
      start: '2026-10-03T11:00:00.000Z',
      end: '2026-10-03T12:00:00.000Z',
      source: 'mock',
    },
    rating: null,
  });
  expect(sparse.sessions[1]?.metrics.pulse_deviation).toBeNull();
  expect(sparse.sessions[1]?.metrics.focus_rating).toBeNull();
  await experiments.removeSession('owner', e.id, first.sessions[0]!.id);
  expect((await experiments.get('owner', e.id)).sessions).toHaveLength(1);
  await experiments.remove('owner', e.id);
  expect(await experiments.list('owner')).toEqual([]);
});
it('rejects forged metrics and invalid definitions, including identical conditions and duplicate measures', () => {
  expect(
    experimentDefinitionSchema.safeParse({
      ...definition,
      conditions: ['Music', ' music '],
    }).success,
  ).toBe(false);
  expect(
    experimentDefinitionSchema.safeParse({
      ...definition,
      criteria: [definition.criteria[0], definition.criteria[0]],
    }).success,
  ).toBe(false);
  expect(
    experimentSessionSchema.safeParse({
      input,
      metrics: { pulse_deviation: 999 },
    }).success,
  ).toBe(false);
});
