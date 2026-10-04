import { expect, it } from 'vitest';
import {
  compareAgainstBaseline,
  getActivityBaseline,
  getTimeOfDayBaseline,
  getBaselineDeviation,
} from './baseline';
const evidence = {
  sampleCount: 100,
  dayCount: 7,
  mean: 72,
  variance: 4,
  measurementConfidence: 0.88,
};
const context = { kind: 'activity', activity: 'Coding' } as const;
it('compares personal evidence without absolute health thresholds', () => {
  expect(
    compareAgainstBaseline('pulse', 81, 18, evidence, context),
  ).toMatchObject({
    baseline: 72,
    differenceAbsolute: 9,
    differencePercent: 12.5,
    deviation: 4.5,
    confidence: 0.88,
    state: 'ready',
  });
  expect(
    compareAgainstBaseline('pulse', 63, 18, evidence, context)
      .differenceAbsolute,
  ).toBe(-9);
  expect(getTimeOfDayBaseline(evidence, 'morning').context).toEqual({
    kind: 'time_of_day',
    period: 'morning',
  });
});
it('requires multiple days and enough samples per metric', () => {
  for (const patch of [{ sampleCount: 19 }, { dayCount: 2 }, { mean: null }]) {
    expect(
      compareAgainstBaseline('hrv', 20, 1, { ...evidence, ...patch }, context),
    ).toMatchObject({
      state: 'insufficient_history',
      baseline: null,
      differenceAbsolute: null,
      confidence: 0,
    });
  }
  expect(
    getActivityBaseline({ ...evidence, sampleCount: 20, dayCount: 3 }, 'Coding')
      .baseline,
  ).toBe(72);
});
it('keeps absent values, zero reference and constant history distinct', () => {
  expect(
    compareAgainstBaseline('pulse', null, 0, evidence, context),
  ).toMatchObject({
    state: 'no_current_data',
    baseline: 72,
    differenceAbsolute: null,
  });
  expect(
    compareAgainstBaseline(
      'respiration',
      0,
      1,
      { ...evidence, mean: 0, variance: 0 },
      context,
    ),
  ).toMatchObject({
    state: 'ready',
    differenceAbsolute: 0,
    differencePercent: null,
    deviation: null,
  });
  expect(getBaselineDeviation(70, 72, 0)).toBeNull();
});
