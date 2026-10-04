import { z } from 'zod';
import { foregroundSchema, type Foreground } from '@trueiris/schemas';
import type { SensorChild } from '../sensor/presage';
export interface ContextProvider {
  read(titles: boolean): Promise<Foreground>;
  stop(): void;
}
export class ContextUnavailable extends Error {
  constructor(readonly issue: 'unsupported' | 'unavailable') {
    super(issue);
  }
}
const response = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('foreground'), foreground: foregroundSchema })
    .strict(),
  z
    .object({
      kind: z.literal('error'),
      issue: z.enum(['unsupported', 'unavailable']),
    })
    .strict(),
]);
/** Bound every native observation and kill the utility process on teardown. */
export class NativeContextProvider implements ContextProvider {
  private pending: {
    resolve: (result: Foreground) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private stopped = false;
  constructor(
    private readonly child: SensorChild,
    private readonly deadline = 4000,
  ) {
    child.on('message', (value) => {
      const pending = this.pending;
      if (!pending || this.stopped) return;
      this.pending = null;
      clearTimeout(pending.timer);
      const parsed = response.safeParse(value);
      if (!parsed.success)
        pending.reject(new ContextUnavailable('unavailable'));
      else if (parsed.data.kind === 'error')
        pending.reject(new ContextUnavailable(parsed.data.issue));
      else pending.resolve(parsed.data.foreground);
    });
    child.on('exit', () => {
      this.stop();
    });
  }
  read(windowTitles: boolean): Promise<Foreground> {
    if (this.stopped || this.pending)
      return Promise.reject(new ContextUnavailable('unavailable'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop();
      }, this.deadline);
      this.pending = { resolve, reject, timer };
      try {
        this.child.postMessage({ windowTitles });
      } catch {
        this.stop();
      }
    });
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new ContextUnavailable('unavailable'));
      this.pending = null;
    }
    this.child.kill();
  }
}
/** Explicit test provider; every saved interval is marked mock. */
export class MockContextProvider implements ContextProvider {
  private count = 0;
  async read(titles: boolean): Promise<Foreground> {
    const coding = Math.floor(this.count++ / 4) % 2 === 0;
    return {
      application: coding
        ? { id: 'com.microsoft.VSCode', name: 'Visual Studio Code' }
        : { id: 'com.apple.Preview', name: 'Preview' },
      windowTitle: titles ? 'Mock window' : null,
      titleAccess: titles ? 'ready' : 'off',
    };
  }
  stop() {}
}
