import type { DesktopStatus, SensorReading } from '@trueiris/schemas';

export const STATUS_CHANNEL = 'trueiris:get-status';

/** Deliberately narrow bridge; never expose generic IPC, Node, or credentials. */
export interface DesktopBridge {
  getStatus(): Promise<DesktopStatus>;
}

/** Provider contract for feature 2. No production or mock sensing is active yet. */
export interface SensorProvider {
  start(onReading: (reading: SensorReading) => void): Promise<void>;
  stop(): Promise<void>;
}
