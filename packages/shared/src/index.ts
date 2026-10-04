import type {
  AskQuery,
  AgentResult,
  BaselineQuery,
  BaselineResult,
  ContextOptions,
  ContextSnapshot,
  DesktopStatus,
  SensorEvent,
  SensorProviderKind,
  SensorSnapshot,
  StorageStatus,
  TimelineQuery,
  TimelineResult,
  RecordedActivity,
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
  exportContext: 'trueiris:storage:export-context',
  delete: 'trueiris:storage:delete',
} as const;

export const CONTEXT_CHANNELS = {
  get: 'trueiris:context:get',
  start: 'trueiris:context:start',
  stop: 'trueiris:context:stop',
  options: 'trueiris:context:options',
  update: 'trueiris:context:update',
} as const;

export const REASONING_CHANNELS = {
  ask: 'trueiris:reasoning:ask',
  cancel: 'trueiris:reasoning:cancel',
} as const;
export const BASELINE_CHANNEL = 'trueiris:baselines:get';
export const TIMELINE_CHANNEL = 'trueiris:timeline:get';
export const ACTIVITY_CHANNEL = 'trueiris:activity:set';

/** Named, validated capabilities only; never expose generic IPC or credentials. */
export interface DesktopBridge {
  askIris(query: AskQuery): Promise<AgentResult>;
  cancelIris(): Promise<void>;
  getStatus(): Promise<DesktopStatus>;
  getStorage(): Promise<StorageStatus>;
  setStorageEnabled(enabled: boolean): Promise<StorageStatus>;
  exportData(): Promise<'saved' | 'cancelled' | 'failed'>;
  deleteData(): Promise<'deleted' | 'cancelled' | 'failed'>;
  getBaselines(query: BaselineQuery): Promise<BaselineResult>;
  getTimeline(query: TimelineQuery): Promise<TimelineResult>;
  setActivity(
    activity: RecordedActivity | null,
  ): Promise<RecordedActivity | null>;
  getContext(): Promise<ContextSnapshot>;
  startContext(): Promise<ContextSnapshot>;
  stopContext(): Promise<ContextSnapshot>;
  setContextOptions(options: ContextOptions): Promise<ContextSnapshot>;
  onContext(listener: (snapshot: ContextSnapshot) => void): () => void;
  exportContext(): Promise<'saved' | 'cancelled' | 'failed'>;
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
