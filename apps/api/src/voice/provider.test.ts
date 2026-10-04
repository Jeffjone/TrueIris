import { expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { ElevenLabsVoiceProvider, type Transcript } from './provider';
it('uses backend-only vendor authentication and projects partial/final transcripts without vendor metadata', async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const packets: unknown[] = [],
    events: Transcript[] = [];
  let remote: WebSocket | undefined;
  server.on('connection', (socket) => {
    remote = socket;
    socket.on('message', (raw) => packets.push(JSON.parse(raw.toString())));
    socket.send(
      JSON.stringify({
        message_type: 'session_started',
        session_id: 'private-vendor-metadata',
      }),
    );
  });
  const connect = vi.fn(
    (_url: string, headers: Record<string, string>) =>
      new WebSocket(`ws://127.0.0.1:${port}`, { headers }),
  );
  const provider = new ElevenLabsVoiceProvider(
    'secret-test-key',
    'voice-test',
    'eleven_flash_v2_5',
    fetch,
    connect,
  );
  const abort = new AbortController();
  try {
    const stream = await provider.open(
      (event) => events.push(event),
      abort.signal,
    );
    expect(connect.mock.calls[0]?.[0]).toContain(
      'wss://api.elevenlabs.io/v1/speech-to-text/realtime?',
    );
    expect(connect.mock.calls[0]?.[1]).toEqual({
      'xi-api-key': 'secret-test-key',
    });
    remote!.send(
      JSON.stringify({
        message_type: 'partial_transcript',
        text: 'Iris',
        private: 'never forwarded',
      }),
    );
    remote!.send(
      JSON.stringify({
        message_type: 'committed_transcript',
        text: 'Iris, hello.',
      }),
    );
    await expect.poll(() => events.length).toBe(2);
    expect(events).toEqual([
      { type: 'partial', text: 'Iris' },
      { type: 'final', text: 'Iris, hello.' },
    ]);
    stream.send(new Uint8Array(3200));
    stream.finish();
    await expect.poll(() => packets.length).toBe(2);
    expect(packets[1]).toMatchObject({
      message_type: 'input_audio_chunk',
      sample_rate: 16000,
      commit: true,
    });
    remote!.send(
      JSON.stringify({
        message_type: 'auth_error',
        details: 'private API diagnostic',
      }),
    );
    await expect.poll(() => events.at(-1)?.type).toBe('error');
    expect(JSON.stringify(events)).not.toContain('private');
  } finally {
    abort.abort();
    server.close();
  }
});
it('yields speech before the HTTP stream completes, bounds output and cancels readers on abort', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
        cancel: cancelled,
      }),
    ),
  );
  const provider = new ElevenLabsVoiceProvider(
    'test-secret',
    'voice-test',
    'eleven_flash_v2_5',
    fetcher,
  );
  const abort = new AbortController(),
    speech = provider
      .speak('Cited answer.', abort.signal)
      [Symbol.asyncIterator]();
  controller.enqueue(new Uint8Array([0, 1, 2]));
  expect((await speech.next()).value).toEqual(new Uint8Array([0, 1, 2]));
  expect(fetcher.mock.calls[0]?.[0].toString()).toBe(
    'https://api.elevenlabs.io/v1/text-to-speech/voice-test/stream?output_format=pcm_24000',
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    headers: { 'xi-api-key': 'test-secret' },
    redirect: 'error',
    body: JSON.stringify({
      text: 'Cited answer.',
      model_id: 'eleven_flash_v2_5',
    }),
  });
  abort.abort();
  await expect(speech.next()).rejects.toThrow();
  expect(cancelled).toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response(new Uint8Array([1])));
  const odd = provider
    .speak('Answer.', new AbortController().signal)
    [Symbol.asyncIterator]();
  await odd.next();
  await expect(odd.next()).rejects.toThrow('Invalid PCM stream');
  fetcher.mockResolvedValue(
    new Response('private diagnostic', { status: 401 }),
  );
  await expect(
    provider
      .speak('Answer.', new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toThrow('Speech unavailable');
  expect(() => new ElevenLabsVoiceProvider('key', '../private')).toThrow(
    'Invalid voice configuration',
  );
});
