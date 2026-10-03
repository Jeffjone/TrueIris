import { describe, expect, it } from 'vitest';
import { measurementSchema, measurementBatchSchema } from './storage';
const m = {
  eventId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  timestamp: '2026-10-03T12:00:01.000Z',
  startedAt: '2026-10-03T12:00:00.000Z',
  source: 'live',
  signalQuality: 'good',
};
describe('strict ingestion serialization', () => {
  it.each([
    { ...m, userId: 'spoof' },
    { ...m, frames: 'private' },
    { ...m, timestamp: '2026-10-03T12:00:01.100Z' },
    { ...m, timestamp: '2026-10-03T12:00:01+00:00' },
    { ...m, startedAt: '2026-10-03T12:00:02.000Z' },
    { ...m, pulseRate: Infinity },
    { ...m, pulseConfidence: 1.5 },
  ])('rejects extra fields and invalid UTC/confidence %j', (value) => {
    expect(measurementSchema.safeParse(value).success).toBe(false);
  });
  it('bounds batches and preserves missing metrics', () => {
    expect(measurementBatchSchema.safeParse({ measurements: [] }).success).toBe(
      false,
    );
    expect(
      measurementBatchSchema.safeParse({ measurements: Array(121).fill(m) })
        .success,
    ).toBe(false);
    expect(measurementSchema.parse(m)).not.toHaveProperty('pulseRate');
  });
});
