import type { DesktopBridge } from '@trueiris/shared';
declare global {
  interface Window {
    trueiris?: DesktopBridge;
  }
}
export {};
