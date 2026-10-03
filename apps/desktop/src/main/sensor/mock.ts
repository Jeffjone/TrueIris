import type {
  SensorEvent,
  SensorIssue,
  SensorReading,
} from '@trueiris/schemas';
import type { SensorProvider } from '@trueiris/shared';

export type MockScenario =
  | 'steady'
  | 'no_face'
  | 'low_confidence'
  | 'lighting'
  | 'motion'
  | 'talking'
  | 'network'
  | 'no_camera'
  | 'permission_denied';
export class MockSensorProvider implements SensorProvider {
  private timer: ReturnType<typeof setInterval> | undefined;
  private tick = 0;
  constructor(private readonly scenario: MockScenario = 'steady') {}
  async start(sessionId: string, onEvent: (event: SensorEvent) => void) {
    if (this.timer) throw new Error('Mock sensor already started');
    onEvent({ kind: 'ready' });
    onEvent({ kind: 'issue', issue: 'calibrating' });
    this.timer = setInterval(() => {
      this.tick += 1;
      if (
        ['network', 'no_camera', 'permission_denied'].includes(this.scenario)
      ) {
        onEvent({ kind: 'error', issue: this.scenario as SensorIssue });
        void this.stop();
        return;
      }
      if (['no_face', 'lighting', 'motion'].includes(this.scenario)) {
        onEvent({ kind: 'issue', issue: this.scenario as SensorIssue });
        return;
      }
      const reading: SensorReading = {
        timestamp: new Date().toISOString(),
        sessionId,
        source: 'mock',
        signalQuality: 'excellent',
        pulseRate: 74 + Math.round(Math.sin(this.tick / 3) * 2),
        pulseConfidence: 0.92,
        respirationRate: 14 + Math.sin(this.tick / 4) * 0.3,
        respirationConfidence: 0.9,
        hrvRmssd: 41 + Math.round(Math.sin(this.tick / 5)),
        hrvConfidence: 0.88,
        talking: false,
      };
      if (this.scenario === 'low_confidence' || this.scenario === 'talking') {
        delete reading.pulseRate;
        delete reading.respirationRate;
        delete reading.hrvRmssd;
        reading.signalQuality = 'poor';
        if (this.scenario === 'talking') reading.talking = true;
        else {
          reading.pulseConfidence = 0.2;
          reading.respirationConfidence = 0.2;
          reading.hrvConfidence = 0.2;
        }
      }
      onEvent({ kind: 'reading', reading });
    }, 1000);
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
