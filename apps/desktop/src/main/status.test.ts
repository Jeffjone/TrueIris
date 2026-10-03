import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDesktopStatus } from './status';

const health = {
  service: 'trueiris-api',
  status: 'ok',
  timestamp: '2026-10-03T20:00:00.000Z',
  integrations: {
    database: 'not_implemented',
    reasoning: 'not_implemented',
    voice: 'not_implemented',
  },
};
afterEach(() => vi.unstubAllGlobals());
describe('desktop API status', () => {
  it('reports a connection only after validating the API contract', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(health)));
    vi.stubGlobal('fetch', fetch);
    expect(
      await getDesktopStatus('http://localhost:3001', '0.1.0', false),
    ).toEqual({
      version: '0.1.0',
      demoMode: false,
      api: 'connected',
      integrations: health.integrations,
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });
  it.each([
    new Response('error', { status: 503 }),
    new Response('{}'),
    new Response('not-json'),
  ])('degrades on an invalid response', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(
      await getDesktopStatus('http://localhost:3001', '0.1.0', false),
    ).toMatchObject({ api: 'unavailable', integrations: null });
  });
  it('degrades when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );
    expect(
      await getDesktopStatus('http://localhost:3001', '0.1.0', true),
    ).toEqual({
      version: '0.1.0',
      demoMode: true,
      api: 'unavailable',
      integrations: null,
    });
  });
});
