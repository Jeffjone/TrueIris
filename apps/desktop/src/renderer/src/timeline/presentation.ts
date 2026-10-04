import type { TimelineData, TimelinePoint } from '@trueiris/schemas';
export type Metric = 'pulse' | 'respiration' | 'hrv';
export const metrics = [
  { key: 'pulse', label: 'Pulse', unit: 'bpm', color: '#527960' },
  { key: 'respiration', label: 'Respiration', unit: '/min', color: '#678997' },
  { key: 'hrv', label: 'HRV · RMSSD', unit: 'ms', color: '#967eaa' },
] as const;
export function dateKey(time: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(time);
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}
/** Find midnight by calendar date rather than assuming every local day is 24h. */
export function dayBounds(now: number, zone: string) {
  const key = dateKey(now, zone);
  const approximate = Date.parse(`${key}T00:00:00Z`);
  const boundary = (after: boolean) => {
    let low = approximate - 36 * 3600_000,
      high = approximate + 60 * 3600_000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      const date = dateKey(middle, zone);
      if (after ? date <= key : date < key) low = middle;
      else high = middle;
    }
    return high;
  };
  return { key, start: boundary(false), end: boundary(true) };
}
export function timeLabel(time: number | string, zone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(typeof time === 'string' ? Date.parse(time) : time);
}
export function pointTime(point: TimelinePoint) {
  return (Date.parse(point.first) + Date.parse(point.last)) / 2;
}
/** Break across sessions, withheld buckets and absent seconds; never fill gaps. */
export function metricSegments(data: TimelineData, metric: Metric) {
  const segments: TimelinePoint[][] = [];
  const latest = new Map<
    string,
    { point: TimelinePoint; segment: TimelinePoint[] }
  >();
  const gaps = new Map<string, typeof data.gaps>();
  for (const gap of data.gaps) {
    const list = gaps.get(gap.sessionId) ?? [];
    list.push(gap);
    gaps.set(gap.sessionId, list);
  }
  for (const list of gaps.values())
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const point of data.points) {
    if (point[metric].mean === null) {
      latest.delete(point.sessionId);
      continue;
    }
    const previous = latest.get(point.sessionId);
    const list = gaps.get(point.sessionId) ?? [];
    // Binary search the final gap beginning before this point; gaps from one
    // session do not overlap. Avoid scanning thousands of gaps for every point.
    let low = 0,
      high = list.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (Date.parse(list[mid]!.start) < pointTime(point)) low = mid + 1;
      else high = mid;
    }
    const gap = low > 0 ? list[low - 1] : undefined;
    const interrupted =
      previous && gap && Date.parse(gap.end) > pointTime(previous.point);
    const contiguous =
      previous &&
      Date.parse(point.first) <= Date.parse(previous.point.last) + 1000 &&
      !interrupted;
    const segment = contiguous ? previous.segment : [];
    if (!contiguous) segments.push(segment);
    segment.push(point);
    latest.set(point.sessionId, { point, segment });
  }
  return segments;
}
export function contextChanges(data: TimelineData) {
  const last = new Map<string, TimelineData['activities'][number]>();
  return data.activities.filter((p) => {
    const previous = last.get(p.sessionId);
    last.set(p.sessionId, p);
    return (
      previous && previous.end === p.start && previous.activity !== p.activity
    );
  });
}
export function nearestPoint(data: TimelineData, time: number) {
  return data.points.reduce<TimelinePoint | null>(
    (best, p) =>
      !best || Math.abs(pointTime(p) - time) < Math.abs(pointTime(best) - time)
        ? p
        : best,
    null,
  );
}

/** Chunk boundaries are not activity/application changes; gaps break continuity. */
export function desktopChanges(data: TimelineData) {
  const previous = new Map<
    string,
    NonNullable<TimelineData['contexts']>[number]
  >();
  return (data.contexts ?? []).filter((current) => {
    const last = previous.get(current.sessionId);
    previous.set(current.sessionId, current);
    return (
      last &&
      last.end === current.start &&
      (last.application?.id !== current.application?.id ||
        last.windowTitle !== current.windowTitle ||
        last.classification?.activity !== current.classification?.activity ||
        last.manualActivity !== current.manualActivity ||
        last.idle !== current.idle ||
        last.focusMode !== current.focusMode)
    );
  });
}
