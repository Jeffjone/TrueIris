import { expect, it } from 'vitest';
import { generateDemo } from '../../../../packages/db/src/demo-generator';
import { createReasoningFixture, fixtureRequest } from './fixtures';
import { executeTool } from './tools';
it('retrieves only scoped, explicitly authored demo summaries and keeps real semantic memory unavailable', async () => {
  const data = generateDemo(
    'demo-owner',
    new Date('2026-10-04T18:00:00Z'),
  ).dataset;
  const { store } = createReasoningFixture();
  store.demo = {
    get: async (owner) => (owner === 'demo-owner' ? data : null),
    seed: async () => data,
    clear: async () => {},
  };
  const options = {
    store,
    userId: 'demo-owner',
    request: { ...fixtureRequest, source: 'demo_seed' as const },
    asOf: '2026-10-04T18:00:00.000Z',
    id: 'e1',
    signal: new AbortController().signal,
  };
  const evidence = await executeTool(
    'search_memories',
    { query: 'coding music', limit: 3 },
    options,
  );
  expect(evidence.status).toBe('ready');
  const episodes = evidence.facts.filter((f) => f.range);
  expect(episodes).toHaveLength(3);
  expect(
    episodes.every(
      (f) => f.range?.source === 'demo_seed' && f.text.includes('Generated'),
    ),
  ).toBe(true);
  expect(
    evidence.facts.find((f) => f.id === evidence.limitations[0])?.text,
  ).toContain('matches words only');
  expect(
    (
      await executeTool(
        'search_memories',
        { query: 'coding', limit: 3 },
        { ...options, userId: 'other' },
      )
    ).status,
  ).toBe('unavailable');
  expect(
    (
      await executeTool(
        'search_memories',
        { query: 'coding', limit: 3 },
        { ...options, request: { ...fixtureRequest, source: 'live' } },
      )
    ).status,
  ).toBe('unavailable');
  expect(
    (
      await executeTool(
        'search_memories',
        { query: 'unrelated', limit: 3 },
        options,
      )
    ).status,
  ).toBe('empty');
});
