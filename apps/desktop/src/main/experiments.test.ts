import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { experimentDefinitionSchema } from '@trueiris/schemas';
import { MemoryExperiments } from '../../../../packages/db/src/experiments';
import { createReasoningFixture } from '../../../../apps/api/src/agents/fixtures';
import { ExperimentClient } from './experiments';
async function fixture() {
  const { store } = createReasoningFixture();
  const experiments = new MemoryExperiments(store);
  const definition = experimentDefinitionSchema.parse({
    title: 'Music',
    hypothesis: 'Do sessions differ?',
    conditions: ['Music', 'No Music'],
    minimumSessions: 7,
    source: 'mock',
    timezone: 'UTC',
    activity: 'Coding',
    criteria: [{ metric: 'session_duration', meaningfulDifference: 5 }],
  });
  const experiment = await experiments.create('fixture', definition);
  const detail = await experiments.get('fixture', experiment.id);
  const outcome = {
    state: 'ready',
    data: { experiments: [experiment], selected: detail },
  };
  return { experiment, outcome };
}
it('rejects mismatched selections, changed definitions and unconfirmed mutations', async () => {
  const { experiment, outcome } = await fixture();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(outcome)));
  const client = new ExperimentClient(
    'http://localhost',
    'private-token',
    fetcher,
  );
  expect((await client.action({ type: 'get', id: experiment.id })).state).toBe(
    'ready',
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error',
    headers: { authorization: 'Bearer private-token' },
  });
  expect(
    (
      await client.action({
        type: 'get',
        id: '00000000-0000-4000-8000-000000000001',
      })
    ).state,
  ).toBe('unavailable');
  expect(
    (
      await client.action({
        type: 'create',
        definition: {
          ...experiment.definition,
          hypothesis: 'Another hypothesis',
        },
      })
    ).state,
  ).toBe('unavailable');
  expect(
    (
      await client.action({
        type: 'status',
        id: experiment.id,
        status: 'completed',
      })
    ).state,
  ).toBe('unavailable');
  expect(
    (
      await client.action({
        type: 'record',
        id: experiment.id,
        input: {
          condition: 'Music',
          range: {
            source: 'mock',
            start: '2026-10-03T10:00:00Z',
            end: '2026-10-03T10:01:00Z',
          },
          rating: null,
          notes: null,
        },
      })
    ).state,
  ).toBe('unavailable');
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({ ...outcome, data: { ...outcome.data, selected: null } }),
    ),
  );
  expect(
    (await client.action({ type: 'remove', id: experiment.id })).state,
  ).toBe('unavailable');
});
it('caps streamed responses and cancels oversized private transports', async () => {
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1));
          },
          cancel,
        }),
      ),
  );
  const result = await new ExperimentClient(
    'http://localhost',
    'token',
    fetcher,
  ).action({ type: 'list' });
  expect(result).toEqual({ state: 'unavailable', data: null });
  expect(cancel).toHaveBeenCalledOnce();
});
it('exports only verified selected evidence atomically with private permissions and preserves prior files on cancellation', async () => {
  const { experiment, outcome } = await fixture();
  const dir = await mkdtemp(join(tmpdir(), 'trueiris-experiment-export-'));
  const path = join(dir, 'experiment.json');
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(outcome)));
  const client = new ExperimentClient('http://localhost', 'token', fetcher);
  try {
    await writeFile(path, 'previous export');
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      client.export(experiment.id, path, aborted.signal),
    ).rejects.toThrow('Export unavailable');
    expect(await readFile(path, 'utf8')).toBe('previous export');
    expect(await readdir(dir)).toEqual(['experiment.json']);
    await client.export(experiment.id, path, new AbortController().signal);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(
      outcome.data.selected,
    );
    expect(await readdir(dir)).toEqual(['experiment.json']);
    if (process.platform !== 'win32')
      expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
