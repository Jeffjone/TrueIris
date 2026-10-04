import { randomUUID } from 'node:crypto';
import {
  contextIntervalSchema,
  type ContextInterval,
  type ContextOptions,
  type ContextSnapshot,
  type Foreground,
  type RecordedActivity,
  type StorageStatus,
} from '@trueiris/schemas';
import { effectiveActivity } from './classifier';
import { ContextUnavailable, type ContextProvider } from './provider';

const iso = (time: number) => new Date(time).toISOString();
const zeroStorage: StorageStatus = {
  configured: false,
  enabled: false,
  state: 'off',
  queued: 0,
  saved: 0,
  dropped: 0,
  lastSavedAt: null,
};
export function initialContext(provider: 'desktop' | 'mock'): ContextSnapshot {
  return {
    phase: 'off',
    provider,
    issue: 'none',
    sessionId: null,
    startedAt: null,
    timestamp: null,
    application: null,
    windowTitle: null,
    titleAccess: 'off',
    options: { windowTitles: false, focusMode: false },
    manualActivity: null,
    classification: null,
    idleSeconds: 0,
    sessionSeconds: 0,
    applicationSwitches: 0,
    foregroundSeconds: 0,
    storage: zeroStorage,
  };
}
/** Independent capture, explicit saving boundaries, and never invent continuity across missing polls. */
export class ContextController {
  private snapshot: ContextSnapshot;
  private provider: ContextProvider | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private busy = false;
  private revision = 0;
  private saving = false;
  private open: { start: number; last: number; value: ContextSnapshot } | null =
    null;
  private foregroundStart = 0;
  private lastObserved: number | null = null;
  constructor(
    kind: 'desktop' | 'mock',
    private readonly create: () => ContextProvider,
    private readonly idle: () => number,
    private readonly emit: (value: ContextSnapshot) => void,
    private readonly persist: (value: ContextInterval) => void,
    private readonly storage: () => StorageStatus,
    private readonly now = Date.now,
  ) {
    this.snapshot = initialContext(kind);
  }
  get(): ContextSnapshot {
    return structuredClone({ ...this.snapshot, storage: this.storage() });
  }
  private publish() {
    this.emit(this.get());
  }
  async start() {
    if (this.snapshot.phase === 'running' || this.snapshot.phase === 'starting')
      return this.get();
    const options = { ...this.snapshot.options };
    this.stop();
    this.snapshot.options = options;
    const time = this.now();
    this.snapshot = {
      ...this.snapshot,
      phase: 'starting',
      issue: 'none',
      sessionId: randomUUID(),
      startedAt: iso(time),
      timestamp: null,
      applicationSwitches: 0,
      sessionSeconds: 0,
      foregroundSeconds: 0,
    };
    this.foregroundStart = time;
    this.lastObserved = null;
    try {
      this.provider = this.create();
    } catch (error) {
      this.fail(error);
      return this.get();
    }
    this.publish();
    this.timer = setInterval(() => {
      void this.poll();
    }, 1000);
    this.timer.unref();
    await this.poll();
    return this.get();
  }
  stop(): ContextSnapshot {
    this.close(this.now());
    this.generation++;
    this.revision++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.provider?.stop();
    this.provider = null;
    this.busy = false;
    this.lastObserved = null;
    this.snapshot = {
      ...initialContext(this.snapshot.provider),
      manualActivity: this.snapshot.manualActivity,
    };
    this.publish();
    return this.get();
  }
  setManual(value: RecordedActivity | null) {
    this.close(this.now());
    this.revision++;
    this.snapshot.manualActivity = value;
    this.refreshClassification();
    this.publish();
  }
  setOptions(options: ContextOptions) {
    this.close(this.now());
    this.revision++;
    this.snapshot.options = options;
    // Scrub prior title immediately, including replies from an earlier poll.
    this.snapshot.windowTitle = null;
    this.snapshot.titleAccess = options.windowTitles ? 'unavailable' : 'off';
    this.refreshClassification();
    this.publish();
  }
  setSaving(enabled: boolean) {
    this.close(this.now());
    this.saving = enabled;
    this.open = null;
  }
  private refreshClassification() {
    this.snapshot.classification = effectiveActivity(
      {
        application: this.snapshot.application,
        windowTitle: this.snapshot.windowTitle,
        previousActivity: this.snapshot.classification?.activity ?? null,
        timeOfDay: iso(this.now()),
      },
      this.snapshot.manualActivity,
      this.snapshot.idleSeconds,
    );
  }
  private fail(error: unknown) {
    this.close(this.now());
    this.generation++;
    this.provider?.stop();
    this.provider = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.snapshot = {
      ...this.snapshot,
      phase: 'error',
      issue: error instanceof ContextUnavailable ? error.issue : 'unavailable',
      application: null,
      windowTitle: null,
      classification: null,
      titleAccess: this.snapshot.options.windowTitles ? 'unavailable' : 'off',
    };
    this.publish();
  }
  async poll() {
    if (this.busy || !this.provider) return;
    this.busy = true;
    const generation = this.generation,
      revision = this.revision;
    try {
      const observed: Foreground = await this.provider.read(
        this.snapshot.options.windowTitles,
      );
      if (generation !== this.generation || revision !== this.revision) return;
      const time = this.now();
      if (
        this.lastObserved !== null &&
        (time - this.lastObserved > 1500 || time < this.lastObserved)
      ) {
        this.close(Math.min(time, this.lastObserved + 1000));
        this.lastObserved = null;
        this.foregroundStart = time;
      }
      const changed =
        this.snapshot.application?.id !== observed.application?.id;
      if (changed) {
        if (this.snapshot.application && observed.application)
          this.snapshot.applicationSwitches++;
        this.foregroundStart = time;
      }
      this.snapshot = {
        ...this.snapshot,
        ...observed,
        phase: 'running',
        issue: 'none',
        timestamp: iso(time),
        windowTitle: this.snapshot.options.windowTitles
          ? observed.windowTitle
          : null,
        idleSeconds: Math.max(0, Math.floor(this.idle())),
        sessionSeconds: Math.max(
          0,
          Math.floor((time - Date.parse(this.snapshot.startedAt!)) / 1000),
        ),
        foregroundSeconds: Math.max(
          0,
          Math.floor((time - this.foregroundStart) / 1000),
        ),
      };
      this.refreshClassification();
      const previous = this.open?.value;
      if (
        previous &&
        (time - this.open!.start >= 30_000 ||
          this.key(previous) !== this.key(this.snapshot))
      )
        this.close(time);
      if (this.saving && this.snapshot.application) {
        this.open ??= { start: time, last: time, value: this.get() };
        this.open.last = time;
        this.open.value = this.get();
      }
      this.lastObserved = time;
      this.publish();
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
  private key(value: ContextSnapshot) {
    return JSON.stringify([
      value.application,
      value.windowTitle,
      value.manualActivity,
      value.classification,
      value.idleSeconds >= 60,
      value.options.focusMode,
    ]);
  }
  private close(time: number) {
    const open = this.open;
    this.open = null;
    if (!open || !this.saving || !open.value.sessionId || !open.value.startedAt)
      return;
    // Allow ordinary timer jitter at a fresh observation boundary. Larger
    // delays end at the previous observation's one-second heartbeat.
    const observedEnd =
      time >= open.last && time - open.last <= 1500 ? time : open.last + 1000;
    const end = Math.min(time, observedEnd, open.start + 30_000);
    if (end <= open.start) return;
    const s = open.value;
    this.persist(
      contextIntervalSchema.parse({
        id: randomUUID(),
        sessionId: s.sessionId,
        source: s.provider === 'mock' ? 'mock' : 'live',
        startedAt: s.startedAt,
        start: iso(open.start),
        end: iso(end),
        application: s.application,
        windowTitle: s.windowTitle,
        manualActivity: s.manualActivity,
        classification: s.classification,
        idle: s.idleSeconds >= 60,
        idleSeconds: s.idleSeconds,
        sessionSeconds: s.sessionSeconds,
        applicationSwitches: s.applicationSwitches,
        focusMode: s.options.focusMode,
      }),
    );
  }
}
