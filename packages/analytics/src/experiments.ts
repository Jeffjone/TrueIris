import type {
  Experiment,
  ExperimentSession,
  ExperimentComparison,
} from '@trueiris/schemas';
/** Descriptive session comparisons; no significance test, causal effect or population inference. */
export function compareExperiment(
  experiment: Experiment,
  sessions: ExperimentSession[],
): ExperimentComparison[] {
  const d = experiment.definition;
  return d.criteria.map((criterion) => {
    const conditions = d.conditions.map((condition) => {
      const eligible = sessions.filter(
        (s) =>
          s.input.condition === condition &&
          s.metrics[criterion.metric] !== null,
      );
      const values = eligible.map((s) => s.metrics[criterion.metric]!);
      const days = new Set(
        eligible.map((s) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: d.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(s.input.range.start)),
        ),
      );
      return {
        condition,
        count: values.length,
        dayCount: days.size,
        mean: values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
      };
    }) as ExperimentComparison['conditions'];
    const [a, b] = conditions;
    const difference =
      a.mean !== null && b.mean !== null ? b.mean - a.mean : null;
    const observedDifferenceRange =
      a.min !== null && b.min !== null
        ? ([b.min - a.max!, b.max! - a.min] as [number, number])
        : null;
    let state: ExperimentComparison['state'] = 'insufficient_data';
    if (
      a.count + b.count >= d.minimumSessions &&
      conditions.every((c) => c.count >= 3 && c.dayCount >= 2) &&
      observedDifferenceRange
    ) {
      const [low, high] = observedDifferenceRange,
        t = criterion.meaningfulDifference;
      state =
        low >= t || high <= -t
          ? 'meaningful_difference'
          : low > -t && high < t
            ? 'no_meaningful_difference'
            : 'observed_association';
    }
    return {
      metric: criterion.metric,
      threshold: criterion.meaningfulDifference,
      state,
      conditions,
      difference,
      observedDifferenceRange,
    };
  });
}
