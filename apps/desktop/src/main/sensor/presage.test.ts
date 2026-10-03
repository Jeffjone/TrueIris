import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresageSensorProvider, type SensorChild } from './presage';

const sessionId = '09bdad7b-3f43-4c58-82bb-0f8d2ef1e9bf';
class Child extends EventEmitter implements SensorChild {
  messages: unknown[] = [];
  killed = false;
  postMessage(message: unknown) {
    this.messages.push(message);
    if ((message as { kind: string }).kind === 'stop')
      queueMicrotask(() => this.emit('exit', 0));
  }
  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 1));
    return true;
  }
}
afterEach(() => vi.useRealTimers());
describe('Presage utility-process provider', () => {
  it('preserves a classified native error while allowing orderly teardown', async () => {
    const child = new Child();
    const events = vi.fn();
    const provider = new PresageSensorProvider('test-only-key', () => child);
    const start = provider.start(sessionId, events);
    const rejected = expect(start).rejects.toThrow('Sensor start failed');
    child.emit('message', { kind: 'error', issue: 'authentication' });
    await rejected;
    await provider.stop();
    expect(child.killed).toBe(false);
    expect(child.messages[1]).toEqual({ kind: 'stop' });
    expect(events).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith({
      kind: 'error',
      issue: 'authentication',
    });
  });
  it('waits for readiness, sends credentials only to the child, and tears it down', async () => {
    const child = new Child();
    const events = vi.fn();
    const provider = new PresageSensorProvider('test-only-key', () => child);
    const start = provider.start(sessionId, events);
    child.emit('message', { kind: 'ready' });
    await start;
    expect(child.messages[0]).toMatchObject({
      kind: 'start',
      apiKey: 'test-only-key',
      sessionId,
    });
    expect(events).toHaveBeenCalledWith({ kind: 'ready' });
    await provider.stop();
    expect(child.messages[1]).toEqual({ kind: 'stop' });
  });
  it('rejects malformed or secret-bearing child responses and kills the process', async () => {
    const child = new Child();
    const events = vi.fn();
    const provider = new PresageSensorProvider('test-only-key', () => child);
    const start = provider.start(sessionId, events);
    const rejected = expect(start).rejects.toThrow('Sensor start failed');
    child.emit('message', { kind: 'ready', apiKey: 'must-not-pass' });
    await rejected;
    await provider.stop();
    expect(child.killed).toBe(true);
    expect(events).toHaveBeenCalledWith({ kind: 'error', issue: 'processing' });
  });
  it('times out a stuck SDK startup and releases the process', async () => {
    vi.useFakeTimers();
    const child = new Child();
    const events = vi.fn();
    const provider = new PresageSensorProvider(
      'test-only-key',
      () => child,
      100,
    );
    const start = provider.start(sessionId, events);
    const rejected = expect(start).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await provider.stop();
    expect(child.killed).toBe(true);
    expect(events).toHaveBeenCalledWith({ kind: 'error', issue: 'network' });
  });
  it('kills a process that cannot drain during stop', async () => {
    vi.useFakeTimers();
    const child = new Child();
    const provider = new PresageSensorProvider(
      'test-only-key',
      () => child,
      100,
      100,
    );
    const start = provider.start(sessionId, () => {});
    child.emit('message', { kind: 'ready' });
    await start;
    child.postMessage = () => {};
    const stop = provider.stop();
    await vi.advanceTimersByTimeAsync(100);
    await stop;
    expect(child.killed).toBe(true);
  });
});
