import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportMeasurements } from './files';
import { serializeSnapshot } from './queue';
const paths: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    paths.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function destination() {
  const dir = await mkdtemp(join(tmpdir(), 'trueiris-export-unit-'));
  paths.push(dir);
  return { dir, path: join(dir, 'history.jsonl') };
}
const m = serializeSnapshot({
  provider: 'mock',
  phase: 'running',
  issue: 'none',
  sessionId: '00000000-0000-4000-8000-000000000001',
  startedAt: '2026-10-03T12:00:00.000Z',
  reading: {
    sessionId: '00000000-0000-4000-8000-000000000001',
    timestamp: '2026-10-03T12:00:00.000Z',
    source: 'mock',
    signalQuality: 'good',
    pulseRate: 70,
    pulseConfidence: 0.9,
  },
})!;
const response = (page: unknown, status = 200) =>
  new Response(JSON.stringify(page), { status });
describe('private streamed export', () => {
  it('streams validated pages and atomically replaces the selected file with private permissions', async () => {
    const { path } = await destination();
    await writeFile(path, 'previous successful export');
    const next = `${m.timestamp}|${m.eventId}`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ measurements: [m], next }))
      .mockResolvedValueOnce(response({ measurements: [], next: null }));
    vi.stubGlobal('fetch', fetcher);
    await exportMeasurements('http://127.0.0.1', 'token', path);
    expect((await readFile(path, 'utf8')).trim()).toBe(JSON.stringify(m));
    expect(
      new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('cursor'),
    ).toBe(next);
    if (process.platform !== 'win32')
      expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it('preserves an existing export and removes temporary data on failure', async () => {
    const { path, dir } = await destination();
    await writeFile(path, 'previous export');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({}, 401)),
    );
    await expect(
      exportMeasurements('http://127.0.0.1', 'token', path),
    ).rejects.toThrow('Export failed');
    expect(await readFile(path, 'utf8')).toBe('previous export');
    expect(await readdir(dir)).toEqual(['history.jsonl']);
  });
  it('respects rate-limit retry with bounded attempts', async () => {
    const { path } = await destination();
    const pause = vi.fn(async () => {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 429))
      .mockResolvedValueOnce(response({ measurements: [], next: null }));
    vi.stubGlobal('fetch', fetcher);
    await exportMeasurements('http://127.0.0.1', 'token', path, {
      wait: pause,
    });
    expect(pause).toHaveBeenCalledWith(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('cleans temporary data on cancellation', async () => {
    const { path, dir } = await destination();
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportMeasurements('http://127.0.0.1', 'token', path, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('Export failed');
    expect(await readdir(dir)).toEqual([]);
  });
});
