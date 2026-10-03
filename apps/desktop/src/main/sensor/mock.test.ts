import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SensorEvent } from '@trueiris/schemas';
import { MockSensorProvider } from './mock';

const sessionId = '09bdad7b-3f43-4c58-82bb-0f8d2ef1e9bf';
afterEach(() => vi.useRealTimers());
describe('mock sensor', () => {
  it('labels simulated readings and stops emitting on teardown', async () => {
    vi.useFakeTimers();
    const events: SensorEvent[] = [];
    const provider = new MockSensorProvider();
    await provider.start(sessionId, (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(2000);
    expect(events.at(-1)).toMatchObject({
      kind: 'reading',
      reading: { source: 'mock', pulseRate: expect.any(Number) },
    });
    await provider.stop();
    const count = events.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toHaveLength(count);
  });
  it.each([
    'no_face',
    'lighting',
    'motion',
    'network',
    'no_camera',
    'permission_denied',
  ] as const)('exercises %s without any native SDK', async (scenario) => {
    vi.useFakeTimers();
    const events: SensorEvent[] = [];
    const provider = new MockSensorProvider(scenario);
    await provider.start(sessionId, (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(1000);
    expect(events.at(-1)).toMatchObject({ issue: scenario });
    await provider.stop();
  });
  it.each(['low_confidence', 'talking'] as const)(
    'withholds values during %s',
    async (scenario) => {
      vi.useFakeTimers();
      const events: SensorEvent[] = [];
      const provider = new MockSensorProvider(scenario);
      await provider.start(sessionId, (event) => events.push(event));
      await vi.advanceTimersByTimeAsync(1000);
      const event = events.at(-1);
      expect(event).toMatchObject({
        kind: 'reading',
        reading: { signalQuality: 'poor' },
      });
      if (event?.kind === 'reading')
        expect(event.reading.pulseRate).toBeUndefined();
      await provider.stop();
    },
  );
});
