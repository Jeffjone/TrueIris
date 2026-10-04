import { expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { VoiceClient } from './voice';
import { runAgent } from '../../../../apps/api/src/agents/agent';
import {
  createReasoningFixture,
  fixtureRequest,
} from '../../../../apps/api/src/agents/fixtures';
import { MockReasoningProvider } from '../../../../apps/api/src/agents/provider';
import type { VoiceEvent } from '@trueiris/schemas';
it('rejects plaintext remote gateways before sending credentials', async () => {
  const connect = vi.fn();
  const client = new VoiceClient(
    'http://remote.example',
    'private-token',
    () => {},
    connect,
  );
  const options = {
    source: fixtureRequest.source,
    timezone: fixtureRequest.timezone,
    current: fixtureRequest.current,
  };
  expect((await client.start(options)).issue).toBe('not_configured');
  expect(connect).not.toHaveBeenCalled();
});
it('rejects wrong-source evidence before playback and does not re-arm a cancelled permission lease', async () => {
  const { store } = createReasoningFixture();
  const result = await runAgent({
    request: fixtureRequest,
    provider: new MockReasoningProvider(),
    store,
    userId: 'fixture',
    signal: new AbortController().signal,
  });
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const events: VoiceEvent[] = [],
    token = 'private-main-token';
  let sendWrong: () => void = () => {};
  server.on('connection', (ws, request) => {
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    expect(request.headers.origin).toBeUndefined();
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'start') return;
      const sessionId = message.request.sessionId;
      ws.send(
        JSON.stringify({
          type: 'state',
          sessionId,
          phase: 'listening',
          provider: 'mock',
        }),
      );
      sendWrong = () => {
        ws.send(
          JSON.stringify({
            type: 'transcript',
            sessionId,
            final: true,
            text: fixtureRequest.question,
          }),
        );
        ws.send(
          JSON.stringify({
            type: 'answer',
            sessionId,
            result: {
              ...result,
              data: {
                ...result.data!,
                query: { ...result.data!.query, source: 'live' },
              },
            },
          }),
        );
      };
    });
  });
  const client = new VoiceClient(
    `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    token,
    (event) => events.push(event),
  );
  const options = {
    source: fixtureRequest.source,
    timezone: fixtureRequest.timezone,
    current: fixtureRequest.current,
  };
  try {
    const started = await client.start(options);
    expect(client.captureAllowed()).toBe(false);
    sendWrong();
    await expect.poll(() => client.get().issue).toBe('unavailable');
    expect(events.some((e) => e.type === 'answer' || e.type === 'audio')).toBe(
      false,
    );
    expect(client.armCapture(started.sessionId!)).toBe(false);
    const next = await client.start(options);
    client.stop();
    expect(client.armCapture(next.sessionId!)).toBe(false);
    expect(client.captureAllowed()).toBe(false);
  } finally {
    client.stop();
    server.close();
  }
});
