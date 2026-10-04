import { expect, it } from 'vitest';
import { generateDemo } from './demo-generator';
import { demoDatasetSchema } from '@trueiris/schemas';
const date = new Date('2026-10-04T18:00:00Z');
it('generates repeatable multi-day source-separated evidence, consistent epochs and seven condition-labeled sessions', () => {
  const a = generateDemo('owner-a', date),
    b = generateDemo('owner-a', date),
    other = generateDemo('owner-b', date);
  expect(a).toEqual(b);
  expect(other.dataset.episodes[0]?.id).not.toBe(a.dataset.episodes[0]?.id);
  expect(a.dataset.episodes).toHaveLength(33);
  expect(
    new Set(a.dataset.episodes.map((e) => e.range.start.slice(0, 10))).size,
  ).toBe(8);
  expect(
    a.measurements.every(
      (m) => m.source === 'demo_seed' && m.timestamp < a.dataset.historyEnd,
    ),
  ).toBe(true);
  expect(
    a.contexts.every((c) => c.source === 'demo_seed' && !c.windowTitle),
  ).toBe(true);
  expect(a.epochs.reduce((n, e) => n + e.measurementCount, 0)).toBe(
    a.measurements.length,
  );
  expect(a.experimentRecords).toHaveLength(7);
  expect(new Set(a.experimentRecords.map((s) => s.condition))).toEqual(
    new Set(['Music', 'No Music']),
  );
  expect(
    a.dataset.patterns.every((p) => p.sessionCount === p.episodeIds.length),
  ).toBe(true);
  expect(a.dataset.measurementCount).toBe(a.measurements.length);
  expect(
    demoDatasetSchema.safeParse({ ...a.dataset, source: 'live' }).success,
  ).toBe(false);
  expect(
    demoDatasetSchema.safeParse({
      ...a.dataset,
      episodes: [
        {
          ...a.dataset.episodes[0],
          range: { ...a.dataset.episodes[0]!.range, source: 'live' },
        },
        ...a.dataset.episodes.slice(1),
      ],
    }).success,
  ).toBe(false);
});
