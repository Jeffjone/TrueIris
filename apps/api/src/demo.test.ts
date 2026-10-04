import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { generateDemo } from '../../../packages/db/src/demo-generator';
import { createReasoningFixture } from './agents/fixtures';
import { buildApp } from './app';
import { DemoService } from './demo';
import { DemoClient } from '../../desktop/src/main/demo';
it('prepares once per concurrent request, exposes pending state, and allows explicit preparation after clearing', async () => {
  const data = generateDemo('demo', new Date()).dataset;
  const { store } = createReasoningFixture();
  let saved: typeof data | null = null;
  let complete: (value: typeof data) => void = () => {};
  const seed = vi.fn(
    async () =>
      new Promise<typeof data>((resolve) => {
        complete = resolve;
      }),
  );
  store.demo = {
    seed,
    get: async () => saved,
    clear: async () => {
      saved = null;
    },
  };
  const service = new DemoService(store, 'demo');
  const first = service.prepare(),
    second = service.prepare();
  await Promise.resolve();
  expect(await service.get()).toEqual({ state: 'preparing', data: null });
  expect(seed).toHaveBeenCalledOnce();
  saved = data;
  complete(data);
  expect((await first).state).toBe('ready');
  expect(await second).toEqual(await first);
  expect((await service.get()).state).toBe('ready');
  saved = null;
  expect((await service.get()).state).toBe('empty');
  seed.mockResolvedValue(data);
  expect((await service.prepare()).state).toBe('ready');
  await service.close();
});
it('reports missing database without a fallback or permanently stuck preparation', async () => {
  const service = new DemoService(undefined, 'demo');
  expect((await service.prepare()).state).toBe('unavailable');
  expect((await service.get()).state).toBe('not_configured');
  expect((await service.prepare()).state).toBe('unavailable');
});
it('gates demo capabilities and mutations by mode, private token and server-owned identity; ordinary routes stay absent', async () => {
  const owner = randomUUID(),
    token = randomUUID() + randomUUID(),
    data = generateDemo(owner, new Date()).dataset;
  const { store } = createReasoningFixture();
  let saved: typeof data | null = null;
  const seed = vi.fn(async (user) => {
    expect(user).toBe(owner);
    saved = data;
    return data;
  });
  store.demo = {
    get: async (user) => (user === owner ? saved : null),
    seed,
    clear: async () => {
      saved = null;
    },
  };
  const api = buildApp('silent', {
    store,
    userId: owner,
    token,
    demoMode: true,
  });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const headers = {
    authorization: `Bearer ${token}`,
    'x-trueiris-mode': 'demo',
  };
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seed).toHaveBeenCalledOnce();
    expect((await new DemoClient(true, url, token).get()).state).toBe('ready');
    expect((await new DemoClient(true, url, 'wrong').get()).state).toBe(
      'unauthorized',
    );
    const health = (await api.inject('/health')).json();
    expect(health.demo).toEqual({ enabled: true, state: 'ready' });
    expect(JSON.stringify(health)).not.toContain(owner);
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/demo/prepare',
          headers,
          payload: { userId: randomUUID() },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api.inject({
          url: '/demo/history',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/measurements/batch',
          headers: { ...headers, 'x-trueiris-mode': 'ordinary' },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    saved = null;
    expect((await new DemoClient(true, url, token).get()).state).toBe('empty');
    expect((await new DemoClient(true, url, token).get(true)).state).toBe(
      'ready',
    );
  } finally {
    await api.close();
  }
  const ordinary = buildApp('silent', { store, userId: owner, token });
  try {
    expect(
      (
        await ordinary.inject({
          url: '/demo/history',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await ordinary.inject({
          method: 'POST',
          url: '/measurements/batch',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await ordinary.close();
  }
});
