import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SensorSnapshot, Measurement } from '@trueiris/schemas';
import {
  MeasurementQueue,
  serializeSnapshot,
  storageConfigured,
  createBatchSender,
  type SendBatch,
  type BatchResponse,
} from './queue';
const snapshot = (second = 0): SensorSnapshot => ({
  provider: 'mock',
  phase: 'running',
  issue: 'none',
  sessionId: '00000000-0000-4000-8000-000000000001',
  startedAt: '2026-10-03T12:00:00.789Z',
  reading: {
    timestamp: new Date(
      Date.UTC(2026, 9, 3, 12, 0, second) + 900,
    ).toISOString(),
    sessionId: '00000000-0000-4000-8000-000000000001',
    source: 'mock',
    pulseRate: 74,
    pulseConfidence: 0.92,
    signalQuality: 'excellent',
  },
});
const queues: MeasurementQueue[] = [];
function queue(
  send: SendBatch = vi.fn(async (m: Measurement[]) => ({
    status: 200,
    body: { accepted: m.length, duplicates: 0 },
  })),
  now = Date.now,
) {
  const q = new MeasurementQueue(true, send, now, () => 0.5);
  queues.push(q);
  return q;
}
afterEach(async () => {
  await Promise.all(queues.splice(0).map((q) => q.dispose()));
  vi.unstubAllGlobals();
});
describe('measurement serialization and offline queue', () => {
  it('serializes canonical UTC, immutable provenance and missing values without zeros', () => {
    const m = serializeSnapshot(snapshot());
    expect(m).toMatchObject({
      timestamp: '2026-10-03T12:00:00.000Z',
      startedAt: '2026-10-03T12:00:00.000Z',
      source: 'mock',
    });
    expect(m).not.toHaveProperty('respirationRate');
    expect(serializeSnapshot({ ...snapshot(), phase: 'off' })).toBeNull();
    expect(serializeSnapshot({ ...snapshot(), startedAt: null })).toBeNull();
    expect(
      serializeSnapshot({
        ...snapshot(),
        startedAt: '2026-10-03T12:00:05.000Z',
      }),
    ).toBeNull();
  });
  it('starts off and does not retroactively save the reading visible before opt-in', async () => {
    const q = queue();
    q.observe(snapshot());
    expect(q.get().queued).toBe(0);
    await q.setEnabled(true);
    q.observe(snapshot());
    expect(q.get().queued).toBe(0);
    q.observe(snapshot(1));
    q.observe(snapshot(1));
    expect(q.get().queued).toBe(1);
  });
  it('keeps event IDs, payloads and timestamps identical after a lost acknowledgement', async () => {
    let now = 0;
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ status: 200, body: { accepted: 0, duplicates: 1 } });
    const q = queue(send, () => now);
    await q.setEnabled(true);
    q.observe(snapshot());
    await q.flush();
    expect(q.get().state).toBe('retrying');
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1);
    now = 1000;
    await q.flush();
    expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
    expect(q.get()).toMatchObject({
      queued: 0,
      saved: 0,
      state: 'idle',
      lastSavedAt: '1970-01-01T00:00:01.000Z',
    });
  });
  it('caps memory and batches without blocking capture', async () => {
    const send = vi.fn(async (m: Measurement[]) => ({
      status: 200,
      body: { accepted: m.length, duplicates: 0 },
    }));
    const q = queue(send);
    await q.setEnabled(true);
    for (let i = 0; i < 350; i++) q.observe(snapshot(i));
    expect(q.get()).toMatchObject({ queued: 300, dropped: 50 });
    await q.flush();
    expect(send.mock.calls[0]?.[0]).toHaveLength(30);
    expect(q.get()).toMatchObject({ queued: 270, saved: 30 });
  });
  it('caps attempts and reports discarded gaps', async () => {
    let now = 0;
    const q = queue(
      vi.fn(async () => ({ status: 503 })),
      () => now,
    );
    await q.setEnabled(true);
    q.observe(snapshot());
    for (let i = 0; i < 6; i++) {
      await q.flush();
      now += 40_000;
    }
    expect(q.get()).toMatchObject({ queued: 0, dropped: 1, state: 'retrying' });
  });
  it.each([400, 401, 403, 404, 409, 413])(
    'blocks nonretryable status %i until a new explicit action',
    async (status) => {
      const q = queue(vi.fn(async () => ({ status })));
      await q.setEnabled(true);
      q.observe(snapshot());
      await q.flush();
      expect(q.get()).toMatchObject({
        state: 'blocked',
        queued: 0,
        dropped: 1,
      });
      q.observe(snapshot(1));
      expect(q.get().queued).toBe(0);
    },
  );
  it('ignores an in-flight completion after disabling and discards pending readings', async () => {
    let finish!: (value: { status: number; body: unknown }) => void;
    const q = queue(
      vi.fn(
        () =>
          new Promise<BatchResponse>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    await q.setEnabled(true);
    q.observe(snapshot());
    const sending = q.flush();
    const disabling = q.setEnabled(false);
    finish({ status: 200, body: { accepted: 1, duplicates: 0 } });
    await sending;
    await disabling;
    expect(q.get()).toMatchObject({
      state: 'off',
      enabled: false,
      queued: 0,
      saved: 0,
    });
  });
  it('does not send parallel batches and treats malformed acknowledgements as uncertain', async () => {
    const send = vi.fn(async () => ({
      status: 200,
      body: { accepted: 2, duplicates: 0 },
    }));
    const q = queue(send);
    await q.setEnabled(true);
    q.observe(snapshot());
    await Promise.all([q.flush(), q.flush()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.get()).toMatchObject({ state: 'retrying', queued: 1 });
  });
  it('requires HTTPS outside loopback and sends only the validated batch', async () => {
    expect(storageConfigured('http://example.com', 'token')).toBe(false);
    expect(storageConfigured('https://example.com', 'token')).toBe(true);
    expect(storageConfigured('http://127.0.0.1:3001')).toBe(false);
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ accepted: 1, duplicates: 0 }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetcher);
    await createBatchSender(
      'http://127.0.0.1:3001',
      'private-test-token',
    )([serializeSnapshot(snapshot())!]);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      headers: { authorization: 'Bearer private-test-token' },
    });
  });
});

it('stamps manual activity only on new opted-in observations and preserves it on retries', async () => {
  const batches: Measurement[][] = [];
  let now = 1000;
  const queue = new MeasurementQueue(
    true,
    async (batch) => {
      batches.push(batch);
      return { status: 503 };
    },
    () => now,
    () => 0,
  );
  try {
    await queue.setEnabled(true);
    const observation = snapshot();
    queue.observe(observation, 'Coding');
    queue.observe(observation, 'Break');
    await queue.flush();
    expect(batches[0]?.[0]?.activity).toBe('Coding');
    expect(batches[0]?.length).toBe(1);
    now += 1000;
    await queue.flush();
    expect(batches[1]).toEqual(batches[0]);
  } finally {
    await queue.dispose();
  }
});
