import { expect, it, vi } from 'vitest';
import type { ReasoningProvider, ModelContent } from './provider';
import { AgentService, runAgent } from './agent';
import { createReasoningFixture, fixtureRequest } from './fixtures';
import { executeTool, toolDeclarations, toolSchemas } from './tools';
import { dateKey, dayRange } from './time';
const now = () => Date.parse('2026-10-04T16:00:00Z');
const range = {
  start: '2026-10-04T15:30:00.000Z',
  end: '2026-10-04T16:00:00.000Z',
};
const call = (
  name: string,
  args: Record<string, unknown>,
  thoughtSignature?: string,
): ModelContent => ({
  role: 'model',
  parts: [
    {
      functionCall: { name, args, id: 'call-id' },
      ...(thoughtSignature ? { thoughtSignature } : {}),
    },
  ],
});
function scripted(turns: ModelContent[]): ReasoningProvider {
  return {
    kind: 'gemini',
    configured: true,
    next: vi.fn(async () => turns.shift()!),
  };
}
it('executes multi-step owner/source-bound retrieval and renders only cited facts', async () => {
  const { store, scopes } = createReasoningFixture();
  const provider = scripted([
    call('get_metrics', { range, metric: 'pulse' }, 'opaque-signature'),
    call('compare_baseline', {
      range,
      metric: 'pulse',
      context: { kind: 'activity', activity: 'Coding' },
    }),
    call('respond', { factIds: ['e1.f1', 'e2.f2'] }),
  ]);
  const result = await runAgent({
    request: fixtureRequest,
    provider,
    store,
    userId: 'owner',
    signal: new AbortController().signal,
    now,
  });
  expect(result.state).toBe('ready');
  expect(result.data?.answer).toContain('12.5% above');
  expect(result.data?.selectedFacts.map((f) => f.id)).toEqual([
    'e1.f1',
    'e2.f2',
  ]);
  expect(scopes).toEqual([
    { userId: 'owner', range: { ...range, source: 'mock' } },
  ]);
  const next = vi.mocked(provider.next);
  expect(next.mock.calls[1]![0][1]).toMatchObject({
    parts: [{ thoughtSignature: 'opaque-signature' }],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /opaque-signature|PRIVATE TITLE|call-id/,
  );
});
it('rejects arbitrary SQL, oversized ranges, unknown fields and invented citations', async () => {
  const { store, scopes } = createReasoningFixture();
  const provider = scripted([
    call('execute_sql', { sql: 'DELETE FROM measurements' }),
    call('get_metrics', { range, metric: 'pulse', userId: 'forged' }),
    call('get_metrics', { range, metric: 'pulse' }),
    call('respond', { factIds: ['e99.f1'] }),
  ]);
  const result = await runAgent({
    request: fixtureRequest,
    provider,
    store,
    userId: 'owner',
    signal: new AbortController().signal,
    now,
  });
  expect(result.state).toBe('partial');
  expect(scopes).toHaveLength(1);
  expect(result.data?.selectedFacts.every((f) => f.id.startsWith('e1.'))).toBe(
    true,
  );
  expect(JSON.stringify(result)).not.toContain('DELETE');
  expect(
    toolSchemas.get_metrics.safeParse({
      range: { ...range, end: '2026-10-08T16:00:00Z' },
      metric: 'pulse',
    }).success,
  ).toBe(false);
  expect(
    toolSchemas.get_current_state.safeParse({ token: 'private' }).success,
  ).toBe(false);
  expect(
    toolDeclarations.every((t) => t.parametersJsonSchema.type === 'object'),
  ).toBe(true);
});
it('bounds repeated calls and retains useful evidence after provider/storage failures', async () => {
  const { store } = createReasoningFixture();
  const provider = {
    kind: 'mock' as const,
    configured: true,
    next: vi.fn(async () => call('get_metrics', { range, metric: 'pulse' })),
  };
  const result = await runAgent({
    request: fixtureRequest,
    provider,
    store,
    userId: 'owner',
    signal: new AbortController().signal,
    now,
  });
  expect(provider.next).toHaveBeenCalledTimes(8);
  expect(result.state).toBe('partial');
  expect(result.data?.evidence).toHaveLength(8);
  vi.spyOn(store, 'timeline').mockRejectedValue(
    new Error('private connection password'),
  );
  const failure = await runAgent({
    request: fixtureRequest,
    provider: scripted([
      call('get_metrics', { range, metric: 'pulse' }),
      call('respond', { factIds: ['e1.f1'] }),
    ]),
    store,
    userId: 'owner',
    signal: new AbortController().signal,
    now,
  });
  expect(failure.state).toBe('partial');
  expect(failure.data?.answer).toContain('could not be retrieved');
  expect(JSON.stringify(failure)).not.toContain('password');
});
it('cancels stalled providers immediately, enforces admission and releases the request slot', async () => {
  const { store } = createReasoningFixture();
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async () => new Promise(() => {}),
  };
  const service = new AgentService(provider, store, 'owner');
  const pending = service.ask(fixtureRequest, new AbortController().signal);
  expect(
    (await service.ask(fixtureRequest, new AbortController().signal)).state,
  ).toBe('busy');
  service.cancel();
  expect((await pending).state).toBe('cancelled');
  provider.next = async () => call('get_current_state', {});
  const controller = new AbortController();
  controller.abort();
  expect((await service.ask(fixtureRequest, controller.signal)).state).toBe(
    'cancelled',
  );
});
it('withholds mixed-source/stale local readings and never derives a diagnosis', async () => {
  const { store } = createReasoningFixture();
  const request = {
    ...fixtureRequest,
    current: {
      ...fixtureRequest.current,
      reading: {
        timestamp: '2026-10-04T15:59:59.000Z',
        sessionId: '00000000-0000-4000-8000-000000000003',
        source: 'live' as const,
        signalQuality: 'good' as const,
        pulseRate: 90,
        pulseConfidence: 0.9,
      },
    },
  };
  const result = await executeTool(
    'get_current_state',
    {},
    {
      store,
      userId: 'owner',
      request,
      asOf: new Date(now()).toISOString(),
      id: 'e1',
      signal: new AbortController().signal,
    },
  );
  expect(result.facts.some((f) => f.value === 90)).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/stressed|anxious|heart problem/);
});
it('reports unavailable memory and bounded historical matches without semantic claims', async () => {
  const { store } = createReasoningFixture();
  const options = {
    store,
    userId: 'owner',
    request: fixtureRequest,
    asOf: new Date(now()).toISOString(),
    id: 'e1',
    signal: new AbortController().signal,
  };
  const memory = await executeTool(
    'search_memories',
    { query: 'coding', limit: 3 },
    options,
  );
  expect(memory.status).toBe('unavailable');
  const history = await executeTool(
    'find_similar_sessions',
    {
      range: { start: '2026-09-04T15:30:00Z', end: range.start },
      activity: 'Coding',
      description: 'coding sessions',
      limit: 3,
    },
    options,
  );
  expect(history.facts[0]?.text).toContain('recency only');
  expect(history.facts.some((f) => f.value === 74)).toBe(true);
});
it('honors DST calendar boundaries and excludes future/invalid dates', async () => {
  const spring = dayRange('2026-03-08', 'America/Chicago'),
    fall = dayRange('2026-11-01', 'America/Chicago');
  expect(Date.parse(spring.end) - Date.parse(spring.start)).toBe(23 * 3600_000);
  expect(Date.parse(fall.end) - Date.parse(fall.start)).toBe(25 * 3600_000);
  expect(dateKey(Date.parse(spring.start), 'America/Chicago')).toBe(
    '2026-03-08',
  );
  expect(() => dayRange('2026-02-30', 'UTC')).toThrow();
  const { store } = createReasoningFixture();
  expect(
    await runAgent({
      request: fixtureRequest,
      provider: scripted([
        call('get_daily_summary', { date: '2026-10-05' }),
        call('respond', { factIds: ['e1.f1'] }),
      ]),
      store,
      userId: 'owner',
      signal: new AbortController().signal,
      now,
    }),
  ).toMatchObject({ state: 'partial' });
});
it('retains explicit missing-context facts even when the model selects only recorded labels', async () => {
  const { store } = createReasoningFixture();
  const original = store.timeline;
  vi.spyOn(store, 'timeline').mockImplementation(async (user, query) => ({
    ...(await original(user, query)),
    contexts: [],
  }));
  const result = await runAgent({
    request: fixtureRequest,
    provider: scripted([
      call('get_context', { range }),
      call('respond', { factIds: ['e1.f1'] }),
    ]),
    store,
    userId: 'owner',
    signal: new AbortController().signal,
    now,
  });
  expect(result.state).toBe('partial');
  expect(result.data?.selectedFacts.map((f) => f.id)).toContain('e1.f2');
  expect(result.data?.answer).toContain('No desktop context was saved');
});
