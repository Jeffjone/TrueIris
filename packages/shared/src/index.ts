import type {
  DesktopStatus,
  SensorEvent,
  SensorProviderKind,
  SensorSnapshot,
  StorageStatus,
} from '@trueiris/schemas';

export const STATUS_CHANNEL = 'trueiris:get-status';
export const SENSOR_CHANNELS = {
  get: 'trueiris:sensor:get',
  start: 'trueiris:sensor:start',
  stop: 'trueiris:sensor:stop',
  update: 'trueiris:sensor:update',
} as const;

export const STORAGE_CHANNELS = {
  get: 'trueiris:storage:get',
  enable: 'trueiris:storage:enable',
  export: 'trueiris:storage:export',
  delete: 'trueiris:storage:delete',
} as const;

/** Named, validated capabilities only; never expose generic IPC or credentials. */
export interface DesktopBridge {
  getStatus(): Promise<DesktopStatus>;
  getStorage(): Promise<StorageStatus>;
  setStorageEnabled(enabled: boolean): Promise<StorageStatus>;
  exportData(): Promise<'saved' | 'cancelled' | 'failed'>;
  deleteData(): Promise<'deleted' | 'cancelled' | 'failed'>;
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
