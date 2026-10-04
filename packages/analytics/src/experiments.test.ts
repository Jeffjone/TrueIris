import { expect, it } from 'vitest';
import { compareExperiment } from './experiments';
import type { Experiment, ExperimentSession } from '@trueiris/schemas';
const experiment: Experiment = {
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-09-01T00:00:00.000Z',
  status: 'active',
  definition: {
    title: 'Music',
    hypothesis: 'Do sessions differ?',
    conditions: ['Music', 'No Music'],
    minimumSessions: 7,
    source: 'mock',
    timezone: 'UTC',
    activity: 'Coding',
    criteria: [{ metric: 'focus_rating', meaningfulDifference: 1 }],
  },
};
function sessions(
  a: (number | null)[],
  b: (number | null)[],
): ExperimentSession[] {
  return [a, b].flatMap((values, condition) =>
    values.map(
      (value, i) =>
        ({
          id: `fixture-${condition}-${i}`,
          experimentId: experiment.id,
          recordedAt: '2026-10-01T00:00:00.000Z',
          input: {
            condition: experiment.definition.conditions[condition]!,
            rating: value,
            notes: null,
            range: {
              start: new Date(
                Date.UTC(2026, 8, i + 1, condition + 10),
              ).toISOString(),
              end: new Date(
                Date.UTC(2026, 8, i + 1, condition + 11),
              ).toISOString(),
              source: 'mock',
            },
          },
          metrics: {
            focus_rating: value,
            session_duration: 60,
            pulse_deviation: null,
            hrv_deviation: null,
          },
          evidence: {},
        }) as ExperimentSession,
    ),
  );
}
it('distinguishes support, observed association and predeclared practical differences without causal significance claims', () => {
  expect(
    compareExperiment(experiment, sessions([5, 5, 5], [2, 2, 2, 2]))[0],
  ).toMatchObject({
    state: 'meaningful_difference',
    difference: -3,
    observedDifferenceRange: [-3, -3],
  });
  expect(
    compareExperiment(experiment, sessions([3, 3, 3], [3, 3, 3, 3]))[0]?.state,
  ).toBe('no_meaningful_difference');
  expect(
    compareExperiment(experiment, sessions([2, 3, 4], [2, 4, 5, 5]))[0]?.state,
  ).toBe('observed_association');
  expect(
    compareExperiment(experiment, sessions([5, 5, null], [2, 2, 2, 2]))[0]
      ?.state,
  ).toBe('insufficient_data');
  const sameDate = sessions([5, 5, 5], [2, 2, 2, 2]).map((s) => ({
    ...s,
    input: {
      ...s.input,
      range: { ...s.input.range, start: '2026-09-01T10:00:00.000Z' },
    },
  }));
  expect(compareExperiment(experiment, sameDate)[0]?.state).toBe(
    'insufficient_data',
  );
});
it('counts independent sessions rather than reading counts and keeps absent physiological values out of comparisons', () => {
  const e = {
    ...experiment,
    definition: {
      ...experiment.definition,
      criteria: [
        { metric: 'hrv_deviation' as const, meaningfulDifference: 10 },
      ],
    },
  };
  const values = sessions([5, 5, 5], [2, 2, 2, 2]);
  expect(
    compareExperiment(e, values)[0]?.conditions.map((c) => c.count),
  ).toEqual([0, 0]);
  expect(compareExperiment(e, values)[0]?.difference).toBeNull();
});
