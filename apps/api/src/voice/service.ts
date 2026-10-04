import WebSocket from 'ws';
import {
  voiceMessageSchema,
  voiceEventSchema,
  voiceQuestion,
  type VoiceEvent,
  type VoiceStart,
} from '@trueiris/schemas';
import type { AgentService } from '../agents/agent';
import type {
  VoiceProvider,
  TranscriptionStream,
  Transcript,
} from './provider';

export class VoiceService {
  private active: { cancel: () => void } | null = null;
  constructor(
    readonly provider: VoiceProvider,
    private readonly agent: AgentService | null,
  ) {}
  cancel() {
    this.active?.cancel();
  }
  attach(socket: WebSocket) {
    if (this.active) {
      socket.close(1013, 'busy');
      return;
    }
    const abort = new AbortController();
    let request: VoiceStart | null = null,
      stream: TranscriptionStream | null = null;
    let phase = 'connecting',
      closed = false,
      audioSeq = 0,
      outputSeq = 0;
    let bytes = 0,
      secondBytes = 0,
      second = Date.now();
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = setTimeout(() => end('timeout'), 5000);
    const deadline = setTimeout(() => end('timeout'), 240_000);
    const record = { cancel: () => end('cancelled') };
    this.active = record;
    const send = (event: VoiceEvent) => {
      if (closed || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 512 * 1024)
        throw new Error('Slow voice client');
      socket.send(JSON.stringify(voiceEventSchema.parse(event)));
    };
    const dispose = () => {
      if (closed) return;
      closed = true;
      abort.abort();
      stream?.close();
      clearTimeout(startTimer);
      clearTimeout(deadline);
      clearTimeout(captureTimer);
      if (this.active === record) this.active = null;
      socket.close();
    };
    const end = (reason: Extract<VoiceEvent, { type: 'end' }>['reason']) => {
      if (closed) return;
      try {
        if (request)
          send({ type: 'end', sessionId: request.sessionId, reason });
      } catch {
        /* close a stalled client */
      }
      dispose();
    };
    const state = (
      next:
        'connecting' | 'listening' | 'transcribing' | 'analyzing' | 'speaking',
    ) => {
      phase = next;
      send({
        type: 'state',
        sessionId: request!.sessionId,
        phase: next,
        provider: this.provider.kind,
      });
    };
    const answer = async (text: string) => {
      if (closed || !request || !['listening', 'transcribing'].includes(phase))
        return;
      clearTimeout(captureTimer);
      stream?.close();
      stream = null;
      send({
        type: 'transcript',
        sessionId: request.sessionId,
        final: true,
        text,
      });
      state('analyzing');
      try {
        const { sessionId, ...options } = request;
        const result = this.agent
          ? await this.agent.ask(
              { ...options, question: voiceQuestion(text) },
              abort.signal,
            )
          : { state: 'not_configured' as const, data: null };
        if (closed) return;
        send({ type: 'answer', sessionId, result });
        if (!result.data) {
          end(
            result.state === 'busy'
              ? 'busy'
              : result.state === 'cancelled'
                ? 'cancelled'
                : result.state === 'not_configured'
                  ? 'not_configured'
                  : 'unavailable',
          );
          return;
        }
        state('speaking');
        let carry = Buffer.alloc(0);
        for await (const bytes of this.provider.speak(
          result.data.answer,
          abort.signal,
        )) {
          if (closed) return;
          const available = Buffer.concat([carry, bytes]);
          const even = available.length - (available.length % 2);
          carry = available.subarray(even);
          for (let offset = 0; offset < even; offset += 6144) {
            const event = voiceEventSchema.parse({
              type: 'audio',
              sessionId,
              seq: outputSeq++,
              pcm: available
                .subarray(offset, Math.min(offset + 6144, even))
                .toString('base64'),
            });
            if (socket.bufferedAmount > 512 * 1024)
              throw new Error('Slow voice client');
            await new Promise<void>((resolve, reject) =>
              socket.send(JSON.stringify(event), (error) =>
                error ? reject(new Error('Audio unavailable')) : resolve(),
              ),
            );
            if (closed) return;
          }
        }
        if (carry.length || !outputSeq)
          throw new Error('Invalid speech stream');
        end('completed');
      } catch {
        if (!closed) end('unavailable');
      }
    };
    const transcript = (event: Transcript) => {
      if (closed || !request) return;
      if (event.type === 'error') {
        end('unavailable');
        return;
      }
      if (!['listening', 'transcribing'].includes(phase)) return;
      if (event.type === 'final') {
        void answer(event.text).catch(() => end('unavailable'));
        return;
      }
      try {
        send({
          type: 'transcript',
          sessionId: request.sessionId,
          final: false,
          text: event.text,
        });
      } catch {
        end('unavailable');
      }
    };
    // Register handlers synchronously before any provider work, so no input is lost during startup.
    socket.on('message', (raw, binary) => {
      if (closed) return;
      try {
        if (binary) throw new Error('Invalid audio envelope');
        const message = voiceMessageSchema.parse(JSON.parse(raw.toString()));
        if (message.type === 'start') {
          if (request) throw new Error('Session already started');
          request = message.request;
          clearTimeout(startTimer);
          if (!this.provider.configured || !this.agent?.provider.configured) {
            end('not_configured');
            return;
          }
          state('connecting');
          void this.provider
            .open(transcript, abort.signal)
            .then((opened) => {
              if (closed) {
                opened.close();
                return;
              }
              stream = opened;
              state('listening');
              captureTimer = setTimeout(() => end('timeout'), 60_000);
            })
            .catch(() => end('unavailable'));
          return;
        }
        // The last microphone frames can already be in flight when VAD commits.
        if (
          request &&
          message.sessionId === request.sessionId &&
          ['transcribing', 'analyzing', 'speaking'].includes(phase)
        )
          return;
        if (
          !request ||
          message.sessionId !== request.sessionId ||
          phase !== 'listening' ||
          !stream
        )
          throw new Error('Inactive voice session');
        if (message.type === 'finish') {
          state('transcribing');
          clearTimeout(captureTimer);
          captureTimer = setTimeout(() => end('timeout'), 10_000);
          stream.finish();
          return;
        }
        const pcm = Buffer.from(message.pcm, 'base64');
        if (message.seq !== audioSeq++ || pcm.length % 2 || pcm.length > 6144)
          throw new Error('Invalid audio sequence');
        if (Date.now() - second >= 1000) {
          second = Date.now();
          secondBytes = 0;
        }
        secondBytes += pcm.length;
        bytes += pcm.length;
        if (secondBytes > 64_000 || bytes > 1_920_000)
          throw new Error('Audio limit reached');
        stream.send(pcm);
      } catch {
        end('invalid_audio');
      }
    });
    socket.on('close', dispose);
    socket.on('error', dispose);
  }
}
