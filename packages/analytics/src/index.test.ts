import { describe, expect, it } from 'vitest';
import { calculateEpoch, epochStart } from './index';
import type { Measurement } from '@trueiris/schemas';
const sample = (
  second: number,
  patch: Partial<Measurement> = {},
): Measurement => ({
  timestamp: new Date(Date.UTC(2026, 9, 3, 12, 0, second)).toISOString(),
  startedAt: '2026-10-03T12:00:00.000Z',
  eventId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  source: 'live',
  pulseRate: 70,
  pulseConfidence: 0.9,
  signalQuality: 'good',
  ...patch,
});
describe('30-second epochs', () => {
  it('uses population variance, per-metric counts and actual coverage', () => {
    const result = calculateEpoch([
      sample(0),
      sample(2, {
        pulseRate: 74,
        respirationRate: 12,
        respirationConfidence: 0.8,
      }),
      sample(3, { pulseRate: 72, hrvRmssd: 0, hrvConfidence: 0.8 }),
    ]);
    expect(result).toMatchObject({
      meanPulse: 72,
      pulseVariance: 8 / 3,
      pulseCount: 3,
      meanRespiration: 12,
      respirationCount: 1,
      meanHrv: 0,
      hrvCount: 1,
      coverage: 0.1,
      missingSeconds: 27,
    });
  });
  it('never replaces missing, talking or low quality metrics with zero', () => {
    const result = calculateEpoch([
      sample(0, { pulseConfidence: 0.1 }),
      sample(1, { talking: true }),
      sample(2, { signalQuality: 'poor' }),
    ]);
    expect(result.meanPulse).toBeNull();
    expect(result.pulseVariance).toBeNull();
    expect(result.pulseCount).toBe(0);
    expect(result.qualityScore).toBe(1 / 3);
  });
  it('applies the existing metric-specific sensor confidence thresholds', () => {
    const result = calculateEpoch([
      sample(0, {
        pulseConfidence: 0.4,
        respirationRate: 12,
        respirationConfidence: 0.44,
        hrvRmssd: 40,
        hrvConfidence: 0.5,
      }),
    ]);
    expect(result.meanPulse).toBe(70);
    expect(result.meanRespiration).toBeNull();
    expect(result.meanHrv).toBe(40);
  });
  it.each([
    { sessionId: '00000000-0000-4000-8000-000000000003' },
    { source: 'mock' as const },
    { timestamp: '2026-10-03T12:00:30.000Z' },
  ])('rejects mixed session, provenance or window %j', (patch) => {
    expect(() => calculateEpoch([sample(0), sample(1, patch)])).toThrow(
      'unrelated',
    );
  });
  it('rejects duplicate seconds and empty input', () => {
    expect(() => calculateEpoch([sample(0), sample(0)])).toThrow('Duplicate');
    expect(() => calculateEpoch([])).toThrow('empty');
  });
  it('uses UTC at midnight, across a DST transition and at the end-exclusive boundary', () => {
    expect(new Date(epochStart('2026-11-01T07:59:59.000Z')).toISOString()).toBe(
      '2026-11-01T07:59:30.000Z',
    );
    expect(
      epochStart('2026-10-04T00:00:00.000Z') -
        epochStart('2026-10-03T23:59:59.000Z'),
    ).toBe(30_000);
    expect(epochStart(sample(29).timestamp)).not.toBe(
      epochStart(sample(30).timestamp),
    );
  });
});
