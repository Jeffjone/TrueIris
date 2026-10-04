import WebSocket from 'ws';
import { z } from 'zod';

export type Transcript =
  { type: 'partial' | 'final'; text: string } | { type: 'error' };
export interface TranscriptionStream {
  send(pcm: Uint8Array): void;
  finish(): void;
  close(): void;
}
export interface VoiceProvider {
  readonly kind: 'elevenlabs' | 'mock';
  readonly configured: boolean;
  open(
    listener: (event: Transcript) => void,
    signal: AbortSignal,
  ): Promise<TranscriptionStream>;
  speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
const vendorEvent = z
  .object({
    message_type: z.string().max(100),
    text: z.string().max(1500).optional(),
  })
  .passthrough();
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly kind = 'elevenlabs' as const;
  readonly configured: boolean;
  constructor(
    private readonly key: string | undefined,
    private readonly voiceId: string | undefined,
    private readonly model = 'eleven_flash_v2_5',
    private readonly request = fetch,
    private readonly connect = (url: string, headers: Record<string, string>) =>
      new WebSocket(url, {
        headers,
        maxPayload: 64 * 1024,
        handshakeTimeout: 10_000,
        followRedirects: false,
        perMessageDeflate: false,
      }),
  ) {
    this.configured = Boolean(key && voiceId);
    if (
      (voiceId && !/^[a-zA-Z0-9_-]{1,100}$/.test(voiceId)) ||
      !/^eleven_[a-z0-9_]{1,70}$/.test(model)
    )
      throw new Error('Invalid voice configuration');
  }
  async open(
    listener: (event: Transcript) => void,
    signal: AbortSignal,
  ): Promise<TranscriptionStream> {
    if (!this.configured) throw new Error('Voice is not configured');
    signal.throwIfAborted();
    const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    url.search = new URLSearchParams({
      model_id: 'scribe_v2_realtime',
      audio_format: 'pcm_16000',
      commit_strategy: 'vad',
      vad_silence_threshold_secs: '1.2',
      include_timestamps: 'false',
    }).toString();
    const ws = this.connect(url.toString(), { 'xi-api-key': this.key! });
    let closed = false,
      ready = false;
    let rejectReady: (reason: Error) => void = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      ws.terminate();
    };
    const fail = () => {
      if (closed) return;
      rejectReady(new Error('Transcription unavailable'));
      if (ready) listener({ type: 'error' });
      close();
    };
    const aborted = () => {
      rejectReady(new Error('Voice cancelled'));
      close();
    };
    const timer = setTimeout(fail, 10_000);
    const startup = new Promise<void>((resolve, reject) => {
      rejectReady = reject;
      ws.on('message', (raw, binary) => {
        if (closed || signal.aborted) return;
        try {
          const payload = Buffer.isBuffer(raw)
            ? raw
            : raw instanceof ArrayBuffer
              ? Buffer.from(raw)
              : Buffer.concat(raw);
          if (binary || payload.length > 64 * 1024)
            throw new Error('Invalid transcript');
          const event = vendorEvent.parse(JSON.parse(payload.toString()));
          if (event.message_type === 'session_started') {
            ready = true;
            clearTimeout(timer);
            resolve();
          } else if (
            event.message_type === 'partial_transcript' ||
            event.message_type === 'committed_transcript'
          ) {
            const text = event.text?.trim();
            if (text)
              listener({
                type:
                  event.message_type === 'partial_transcript'
                    ? 'partial'
                    : 'final',
                text,
              });
          } else if (
            !['warning', 'committed_transcript_with_timestamps'].includes(
              event.message_type,
            )
          )
            fail();
        } catch {
          fail();
        }
      });
      ws.on('error', fail);
      ws.on('close', fail);
    });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    await startup;
    const input = (pcm: Uint8Array, commit = false) => {
      if (
        closed ||
        signal.aborted ||
        ws.readyState !== WebSocket.OPEN ||
        ws.bufferedAmount > 64 * 1024
      ) {
        fail();
        return;
      }
      ws.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: Buffer.from(pcm).toString('base64'),
          sample_rate: 16000,
          commit,
        }),
      );
    };
    return {
      send: (pcm) => input(pcm),
      finish: () => input(new Uint8Array(3200), true),
      close,
    };
  }
  async *speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array> {
    if (!this.configured || !text || text.length > 16000)
      throw new Error('Speech unavailable');
    const url = new URL(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId!}/stream`,
    );
    url.searchParams.set('output_format', 'pcm_24000');
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'xi-api-key': this.key!, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: this.model }),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Speech unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Speech unavailable');
    let bytes = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 14_400_000) throw new Error('Speech limit reached');
        yield chunk.value;
      }
      if (!bytes || bytes % 2) throw new Error('Invalid PCM stream');
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
/** Explicit test provider: simulated transcription and a generated tone, never a fallback. */
export class MockVoiceProvider implements VoiceProvider {
  readonly kind = 'mock' as const;
  readonly configured = true;
  constructor(
    private readonly transcript = 'Iris, explain the last thirty minutes.',
  ) {}
  async open(
    listener: (event: Transcript) => void,
    signal: AbortSignal,
  ): Promise<TranscriptionStream> {
    let packets = 0,
      closed = false;
    const finish = () => {
      if (!closed && !signal.aborted) {
        closed = true;
        listener({ type: 'final', text: this.transcript });
      }
    };
    return {
      send: () => {
        if (closed || signal.aborted) return;
        packets++;
        if (packets === 2)
          listener({ type: 'partial', text: 'Iris, explain the last…' });
        if (packets === 8) finish();
      },
      finish,
      close: () => {
        closed = true;
      },
    };
  }
  async *speak(_text: string, signal: AbortSignal) {
    for (let frame = 0; frame < 20; frame++) {
      signal.throwIfAborted();
      const bytes = new Uint8Array(4800),
        view = new DataView(bytes.buffer);
      for (let i = 0; i < 2400; i++)
        view.setInt16(
          i * 2,
          Math.round(
            2000 * Math.sin((2 * Math.PI * 220 * (frame * 2400 + i)) / 24000),
          ),
          true,
        );
      yield bytes;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
