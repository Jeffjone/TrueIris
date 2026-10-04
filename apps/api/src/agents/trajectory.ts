import type {
  BaselineComparison,
  BaselineContext,
  TimelineData,
  TimelineQuery,
} from '@trueiris/schemas';
import { localDaypart } from './recent';

/** Descriptive epoch comparisons only. No interpolation, cross-session trend, or physiological labels. */
export function pulseTrajectory(
  data: TimelineData,
  comparison: BaselineComparison,
  context: BaselineContext,
  timezone: string,
): { text: string; value: number; range: TimelineQuery }[] {
  if (
    data.limited ||
    comparison.state !== 'ready' ||
    comparison.baseline === null
  )
    return [];
  const points = data.points
    .filter((p) => {
      if (
        p.pulse.mean === null ||
        p.pulse.count < 15 ||
        p.first < data.range.start ||
        p.last >= data.range.end
      )
        return false;
      if (context.kind === 'time_of_day')
        return (
          localDaypart(p.first, timezone) === context.period &&
          localDaypart(p.last, timezone) === context.period
        );
      return data.activities.some(
        (a) =>
          a.sessionId === p.sessionId &&
          a.activity === context.activity &&
          a.start <= p.first &&
          a.end > p.last,
      );
    })
    .sort((a, b) => a.first.localeCompare(b.first));
  const first = points[0];
  if (!first) return [];
  const baseline = comparison.baseline;
  const describe = (value: number) =>
    baseline === 0
      ? `${Math.abs(value).toFixed(1)} bpm ${value >= 0 ? 'above' : 'below'} the zero baseline (percentage unavailable)`
      : `${((100 * Math.abs(value - baseline)) / Math.abs(baseline)).toFixed(1)}% ${value >= baseline ? 'above' : 'below'} your earlier ${context.kind === 'activity' ? context.activity : context.period} baseline of ${baseline.toFixed(1)} bpm`;
  const firstMean = first.pulse.mean!;
  const facts = [
    {
      text: `The first accepted pulse epoch matching this baseline, recorded ${((Date.parse(first.first) - Date.parse(data.range.start)) / 60_000).toFixed(1)} minutes into this window, averaged ${firstMean.toFixed(1)} bpm: ${describe(firstMean)}. This describes the first saved epoch, not an unobserved starting value.`,
      value: firstMean,
      range: { ...data.range, start: first.start, end: first.end },
    },
  ];
  // Stop at a session boundary; never describe separate sessions as one trajectory.
  const sameSession = points.slice(
    1,
    points.findIndex((p) => p.sessionId !== first.sessionId) < 0
      ? undefined
      : points.findIndex((p) => p.sessionId !== first.sessionId),
  );
  const closer = sameSession.find(
    (p) => Math.abs(p.pulse.mean! - baseline) < Math.abs(firstMean - baseline),
  );
  if (closer)
    facts.push({
      text: `A later saved pulse epoch in the same sensing session, ${((Date.parse(closer.first) - Date.parse(first.first)) / 60_000).toFixed(1)} minutes after that first epoch, was closer to your earlier baseline at ${closer.pulse.mean!.toFixed(1)} bpm (${describe(closer.pulse.mean!)}). This compares recorded epochs; intervening unrecorded time remains unknown.`,
      value: closer.pulse.mean!,
      range: { ...data.range, start: first.start, end: closer.end },
    });
  return facts;
}
