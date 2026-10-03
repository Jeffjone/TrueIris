import type { SensorReading } from '@trueiris/schemas';

interface Sample {
  value?: number | null;
  confidence?: number | null;
  stable?: boolean | null;
  timestamp?: unknown;
}
interface HrvSample extends Sample {
  rmssd?: number | null;
}
interface Detection {
  detected?: boolean | null;
  stable?: boolean | null;
  timestamp?: unknown;
}
export interface MetricsPayload {
  cardio?: { pulseRate?: Sample[] | null; hrv?: HrvSample[] | null } | null;
  breathing?: { rate?: Sample[] | null } | null;
  face?: { talking?: Detection[] | null } | null;
}

const timeOf = (sample: { timestamp?: unknown }) =>
  Number(sample.timestamp) / 1000;
function latest<T extends { timestamp?: unknown }>(
  samples: T[] | null | undefined,
  previous: T | undefined,
): T | undefined {
  let selected = previous;
  for (const sample of samples ?? []) {
    const time = timeOf(sample);
    if (Number.isFinite(time) && (!selected || time >= timeOf(selected)))
      selected = sample;
  }
  return selected;
}
const fresh = (
  sample: { timestamp?: unknown } | undefined,
  now: number,
  maxAge: number,
) =>
  sample !== undefined &&
  Number.isFinite(timeOf(sample)) &&
  now - timeOf(sample) >= -1000 &&
  now - timeOf(sample) <= maxAge;

/** Vendor confidence is a percentage, including values below 1; never guess its scale. */
export function normalizeConfidence(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value / 100
    : undefined;
}

/** Merge partial metric packets without refreshing old sample timestamps. */
export class ReadingNormalizer {
  private pulse: Sample | undefined;
  private breathing: Sample | undefined;
  private hrv: HrvSample | undefined;
  private talking: Detection | undefined;
  constructor(private readonly sessionId: string) {}
  clear() {
    this.pulse = undefined;
    this.breathing = undefined;
    this.hrv = undefined;
    this.talking = undefined;
  }
  update(packet: MetricsPayload) {
    this.pulse = latest(packet.cardio?.pulseRate, this.pulse);
    this.breathing = latest(packet.breathing?.rate, this.breathing);
    this.hrv = latest(packet.cardio?.hrv, this.hrv);
    this.talking = latest(packet.face?.talking, this.talking);
  }
  read(now = Date.now()): SensorReading {
    const reading: SensorReading = {
      timestamp: new Date(now).toISOString(),
      sessionId: this.sessionId,
      source: 'live',
      signalQuality: 'unavailable',
    };
    if (
      fresh(this.talking, now, 5000) &&
      this.talking?.stable === true &&
      typeof this.talking.detected === 'boolean'
    )
      reading.talking = this.talking.detected;
    const metrics = [
      {
        sample: this.pulse,
        value: this.pulse?.value,
        valueKey: 'pulseRate',
        confidenceKey: 'pulseConfidence',
        age: 5000,
        minimum: 0.4,
        positive: true,
      },
      {
        sample: this.breathing,
        value: this.breathing?.value,
        valueKey: 'respirationRate',
        confidenceKey: 'respirationConfidence',
        age: 10000,
        minimum: 0.45,
        positive: false,
      },
      {
        sample: this.hrv,
        value: this.hrv?.rmssd,
        valueKey: 'hrvRmssd',
        confidenceKey: 'hrvConfidence',
        age: 15000,
        minimum: 0.5,
        positive: false,
      },
    ] as const;
    const accepted: number[] = [];
    let rejected = false;
    for (const metric of metrics) {
      if (!fresh(metric.sample, now, metric.age)) continue;
      const confidence = normalizeConfidence(metric.sample?.confidence);
      if (confidence !== undefined) reading[metric.confidenceKey] = confidence;
      const valid =
        metric.sample?.stable === true &&
        confidence !== undefined &&
        confidence >= metric.minimum &&
        typeof metric.value === 'number' &&
        Number.isFinite(metric.value) &&
        (metric.positive ? metric.value > 0 : metric.value >= 0);
      if (valid && reading.talking !== true) {
        reading[metric.valueKey] = metric.value as number;
        accepted.push(confidence);
      } else {
        rejected = true;
      }
    }
    reading.signalQuality = rejected
      ? 'poor'
      : accepted.length
        ? Math.min(...accepted) >= 0.8
          ? 'excellent'
          : 'good'
        : 'unavailable';
    return reading;
  }
}
