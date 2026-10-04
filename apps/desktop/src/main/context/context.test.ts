import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contextIntervalSchema,
  contextBatchSchema,
  contextCursorSchema,
  type ContextInterval,
  type Foreground,
  type StorageStatus,
} from '@trueiris/schemas';
import { classifyActivity, effectiveActivity } from './classifier';
import { ContextController } from './controller';
import {
  ContextUnavailable,
  NativeContextProvider,
  type ContextProvider,
} from './provider';
import type { SensorChild } from '../sensor/presage';
import { RecordQueue } from '../storage/queue';
const coding: Foreground = {
  application: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
  windowTitle: null,
  titleAccess: 'off',
};
const status: StorageStatus = {
  configured: true,
  enabled: true,
  state: 'idle',
  queued: 0,
  saved: 0,
  dropped: 0,
  lastSavedAt: null,
};
const origin = Date.parse('2026-10-04T12:00:00Z');
const activityInput = {
  application: coding.application,
  windowTitle: null,
  previousActivity: null,
  timeOfDay: new Date(origin).toISOString(),
};

describe('conservative activity abstraction', () => {
  it('uses app evidence and gives ambiguous browsers low confidence', () => {
    expect(classifyActivity(activityInput)).toMatchObject({
      activity: 'Coding',
      confidence: 0.9,
    });
    const browser = {
      ...activityInput,
      application: { id: 'com.apple.Safari', name: 'Safari' },
      previousActivity: 'Coding' as const,
    };
    expect(classifyActivity(browser)).toMatchObject({
      activity: 'Other',
      confidence: 0.2,
    });
    const withTitle = classifyActivity({
      ...browser,
      windowTitle: 'Private document – Coursera',
    });
    expect(withTitle?.activity).toBe('Studying');
    expect(withTitle?.reason).not.toContain('Private document');
    expect(
      classifyActivity({ ...activityInput, application: null }),
    ).toBeNull();
  });
  it('honors manual selection above idle inference and treats idle as uncertain', () => {
    expect(effectiveActivity(activityInput, 'Reading', 200)).toMatchObject({
      activity: 'Reading',
      confidence: 1,
      reason: 'Selected by you.',
    });
    expect(effectiveActivity(activityInput, null, 60)).toMatchObject({
      activity: 'Break',
      confidence: 0.8,
    });
    expect(effectiveActivity(activityInput, null, 59)?.activity).toBe('Coding');
    expect(
      effectiveActivity({ ...activityInput, application: null }, 'Coding', 0),
    ).toBeNull();
  });
});

describe('context capture and consent lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(origin);
  });
  afterEach(() => vi.useRealTimers());
  function setup() {
    let observation = coding,
      idle = 0;
    const saved: ContextInterval[] = [];
    const provider: ContextProvider = {
      read: vi.fn(async () => observation),
      stop: vi.fn(),
    };
    const controller = new ContextController(
      'mock',
      () => provider,
      () => idle,
      vi.fn(),
      (i) => saved.push(i),
      () => status,
    );
    return {
      controller,
      provider,
      saved,
      set: (value: Foreground) => {
        observation = value;
      },
      idle: (value: number) => {
        idle = value;
      },
    };
  }
  const tick = async (c: ContextController, ms = 1000) => {
    vi.setSystemTime(Date.now() + ms);
    await c.poll();
  };
  it('captures independently of camera but persists only after saving consent', async () => {
    const { controller: c, provider, saved } = setup();
    expect(c.get()).toMatchObject({
      phase: 'off',
      options: { windowTitles: false, focusMode: false },
    });
    expect(provider.read).not.toHaveBeenCalled();
    await c.start();
    await tick(c);
    expect(saved).toEqual([]);
    c.setSaving(true);
    await tick(c);
    await tick(c);
    c.stop();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      source: 'mock',
      start: new Date(origin + 2000).toISOString(),
      end: new Date(origin + 3000).toISOString(),
      windowTitle: null,
    });
    expect(c.get()).toMatchObject({
      phase: 'off',
      application: null,
      classification: null,
      sessionId: null,
    });
  });
  it('splits app/manual/focus/idle changes and counts switches without title churn', async () => {
    const { controller: c, saved, set, idle } = setup();
    c.setSaving(true);
    await c.start();
    await tick(c);
    c.setManual('Studying');
    await tick(c);
    c.setOptions({ windowTitles: false, focusMode: true });
    await tick(c);
    set({
      application: { id: 'Preview', name: 'Preview' },
      windowTitle: null,
      titleAccess: 'off',
    });
    await tick(c);
    idle(65);
    await tick(c);
    c.setManual(null);
    await tick(c);
    await tick(c);
    c.stop();
    expect(
      saved.some((i) => i.manualActivity === 'Studying' && i.focusMode),
    ).toBe(true);
    expect(
      saved.some((i) => i.classification?.activity === 'Break' && i.idle),
    ).toBe(true);
    expect(saved.at(-1)?.applicationSwitches).toBe(1);
    expect(saved.every((i) => i.source === 'mock')).toBe(true);
    expect(c.get().options).toEqual({ windowTitles: false, focusMode: false });
  });
  it('bounds intervals to 30 seconds and never bridges delayed observations', async () => {
    const { controller: c, saved } = setup();
    c.setSaving(true);
    await c.start();
    for (let i = 0; i < 31; i++) await tick(c);
    await tick(c, 60_000);
    await tick(c);
    c.stop();
    expect(
      saved[0] && Date.parse(saved[0].end) - Date.parse(saved[0].start),
    ).toBe(30_000);
    expect(
      saved.every((i) => Date.parse(i.end) - Date.parse(i.start) <= 30_000),
    ).toBe(true);
    expect(
      saved.some(
        (i, index) =>
          index > 0 && Date.parse(i.start) > Date.parse(saved[index - 1]!.end),
      ),
    ).toBe(true);
  });
  it('keeps normal timer jitter contiguous but resets foreground duration after a missing poll', async () => {
    const { controller: c, saved, set } = setup();
    c.setSaving(true);
    await c.start();
    await tick(c, 1100);
    set({
      application: { id: 'Preview', name: 'Preview' },
      windowTitle: null,
      titleAccess: 'off',
    });
    await tick(c, 1100);
    await tick(c, 1000);
    await tick(c, 1700);
    await tick(c);
    c.stop();
    expect(saved[0]!.end).toBe(saved[1]!.start);
    expect(Date.parse(saved[2]!.start)).toBeGreaterThan(
      Date.parse(saved[1]!.end),
    );
  });
  it('scrubs titles immediately and rejects a late reply after options change/stop', async () => {
    const { controller: c, provider, set } = setup();
    c.setOptions({ windowTitles: true, focusMode: true });
    set({ ...coding, windowTitle: 'Private document', titleAccess: 'ready' });
    await c.start();
    expect(c.get().windowTitle).toBe('Private document');
    let resolve!: (v: Foreground) => void;
    vi.mocked(provider.read).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = c.poll();
    c.setOptions({ windowTitles: false, focusMode: true });
    expect(c.get().windowTitle).toBeNull();
    resolve({
      ...coding,
      windowTitle: 'Late private title',
      titleAccess: 'ready',
    });
    await pending;
    expect(c.get().windowTitle).toBeNull();
    vi.mocked(provider.read).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const second = c.poll();
    c.stop();
    resolve(coding);
    await second;
    expect(c.get().phase).toBe('off');
  });
  it('stops on failure and represents unsupported environments honestly', async () => {
    const { controller: c, provider } = setup();
    vi.mocked(provider.read).mockRejectedValue(
      new ContextUnavailable('unsupported'),
    );
    await c.start();
    expect(c.get()).toMatchObject({
      phase: 'error',
      issue: 'unsupported',
      application: null,
      classification: null,
    });
    expect(provider.stop).toHaveBeenCalled();
    c.stop();
  });
  it('leaves an interval gap for missing foreground observations', async () => {
    const { controller: c, saved, set } = setup();
    c.setSaving(true);
    await c.start();
    await tick(c);
    set({ application: null, windowTitle: null, titleAccess: 'off' });
    await tick(c);
    await tick(c);
    expect(c.get().classification).toBeNull();
    set(coding);
    await tick(c);
    await tick(c);
    c.stop();
    expect(saved).toHaveLength(2);
    expect(saved[0]!.end < saved[1]!.start).toBe(true);
  });
});

describe('native worker boundary', () => {
  it('bounds hung reads, kills the worker, and ignores stale callbacks', async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, (value: never) => void>();
      const child = {
        on: (event: string, fn: (value: never) => void) => {
          listeners.set(event, fn);
          return child;
        },
        kill: vi.fn(() => true),
        postMessage: vi.fn(),
      } as SensorChild;
      const provider = new NativeContextProvider(child, 100);
      const pending = provider.read(false);
      const failure = expect(pending).rejects.toThrow('unavailable');
      await vi.advanceTimersByTimeAsync(101);
      await failure;
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.postMessage).toHaveBeenCalledWith({ windowTitles: false });
      listeners.get('message')?.({
        kind: 'foreground',
        foreground: coding,
      } as never);
      await expect(provider.read(true)).rejects.toThrow('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('context storage contracts and retries', () => {
  const interval: ContextInterval = {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    source: 'mock',
    startedAt: new Date(origin).toISOString(),
    start: new Date(origin).toISOString(),
    end: new Date(origin + 1000).toISOString(),
    application: coding.application,
    windowTitle: null,
    manualActivity: null,
    classification: classifyActivity(activityInput),
    idle: false,
    idleSeconds: 0,
    sessionSeconds: 1,
    applicationSwitches: 0,
    focusMode: false,
  };
  it('rejects unbounded/inverted intervals, spoofed identity and malformed cursors', () => {
    expect(contextIntervalSchema.safeParse(interval).success).toBe(true);
    for (const changes of [
      { end: new Date(origin + 30_001).toISOString() },
      { end: interval.start },
      { startedAt: interval.end },
      { userId: 'spoof' },
      { application: null },
    ])
      expect(
        contextIntervalSchema.safeParse({ ...interval, ...changes }).success,
      ).toBe(false);
    expect(
      contextBatchSchema.safeParse({ intervals: Array(61).fill(interval) })
        .success,
    ).toBe(false);
    expect(
      contextCursorSchema.safeParse(`${interval.start}|${interval.id}`).success,
    ).toBe(true);
    expect(contextCursorSchema.safeParse('invalid|invalid').success).toBe(
      false,
    );
  });
  it('retries immutable interval IDs and keeps the context queue bounded', async () => {
    let now = origin;
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockImplementation(async (batch: ContextInterval[]) => ({
        status: 200,
        body: { accepted: batch.length, duplicates: 0 },
      }));
    const queue = new RecordQueue<ContextInterval>(
      true,
      send,
      () => now,
      () => 0.5,
      2,
      1,
    );
    try {
      queue.enqueue(interval);
      expect(queue.get().queued).toBe(0);
      await queue.setEnabled(true);
      queue.enqueue(interval);
      await queue.flush();
      expect(queue.get().state).toBe('retrying');
      now += 2000;
      await queue.flush();
      expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
      queue.enqueue({ ...interval, id: 'a' });
      queue.enqueue({ ...interval, id: 'b' });
      queue.enqueue({ ...interval, id: 'c' });
      expect(queue.get()).toMatchObject({ queued: 2, dropped: 1 });
      await queue.setEnabled(false);
      expect(queue.get()).toMatchObject({ queued: 0, enabled: false });
    } finally {
      await queue.dispose();
    }
  });
});
