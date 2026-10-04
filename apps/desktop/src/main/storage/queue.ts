import { randomUUID } from 'node:crypto';
import {
  ingestionAckSchema,
  measurementBatchSchema,
  measurementSchema,
  type Measurement,
  type SensorSnapshot,
  type StorageStatus,
  type RecordedActivity,
} from '@trueiris/schemas';

export function serializeSnapshot(
  snapshot: SensorSnapshot,
  eventId = randomUUID(),
  activity: RecordedActivity | null = null,
): Measurement | null {
  if (
    snapshot.phase !== 'running' ||
    !snapshot.reading ||
    !snapshot.startedAt ||
    snapshot.sessionId !== snapshot.reading.sessionId
  )
    return null;
  const second = (time: string) =>
    new Date(Math.floor(Date.parse(time) / 1000) * 1000).toISOString();
  const parsed = measurementSchema.safeParse({
    ...snapshot.reading,
    ...(activity ? { activity } : {}),
    timestamp: second(snapshot.reading.timestamp),
    startedAt: second(snapshot.startedAt),
    eventId,
  });
  return parsed.success ? parsed.data : null;
}
export interface BatchResponse {
  status: number;
  body?: unknown;
}
export type SendBatch = (batch: Measurement[]) => Promise<BatchResponse>;
const MAX_ATTEMPTS = 6;
export class RecordQueue<T> {
  private pending: T[] = [];
  private inFlight: T[] = [];
  private operation: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval>;
  private nextAttempt = 0;
  private attempts = 0;
  private generation = 0;
  private status: StorageStatus;
  constructor(
    configured: boolean,
    private readonly send: (batch: T[]) => Promise<BatchResponse>,
    private readonly now = Date.now,
    private readonly random = Math.random,
    private readonly capacity = 300,
    private readonly batchSize = 30,
  ) {
    this.status = {
      configured,
      enabled: false,
      state: 'off',
      queued: 0,
      saved: 0,
      dropped: 0,
      lastSavedAt: null,
    };
    this.timer = setInterval(() => {
      void this.flush();
    }, 1000);
    this.timer.unref();
  }
  get(): StorageStatus {
    return {
      ...this.status,
      queued: this.pending.length + this.inFlight.length,
    };
  }
  async setEnabled(enabled: boolean) {
    if (enabled && !this.status.configured)
      throw new Error('Storage configuration is unavailable');
    ++this.generation;
    this.status.enabled = enabled;
    this.status.state = enabled ? 'idle' : 'off';
    this.status.dropped += this.pending.length + this.inFlight.length;
    this.pending = [];
    this.inFlight = [];
    this.attempts = 0;
    this.nextAttempt = 0;
    // Never replay a reading that was visible before consent.
    if (this.operation) await this.operation;
    return this.get();
  }
  enqueue(m: T) {
    if (!this.status.enabled || this.status.state === 'blocked') return;
    if (this.get().queued >= this.capacity) {
      this.pending.shift();
      this.status.dropped++;
    }
    this.pending.push(m);
  }
  async flush() {
    if (this.operation) return this.operation;
    if (
      !this.status.enabled ||
      this.status.state === 'blocked' ||
      this.now() < this.nextAttempt
    )
      return;
    if (!this.inFlight.length)
      this.inFlight = this.pending.splice(0, this.batchSize);
    if (!this.inFlight.length) return;
    const generation = this.generation;
    const batch = this.inFlight;
    this.status.state = 'saving';
    this.operation = (async () => {
      try {
        const response = await this.send(batch);
        if (generation !== this.generation) return;
        if (response.status >= 200 && response.status < 300) {
          const ack = ingestionAckSchema.parse(response.body);
          if (ack.accepted + ack.duplicates !== batch.length)
            throw new Error('Invalid acknowledgement');
          this.status.saved += ack.accepted;
          this.status.lastSavedAt = new Date(this.now()).toISOString();
          this.inFlight = [];
          this.attempts = 0;
          this.nextAttempt = this.now() + 5000;
          this.status.state = 'idle';
          return;
        }
        if ([400, 401, 403, 404, 409, 413].includes(response.status)) {
          this.status.state = 'blocked';
          this.status.dropped += this.pending.length + this.inFlight.length;
          this.pending = [];
          this.inFlight = [];
          return;
        }
        throw new Error('Temporary storage failure');
      } catch {
        if (generation !== this.generation) return;
        this.attempts++;
        this.status.state = 'retrying';
        this.nextAttempt =
          this.now() +
          Math.min(30_000, 1000 * 2 ** (this.attempts - 1)) *
            (0.75 + this.random() * 0.5);
        if (this.attempts >= MAX_ATTEMPTS) {
          this.status.dropped += this.inFlight.length;
          this.inFlight = [];
          this.attempts = 0;
        }
      }
    })().finally(() => {
      this.operation = null;
    });
    return this.operation;
  }
  async dispose() {
    clearInterval(this.timer);
    await this.setEnabled(false);
  }
}
export class MeasurementQueue extends RecordQueue<Measurement> {
  private lastSecond: string | null = null;
  observe(snapshot: SensorSnapshot, activity: RecordedActivity | null = null) {
    const m = serializeSnapshot(snapshot, randomUUID(), activity);
    if (!m) return;
    const key = `${m.sessionId}:${m.timestamp}`;
    if (key === this.lastSecond) return;
    this.lastSecond = key;
    this.enqueue(m);
  }
}
export function createBatchSender(apiUrl: string, token?: string): SendBatch {
  return async (measurements) => {
    const response = await fetch(new URL('/measurements/batch', apiUrl), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(measurementBatchSchema.parse({ measurements })),
    });
    return {
      status: response.status,
      ...(response.ok ? { body: (await response.json()) as unknown } : {}),
    };
  };
}
export function storageConfigured(apiUrl: string, token?: string) {
  const url = new URL(apiUrl);
  return (
    Boolean(token) &&
    (url.protocol === 'https:' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  );
}
