import { transportMode } from './transport';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  voiceEventSchema,
  voiceAudioSchema,
  voiceStartSchema,
  voiceQuestion,
  type VoiceStart,
  type VoiceSnapshot,
  type VoiceEvent,
  type VoiceAudio,
  type VoiceIssue,
} from '@trueiris/schemas';
import { storageConfigured } from './storage/queue';

/** Authenticated gateway and microphone lease are main-owned; no vendor key/token enters the renderer. */
export class VoiceClient {
  private snapshot: VoiceSnapshot = {
    phase: 'off',
    sessionId: null,
    provider: 'elevenlabs',
    issue: null,
  };
  private active: {
    id: string;
    ws: WebSocket;
    done: (snapshot: VoiceSnapshot) => void;
    timer: ReturnType<typeof setTimeout>;
    options: Omit<VoiceStart, 'sessionId'>;
    question: string | null;
    audioSeq: number;
    inputSeq: number;
    answered: boolean;
  } | null = null;
  private armed = false;
  private playbackId: string | null = null;
  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly emit: (event: VoiceEvent) => void,
    private readonly connect = (url: string, headers: Record<string, string>) =>
      new WebSocket(url, {
        headers,
        maxPayload: 256 * 1024,
        handshakeTimeout: 10_000,
        followRedirects: false,
        perMessageDeflate: false,
      }),
  ) {}
  get() {
    return this.snapshot;
  }
  captureAllowed() {
    return (
      this.armed && this.snapshot.phase === 'listening' && this.active !== null
    );
  }
  armCapture(id: string) {
    if (this.active?.id !== id || this.snapshot.phase !== 'listening')
      return false;
    this.armed = true;
    this.emit({
      type: 'state',
      sessionId: id,
      phase: 'listening',
      provider: this.snapshot.provider,
    });
    return true;
  }
  stop(reason: 'cancelled' | VoiceIssue = 'cancelled') {
    const active = this.active,
      id = active?.id ?? this.playbackId;
    this.playbackId = null;
    this.armed = false;
    this.active = null;
    this.snapshot = {
      ...this.snapshot,
      sessionId: null,
      phase: reason === 'cancelled' ? 'off' : 'error',
      issue: reason === 'cancelled' ? null : reason,
    };
    if (active) {
      clearTimeout(active.timer);
      active.done(this.snapshot);
      active.ws.terminate();
    }
    if (id) this.emit({ type: 'end', sessionId: id, reason });
  }
  async start(options: Omit<VoiceStart, 'sessionId'>): Promise<VoiceSnapshot> {
    if (this.active) return { ...this.snapshot, issue: 'busy' };
    if (this.playbackId) this.stop();
    if (!storageConfigured(this.url, this.token)) {
      this.stop('not_configured');
      return this.snapshot;
    }
    const id = randomUUID();
    const request = voiceStartSchema.parse({ ...options, sessionId: id });
    const url = new URL('/voice/stream', this.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.snapshot = {
      phase: 'connecting',
      sessionId: id,
      provider: 'elevenlabs',
      issue: null,
    };
    this.emit({
      type: 'state',
      sessionId: id,
      phase: 'connecting',
      provider: 'elevenlabs',
    });
    let ws: WebSocket;
    try {
      ws = this.connect(url.toString(), {
        authorization: `Bearer ${this.token!}`,
        'x-trueiris-mode': transportMode(),
      });
    } catch {
      this.stop('unavailable');
      return this.snapshot;
    }
    const startup = new Promise<VoiceSnapshot>((done) => {
      const active = {
        id,
        ws,
        done,
        timer: setTimeout(() => this.stop('timeout'), 20_000),
        options,
        question: null as string | null,
        audioSeq: 0,
        inputSeq: 0,
        answered: false,
      };
      this.active = active;
      ws.on('open', () => {
        if (this.active === active)
          ws.send(JSON.stringify({ type: 'start', request }));
      });
      ws.on('message', (raw, binary) => {
        if (this.active !== active) return;
        try {
          if (binary) throw new Error('Invalid voice event');
          const event = voiceEventSchema.parse(JSON.parse(raw.toString()));
          if (event.sessionId !== id) throw new Error('Wrong voice session');
          if (event.type === 'state') {
            this.snapshot = {
              phase: event.phase,
              sessionId: id,
              provider: event.provider,
              issue: null,
            };
            if (event.phase !== 'listening') this.armed = false;
            if (event.phase === 'listening') {
              clearTimeout(active.timer);
              active.timer = setTimeout(() => this.stop('timeout'), 240_000);
              done(this.snapshot);
              return;
            }
            if (event.phase === 'speaking' && !active.answered)
              throw new Error('Speech has no evidence');
          } else if (event.type === 'transcript' && event.final) {
            this.armed = false;
            active.question = voiceQuestion(event.text);
          } else if (event.type === 'answer') {
            if (
              !active.question ||
              (event.result.data &&
                (event.result.data.query.question !== active.question ||
                  event.result.data.query.source !== options.source ||
                  event.result.data.query.timezone !== options.timezone))
            )
              throw new Error('Wrong voice evidence');
            active.answered = Boolean(event.result.data);
          } else if (event.type === 'audio') {
            if (
              !active.answered ||
              this.snapshot.phase !== 'speaking' ||
              event.seq !== active.audioSeq++
            )
              throw new Error('Invalid speech sequence');
            const bytes = Buffer.from(event.pcm, 'base64');
            if (bytes.length % 2) throw new Error('Invalid speech samples');
          } else if (event.type === 'end') {
            this.armed = false;
            this.active = null;
            // Network completion can precede several minutes of queued playback.
            // Keep a cancellable lease until the renderer drains or stops the audio.
            this.playbackId = event.reason === 'completed' ? id : null;
            clearTimeout(active.timer);
            this.snapshot = {
              ...this.snapshot,
              sessionId: null,
              phase:
                event.reason === 'completed'
                  ? 'speaking'
                  : event.reason === 'cancelled'
                    ? 'off'
                    : 'error',
              issue: ['completed', 'cancelled'].includes(event.reason)
                ? null
                : (event.reason as VoiceIssue),
            };
            done(this.snapshot);
            ws.close();
          }
          this.emit(event);
        } catch {
          this.stop('unavailable');
        }
      });
      ws.on('unexpected-response', (_request, response) => {
        response.resume();
        if (this.active === active)
          this.stop(
            response.statusCode === 401 || response.statusCode === 403
              ? 'unauthorized'
              : 'unavailable',
          );
      });
      ws.on('error', () => {
        if (this.active === active) this.stop('unavailable');
      });
      ws.on('close', (code) => {
        if (this.active === active)
          this.stop(
            code === 1013
              ? 'busy'
              : code === 1008
                ? 'not_configured'
                : 'unavailable',
          );
      });
    });
    return startup;
  }
  audio(input: VoiceAudio) {
    const chunk = voiceAudioSchema.parse(input),
      active = this.active;
    if (!this.captureAllowed() || !active || chunk.sessionId !== active.id)
      return false;
    if (
      chunk.seq !== active.inputSeq++ ||
      Buffer.from(chunk.pcm, 'base64').length % 2 ||
      active.ws.bufferedAmount > 64 * 1024
    ) {
      this.stop('invalid_audio');
      return false;
    }
    active.ws.send(JSON.stringify({ type: 'audio', ...chunk }));
    return true;
  }
  finish(id: string) {
    if (!this.active || this.active.id !== id || !this.captureAllowed()) return;
    this.armed = false;
    this.snapshot = { ...this.snapshot, phase: 'transcribing' };
    this.active.ws.send(JSON.stringify({ type: 'finish', sessionId: id }));
  }
}
