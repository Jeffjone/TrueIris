import { expect, it, vi } from 'vitest';
import { ReasoningClient } from './reasoning';
import {
  fixtureRequest,
  createReasoningFixture,
} from '../../../../apps/api/src/agents/fixtures';
import { MockReasoningProvider } from '../../../../apps/api/src/agents/provider';
import { runAgent } from '../../../../apps/api/src/agents/agent';
it('keeps authenticated transport in main, validates answer provenance and rejects wrong-source responses', async () => {
  const { store } = createReasoningFixture();
  const result = await runAgent({
    request: fixtureRequest,
    provider: new MockReasoningProvider(),
    store,
    userId: 'fixture',
    signal: new AbortController().signal,
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(result)));
  const client = new ReasoningClient(
    'http://localhost',
    'private-token',
    fetcher,
  );
  expect((await client.ask(fixtureRequest)).data?.query.source).toBe('mock');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error',
    headers: { authorization: 'Bearer private-token' },
  });
  for (const data of [
    { ...result.data, query: { ...result.data!.query, source: 'live' } },
    { ...result.data, answer: 'You are stressed with a pulse of 999.' },
  ]) {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ ...result, data })),
    );
    expect((await client.ask(fixtureRequest)).state).toBe('unavailable');
  }
  fetcher.mockResolvedValue(new Response(null, { status: 401 }));
  expect((await client.ask(fixtureRequest)).state).toBe('unauthorized');
  fetcher.mockClear();
  expect(
    (
      await new ReasoningClient('http://remote.example', 'token', fetcher).ask(
        fixtureRequest,
      )
    ).state,
  ).toBe('not_configured');
  expect(fetcher).not.toHaveBeenCalled();
});
it('aborts active requests, blocks concurrent asks and can recover', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    );
  const client = new ReasoningClient('http://localhost', 'token', fetcher);
  const pending = client.ask(fixtureRequest);
  expect((await client.ask(fixtureRequest)).state).toBe('busy');
  client.cancel();
  expect((await pending).state).toBe('cancelled');
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ state: 'not_configured', data: null })),
  );
  expect((await client.ask(fixtureRequest)).state).toBe('not_configured');
});
