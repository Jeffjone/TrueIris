import { useEffect, useState } from 'react';
import type {
  SensorIssue,
  SensorProviderKind,
  SensorSnapshot,
} from '@trueiris/schemas';

export const sensorMessages: Record<
  SensorIssue,
  { title: string; detail: string }
> = {
  none: {
    title: 'Connected to your moment.',
    detail: 'Measurements update as the sensor finds a reliable signal.',
  },
  calibrating: {
    title: 'Finding your signal.',
    detail:
      'Face the camera, sit still, and allow time for measurements to stabilize. Some metrics may be unavailable on your plan.',
  },
  no_face: {
    title: 'No face detected.',
    detail: 'Face the camera with your face fully in view.',
  },
  multiple_faces: {
    title: 'One person at a time.',
    detail: 'Keep only your own face in the camera’s view.',
  },
  positioning: {
    title: 'Adjust your position.',
    detail: 'Center your face, look forward, and keep your upper body in view.',
  },
  lighting: {
    title: 'A little more light.',
    detail: 'Use even light on your face and avoid bright light behind you.',
  },
  motion: {
    title: 'Give the signal a moment.',
    detail:
      'Sit still. Motion or a low camera frame rate can interrupt measurements.',
  },
  talking: {
    title: 'Talking detected.',
    detail:
      'Readings are withheld while you talk. Pause speaking to let the signal settle.',
  },
  low_confidence: {
    title: 'Low confidence.',
    detail:
      'Only stable measurements with sufficient confidence are shown. Missing values are withheld.',
  },
  stale: {
    title: 'Waiting for fresh readings.',
    detail:
      'The sensor has stopped sending recent measurements. Stop and reconnect if this continues.',
  },
  missing_key: {
    title: 'Presage needs a connection.',
    detail:
      'Set PRESAGE_API_KEY in your local .env, restart TrueIris, and try again. You can also choose the mock sensor.',
  },
  permission_denied: {
    title: 'Camera permission is off.',
    detail:
      'Allow camera access for TrueIris or Electron in your operating system’s privacy settings, then reconnect.',
  },
  no_camera: {
    title: 'Camera unavailable.',
    detail:
      'Connect a camera and close other applications that might be using it.',
  },
  unsupported_platform: {
    title: 'This platform needs a different setup.',
    detail:
      'Presage supports macOS Apple Silicon, Linux x64/ARM64 with glibc 2.35+, and Windows x64. The mock sensor remains available.',
  },
  sdk_unavailable: {
    title: 'The sensor runtime could not load.',
    detail:
      'Reinstall dependencies for this platform and check the Presage setup guide.',
  },
  authentication: {
    title: 'Presage could not authorize sensing.',
    detail:
      'Check your API key, plan access, and available credits, then reconnect.',
  },
  network: {
    title: 'Presage is unavailable.',
    detail:
      'Check your network connection and try reconnecting. Mock sensing can be selected explicitly.',
  },
  processing: {
    title: 'Sensing was interrupted.',
    detail: 'Try reconnecting; restart TrueIris if the problem continues.',
  },
};
export function sensorLabel(snapshot: SensorSnapshot): string {
  if (snapshot.phase === 'off') return 'Sensing is off';
  if (snapshot.phase === 'stopping') return 'Stopping sensing';
  if (snapshot.provider === 'mock') return 'Mock sensor · no camera';
  if (snapshot.phase === 'starting') return 'Starting camera';
  if (snapshot.phase === 'running') return 'Camera sensing active';
  return 'Camera session failed';
}
const initial: SensorSnapshot = {
  provider: 'presage',
  phase: 'off',
  issue: 'none',
  sessionId: null,
  startedAt: null,
  reading: null,
};
export function useSensor() {
  const [snapshot, setSnapshot] = useState<SensorSnapshot>(initial);
  const [available, setAvailable] = useState(false);
  // Keep the user's provider choice with the session controls across route mounts.
  const [selectedProvider, selectProvider] =
    useState<SensorProviderKind | null>(null);
  useEffect(() => {
    const bridge = window.trueiris;
    if (!bridge) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = bridge.onSensor((value) => {
      receivedEvent = true;
      if (active) setSnapshot(value);
    });
    void bridge
      .getSensor()
      .then((value) => {
        if (active) {
          if (!receivedEvent) setSnapshot(value);
          setAvailable(true);
        }
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const start = async (provider: SensorProviderKind) => {
    try {
      await window.trueiris?.startSensor(provider);
    } catch {
      setSnapshot((current) => ({
        ...current,
        phase: 'error',
        issue: 'processing',
        reading: null,
      }));
    }
  };
  const stop = async () => {
    try {
      await window.trueiris?.stopSensor();
    } catch {
      setSnapshot((current) => ({
        ...current,
        phase: 'error',
        issue: 'processing',
        reading: null,
      }));
    }
  };
  return {
    snapshot,
    available,
    start,
    stop,
    provider: ['starting', 'running', 'stopping'].includes(snapshot.phase)
      ? snapshot.provider
      : (selectedProvider ?? snapshot.provider),
    selectProvider,
  };
}
export type SensorControls = ReturnType<typeof useSensor>;
