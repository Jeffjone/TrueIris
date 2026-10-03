import { describe, expect, it } from 'vitest';
import type { SensorSnapshot } from '@trueiris/schemas';
import {
  elapsedSeconds,
  formatDuration,
  signalPresentation,
} from './presentation';
const snapshot: SensorSnapshot = {
  provider: 'mock',
  phase: 'running',
  issue: 'none',
  sessionId: '09bdad7b-3f43-4c58-82bb-0f8d2ef1e9bf',
  startedAt: '2026-10-03T20:00:00.000Z',
  reading: {
    timestamp: '2026-10-03T20:00:01.000Z',
    sessionId: '09bdad7b-3f43-4c58-82bb-0f8d2ef1e9bf',
    source: 'mock',
    signalQuality: 'excellent',
    pulseRate: 74,
    pulseConfidence: 0.92,
  },
};
describe('live signal presentation', () => {
  it.each([
    ['excellent', 'Excellent signal'],
    ['good', 'Good signal'],
    ['poor', 'Low confidence'],
    ['unavailable', 'Calibrating'],
  ] as const)(
    'describes %s signal without a physiological interpretation',
    (quality, label) => {
      expect(
        signalPresentation({
          ...snapshot,
          reading: { ...snapshot.reading!, signalQuality: quality },
        }).label,
      ).toBe(label);
    },
  );
  it.each([
    ['no_face', 'No face detected'],
    ['lighting', 'Check lighting'],
    ['motion', 'Motion detected'],
    ['talking', 'Talking detected'],
    ['stale', 'Waiting for fresh readings'],
    ['calibrating', 'Calibrating'],
  ] as const)(
    'gives %s precedence over a previous excellent reading',
    (issue, label) => {
      expect(signalPresentation({ ...snapshot, issue }).label).toBe(label);
    },
  );
  it.each(['no_camera', 'permission_denied'] as const)(
    'makes %s explicit',
    (issue) => {
      expect(
        signalPresentation({
          ...snapshot,
          phase: 'error',
          reading: null,
          issue,
        }).label,
      ).toBe('Camera unavailable');
    },
  );
  it('does not present an old quality as connected after stop', () => {
    expect(signalPresentation({ ...snapshot, phase: 'off' }).label).toBe(
      'Not connected',
    );
  });
});
describe('session duration', () => {
  it.each([
    [0, '00:00'],
    [59.9, '00:59'],
    [60, '01:00'],
    [3599, '59:59'],
    [3600, '01:00:00'],
    [3661, '01:01:01'],
    [-10, '00:00'],
    [NaN, '00:00'],
  ] as const)('formats %s seconds', (seconds, value) => {
    expect(formatDuration(seconds)).toBe(value);
  });
  it('recovers elapsed time from a main-owned start after navigation or inactivity', () => {
    expect(
      elapsedSeconds(
        snapshot.startedAt!,
        Date.parse('2026-10-03T20:38:17.999Z'),
      ),
    ).toBe(2297);
    expect(
      elapsedSeconds(snapshot.startedAt!, Date.parse('2026-10-03T19:59:59Z')),
    ).toBe(0);
    expect(elapsedSeconds('invalid', Date.now())).toBe(0);
  });
});
