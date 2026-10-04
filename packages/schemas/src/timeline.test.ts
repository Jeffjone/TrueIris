import { describe, expect, it } from 'vitest';
import { timelineQuerySchema } from './timeline';
import { measurementSchema } from './storage';
const query = {
  start: '2026-11-01T05:00:00.000Z',
  end: '2026-11-02T06:00:00.000Z',
  source: 'live',
};
describe('timeline boundaries', () => {
  it('accepts a 25h DST day with explicit provenance', () =>
    expect(timelineQuerySchema.parse(query)).toEqual(query));
  it.each([
    { ...query, source: 'mixed' },
    { ...query, userId: 'forged' },
    { ...query, end: query.start },
    { ...query, end: '2026-11-03T05:00:00.000Z' },
    { ...query, start: '2026-11-01T00:00:00-05:00' },
  ])('rejects unbounded, ambiguous or forged queries %j', (value) =>
    expect(timelineQuerySchema.safeParse(value).success).toBe(false),
  );
  it('accepts only fixed manual activity labels on measurements', () => {
    const m = {
      eventId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      startedAt: query.start,
      timestamp: query.start,
      source: 'live',
      signalQuality: 'good',
    };
    expect(measurementSchema.parse({ ...m, activity: 'Coding' }).activity).toBe(
      'Coding',
    );
    expect(
      measurementSchema.safeParse({ ...m, activity: 'window title' }).success,
    ).toBe(false);
    expect(measurementSchema.parse(m)).not.toHaveProperty('activity');
  });
});
