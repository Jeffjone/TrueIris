import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../app';
import {
  MockReasoningProvider,
  type ReasoningProvider,
} from '../agents/provider';
import { createReasoningFixture, fixtureCurrent } from '../agents/fixtures';
import { VoiceClient } from '../../../desktop/src/main/voice';
import { MockVoiceProvider, type VoiceProvider } from './provider';
import type { VoiceEvent } from '@trueiris/schemas';
async function setup(
  voice: VoiceProvider = new MockVoiceProvider(),
  reasoning: ReasoningProvider = new MockReasoningProvider(),
) {
  const fixture = createReasoningFixture(),
    token = randomUUID() + randomUUID(),
    userId = randomUUID();
  const api = buildApp('silent', {
    ...fixture,
    token,
    userId,
    voice,
    reasoning,
  });
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  const events: VoiceEvent[] = [];
  const client = new VoiceClient(url, token, (event) => events.push(event));
  return { ...fixture, api, url, token, userId, events, client };
}
async function ready(client: VoiceClient) {
  const started = await client.start({
    source: 'mock',
    timezone: 'UTC',
    current: fixtureCurrent,
  });
  expect(started.phase).toBe('listening');
  const id = started.sessionId!;
  expect(client.captureAllowed()).toBe(false);
  expect(
    client.audio({
      sessionId: id,
      seq: 0,
      pcm: Buffer.alloc(3200).toString('base64'),
    }),
  ).toBe(false);
  expect(client.armCapture(id)).toBe(true);
  return id;
}
it('streams partial/final transcripts through the existing owner-scoped Gemini tool loop and PCM speech', async () => {
  const { api, client, events, scopes, userId } = await setup();
  try {
    const id = await ready(client);
    for (let seq = 0; seq < 9; seq++)
      client.audio({
        sessionId: id,
        seq,
        pcm: Buffer.alloc(3200).toString('base64'),
      });
    await expect
      .poll(() => events.find((e) => e.type === 'end')?.type)
      .toBe('end');
    expect(
      events.filter((e) => e.type === 'transcript').map((e) => e.final),
    ).toEqual([false, true]);
    const answer = events.find((e) => e.type === 'answer');
    expect(
      answer?.type === 'answer' && answer.result.data?.explanationRange,
    ).toBeTruthy();
    expect(
      answer?.type === 'answer' && answer.result.data!.evidence.length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      scopes.every((s) => s.userId === userId && s.range.source === 'mock'),
    ).toBe(true);
    const audio = events.filter((e) => e.type === 'audio');
    expect(audio.map((e) => e.seq)).toEqual(audio.map((_, i) => i));
    expect(
      audio.reduce((n, e) => n + Buffer.from(e.pcm, 'base64').length, 0),
    ).toBe(96000);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'completed' });
    expect(client.captureAllowed()).toBe(false);
    expect(client.get().phase).toBe('speaking');
    client.stop();
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'cancelled' });
    expect(client.get().phase).toBe('off');
  } finally {
    client.stop();
    await api.close();
  }
});
it('cancels pending reasoning, releases admission and rejects malformed audio without persisting it', async () => {
  const mock = new MockReasoningProvider();
  let stall = true,
    signal: AbortSignal | undefined;
  const reasoning: ReasoningProvider = {
    kind: 'mock',
    configured: true,
    next: async (contents, abort) => {
      signal = abort;
      return stall ? new Promise(() => {}) : mock.next(contents, abort);
    },
  };
  const { api, client, events } = await setup(
    new MockVoiceProvider(),
    reasoning,
  );
  try {
    const id = await ready(client);
    client.finish(id);
    await expect.poll(() => client.get().phase).toBe('analyzing');
    expect(
      (
        await client.start({
          source: 'mock',
          timezone: 'UTC',
          current: fixtureCurrent,
        })
      ).issue,
    ).toBe('busy');
    client.stop();
    await expect.poll(() => signal?.aborted).toBe(true);
    stall = false;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const next = await ready(client);
    expect(
      client.audio({
        sessionId: next,
        seq: 2,
        pcm: Buffer.alloc(3200).toString('base64'),
      }),
    ).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'end',
      reason: 'invalid_audio',
    });
  } finally {
    client.stop();
    await api.close();
  }
});
it('keeps the cited text answer when speech fails and fails missing configuration before capture', async () => {
  const voice = new MockVoiceProvider();
  const failing: VoiceProvider = {
    kind: 'mock',
    configured: true,
    open: voice.open.bind(voice),
    speak: async function* () {
      throw new Error('private vendor response');
      yield new Uint8Array();
    },
  };
  const { api, client, events } = await setup(failing);
  try {
    client.finish(await ready(client));
    await expect.poll(() => events.at(-1)?.type).toBe('end');
    expect(events.some((e) => e.type === 'answer' && e.result.data)).toBe(true);
    expect(events.at(-1)).toMatchObject({ reason: 'unavailable' });
    expect(JSON.stringify(events)).not.toContain('private vendor response');
  } finally {
    client.stop();
    await api.close();
  }
  const missing = await setup({ ...failing, configured: false });
  try {
    expect(
      (
        await missing.client.start({
          source: 'mock',
          timezone: 'UTC',
          current: fixtureCurrent,
        })
      ).issue,
    ).toBe('not_configured');
    expect(missing.client.captureAllowed()).toBe(false);
  } finally {
    missing.client.stop();
    await missing.api.close();
  }
});
it('authenticates WebSocket upgrades and rejects browser origins and query credential paths', async () => {
  const { api, url, token } = await setup();
  const connect = (path: string, headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(url.replace('http', 'ws') + path, { headers });
      ws.on('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode!);
        ws.terminate();
      });
      ws.on('error', () => {});
      ws.on('open', () => {
        ws.close();
        reject(new Error('Unexpected upgrade'));
      });
    });
  try {
    expect(await connect('/voice/stream', {})).toBe(401);
    expect(
      await connect('/voice/stream', {
        authorization: `Bearer ${token}`,
        origin: 'http://renderer.example',
      }),
    ).toBe(400);
    expect(
      await connect('/voice/stream?token=private', {
        authorization: `Bearer ${token}`,
      }),
    ).toBe(400);
  } finally {
    await api.close();
  }
});

it('enforces server admission and deletion cancels provider and microphone leases', async () => {
  const { api, client, url, token } = await setup();
  const other = new VoiceClient(url, token, () => {});
  try {
    await ready(client);
    expect(
      (
        await other.start({
          source: 'mock',
          timezone: 'UTC',
          current: fixtureCurrent,
        })
      ).issue,
    ).toBe('busy');
    const response = await api.inject({
      method: 'DELETE',
      url: '/data',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(204);
    await expect.poll(() => client.get().phase).toBe('off');
    expect(client.captureAllowed()).toBe(false);
    await ready(other);
  } finally {
    client.stop();
    other.stop();
    await api.close();
  }
});
