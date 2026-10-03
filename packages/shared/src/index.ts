import type {
  DesktopStatus,
  SensorEvent,
  SensorProviderKind,
  SensorSnapshot,
} from '@trueiris/schemas';

export const STATUS_CHANNEL = 'trueiris:get-status';
export const SENSOR_CHANNELS = {
  get: 'trueiris:sensor:get',
  start: 'trueiris:sensor:start',
  stop: 'trueiris:sensor:stop',
  update: 'trueiris:sensor:update',
} as const;

/** Named, validated capabilities only; never expose generic IPC or credentials. */
export interface DesktopBridge {
  getStatus(): Promise<DesktopStatus>;
  getSensor(): Promise<SensorSnapshot>;
  startSensor(provider: SensorProviderKind): Promise<SensorSnapshot>;
  stopSensor(): Promise<SensorSnapshot>;
  onSensor(listener: (snapshot: SensorSnapshot) => void): () => void;
}

export interface SensorProvider {
  start(
    sessionId: string,
    onEvent: (event: SensorEvent) => void,
  ): Promise<void>;
  stop(): Promise<void>;
}
