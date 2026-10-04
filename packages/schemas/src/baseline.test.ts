import { expect, it } from 'vitest';
import { baselineQuerySchema } from './baseline';
export const query = {
  range: {
    start: '2026-03-10T14:00:00.000Z',
    end: '2026-03-10T14:01:00.000Z',
    source: 'mock',
  },
  context: { kind: 'activity', activity: 'Coding' },
  timezone: 'America/Chicago',
  lookbackDays: 30,
};
it('bounds history, period, timezone and allowed contextual inputs', () => {
  expect(baselineQuerySchema.safeParse(query).success).toBe(true);
  for (const patch of [
    { lookbackDays: 31 },
    { lookbackDays: 0 },
    { timezone: 'invalid' },
    { timezone: '+05:30' },
    { userId: 'forged' },
    { context: { kind: 'activity', activity: 'stressed' } },
    { range: { ...query.range, end: query.range.start } },
  ])
    expect(baselineQuerySchema.safeParse({ ...query, ...patch }).success).toBe(
      false,
    );
});
