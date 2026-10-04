import { z } from 'zod';
import {
  askQuerySchema,
  currentStateSchema,
  agentResultSchema,
} from './reasoning';

export const voiceProviderSchema = z.enum(['elevenlabs', 'mock']);
export const voiceOptionsSchema = askQuerySchema.omit({ question: true });
export type VoiceOptions = z.infer<typeof voiceOptionsSchema>;
export const voiceStartSchema = voiceOptionsSchema
  .extend({ sessionId: z.uuid(), current: currentStateSchema })
  .strict();
export type VoiceStart = z.infer<typeof voiceStartSchema>;
export const voiceIssueSchema = z.enum([
  'not_configured',
  'unavailable',
  'unauthorized',
  'busy',
  'timeout',
  'permission_denied',
  'no_microphone',
  'invalid_audio',
  'playback_failed',
]);
export type VoiceIssue = z.infer<typeof voiceIssueSchema>;
export const voiceSnapshotSchema = z
  .object({
    sessionId: z.uuid().nullable(),
    phase: z.enum([
      'off',
      'connecting',
      'listening',
      'transcribing',
      'analyzing',
      'speaking',
      'error',
    ]),
    provider: voiceProviderSchema,
    issue: voiceIssueSchema.nullable(),
  })
  .strict();
export type VoiceSnapshot = z.infer<typeof voiceSnapshotSchema>;
const session = { sessionId: z.uuid() };
export const voiceAudioSchema = z
  .object({
    ...session,
    seq: z.number().int().min(0).max(10_000),
    pcm: z.base64().min(4).max(8192),
  })
  .strict();
export type VoiceAudio = z.infer<typeof voiceAudioSchema>;
export const voiceMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), request: voiceStartSchema }).strict(),
  voiceAudioSchema.extend({ type: z.literal('audio') }).strict(),
  z.object({ type: z.literal('finish'), ...session }).strict(),
]);
export const voiceEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('state'),
      ...session,
      phase: z.enum([
        'connecting',
        'listening',
        'transcribing',
        'analyzing',
        'speaking',
      ]),
      provider: voiceProviderSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('transcript'),
      ...session,
      final: z.boolean(),
      text: z.string().trim().min(1).max(1500),
    })
    .strict(),
  z
    .object({
      type: z.literal('answer'),
      ...session,
      result: agentResultSchema,
    })
    .strict(),
  voiceAudioSchema.extend({ type: z.literal('audio') }).strict(),
  z
    .object({
      type: z.literal('end'),
      ...session,
      reason: z.enum(['completed', 'cancelled', ...voiceIssueSchema.options]),
    })
    .strict(),
]);
export type VoiceEvent = z.infer<typeof voiceEventSchema>;
/** Preserve the displayed transcript; normalize only this exact spoken command for the existing recent workflow. */
export function voiceQuestion(text: string): string {
  return /^(?:iris[,:]?\s+)?explain\s+(?:the\s+)?last\s+(?:30|thirty)\s+minutes[.!?]?$/i.test(
    text.trim(),
  )
    ? 'Iris, explain the last 30 minutes.'
    : text.trim();
}
