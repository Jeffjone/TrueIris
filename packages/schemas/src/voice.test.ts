import { expect, it } from 'vitest';
import { voiceAudioSchema, voiceMessageSchema, voiceQuestion } from './voice';
const sessionId = '00000000-0000-4000-8000-000000000001';
it('validates bounded sequenced audio envelopes and keeps identities out of renderer options', () => {
  const frame = {
    sessionId,
    seq: 0,
    pcm: Buffer.alloc(3200).toString('base64'),
  };
  expect(voiceAudioSchema.parse(frame)).toEqual(frame);
  for (const bad of [
    { ...frame, seq: -1 },
    { ...frame, pcm: '*private*' },
    { ...frame, pcm: 'A'.repeat(8196) },
    { ...frame, userId: sessionId },
  ])
    expect(voiceAudioSchema.safeParse(bad).success).toBe(false);
  expect(
    voiceMessageSchema.safeParse({
      type: 'finish',
      sessionId,
      token: 'private',
    }).success,
  ).toBe(false);
});
it('normalizes the spoken recent-explanation command without changing unrelated questions', () => {
  expect(voiceQuestion('Iris, explain the last thirty minutes.')).toBe(
    'Iris, explain the last 30 minutes.',
  );
  expect(voiceQuestion('  What happened yesterday?  ')).toBe(
    'What happened yesterday?',
  );
  expect(
    voiceQuestion('Explain the last thirty minutes and diagnose my stress.'),
  ).toBe('Explain the last thirty minutes and diagnose my stress.');
});
