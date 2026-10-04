import type { MeasurementStore } from '@trueiris/db';
import { baselineDataSchema } from '@trueiris/schemas';
import type {
  AskRequest,
  TimelineData,
  TimelineQuery,
} from '@trueiris/schemas';
export const fixtureCurrent: AskRequest['current'] = {
  sensor: 'off',
  reading: null,
  context: 'off',
  contextSource: 'mock',
  application: null,
  activity: null,
  saving: false,
};
export const fixtureRequest: AskRequest = {
  question:
    'When was my pulse lowest today? Compare it with my usual coding baseline.',
  source: 'mock',
  timezone: 'UTC',
  current: fixtureCurrent,
};
const sessionId = '00000000-0000-4000-8000-000000000003';
const empty = { count: 0, mean: null, min: null, max: null, confidence: null };
export function createReasoningFixture() {
  const scopes: { userId: string; range: TimelineQuery }[] = [];
  const store: MeasurementStore = {
    health: async () => true,
    ingest: async () => ({ accepted: 0, duplicates: 0 }),
    ingestContext: async () => ({ accepted: 0, duplicates: 0 }),
    exportPage: async () => ({ measurements: [], next: null }),
    exportContextPage: async () => ({ intervals: [], next: null }),
    deleteData: async () => {},
    close: async () => {},
    timeline: async (userId, range): Promise<TimelineData> => {
      scopes.push({ userId, range });
      if (range.source !== 'mock')
        return {
          range,
          points: [],
          activities: [],
          gaps: [],
          contexts: [],
          summary: {
            count: 0,
            observedSeconds: 0,
            sessions: 0,
            pulse: empty,
            respiration: empty,
            hrv: empty,
          },
          limited: false,
        };
      const start = Date.parse(range.start),
        duration = Date.parse(range.end) - start;
      const iso = (t: number) => new Date(t).toISOString();
      const stats = (mean: number, min = mean, max = mean) => ({
        count: 30,
        mean,
        min,
        max,
        confidence: 0.9,
      });
      const first = start + Math.floor(duration / 4),
        last = start + Math.floor((duration * 3) / 4);
      const points = [first, last].map((t, i) => ({
        start: iso(t),
        end: iso(Math.min(t + 30_000, start + duration)),
        first: iso(t),
        last: iso(Math.min(t + 29_000, start + duration - 1)),
        sessionId,
        count: 30,
        pulse: stats(i ? 72 : 81, i ? 70 : 80, i ? 74 : 82),
        respiration: stats(12),
        hrv: stats(30),
      }));
      return {
        range,
        points,
        activities: [
          {
            start: points[0]!.start,
            end: points[0]!.end,
            sessionId,
            activity: 'Coding',
          },
        ],
        gaps: [],
        contexts: points.map((p, i) => ({
          id: `00000000-0000-4000-8000-00000000000${i + 4}`,
          sessionId,
          source: range.source,
          startedAt: iso(Date.parse(range.start)),
          start: p.start,
          end: p.end,
          application: { id: 'editor', name: 'Visual Studio Code' },
          windowTitle: 'PRIVATE TITLE MUST NEVER REACH GEMINI',
          manualActivity: 'Coding',
          classification: {
            activity: 'Coding',
            confidence: 1,
            reason: 'Selected by you',
          },
          idle: false,
          idleSeconds: 0,
          sessionSeconds: 30,
          applicationSwitches: 0,
          focusMode: false,
        })),
        summary: {
          count: 60,
          observedSeconds: 60,
          sessions: 1,
          pulse: { ...stats(76.5, 70, 82), count: 60 },
          respiration: { ...stats(12), count: 60 },
          hrv: { ...stats(30), count: 60 },
        },
        limited: false,
      };
    },
    baselines: async (_user, query) =>
      baselineDataSchema.parse({
        query,
        historyStart: new Date(
          Date.parse(query.range.start) - query.lookbackDays * 86400_000,
        ).toISOString(),
        historyEnd: query.range.start,
        comparisons: (['pulse', 'respiration', 'hrv'] as const).map(
          (metric) => ({
            metric,
            current:
              metric === 'pulse' ? 81 : metric === 'respiration' ? 12 : 30,
            currentCount: 60,
            baseline:
              metric === 'pulse' ? 72 : metric === 'respiration' ? 12 : 30,
            differenceAbsolute: metric === 'pulse' ? 9 : 0,
            differencePercent: metric === 'pulse' ? 12.5 : 0,
            deviation: metric === 'pulse' ? 4.5 : 0,
            sampleCount: 100,
            dayCount: 7,
            confidence: 0.9,
            state: 'ready' as const,
          }),
        ),
      }),
    similarSessions: async (_user, query) => ({
      query,
      sessions: [
        {
          range: {
            start: new Date(
              Date.parse(query.range.end) - 86400_000,
            ).toISOString(),
            end: new Date(
              Date.parse(query.range.end) - 86400_000 + 30_000,
            ).toISOString(),
            source: query.source,
          },
          activity: query.activity,
          count: 30,
          pulse: 74,
          respiration: 12,
          hrv: 30,
        },
      ],
    }),
  };
  return { store, scopes };
}
