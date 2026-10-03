import { describe, expect, it } from 'vitest';
import { sensorReadingSchema } from './index';

const reading = {
  timestamp: '2026-10-03T20:00:00.000Z',
  sessionId: '09bdad7b-3f43-4c58-82bb-0f8d2ef1e9bf',
  source: 'mock',
  signalQuality: 'unavailable',
};
describe('sensor contract', () => {
  it('permits missing metrics rather than substituting zero', () => {
    expect(sensorReadingSchema.parse(reading).pulseRate).toBeUndefined();
  });
  it('requires provenance and bounds confidence', () => {
    expect(
      sensorReadingSchema.safeParse({ ...reading, source: undefined }).success,
    ).toBe(false);
    expect(
      sensorReadingSchema.safeParse({ ...reading, pulseConfidence: 1.1 })
        .success,
    ).toBe(false);
    expect(
      sensorReadingSchema.safeParse({ ...reading, pulseRate: NaN }).success,
    ).toBe(false);
  });
  it('rejects raw captures in the event contract', () => {
    expect(
      sensorReadingSchema.safeParse({ ...reading, screenshot: 'pixels' })
        .success,
    ).toBe(false);
  });
});
