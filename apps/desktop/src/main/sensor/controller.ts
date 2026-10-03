import { randomUUID } from 'node:crypto';
import {
  sensorSnapshotSchema,
  type SensorEvent,
  type SensorIssue,
  type SensorProviderKind,
  type SensorSnapshot,
} from '@trueiris/schemas';
import type { SensorProvider } from '@trueiris/shared';

export class SensorStartError extends Error {
  constructor(readonly issue: SensorIssue) {
    super('Sensor cannot start');
  }
}
export class SensorController {
  private generation = 0;
  private provider: SensorProvider | null = null;
  private snapshot: SensorSnapshot;
  private cleanup: Promise<void> = Promise.resolve();
  private cleanupFailed = false;
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(
    initialProvider: SensorProviderKind,
    private readonly factory: (
      kind: SensorProviderKind,
    ) => Promise<SensorProvider>,
    private readonly publish: (snapshot: SensorSnapshot) => void,
  ) {
    this.snapshot = {
      provider: initialProvider,
      phase: 'off',
      issue: 'none',
      sessionId: null,
      reading: null,
    };
    this.heartbeat = setInterval(() => {
      if (
        this.snapshot.phase === 'running' &&
        this.snapshot.reading &&
        Date.now() - Date.parse(this.snapshot.reading.timestamp) > 5000
      ) {
        this.update({ reading: null, issue: 'stale' });
      }
    }, 1000);
    this.heartbeat.unref();
  }
  get(): SensorSnapshot {
    return structuredClone(this.snapshot);
  }
  private update(patch: Partial<SensorSnapshot>) {
    this.snapshot = sensorSnapshotSchema.parse({ ...this.snapshot, ...patch });
    this.publish(this.get());
  }
  private release() {
    const provider = this.provider;
    this.provider = null;
    this.cleanup = this.cleanup
      .then(async () => {
        if (provider) await provider.stop();
      })
      .catch(() => {
        this.cleanupFailed = true;
        this.update({ phase: 'error', issue: 'processing', reading: null });
      });
    return this.cleanup;
  }
  async start(kind: SensorProviderKind): Promise<SensorSnapshot> {
    if (['starting', 'running', 'stopping'].includes(this.snapshot.phase))
      return this.get();
    await this.cleanup;
    if (this.cleanupFailed) return this.get();
    // Recheck after await: simultaneous start requests must own one provider.
    if (['starting', 'running', 'stopping'].includes(this.snapshot.phase))
      return this.get();
    const generation = ++this.generation;
    const sessionId = randomUUID();
    this.update({
      provider: kind,
      phase: 'starting',
      issue: 'calibrating',
      sessionId,
      reading: null,
    });
    try {
      const provider = await this.factory(kind);
      if (generation !== this.generation) {
        await provider.stop();
        return this.get();
      }
      this.provider = provider;
      await provider.start(sessionId, (event) =>
        this.receive(generation, event),
      );
    } catch (error) {
      if (generation === this.generation)
        this.fail(
          error instanceof SensorStartError ? error.issue : 'processing',
        );
    }
    return this.get();
  }
  private fail(issue: SensorIssue) {
    ++this.generation;
    this.update({ phase: 'error', issue, reading: null });
    void this.release();
  }
  private receive(generation: number, event: SensorEvent) {
    if (generation !== this.generation) return;
    if (event.kind === 'error') {
      this.fail(event.issue);
      return;
    }
    if (event.kind === 'ready') {
      this.update({ phase: 'running' });
      return;
    }
    if (event.kind === 'issue') {
      if (event.issue !== this.snapshot.issue || this.snapshot.reading)
        this.update({ issue: event.issue, reading: null });
      return;
    }
    if (
      event.reading.sessionId !== this.snapshot.sessionId ||
      event.reading.source !==
        (this.snapshot.provider === 'presage' ? 'live' : 'mock')
    ) {
      this.fail('processing');
      return;
    }
    const reading = event.reading;
    const issue = reading.talking
      ? 'talking'
      : reading.signalQuality === 'poor'
        ? 'low_confidence'
        : reading.signalQuality === 'unavailable'
          ? 'calibrating'
          : 'none';
    this.update({ reading, issue });
  }
  async stop(): Promise<SensorSnapshot> {
    const generation = ++this.generation;
    const busy = this.snapshot.phase !== 'off';
    if (busy) this.update({ phase: 'stopping', reading: null });
    await this.release();
    if (!this.cleanupFailed && generation === this.generation)
      this.update({
        phase: 'off',
        issue: 'none',
        sessionId: null,
        reading: null,
      });
    return this.get();
  }
  async dispose() {
    clearInterval(this.heartbeat);
    await this.stop();
  }
}
