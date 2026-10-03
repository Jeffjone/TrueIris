import { describe, expect, it } from 'vitest';
import { Metrics, decodeMetrics } from '@smartspectra/node-sdk/messages';
import { ReadingNormalizer, normalizeConfidence } from './normalize';

const sessionId = '09bdad7b-3f43-4c58-82bb-0f8d2ef1e9bf';
const now = Date.parse('2026-10-03T20:00:00Z');
const sample = (value = 74, confidence = 90, stable = true, time = now) => ({
  value,
  confidence,
  stable,
  timestamp: time * 1000,
});

describe('Presage normalization', () => {
  it('decodes a real protobuf-shaped payload and normalizes each metric', () => {
    const packet = Metrics.encode(
      Metrics.create({
        cardio: { pulseRate: [sample()], hrv: [{ ...sample(), rmssd: 41 }] },
        breathing: { rate: [sample(14.2)] },
        face: {
          talking: [{ detected: false, stable: true, timestamp: now * 1000 }],
        },
      }),
    ).finish();
    const normalizer = new ReadingNormalizer(sessionId);
    normalizer.update(decodeMetrics(packet));
    expect(normalizer.read(now)).toMatchObject({
      pulseRate: 74,
      pulseConfidence: 0.9,
      hrvRmssd: 41,
      talking: false,
      signalQuality: 'excellent',
      source: 'live',
    });
    expect(normalizer.read(now).respirationRate).toBeCloseTo(14.2, 5);
  });
  it('does not confuse 0.9 percent with 90 percent', () => {
    expect(normalizeConfidence(0.9)).toBeCloseTo(0.009, 10);
  });
  it.each([NaN, Infinity, -1, 101, undefined, '90'])(
    'rejects invalid confidence %s',
    (value) => {
      expect(normalizeConfidence(value)).toBeUndefined();
    },
  );
  it('withholds unstable and low-confidence pulse without dropping valid respiration', () => {
    const normalizer = new ReadingNormalizer(sessionId);
    normalizer.update({
      cardio: { pulseRate: [sample(74, 95, false)] },
      breathing: { rate: [sample(14, 90)] },
    });
    expect(normalizer.read(now)).toMatchObject({
      pulseConfidence: 0.95,
      respirationRate: 14,
      signalQuality: 'poor',
    });
    expect(normalizer.read(now).pulseRate).toBeUndefined();
    normalizer.update({ cardio: { pulseRate: [sample(74, 39, true)] } });
    expect(normalizer.read(now).pulseRate).toBeUndefined();
  });
  it('uses separate vendor confidence thresholds and permits valid zero HRV/breathing', () => {
    const normalizer = new ReadingNormalizer(sessionId);
    normalizer.update({
      cardio: {
        pulseRate: [sample(74, 40)],
        hrv: [{ ...sample(0, 50), rmssd: 0 }],
      },
      breathing: { rate: [sample(0, 45)] },
    });
    expect(normalizer.read(now)).toMatchObject({
      pulseRate: 74,
      respirationRate: 0,
      hrvRmssd: 0,
      signalQuality: 'good',
    });
  });
  it('merges partial packets, expires values by their own sample times, and rejects older packets', () => {
    const normalizer = new ReadingNormalizer(sessionId);
    normalizer.update({ cardio: { pulseRate: [sample()] } });
    normalizer.update({ breathing: { rate: [sample(14)] } });
    normalizer.update({
      cardio: { pulseRate: [sample(99, 90, true, now - 1000)] },
    });
    expect(normalizer.read(now)).toMatchObject({
      pulseRate: 74,
      respirationRate: 14,
    });
    expect(normalizer.read(now + 6000).pulseRate).toBeUndefined();
    expect(normalizer.read(now + 11000).respirationRate).toBeUndefined();
  });
  it('withholds values during talking and after clearing on invalid validation', () => {
    const normalizer = new ReadingNormalizer(sessionId);
    normalizer.update({
      cardio: { pulseRate: [sample()] },
      face: {
        talking: [{ detected: true, stable: true, timestamp: now * 1000 }],
      },
    });
    expect(normalizer.read(now)).toMatchObject({
      talking: true,
      signalQuality: 'poor',
    });
    expect(normalizer.read(now).pulseRate).toBeUndefined();
    normalizer.clear();
    expect(normalizer.read(now)).toMatchObject({
      signalQuality: 'unavailable',
    });
    expect(normalizer.read(now).pulseConfidence).toBeUndefined();
  });
  it('withholds invalid numeric values, missing timestamps, and future timestamps', () => {
    for (const invalid of [
      { ...sample(), value: NaN },
      { ...sample(), timestamp: undefined },
      sample(74, 90, true, now + 3000),
    ]) {
      const normalizer = new ReadingNormalizer(sessionId);
      normalizer.update({ cardio: { pulseRate: [invalid] } });
      expect(normalizer.read(now).pulseRate).toBeUndefined();
    }
  });
});
