import pino from 'pino';

export const loggerOptions = (level: string) => ({
  level,
  redact: {
    paths: [
      'apiKey',
      'token',
      'password',
      'DATABASE_URL',
      'PRESAGE_API_KEY',
      'GEMINI_API_KEY',
      'ELEVENLABS_API_KEY',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});
export const createLogger = (name: string, level: string) =>
  pino({ ...loggerOptions(level), name });
