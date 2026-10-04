import { createHash } from 'node:crypto';
import {
  measurementSchema,
  contextIntervalSchema,
  demoDatasetSchema,
  experimentDefinitionSchema,
  type Measurement,
  type ContextInterval,
  type DemoEpisode,
} from '@trueiris/schemas';
import { calculateEpoch } from '@trueiris/analytics';
const dayMs = 86400_000;
const iso = (time: number) => new Date(time).toISOString();
/** Namespaced by owner/version/time; never collide with a real capture session. */
export function demoId(owner: string, label: string) {
  const hex = createHash('sha256')
    .update(`trueiris:demo-v1:${owner}:${label}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function generateDemo(owner: string, now = new Date()) {
  // Minute resolution makes identical runs reproducible, and avoids future observations.
  const anchor = Math.floor(now.getTime() / 60_000) * 60_000;
  const midnight = Math.floor(anchor / dayMs) * dayMs;
  const measurements: Measurement[] = [],
    contexts: ContextInterval[] = [],
    episodes: DemoEpisode[] = [];
  const epochs: ReturnType<typeof calculateEpoch>[] = [];
  const experimentRecords: {
    condition: string;
    range: DemoEpisode['range'];
    rating: number;
    notes: string;
  }[] = [];
  function session(
    label: string,
    start: number,
    minutes: number,
    activity: Measurement['activity'],
    music = false,
    trajectory = false,
  ) {
    const id = demoId(owner, label + ':' + start),
      end = start + minutes * 60_000;
    const rows: Measurement[] = [];
    let noise = Number.parseInt(id.slice(0, 8), 16) >>> 0;
    const rand = () => {
      noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
      return noise / 4294967296;
    };
    for (let second = 0; second < minutes * 60; second++) {
      const pulse =
        activity === 'Break'
          ? 68
          : activity === 'Meeting'
            ? 84
            : activity === 'Reading'
              ? 71
              : music
                ? 73
                : 78;
      rows.push(
        measurementSchema.parse({
          eventId: demoId(owner, `${label}:${start}:${second}`),
          sessionId: id,
          source: 'demo_seed',
          startedAt: iso(start),
          timestamp: iso(start + second * 1000),
          activity,
          pulseRate: Math.round(
            (trajectory ? 84 - (11 * second) / (minutes * 60) : pulse) +
              (rand() - 0.5) * 4,
          ),
          pulseConfidence: 0.92,
          respirationRate:
            Math.round(
              (activity === 'Meeting' ? 16 : 13) * 10 + (rand() - 0.5) * 10,
            ) / 10,
          respirationConfidence: 0.9,
          hrvRmssd: Math.round(
            (music ? 50 : activity === 'Break' ? 55 : 42) + (rand() - 0.5) * 6,
          ),
          hrvConfidence: 0.88,
          talking: false,
          signalQuality: 'excellent',
        }),
      );
    }
    measurements.push(...rows);
    for (let offset = 0; offset < rows.length; offset += 30)
      epochs.push(calculateEpoch(rows.slice(offset, offset + 30)));
    const app =
      activity === 'Coding'
        ? { id: 'demo.editor', name: 'Visual Studio Code' }
        : activity === 'Reading'
          ? { id: 'demo.reader', name: 'Reader' }
          : activity === 'Meeting'
            ? { id: 'demo.meeting', name: 'Meeting' }
            : { id: 'demo.break', name: 'Desktop' };
    for (let second = 0; second < minutes * 60; second += 30)
      contexts.push(
        contextIntervalSchema.parse({
          id: demoId(owner, `context:${label}:${start}:${second}`),
          sessionId: id,
          source: 'demo_seed',
          startedAt: iso(start),
          start: iso(start + second * 1000),
          end: iso(start + (second + 30) * 1000),
          application: app,
          windowTitle: null,
          manualActivity: activity,
          classification: {
            activity,
            confidence: 1,
            reason: 'Generated demonstration activity',
          },
          idle: activity === 'Break',
          idleSeconds: activity === 'Break' ? second + 30 : 0,
          sessionSeconds: second + 30,
          applicationSwitches: 0,
          focusMode: false,
        }),
      );
    const pulse = rows.reduce((sum, r) => sum + r.pulseRate!, 0) / rows.length;
    const hrv = rows.reduce((sum, r) => sum + r.hrvRmssd!, 0) / rows.length;
    const range = {
      start: iso(start),
      end: iso(end),
      source: 'demo_seed' as const,
    };
    episodes.push({
      id,
      range,
      activity: activity!,
      title: `${activity} · generated sample session`,
      summary: `Generated ${minutes}-minute ${activity} period: ${rows.length} illustrative readings, mean pulse ${pulse.toFixed(1)} BPM and HRV ${hrv.toFixed(1)} ms. This is sample history, not a remembered personal event.`,
      tags: [
        activity!,
        ...(activity === 'Coding' ? [music ? 'music' : 'no music'] : []),
      ],
      readings: rows.length,
      pulse,
      hrv,
    });
    return range;
  }
  for (let day = 7; day >= 1; day--) {
    const base = midnight - day * dayMs;
    const music = day % 2 === 1;
    const range = session(
      `day-${day}-coding`,
      base + 9 * 3600_000,
      music ? 12 : 18,
      'Coding',
      music,
    );
    experimentRecords.push({
      condition: music ? 'Music' : 'No Music',
      range,
      rating: music ? 5 : 2,
      notes:
        'Generated sample rating; no real participant or treatment effect.',
    });
    session(`day-${day}-reading`, base + 10 * 3600_000, 8, 'Reading');
    session(`day-${day}-meeting`, base + 11 * 3600_000, 8, 'Meeting');
    session(`day-${day}-break`, base + 12 * 3600_000, 5, 'Break');
  }
  session('recent-reading', anchor - 4 * 3600_000, 20, 'Reading');
  session('recent-coding', anchor - 3 * 3600_000, 30, 'Coding', true);
  session('recent-break', anchor - 2 * 3600_000, 10, 'Break');
  session('recent-meeting', anchor - 90 * 60_000, 20, 'Meeting');
  session('recent-trajectory', anchor - 31 * 60_000, 30, 'Coding', false, true);
  const coding = episodes.filter((e) => e.activity === 'Coding'),
    meeting = episodes.filter((e) => e.activity === 'Meeting');
  const mean = (items: DemoEpisode[]) =>
    items.reduce((sum, e) => sum + e.pulse * e.readings, 0) /
    items.reduce((sum, e) => sum + e.readings, 0);
  const dates = (items: DemoEpisode[]) =>
    new Set(items.map((e) => e.range.start.slice(0, 10))).size;
  const experimentId = demoId(owner, 'music-experiment');
  const dataset = demoDatasetSchema.parse({
    source: 'demo_seed',
    version: 'demo-v1',
    generatedAt: iso(anchor),
    historyStart: episodes.reduce(
      (a, e) => (e.range.start < a ? e.range.start : a),
      episodes[0]!.range.start,
    ),
    historyEnd: iso(anchor - 60_000),
    timezone: 'UTC',
    measurementCount: measurements.length,
    contextCount: contexts.length,
    episodes,
    patterns: [
      {
        title: 'Coding and meeting periods differ in this sample',
        description: `Generated coding pulse averages ${mean(coding).toFixed(1)} BPM; generated meeting pulse averages ${mean(meeting).toFixed(1)} BPM. This illustrates a recorded association, not stress, a personal conclusion or a causal effect.`,
        episodeIds: [...coding, ...meeting].map((e) => e.id),
        sessionCount: coding.length + meeting.length,
        dayCount: dates([...coding, ...meeting]),
      },
      {
        title: 'The sample includes both music conditions',
        description:
          'Seven generated coding sessions include condition labels and fictional focus ratings for an illustrative experiment. Designed differences demonstrate the comparison UI; they are not findings about whether music improves focus.',
        episodeIds: coding.slice(0, 7).map((e) => e.id),
        sessionCount: 7,
        dayCount: 7,
      },
    ],
    experimentIds: [experimentId],
  });
  const definition = experimentDefinitionSchema.parse({
    title: 'Demo · Music vs No Music',
    hypothesis:
      'Illustrative comparison of generated coding sessions; no real treatment effect.',
    conditions: ['Music', 'No Music'],
    criteria: [
      { metric: 'session_duration', meaningfulDifference: 5 },
      { metric: 'focus_rating', meaningfulDifference: 1 },
      { metric: 'pulse_deviation', meaningfulDifference: 5 },
      { metric: 'hrv_deviation', meaningfulDifference: 10 },
    ],
    minimumSessions: 7,
    source: 'demo_seed',
    timezone: 'UTC',
    activity: 'Coding',
  });
  return {
    dataset,
    measurements,
    contexts,
    epochs,
    experimentId,
    definition,
    experimentRecords,
  };
}
