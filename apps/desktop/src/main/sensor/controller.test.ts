import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SensorEvent, SensorSnapshot } from '@trueiris/schemas';
import type { SensorProvider } from '@trueiris/shared';
import { SensorController, SensorStartError } from './controller';

const controllers: SensorController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  vi.useRealTimers();
});
function setup(factory: (kind: 'mock' | 'presage') => Promise<SensorProvider>) {
  const updates: SensorSnapshot[] = [];
  const controller = new SensorController('presage', factory, (value) =>
    updates.push(value),
  );
  controllers.push(controller);
  return { controller, updates };
}
function provider() {
  let emit: (event: SensorEvent) => void = () => {};
  let sessionId = '';
  const instance: SensorProvider = {
    start: vi.fn(async (id, listener) => {
      sessionId = id;
      emit = listener;
      listener({ kind: 'ready' });
    }),
    stop: vi.fn(async () => {}),
  };
  return {
    instance,
    emit: (event: SensorEvent) => emit(event),
    reading: (source: 'live' | 'mock' = 'mock') => ({
      kind: 'reading' as const,
      reading: {
        timestamp: new Date().toISOString(),
        sessionId,
        source,
        pulseRate: 74,
        pulseConfidence: 0.9,
        signalQuality: 'excellent' as const,
      },
    }),
  };
}
describe('sensor lifecycle controller', () => {
  it('owns the session start across quality changes and resets it after stop/restart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T20:00:00Z'));
    const fake = provider();
    const { controller } = setup(async () => fake.instance);
    await controller.start('mock');
    const start = controller.get().startedAt;
    expect(start).toBe('2026-10-03T20:00:00.000Z');
    await vi.advanceTimersByTimeAsync(2000);
    fake.emit({ kind: 'issue', issue: 'no_face' });
    fake.emit(fake.reading());
    fake.emit({ kind: 'ready' });
    expect(controller.get().startedAt).toBe(start);
    await controller.stop();
    expect(controller.get().startedAt).toBeNull();
    await controller.start('mock');
    expect(controller.get().startedAt).toBe('2026-10-03T20:00:02.000Z');
    fake.emit({ kind: 'error', issue: 'network' });
    expect(controller.get().startedAt).toBeNull();
  });
  it('starts only once on concurrent requests and ignores readings after stop', async () => {
    const fake = provider();
    const factory = vi.fn(async () => fake.instance);
    const { controller } = setup(factory);
    await Promise.all([controller.start('mock'), controller.start('mock')]);
    expect(factory).toHaveBeenCalledTimes(1);
    fake.emit(fake.reading());
    expect(controller.get().reading?.pulseRate).toBe(74);
    await controller.stop();
    fake.emit(fake.reading());
    expect(controller.get()).toMatchObject({ phase: 'off', reading: null });
    expect(fake.instance.stop).toHaveBeenCalledTimes(1);
  });
  it('does not capture after a pending permission/start is canceled', async () => {
    const fake = provider();
    let resolveFactory: (value: SensorProvider) => void = () => {};
    const { controller } = setup(
      () =>
        new Promise((resolve) => {
          resolveFactory = resolve;
        }),
    );
    const start = controller.start('presage');
    await Promise.resolve();
    await controller.stop();
    resolveFactory(fake.instance);
    await start;
    expect(fake.instance.start).not.toHaveBeenCalled();
    expect(controller.get().phase).toBe('off');
  });
  it('exposes a sanitized missing-key state without creating a stream', async () => {
    const { controller } = setup(async () => {
      throw new SensorStartError('missing_key');
    });
    expect(await controller.start('presage')).toMatchObject({
      phase: 'error',
      issue: 'missing_key',
      reading: null,
    });
  });
  it('clears readings on validation failure and stops after an API error', async () => {
    const fake = provider();
    const { controller } = setup(async () => fake.instance);
    await controller.start('mock');
    fake.emit(fake.reading());
    fake.emit({ kind: 'issue', issue: 'no_face' });
    expect(controller.get().reading).toBeNull();
    fake.emit({ kind: 'error', issue: 'network' });
    await controller.stop();
    expect(fake.instance.stop).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched provenance and session IDs', async () => {
    const fake = provider();
    const { controller } = setup(async () => fake.instance);
    await controller.start('mock');
    fake.emit(fake.reading('live'));
    expect(controller.get()).toMatchObject({
      phase: 'error',
      issue: 'processing',
      reading: null,
    });
  });
  it('expires a silent provider instead of freezing the last pulse', async () => {
    vi.useFakeTimers();
    const fake = provider();
    const { controller } = setup(async () => fake.instance);
    await controller.start('mock');
    fake.emit(fake.reading());
    await vi.advanceTimersByTimeAsync(6000);
    expect(controller.get()).toMatchObject({ issue: 'stale', reading: null });
  });
});
describe('explicit demo fallback', () => {
  function demo(
    factory: (kind: 'mock' | 'presage') => Promise<SensorProvider>,
  ) {
    const controller = new SensorController('presage', factory, () => {}, true);
    controllers.push(controller);
    return controller;
  }
  it('uses a new correctly labeled mock session after missing credentials, never before explicit start', async () => {
    const mock = provider(),
      factory = vi.fn(async (kind) => {
        if (kind === 'presage') throw new SensorStartError('missing_key');
        return mock.instance;
      });
    const controller = demo(factory);
    expect(factory).not.toHaveBeenCalled();
    expect(await controller.start('presage')).toMatchObject({
      provider: 'mock',
      phase: 'running',
      fallbackIssue: 'missing_key',
    });
    mock.emit(mock.reading());
    expect(controller.get().reading?.source).toBe('mock');
    await controller.stop();
    expect(controller.get()).toMatchObject({
      phase: 'off',
      fallbackIssue: null,
    });
  });
  it('retains healthy genuine readings and tears down a failed Presage session before starting a new mock session', async () => {
    const live = provider(),
      mock = provider();
    const controller = demo(async (kind) =>
      kind === 'presage' ? live.instance : mock.instance,
    );
    await controller.start('presage');
    live.emit(live.reading('live'));
    const realId = controller.get().sessionId;
    expect(controller.get()).toMatchObject({
      provider: 'presage',
      fallbackIssue: null,
      reading: { source: 'live' },
    });
    live.emit({ kind: 'error', issue: 'network' });
    await vi.waitFor(() => expect(controller.get().provider).toBe('mock'));
    expect(live.instance.stop).toHaveBeenCalledOnce();
    expect(controller.get().sessionId).not.toBe(realId);
    mock.emit(mock.reading());
    live.emit(live.reading('live'));
    expect(controller.get()).toMatchObject({
      provider: 'mock',
      fallbackIssue: 'network',
      reading: { source: 'mock' },
    });
  });
  it('stops a pending fallback and refuses replacement if teardown fails', async () => {
    const live = provider(),
      mock = provider();
    let release: () => void = () => {};
    live.instance.stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const factory = vi.fn(async (kind) =>
        kind === 'presage' ? live.instance : mock.instance,
      ),
      controller = demo(factory);
    await controller.start('presage');
    live.emit({ kind: 'error', issue: 'network' });
    await vi.waitFor(() => expect(live.instance.stop).toHaveBeenCalled());
    const stopped = controller.stop();
    release();
    await stopped;
    expect(controller.get().phase).toBe('off');
    expect(factory).toHaveBeenCalledTimes(1);
    const failed = provider();
    failed.instance.stop = vi.fn(async () => {
      throw new Error('teardown');
    });
    const unsafeFactory = vi.fn(async (kind) =>
        kind === 'presage' ? failed.instance : mock.instance,
      ),
      unsafe = demo(unsafeFactory);
    await unsafe.start('presage');
    failed.emit({ kind: 'error', issue: 'network' });
    await vi.waitFor(() => expect(unsafe.get().issue).toBe('processing'));
    expect(unsafeFactory).toHaveBeenCalledTimes(1);
  });
  it('replaces a stale real stream in demo mode, but does not replace poor-quality live readings', async () => {
    vi.useFakeTimers();
    const live = provider(),
      mock = provider(),
      controller = demo(async (kind) =>
        kind === 'presage' ? live.instance : mock.instance,
      );
    await controller.start('presage');
    live.emit({ kind: 'issue', issue: 'lighting' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(controller.get().provider).toBe('presage');
    live.emit(live.reading('live'));
    await vi.advanceTimersByTimeAsync(6000);
    expect(controller.get()).toMatchObject({
      provider: 'mock',
      fallbackIssue: 'stale',
    });
  });
});
