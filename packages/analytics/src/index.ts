import type { Measurement } from '@trueiris/schemas';

export const EPOCH_MS = 30_000;
export const epochStart = (timestamp: string) =>
  Math.floor(Date.parse(timestamp) / EPOCH_MS) * EPOCH_MS;
export function metricStats(values: number[]) {
  if (!values.length) return { count: 0, mean: null, variance: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    mean,
    variance:
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      values.length,
  };
}
/** One UTC window, session and provenance; absent/poor/talking metrics never become zero. */
export function calculateEpoch(measurements: Measurement[]) {
  const first = measurements[0];
  if (!first) throw new Error('Cannot aggregate an empty epoch');
  const start = epochStart(first.timestamp);
  const seen = new Set<string>();
  for (const value of measurements) {
    if (
      value.sessionId !== first.sessionId ||
      value.source !== first.source ||
      epochStart(value.timestamp) !== start
    )
      throw new Error('Epoch contains unrelated observations');
    if (seen.has(value.timestamp)) throw new Error('Duplicate epoch second');
    seen.add(value.timestamp);
  }
  const valid = measurements.filter(
    (m) => !m.talking && ['good', 'excellent'].includes(m.signalQuality),
  );
  const pulse = metricStats(
    valid
      .filter(
        (m) => m.pulseRate !== undefined && (m.pulseConfidence ?? 0) >= 0.4,
      )
      .map((m) => m.pulseRate!),
  );
  const respiration = metricStats(
    valid
      .filter(
        (m) =>
          m.respirationRate !== undefined &&
          (m.respirationConfidence ?? 0) >= 0.45,
      )
      .map((m) => m.respirationRate!),
  );
  const hrv = metricStats(
    valid
      .filter((m) => m.hrvRmssd !== undefined && (m.hrvConfidence ?? 0) >= 0.5)
      .map((m) => m.hrvRmssd!),
  );
  return {
    startTime: new Date(start).toISOString(),
    endTime: new Date(start + EPOCH_MS).toISOString(),
    sessionId: first.sessionId,
    source: first.source,
    measurementCount: measurements.length,
    coverage: measurements.length / 30,
    missingSeconds: 30 - measurements.length,
    qualityScore: valid.length / measurements.length,
    meanPulse: pulse.mean,
    pulseVariance: pulse.variance,
    pulseCount: pulse.count,
    meanRespiration: respiration.mean,
    respirationCount: respiration.count,
    meanHrv: hrv.mean,
    hrvCount: hrv.count,
  };
}
export type Epoch = ReturnType<typeof calculateEpoch>;
export * from './baseline';
export { compareExperiment } from './experiments';
