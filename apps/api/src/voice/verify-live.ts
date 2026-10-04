import { randomUUID } from 'node:crypto';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { buildApp } from '../app';
import { ElevenLabsVoiceProvider } from './provider';
import { GeminiReasoningProvider } from '../agents/provider';
import { createReasoningFixture, fixtureCurrent } from '../agents/fixtures';
import { VoiceClient } from '../../../desktop/src/main/voice';

loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID || !env.GEMINI_API_KEY)
  throw new Error(
    'Configure ElevenLabs key/voice ID and Gemini key in the ignored root .env',
  );
const provider = new ElevenLabsVoiceProvider(
  env.ELEVENLABS_API_KEY,
  env.ELEVENLABS_VOICE_ID,
  env.ELEVENLABS_TTS_MODEL,
);
const { store } = createReasoningFixture();
const token = randomUUID() + randomUUID();
const api = buildApp('silent', {
  store,
  token,
  userId: randomUUID(),
  voice: provider,
  reasoning: new GeminiReasoningProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL),
});
const url = await api.listen({ host: '127.0.0.1', port: 0 });
let partial = false,
  final = false,
  answer = false,
  receivedBytes = 0,
  tools = 0;
let stage = 'synthetic_question_speech';
let resolveEnd: (reason: string) => void = () => {};
const ending = new Promise<string>((resolve) => {
  resolveEnd = resolve;
});
const client = new VoiceClient(url, token, (event) => {
  if (event.type === 'transcript') {
    if (event.final) final = true;
    else partial = true;
  }
  if (event.type === 'answer') {
    tools = event.result.data?.evidence.length ?? 0;
    answer = Boolean(
      event.result.data?.provider === 'gemini' &&
      event.result.data.explanationRange &&
      !event.result.data.answer.startsWith('Iris could not finish'),
    );
  }
  if (event.type === 'audio')
    receivedBytes += Buffer.from(event.pcm, 'base64').length;
  if (event.type === 'end') resolveEnd(event.reason);
});
const timeout = setTimeout(() => client.stop('timeout'), 120_000);
try {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of provider.speak(
    'Iris, explain the last thirty minutes.',
    AbortSignal.timeout(20_000),
  )) {
    size += chunk.length;
    if (size > 480_000) throw new Error('Question audio too long');
    chunks.push(chunk);
  }
  const speech = Buffer.concat(chunks);
  // Synthetic input only. Resample mono 24 kHz S16LE to 16 kHz for the documented STT format.
  const input = Buffer.alloc(Math.floor(speech.length / 3) * 2);
  for (let i = 0; i < input.length / 2; i++) {
    const position = i * 1.5,
      left = Math.floor(position),
      right = Math.min(left + 1, speech.length / 2 - 1);
    input.writeInt16LE(
      Math.round(
        speech.readInt16LE(left * 2) * (1 - (position - left)) +
          speech.readInt16LE(right * 2) * (position - left),
      ),
      i * 2,
    );
  }
  stage = 'voice_round_trip';
  const started = await client.start({
    source: 'mock',
    timezone: 'UTC',
    current: fixtureCurrent,
  });
  if (started.phase !== 'listening' || !started.sessionId)
    throw new Error('Voice could not start');
  client.armCapture(started.sessionId);
  let seq = 0;
  for (let offset = 0; offset < input.length + 64_000; offset += 3200) {
    if (!client.captureAllowed()) break;
    const packet = Buffer.alloc(3200);
    if (offset < input.length)
      input.copy(packet, 0, offset, Math.min(offset + 3200, input.length));
    client.audio({
      sessionId: started.sessionId,
      seq: seq++,
      pcm: packet.toString('base64'),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (client.captureAllowed()) client.finish(started.sessionId);
  const reason = await ending;
  const passed =
    partial &&
    final &&
    answer &&
    tools >= 8 &&
    receivedBytes > 0 &&
    reason === 'completed';
  console.log(
    JSON.stringify({
      check: 'live_voice_synthetic_round_trip',
      passed,
      partial,
      final,
      groundedAnswer: answer,
      toolEvidenceCount: tools,
      speechBytes: receivedBytes,
      reason,
    }),
  );
  if (!passed) process.exitCode = 1;
} catch {
  console.log(
    JSON.stringify({
      check: 'live_voice_synthetic_round_trip',
      passed: false,
      stage,
    }),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  client.stop();
  await api.close();
}
