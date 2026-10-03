import type { SensorIssue } from '@trueiris/schemas';

export class ProcessingLifecycle {
  private hasRun = false;
  unexpectedlyIdle(status: number): boolean {
    if (status === 3) this.hasRun = true;
    return this.hasRun && status === 1;
  }
}

// Stable numeric codes in SmartSpectra 3.4; kept separate from the native loader.
export function validationIssue(code: number): SensorIssue {
  switch (code) {
    case 0:
      return 'none';
    case 1:
      return 'no_face';
    case 2:
      return 'multiple_faces';
    case 5:
    case 6:
      return 'lighting';
    case 10:
      return 'calibrating';
    case 11:
    case 12:
      return 'motion';
    case 3:
    case 4:
    case 7:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
      return 'positioning';
    default:
      return 'low_confidence';
  }
}
export function errorIssue(code: unknown): SensorIssue {
  switch (code) {
    case 2:
    case 4:
      return 'authentication';
    case 5:
    case 6:
      return 'network';
    case 7:
      return 'no_camera';
    default:
      return 'processing';
  }
}
export function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
