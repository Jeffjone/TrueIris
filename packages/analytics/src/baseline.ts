import {
  baselineEvidenceSchema,
  baselineComparisonSchema,
  type BaselineEvidence,
  type BaselineComparison,
  type BaselineContext,
} from '@trueiris/schemas';

export const MIN_BASELINE_SAMPLES = 20;
export const MIN_BASELINE_DAYS = 3;
/** Evidence support heuristic, not a calibrated probability or health assessment. */
function contextualBaseline(input: BaselineEvidence, context: BaselineContext) {
  const evidence = baselineEvidenceSchema.parse(input);
  const adequate =
    evidence.sampleCount >= MIN_BASELINE_SAMPLES &&
    evidence.dayCount >= MIN_BASELINE_DAYS &&
    evidence.mean !== null;
  return {
    ...evidence,
    context,
    baseline: adequate ? evidence.mean : null,
    confidence: adequate
      ? Math.min(1, evidence.sampleCount / 100) *
        Math.min(1, evidence.dayCount / 7) *
        (evidence.measurementConfidence ?? 0)
      : 0,
  };
}
export function getActivityBaseline(
  evidence: BaselineEvidence,
  activity: Extract<BaselineContext, { kind: 'activity' }>['activity'],
) {
  return contextualBaseline(evidence, { kind: 'activity', activity });
}
export function getTimeOfDayBaseline(
  evidence: BaselineEvidence,
  period: Extract<BaselineContext, { kind: 'time_of_day' }>['period'],
) {
  return contextualBaseline(evidence, { kind: 'time_of_day', period });
}
export function getBaselineDeviation(
  current: number | null,
  baseline: number | null,
  variance: number | null,
) {
  if (
    current === null ||
    baseline === null ||
    variance === null ||
    variance <= 0
  )
    return null;
  const value = (current - baseline) / Math.sqrt(variance);
  return Number.isFinite(value) ? value : null;
}
export function compareAgainstBaseline(
  metric: BaselineComparison['metric'],
  current: number | null,
  currentCount: number,
  evidence: BaselineEvidence,
  context: BaselineContext,
): BaselineComparison {
  const reference =
    context.kind === 'activity'
      ? getActivityBaseline(evidence, context.activity)
      : getTimeOfDayBaseline(evidence, context.period);
  const difference =
    current !== null && reference.baseline !== null
      ? current - reference.baseline
      : null;
  const percent =
    difference !== null && reference.baseline !== 0
      ? (difference / reference.baseline!) * 100
      : null;
  return baselineComparisonSchema.parse({
    metric,
    current,
    currentCount,
    baseline: reference.baseline,
    differenceAbsolute: difference,
    differencePercent:
      percent !== null && Number.isFinite(percent) ? percent : null,
    deviation: getBaselineDeviation(
      current,
      reference.baseline,
      reference.variance,
    ),
    sampleCount: reference.sampleCount,
    dayCount: reference.dayCount,
    confidence: reference.confidence,
    state:
      reference.baseline === null
        ? 'insufficient_history'
        : current === null
          ? 'no_current_data'
          : 'ready',
  });
}
