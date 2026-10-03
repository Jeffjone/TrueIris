import { sensorEventSchema, type SensorEvent } from '@trueiris/schemas';
import type { SensorProvider } from '@trueiris/shared';

/** Small structural boundary lets lifecycle tests use a child without Electron/native hardware. */
export interface SensorChild {
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
}

export class PresageSensorProvider implements SensorProvider {
  private child: SensorChild | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopping = false;
  private exited = false;
  private exitListeners: Array<() => void> = [];
  constructor(
    private readonly apiKey: string,
    private readonly spawn: () => SensorChild,
    private readonly startupTimeout = 30_000,
    private readonly stopTimeout = 5000,
  ) {}
  async start(sessionId: string, onEvent: (event: SensorEvent) => void) {
    if (this.child) throw new Error('Sensor already started');
    const child = this.spawn();
    this.child = child;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (failed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (failed) reject(new Error('Sensor start failed'));
        else resolve();
      };
      const timeout = setTimeout(() => {
        onEvent({ kind: 'error', issue: 'network' });
        settle(true);
        child.kill();
      }, this.startupTimeout);
      child.on('message', (message) => {
        if (this.stopping || this.exited) return;
        const parsed = sensorEventSchema.safeParse(message);
        if (!parsed.success) {
          onEvent({ kind: 'error', issue: 'processing' });
          settle(true);
          child.kill();
          return;
        }
        onEvent(parsed.data);
        if (parsed.data.kind === 'ready') settle(false);
        if (parsed.data.kind === 'error') {
          settle(true);
          // The worker drains its native session; stop() bounds that teardown.
          void this.stop();
        }
      });
      child.on('exit', () => {
        this.exited = true;
        for (const listener of this.exitListeners) listener();
        this.exitListeners = [];
        if (!this.stopping) onEvent({ kind: 'error', issue: 'processing' });
        settle(true);
      });
      child.postMessage({ kind: 'start', apiKey: this.apiKey, sessionId });
    });
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    const child = this.child;
    if (!child || this.exited) return Promise.resolve();
    this.stopPromise = new Promise<void>((resolve, reject) => {
      let finalTimeout: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
        child.kill();
        finalTimeout = setTimeout(
          () => reject(new Error('Sensor teardown timed out')),
          1000,
        );
      }, this.stopTimeout);
      this.exitListeners.push(() => {
        clearTimeout(timeout);
        if (finalTimeout) clearTimeout(finalTimeout);
        resolve();
      });
      try {
        child.postMessage({ kind: 'stop' });
      } catch {
        child.kill();
      }
    });
    return this.stopPromise;
  }
}
