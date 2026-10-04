import { describe, expect, it } from 'vitest';
import type { TimelineData, TimelinePoint } from '@trueiris/schemas';
import {
  contextChanges,
  desktopChanges,
  dayBounds,
  metricSegments,
  nearestPoint,
} from './presentation';
const at = (s: number) =>
  new Date(Date.UTC(2026, 9, 4) + s * 1000).toISOString();
const sessionId = '00000000-0000-4000-8000-000000000001';
const stats = { count: 30, mean: 70, min: 68, max: 72, confidence: 0.9 };
const empty = { count: 0, mean: null, min: null, max: null, confidence: null };
const point = (
  s: number,
  patch: Partial<TimelinePoint> = {},
): TimelinePoint => ({
  start: at(s),
  end: at(s + 30),
  first: at(s),
  last: at(s + 29),
  sessionId,
  count: 30,
  pulse: stats,
  respiration: empty,
  hrv: empty,
  ...patch,
});
const data = (points: TimelinePoint[]): TimelineData => ({
  range: { start: at(0), end: at(3600), source: 'live' },
  points,
  activities: [],
  gaps: [],
  summary: {
    count: 60,
    observedSeconds: 60,
    sessions: 1,
    pulse: stats,
    respiration: empty,
    hrv: empty,
  },
  limited: false,
});
describe('Today timeline presentation', () => {
  it.each([
    ['2026-03-08T18:00:00Z', 'America/Chicago', '2026-03-08T06:00:00.000Z', 23],
    ['2026-11-01T18:00:00Z', 'America/Chicago', '2026-11-01T05:00:00.000Z', 25],
    ['2026-10-04T18:00:00Z', 'UTC', '2026-10-04T00:00:00.000Z', 24],
    ['2026-10-04T00:30:00Z', 'Asia/Kolkata', '2026-10-03T18:30:00.000Z', 24],
  ])(
    'uses the actual local calendar day in %s/%s',
    (now, zone, start, hours) => {
      const bounds = dayBounds(Date.parse(now), zone);
      expect(new Date(bounds.start).toISOString()).toBe(start);
      expect(bounds.end - bounds.start).toBe(Number(hours) * 3600_000);
    },
  );
  it('breaks trends across absent seconds, sessions, missing metrics and withheld gaps', () => {
    const d = data([
      point(0),
      point(30),
      point(90),
      point(120, { pulse: empty }),
      point(150),
      point(180, { sessionId: '00000000-0000-4000-8000-000000000002' }),
    ]);
    expect(metricSegments(d, 'pulse').map((s) => s.length)).toEqual([
      2, 1, 1, 1,
    ]);
    d.gaps = [{ start: at(25), end: at(27), sessionId, kind: 'withheld' }];
    expect(metricSegments(d, 'pulse').map((s) => s.length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    d.gaps = [{ start: at(29), end: at(31), sessionId, kind: 'withheld' }];
    expect(metricSegments(d, 'pulse').map((s) => s.length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(metricSegments(d, 'hrv')).toEqual([]);
  });
  it('keeps overlapping sessions as independent continuous trends', () => {
    const other = '00000000-0000-4000-8000-000000000003';
    const d = data([
      point(0),
      point(0, { sessionId: other }),
      point(30),
      point(30, { sessionId: other }),
    ]);
    const segments = metricSegments(d, 'pulse');
    expect(segments.map((s) => s.length)).toEqual([2, 2]);
    expect(
      segments.every((s) => s.every((p) => p.sessionId === s[0]!.sessionId)),
    ).toBe(true);
  });
  it('identifies only contiguous recorded manual activity changes', () => {
    const d = data([]);
    d.activities = [
      { start: at(0), end: at(10), sessionId, activity: null },
      { start: at(10), end: at(20), sessionId, activity: 'Coding' },
      { start: at(30), end: at(40), sessionId, activity: 'Break' },
    ];
    expect(contextChanges(d).map((p) => p.activity)).toEqual(['Coding']);
  });
  it('chooses the nearest recorded summary, never a synthesized value', () => {
    const d = data([point(0), point(300)]);
    expect(nearestPoint(d, 310 * 1000 + Date.parse(at(0)))).toBe(d.points[1]);
    expect(nearestPoint(data([]), 0)).toBe(null);
  });
});

describe('independent desktop context changes', () => {
  it('ignores periodic chunk boundaries and absent observations; recognizes apps and focus even with same activity', () => {
    const d = data([]);
    const context = {
      id: sessionId,
      sessionId,
      source: 'live' as const,
      startedAt: at(0),
      start: at(0),
      end: at(10),
      application: { id: 'code', name: 'Code' },
      windowTitle: null,
      manualActivity: null,
      classification: {
        activity: 'Coding' as const,
        confidence: 0.9,
        reason: 'Code editor foreground.',
      },
      idle: false,
      idleSeconds: 0,
      sessionSeconds: 10,
      applicationSwitches: 0,
      focusMode: false,
    };
    d.contexts = [
      context,
      { ...context, start: at(10), end: at(20) },
      {
        ...context,
        start: at(20),
        end: at(30),
        application: { id: 'xcode', name: 'Xcode' },
      },
      { ...context, start: at(40), end: at(50) },
      { ...context, start: at(50), end: at(60), focusMode: true },
    ];
    expect(desktopChanges(d).map((i) => i.start)).toEqual([at(20), at(50)]);
  });
});
