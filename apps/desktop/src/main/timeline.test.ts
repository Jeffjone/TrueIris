import { expect, it, vi } from 'vitest';
import { getTimeline } from './timeline';
const query = {
  start: '2026-10-04T00:00:00.000Z',
  end: '2026-10-04T01:00:00.000Z',
  source: 'mock' as const,
};
const empty = { count: 0, mean: null, min: null, max: null, confidence: null };
const data = {
  range: query,
  points: [],
  activities: [],
  gaps: [],
  summary: {
    count: 0,
    observedSeconds: 0,
    sessions: 0,
    pulse: empty,
    respiration: empty,
    hrv: empty,
  },
  limited: false,
};
it('keeps credentials in main, validates range/source and refuses redirects', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
  expect(
    await getTimeline('http://127.0.0.1:3001', 'private-token', query, request),
  ).toEqual({ state: 'ready', data });
  const [url, options] = request.mock.calls[0]!;
  expect(new URL(String(url)).searchParams.get('source')).toBe('mock');
  expect(options?.redirect).toBe('error');
  expect(options?.headers).toEqual({ authorization: 'Bearer private-token' });
  request.mockResolvedValue(
    new Response(
      JSON.stringify({ ...data, range: { ...query, source: 'live' } }),
    ),
  );
  expect(
    (await getTimeline('http://localhost', 'private-token', query, request))
      .state,
  ).toBe('unavailable');
});
it('reports offline, authentication and configuration errors without cached history', async () => {
  const request = vi.fn<typeof fetch>();
  expect(
    (await getTimeline('https://example.com', undefined, query, request)).state,
  ).toBe('not_configured');
  expect(
    (await getTimeline('http://example.com', 'private-token', query, request))
      .state,
  ).toBe('not_configured');
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue(new Response(null, { status: 401 }));
  expect(
    await getTimeline('http://localhost', 'private-token', query, request),
  ).toEqual({ state: 'unauthorized', data: null });
  request.mockRejectedValue(new Error('private SQL data'));
  expect(
    await getTimeline('http://localhost', 'private-token', query, request),
  ).toEqual({ state: 'unavailable', data: null });
});
