import { z } from 'zod';
import { foregroundSchema } from '@trueiris/schemas';
import { nativeReader, UnsupportedContext } from './native';
const command = z.object({ windowTitles: z.boolean() }).strict();
let read: ReturnType<typeof nativeReader> | null = null;
let busy = false;
process.parentPort.on('message', (message) => {
  const input = command.safeParse(message.data);
  if (!input.success || busy) return;
  busy = true;
  void (async () => {
    try {
      read ??= nativeReader();
      process.parentPort.postMessage({
        kind: 'foreground',
        foreground: foregroundSchema.parse(await read(input.data.windowTitles)),
      });
    } catch (error) {
      process.parentPort.postMessage({
        kind: 'error',
        issue:
          error instanceof UnsupportedContext ? 'unsupported' : 'unavailable',
      });
    } finally {
      busy = false;
    }
  })();
});
