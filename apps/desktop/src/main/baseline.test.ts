import { expect, it, vi } from 'vitest';
import { getBaselines } from './baseline';
import { compareAgainstBaseline } from '../../../../packages/analytics/src';
const query = {
  range: {
    start: '2026-03-10T14:00:00.000Z',
    end: '2026-03-10T14:01:00.000Z',
    source: 'mock' as const,
  },
  context: { kind: 'activity' as const, activity: 'Coding' as const },
  timezone: 'UTC',
  lookbackDays: 30,
};
const data = {
  query,
  historyStart: '2026-02-08T14:00:00.000Z',
  historyEnd: query.range.start,
  comparisons: (['pulse', 'respiration', 'hrv'] as const).map((m) =>
    compareAgainstBaseline(
      m,
      null,
      0,
      {
        sampleCount: 0,
        dayCount: 0,
        mean: null,
        variance: null,
        measurementConfidence: null,
      },
      query.context,
    ),
  ),
};
it('validates private baseline responses and their exact context/history boundary', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(data)));
  expect(
    (await getBaselines('http://localhost', 'token', query, request)).state,
  ).toBe('ready');
  expect(request.mock.calls[0]?.[1]).toMatchObject({
    method: 'POST',
    redirect: 'error',
    body: JSON.stringify(query),
  });
  for (const patch of [
    { query: { ...query, timezone: 'America/Chicago' } },
    { historyEnd: query.range.end },
    { private: 'unwanted' },
    { comparisons: [...data.comparisons].reverse() },
    { comparisons: data.comparisons.map((c) => ({ ...c, state: 'ready' })) },
  ]) {
    request.mockResolvedValue(
      new Response(JSON.stringify({ ...data, ...patch })),
    );
    expect(
      (await getBaselines('http://localhost', 'token', query, request)).state,
    ).toBe('unavailable');
  }
  request.mockResolvedValue(new Response(null, { status: 401 }));
  expect(
    (await getBaselines('http://localhost', 'token', query, request)).state,
  ).toBe('unauthorized');
  request.mockRejectedValue(new Error('private'));
  expect(
    (await getBaselines('http://localhost', 'token', query, request)).state,
  ).toBe('unavailable');
  request.mockClear();
  expect(
    (await getBaselines('http://remote.example', 'token', query, request))
      .state,
  ).toBe('not_configured');
  expect(request).not.toHaveBeenCalled();
});
