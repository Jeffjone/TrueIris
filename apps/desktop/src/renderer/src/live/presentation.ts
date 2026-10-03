import type { SensorSnapshot } from '@trueiris/schemas';

export const activities = [
  'Coding',
  'Studying',
  'Reading',
  'Meeting',
  'Break',
  'Other',
] as const;
export type Activity = (typeof activities)[number] | '';
export type SignalTone = 'positive' | 'caution' | 'quiet';

export function signalPresentation(snapshot: SensorSnapshot): {
  label: string;
  tone: SignalTone;
} {
  if (snapshot.phase === 'off')
    return { label: 'Not connected', tone: 'quiet' };
  if (snapshot.phase === 'starting')
    return { label: 'Calibrating', tone: 'quiet' };
  if (snapshot.phase === 'stopping')
    return { label: 'Stopping', tone: 'quiet' };
  if (snapshot.phase === 'error') {
    return {
      label: ['no_camera', 'permission_denied'].includes(snapshot.issue)
        ? 'Camera unavailable'
        : 'Connection unavailable',
      tone: 'caution',
    };
  }
  const issues: Partial<Record<SensorSnapshot['issue'], string>> = {
    no_face: 'No face detected',
    multiple_faces: 'Multiple faces detected',
    positioning: 'Adjust your position',
    lighting: 'Check lighting',
    motion: 'Motion detected',
    talking: 'Talking detected',
    low_confidence: 'Low confidence',
    stale: 'Waiting for fresh readings',
  };
  const issue = issues[snapshot.issue];
  if (issue) return { label: issue, tone: 'caution' };
  if (snapshot.issue === 'calibrating')
    return { label: 'Calibrating', tone: 'quiet' };
  switch (snapshot.reading?.signalQuality) {
    case 'excellent':
      return { label: 'Excellent signal', tone: 'positive' };
    case 'good':
      return { label: 'Good signal', tone: 'positive' };
    case 'poor':
      return { label: 'Low confidence', tone: 'caution' };
    default:
      return { label: 'Calibrating', tone: 'quiet' };
  }
}

export function elapsedSeconds(startedAt: string, now: number): number {
  const start = Date.parse(startedAt);
  return Number.isFinite(start) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - start) / 1000))
    : 0;
}
export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${hours ? `${pad(hours)}:` : ''}${pad(minutes)}:${pad(remainder)}`;
}
