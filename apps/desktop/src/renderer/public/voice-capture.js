class IrisMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(1600);
    this.offset = 0;
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channel = inputs[0]?.[0];
    if (!channel || sampleRate !== 16000) return true;
    for (const sample of channel) {
      this.samples[this.offset++] = Math.round(
        Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767),
      );
      if (this.offset === this.samples.length) {
        // Explicit little endian, independent of the host architecture.
        const bytes = new ArrayBuffer(3200),
          view = new DataView(bytes);
        for (let i = 0; i < 1600; i++)
          view.setInt16(i * 2, this.samples[i], true);
        this.port.postMessage(bytes, [bytes]);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('iris-microphone', IrisMicrophone);
