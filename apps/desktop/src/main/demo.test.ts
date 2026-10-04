import { afterEach, expect, it, vi } from 'vitest';
import { DemoClient } from './demo';
import { privateFetch, setTransportMode } from './transport';
afterEach(() => {
  setTransportMode(false);
  vi.unstubAllGlobals();
});
it('refuses private transport outside demo mode or over insecure remote HTTP and never silently fabricates history', async () => {
  const request = vi.fn<typeof fetch>();
  expect(
    await new DemoClient(false, 'http://localhost', 'token', request).get(),
  ).toEqual({ state: 'disabled', data: null });
  expect(
    await new DemoClient(true, 'http://remote.example', 'token', request).get(),
  ).toEqual({ state: 'not_configured', data: null });
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue(new Response('{}'));
  expect(
    (await new DemoClient(true, 'http://localhost', 'token', request).get())
      .state,
  ).toBe('unavailable');
});
it('binds every main private request to the configured mode without changing token or redirect controls', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', request);
  setTransportMode(true);
  await privateFetch('http://localhost/data', {
    method: 'DELETE',
    headers: { authorization: 'Bearer private-token' },
    redirect: 'error',
  });
  expect(request.mock.calls[0]?.[1]).toMatchObject({
    headers: {
      authorization: 'Bearer private-token',
      'x-trueiris-mode': 'demo',
    },
    redirect: 'error',
  });
  setTransportMode(false);
  await privateFetch('http://localhost/timeline');
  expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
    'x-trueiris-mode': 'ordinary',
  });
});
