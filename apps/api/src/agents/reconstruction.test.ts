import { expect, it } from 'vitest';
import { runAgent } from './agent';
import { reconstructEvents } from './reconstruction';
import { createReasoningFixture, fixtureRequest } from './fixtures';
import { MockReasoningProvider, type ReasoningProvider } from './provider';
const range = {
  start: '2026-10-04T09:00:00.000Z',
  end: '2026-10-04T09:30:00.000Z',
  source: 'mock' as const,
};
it('reconstructs only chronological first-party evidence, suppressing titles, unsupported work and gap-spanning trends', async () => {
  const { store } = createReasoningFixture();
  const data = await store.timeline('fixture', range);
  const baseline = await store.baselines('fixture', {
    range,
    context: { kind: 'activity', activity: 'Coding' },
    timezone: 'UTC',
    lookbackDays: 30,
  });
  const evidence = reconstructEvents(data, baseline, 'e1');
  const text = JSON.stringify(evidence);
  expect(text).toContain('Recorded');
  expect(text).toContain('earlier Coding baseline');
  expect(text).not.toContain('PRIVATE TITLE');
  expect(text).not.toContain('authentication');
  expect(text).not.toContain('opening time was');
  expect(text).not.toContain('closer to that earlier baseline'); // The fixture has a long gap between epochs.
  const events = evidence.facts.filter(
    (f) => !evidence.limitations.includes(f.id),
  );
  expect(events.map((e) => e.range!.start)).toEqual(
    events.map((e) => e.range!.start).sort(),
  );
  data.contexts!.push({
    ...data.contexts![0]!,
    id: '00000000-0000-4000-8000-000000000009',
  });
  const ambiguous = reconstructEvents({ ...data, limited: true }, null, 'e1');
  expect(ambiguous.facts.some((f) => f.text.includes('foreground'))).toBe(
    false,
  );
  expect(ambiguous.facts.some((f) => f.text.includes('Overlapping'))).toBe(
    true,
  );
  expect(ambiguous.status).toBe('limited');
});
it('pins the exact selection and owner, requires event retrieval and returns a cited Gemini-ordered narrative', async () => {
  const { store, scopes } = createReasoningFixture();
  const mock = new MockReasoningProvider(),
    seen: string[] = [];
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (contents, signal) => {
      seen.push(JSON.stringify(contents));
      return mock.next(contents, signal);
    },
  };
  const result = await runAgent({
    request: {
      ...fixtureRequest,
      question: 'What happened here?',
      reconstructionRange: range,
    },
    store,
    provider,
    userId: 'owner',
    signal: new AbortController().signal,
    now: () => Date.parse(range.end),
  });
  expect(result.data?.explanationRange).toEqual(range);
  expect(result.data?.evidence.map((e) => e.tool)).toEqual([
    'reconstruct_events',
  ]);
  expect(result.data?.answer).not.toContain('Iris could not finish');
  expect(result.data?.selectedFacts.length).toBeGreaterThan(2);
  expect(
    scopes.every(
      (s) =>
        s.userId === 'owner' &&
        JSON.stringify(s.range) === JSON.stringify(range),
    ),
  ).toBe(true);
  expect(seen.join('')).not.toContain('PRIVATE TITLE');
  const empty = await runAgent({
    request: {
      ...fixtureRequest,
      source: 'live',
      question: 'What happened here?',
      reconstructionRange: { ...range, source: 'live' },
    },
    store,
    provider: mock,
    userId: 'owner',
    signal: new AbortController().signal,
    now: () => Date.parse(range.end),
  });
  expect(empty.data?.answer).toContain('No reconstructable observations');
  expect(empty.state).toBe('partial');
});
it('rejects changed source/future range and cannot answer without the pinned retrieval', async () => {
  const { store } = createReasoningFixture();
  const provider: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async () => ({
      role: 'model',
      parts: [
        { functionCall: { name: 'respond', args: { factIds: ['e1.f1'] } } },
      ],
    }),
  };
  const options = {
    store,
    provider,
    userId: 'owner',
    signal: new AbortController().signal,
    now: () => Date.parse(range.end),
  };
  await expect(
    runAgent({
      ...options,
      request: {
        ...fixtureRequest,
        question: 'What happened here?',
        reconstructionRange: { ...range, source: 'live' },
      },
    }),
  ).rejects.toThrow();
  expect(
    (
      await runAgent({
        ...options,
        request: {
          ...fixtureRequest,
          question: 'What happened here?',
          reconstructionRange: { ...range, end: '2026-10-04T10:30:00.000Z' },
        },
      })
    ).state,
  ).toBe('unavailable');
  expect(
    (
      await runAgent({
        ...options,
        request: {
          ...fixtureRequest,
          question: 'What happened here?',
          reconstructionRange: range,
        },
      })
    ).data,
  ).toBeNull();
});
