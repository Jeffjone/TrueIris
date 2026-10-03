import { z } from 'zod';
import { sensorEventSchema, type SensorEvent } from '@trueiris/schemas';
import { ReadingNormalizer } from './normalize';
import {
  codeOf,
  errorIssue,
  validationIssue,
  ProcessingLifecycle,
} from './issues';
import type { SmartSpectraSDK } from '@smartspectra/node-sdk';

const commandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('start'),
      apiKey: z.string().min(1),
      sessionId: z.uuid(),
    })
    .strict(),
  z.object({ kind: z.literal('stop') }).strict(),
  z.object({ kind: z.literal('probe') }).strict(),
]);
const port = process.parentPort;
let sdk: SmartSpectraSDK | null = null;
let active = false;
let starting = false;
const lifecycle = new ProcessingLifecycle();
let validation = 'calibrating' as ReturnType<typeof validationIssue>;
let timer: ReturnType<typeof setInterval> | undefined;
let failureTimer: ReturnType<typeof setTimeout> | undefined;
let lastEmit = 0;
let stopping: Promise<void> | null = null;
const send = (event: SensorEvent) =>
  port.postMessage(sensorEventSchema.parse(event));

async function stop() {
  if (stopping) return stopping;
  active = false;
  if (timer) clearInterval(timer);
  if (failureTimer) clearTimeout(failureTimer);
  const instance = sdk;
  sdk = null;
  stopping = (async () => {
    try {
      if (instance) {
        await instance.stopAsync();
        await instance.destroy();
      }
    } finally {
      process.exit(0);
    }
  })();
  return stopping;
}
function fail(issue: SensorEvent & { kind: 'error' }) {
  send(issue);
  void stop();
}

async function start(apiKey: string, sessionId: string) {
  if (starting || sdk) return;
  starting = true;
  let vendor: typeof import('@smartspectra/node-sdk');
  try {
    vendor = await import('@smartspectra/node-sdk');
  } catch {
    fail({ kind: 'error', issue: 'sdk_unavailable' });
    return;
  }
  if (stopping) return;
  try {
    if (vendor.SmartSpectraSDK.availableCameras().length === 0) {
      fail({ kind: 'error', issue: 'no_camera' });
      return;
    }
    const normalizer = new ReadingNormalizer(sessionId);
    sdk = new vendor.SmartSpectraSDK({
      apiKey,
      requestedMetrics: [
        vendor.MetricType.PULSE_RATE,
        vendor.MetricType.BREATHING_RATE,
        vendor.MetricType.HRV,
        vendor.MetricType.TALKING,
      ],
      enableAccumulatedOutput: false,
      enableTelemetry: false,
      logLevel: vendor.SmartSpectraLogLevel.kNone,
    });
    const emitReading = () => {
      if (!active || validation !== 'none') return;
      const now = Date.now();
      if (now - lastEmit < 750) return;
      lastEmit = now;
      send({ kind: 'reading', reading: normalizer.read(now) });
    };
    sdk.on('validationStatus', (code) => {
      if (!active) return;
      const issue = validationIssue(code);
      if (issue !== validation) {
        validation = issue;
        normalizer.clear();
        send({
          kind: 'issue',
          issue: issue === 'none' ? 'calibrating' : issue,
        });
      }
    });
    sdk.on('metrics', (buffer) => {
      if (!active || validation !== 'none') return;
      try {
        normalizer.update(
          vendor.decodeMetrics(buffer) as import('./normalize').MetricsPayload,
        );
        emitReading();
      } catch {
        fail({ kind: 'error', issue: 'processing' });
      }
    });
    sdk.on('error', (code) => {
      if (active) fail({ kind: 'error', issue: errorIssue(code) });
    });
    sdk.on('processingStatus', (status) => {
      // The SDK reports idle while initializing. Only idle after running is terminal.
      if (active && lifecycle.unexpectedlyIdle(status))
        fail({ kind: 'error', issue: 'processing' });
      if (active && status === vendor.ProcessingStatus.kError) {
        // Give the numeric error callback time to preserve auth/network classification.
        failureTimer = setTimeout(() => {
          if (active) fail({ kind: 'error', issue: 'processing' });
        }, 100);
      }
    });
    sdk.useCamera(vendor.CameraSelection.default, {
      width: 1280,
      height: 720,
      fps: 30,
    });
    active = true;
    sdk.start();
    if (!active) return;
    send({ kind: 'ready' });
    timer = setInterval(emitReading, 1000);
  } catch (error) {
    const code = codeOf(error);
    fail({ kind: 'error', issue: errorIssue(code) });
  }
}

port.on('message', (message) => {
  const command = commandSchema.safeParse(message.data);
  if (!command.success) {
    fail({ kind: 'error', issue: 'processing' });
    return;
  }
  if (command.data.kind === 'stop') {
    void stop();
    return;
  }
  if (command.data.kind === 'probe') {
    // Native-loader smoke test; no camera discovery, session, key, or capture.
    void import('@smartspectra/node-sdk')
      .then((vendor) => {
        port.postMessage({
          kind: 'probe',
          version: vendor.SmartSpectraSDK.version,
        });
        process.exit(0);
      })
      .catch(() => {
        port.postMessage({ kind: 'probe', version: null });
        process.exit(1);
      });
    return;
  }
  void start(command.data.apiKey, command.data.sessionId);
});
