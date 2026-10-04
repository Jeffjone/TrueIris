import { expect, it, vi } from 'vitest';
import {
  agentResultSchema,
  isRecentExplanation,
  recentExplanationRange,
  type TimelineData,
} from '@trueiris/schemas';
import { runAgent } from './agent';
import { createReasoningFixture, fixtureRequest } from './fixtures';
import {
  MockReasoningProvider,
  type ModelContent,
  type ReasoningProvider,
} from './provider';
import { localDaypart, recentContext } from './recent';
import { pulseTrajectory } from './trajectory';

const asOf = '2026-10-04T16:00:00.000Z';
const range = {
  start: '2026-10-04T15:30:00.000Z',
  end: asOf,
  source: 'mock' as const,
};
const request = {
  ...fixtureRequest,
  question: 'Iris, explain the last 30 minutes.',
};
const context = { kind: 'activity', activity: 'Coding' } as const;
const signal = () => new AbortController().signal;
function options(
  store: ReturnType<typeof createReasoningFixture>['store'],
  provider: ReasoningProvider = new MockReasoningProvider(),
) {
  return {
    request,
    provider,
    store,
    userId: 'owner',
    signal: signal(),
    now: () => Date.parse(asOf),
  };
}
it('retrieves every category for the exact source-bound window using one history snapshot and baseline query', async () => {
  const { store, scopes } = createReasoningFixture();
  const baseline = vi.spyOn(store, 'baselines'),
    history = vi.spyOn(store, 'similarSessions');
  const result = await runAgent(options(store));
  expect(result.state).toBe('ready');
  expect(result.data?.explanationRange).toEqual(range);
  expect(result.data?.evidence).toHaveLength(8);
  expect(scopes).toEqual([{ userId: 'owner', range }]);
  expect(baseline).toHaveBeenCalledTimes(1);
  expect(baseline.mock.calls[0]).toEqual([
    'owner',
    { range, context, timezone: 'UTC', lookbackDays: 30 },
  ]);
  expect(history).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({
      source: 'mock',
      activity: 'Coding',
      limit: 3,
      range: { start: '2026-09-04T15:30:00.000Z', end: range.start },
    }),
  );
  expect(result.data?.answer).toContain('12.5% above');
  expect(result.data?.answer).toContain('was closer to your earlier baseline');
  expect(result.data?.answer).toContain(
    'intervening unrecorded time remains unknown',
  );
  expect(result.data?.answer).toContain('Respiration averaged 12.0');
  expect(result.data?.answer).toContain('historical period');
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE TITLE|stressed|anxious|diagnos|caused/,
  );
});
it('recognizes the text command and pins 30 elapsed minutes across midnight and DST', () => {
  for (const question of [
    'Iris, explain the last 30 minutes.',
    'explain last 30 minutes',
    '  EXPLAIN THE LAST 30 MINUTES!  ',
  ])
    expect(isRecentExplanation(question)).toBe(true);
  for (const question of [
    'Explain the last 30 hours',
    'Compare yesterday with last 30 minutes',
    'Explain the last 60 minutes',
  ])
    expect(isRecentExplanation(question)).toBe(false);
  for (const end of [
    '2026-11-01T07:10:00.000Z',
    '2026-03-08T08:10:00.000Z',
    '2026-10-05T00:10:00.000Z',
  ]) {
    const pinned = recentExplanationRange(
      { ...request, timezone: 'America/Chicago' },
      end,
    )!;
    expect(Date.parse(pinned.end) - Date.parse(pinned.start)).toBe(1_800_000);
    expect(pinned.end).toBe(end);
  }
  expect(localDaypart('2026-10-05T05:00:00.000Z', 'America/Chicago')).toBe(
    'night',
  );
});
it('rejects premature answers, unrelated ranges, and guessed activity context, then allows corrected retrieval', async () => {
  const { store, scopes } = createReasoningFixture();
  const mock = new MockReasoningProvider();
  const bad: ModelContent[] = [
    {
      role: 'model',
      parts: [
        { functionCall: { name: 'respond', args: { factIds: ['e1.f1'] } } },
      ],
    },
    {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'get_metrics',
            args: {
              range: { start: '2026-10-04T12:00:00.000Z', end: asOf },
              metric: 'pulse',
            },
          },
        },
      ],
    },
    {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'compare_baseline',
            args: {
              range: { start: range.start, end: range.end },
              metric: 'pulse',
              context: { kind: 'activity', activity: 'Meeting' },
            },
          },
        },
      ],
    },
  ];
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (contents, abort) => bad.shift() ?? mock.next(contents, abort),
  };
  const result = await runAgent(options(store, provider));
  expect(result.state).toBe('ready');
  expect(scopes).toEqual([{ userId: 'owner', range }]);
  expect(result.data?.evidence).toHaveLength(8);
});
it('preserves missing evidence and scopes time-of-day fallback without inventing history', async () => {
  const { store } = createReasoningFixture();
  const original = store.timeline;
  vi.spyOn(store, 'timeline').mockImplementation(async (owner, query) => ({
    ...(await original(owner, query)),
    activities: [],
    contexts: [],
  }));
  const baselines = vi
    .spyOn(store, 'baselines')
    .mockRejectedValue(new Error('PRIVATE DB PASSWORD'));
  vi.spyOn(store, 'similarSessions').mockImplementation(
    async (_owner, query) => ({ query, sessions: [] }),
  );
  const result = await runAgent(options(store));
  expect(result.state).toBe('partial');
  expect(result.data?.explanationRange).toEqual(range);
  expect(result.data?.evidence).toHaveLength(8);
  expect(baselines).toHaveBeenCalledTimes(1);
  expect(baselines.mock.calls[0]![1].context).toEqual({
    kind: 'time_of_day',
    period: 'afternoon',
  });
  expect(result.data?.answer).toContain('No desktop context was saved');
  expect(result.data?.answer).toContain('could not be retrieved');
  expect(result.data?.answer).toContain('No historical activity-matched');
  expect(JSON.stringify(result)).not.toMatch(/PASSWORD|closer to/);
});
it('does not infer an activity from mixed labels or limited chart detail', async () => {
  const { store } = createReasoningFixture();
  const data = await store.timeline('owner', range);
  const mixed: TimelineData = {
    ...data,
    activities: [
      ...data.activities,
      { ...data.activities[0]!, activity: 'Meeting' },
    ],
  };
  expect(recentContext(range, 'UTC', mixed)).toEqual({
    kind: 'time_of_day',
    period: 'afternoon',
  });
  expect(recentContext(range, 'UTC', { ...data, limited: true })).toEqual({
    kind: 'time_of_day',
    period: 'afternoon',
  });
});
it('does not bridge sensing sessions, low-count epochs, unknown labels or insufficient/zero baselines', async () => {
  const { store } = createReasoningFixture();
  const data = await store.timeline('owner', range);
  const comparison = (
    await store.baselines('owner', {
      range,
      context,
      timezone: 'UTC',
      lookbackDays: 30,
    })
  ).comparisons[0];
  const trajectory = (input: TimelineData) =>
    pulseTrajectory(input, comparison, context, 'UTC');
  expect(trajectory(data)).toHaveLength(2);
  const split = {
    ...data,
    points: data.points.map((p, i) => ({
      ...p,
      sessionId: i ? '00000000-0000-4000-8000-000000000009' : p.sessionId,
    })),
    activities: [],
  };
  // Time-of-day matching isolates the cross-session rule from manual label attribution.
  expect(
    pulseTrajectory(
      split,
      comparison,
      { kind: 'time_of_day', period: 'afternoon' },
      'UTC',
    ),
  ).toHaveLength(1);
  expect(
    trajectory({
      ...data,
      points: data.points.map((p) => ({
        ...p,
        pulse: { ...p.pulse, count: 1 },
      })),
    }),
  ).toEqual([]);
  expect(trajectory({ ...data, activities: [] })).toEqual([]);
  expect(trajectory({ ...data, limited: true })).toEqual([]);
  expect(
    pulseTrajectory(
      data,
      { ...comparison, state: 'insufficient_history', baseline: null },
      context,
      'UTC',
    ),
  ).toEqual([]);
  const zero = pulseTrajectory(
    data,
    { ...comparison, baseline: 0 },
    context,
    'UTC',
  );
  expect(zero[0]?.text).toContain('percentage unavailable');
  expect(JSON.stringify(zero)).not.toMatch(/Infinity|NaN/);
});
it('rejects a forged highlight or a highlight on a different question', async () => {
  const { store } = createReasoningFixture();
  const result = await runAgent(options(store));
  expect(
    agentResultSchema.safeParse({
      ...result,
      data: {
        ...result.data,
        explanationRange: { ...range, start: '2026-10-04T15:00:00.000Z' },
      },
    }).success,
  ).toBe(false);
  expect(
    agentResultSchema.safeParse({
      ...result,
      data: { ...result.data, query: fixtureRequest },
    }).success,
  ).toBe(false);
});

it('recovers from an oversized Gemini parallel plan without executing it or losing call IDs', async () => {
  const { store, scopes } = createReasoningFixture();
  const mock = new MockReasoningProvider();
  let first = true;
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (contents, abort) => {
      if (first) {
        first = false;
        return {
          role: 'model',
          parts: Array.from({ length: 5 }, (_, i) => ({
            functionCall: {
              name: 'get_context',
              args: { range: { start: range.start, end: range.end } },
              id: `parallel-${i}`,
            },
          })),
        };
      }
      if (contents.length === 3) {
        expect(scopes).toHaveLength(0);
        expect(contents[2]!.parts).toHaveLength(5);
        expect(contents[2]!.parts[0]).toMatchObject({
          functionResponse: {
            id: 'parallel-0',
            response: {
              error: expect.stringContaining('At most four functions'),
            },
          },
        });
      }
      return mock.next(contents, abort);
    },
  };
  const result = await runAgent(options(store, provider));
  expect(result.state).toBe('ready');
  expect(result.data?.evidence).toHaveLength(8);
  expect(scopes).toEqual([{ userId: 'owner', range }]);
});

it('requires the final narrative to cover all four evidence categories', async () => {
  const { store } = createReasoningFixture();
  const mock = new MockReasoningProvider();
  let omitted = false,
    corrected = false;
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (contents, abort) => {
      const lastResponse = contents.at(-1)?.parts[0]?.functionResponse as
        { response?: { missingNarrativeTools?: string[] } } | undefined;
      if (lastResponse?.response?.missingNarrativeTools) {
        corrected = true;
        expect(lastResponse.response.missingNarrativeTools).toEqual([
          'get_context',
          'compare_baseline',
          'find_similar_sessions',
        ]);
      }
      const content = await mock.next(contents, abort);
      if (!omitted && content.parts[0]?.functionCall?.name === 'respond') {
        omitted = true;
        return {
          role: 'model',
          parts: [
            { functionCall: { name: 'respond', args: { factIds: ['e2.f1'] } } },
          ],
        };
      }
      return content;
    },
  };
  const result = await runAgent(options(store, provider));
  expect(corrected).toBe(true);
  expect(result.state).toBe('ready');
});
