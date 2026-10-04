export function pcmBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}
export async function captureMicrophone(
  signal: AbortSignal,
  onAudio: (pcm: string) => void,
) {
  signal.throwIfAborted();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  let context: AudioContext | null = null,
    node: AudioWorkletNode | null = null;
  const stop = () => {
    stream.getTracks().forEach((track) => track.stop());
    node?.disconnect();
    if (context) void context.close().catch(() => {});
    signal.removeEventListener('abort', stop);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    context = new AudioContext({ sampleRate: 16000 });
    if (context.sampleRate !== 16000)
      throw new Error('Unsupported microphone format');
    await context.audioWorklet.addModule(
      new URL('./voice-capture.js', document.baseURI).href,
    );
    signal.throwIfAborted();
    node = new AudioWorkletNode(context, 'iris-microphone', {
      channelCount: 1,
      numberOfInputs: 1,
      numberOfOutputs: 1,
    });
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!signal.aborted && event.data.byteLength === 3200)
        onAudio(pcmBase64(new Uint8Array(event.data)));
    };
    context.createMediaStreamSource(stream).connect(node);
    node.connect(context.destination); // Processor outputs silence; microphone audio is never played locally.
    await context.resume();
    signal.throwIfAborted();
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}

/** Schedule consecutive raw PCM chunks before the stream ends; all audio is transient. */
export class SpeechPlayback {
  private readonly context = new AudioContext({ sampleRate: 24000 });
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private drained: (() => void) | null = null;
  private stopped = false;
  constructor() {
    void this.context.resume().catch(() => {});
  }
  push(pcm: string) {
    if (this.stopped) return;
    if (this.context.state !== 'running')
      throw new Error('Speech playback unavailable');
    const bytes = Uint8Array.from(atob(pcm), (c) => c.charCodeAt(0));
    if (!bytes.length || bytes.length % 2)
      throw new Error('Invalid speech samples');
    const buffer = this.context.createBuffer(1, bytes.length / 2, 24000);
    const samples = buffer.getChannelData(0),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++)
      samples[i] = view.getInt16(i * 2, true) / 32768;
    const start = Math.max(this.context.currentTime + 0.04, this.next);
    if (start + buffer.duration - this.context.currentTime > 300)
      throw new Error('Speech buffer limit reached');
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (!this.sources.size) this.drained?.();
    };
    source.start(start);
    this.next = start + buffer.duration;
  }
  async finish() {
    if (this.sources.size && !this.stopped)
      await new Promise<void>((resolve) => {
        this.drained = resolve;
      });
    this.close();
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
    }
    this.sources.clear();
    this.drained?.();
    this.drained = null;
    void this.context.close().catch(() => {});
  }
}
