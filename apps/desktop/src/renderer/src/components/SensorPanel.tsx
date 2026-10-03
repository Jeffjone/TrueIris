import { useState } from 'react';
import type { SensorProviderKind } from '@trueiris/schemas';
import type { SensorControls } from '../sensor';

export function SensorPanel({ sensor }: { sensor: SensorControls }) {
  const [selected, setSelected] = useState<SensorProviderKind | null>(null);
  const { snapshot, available } = sensor;
  const provider = selected ?? snapshot.provider;
  const busy = ['starting', 'running', 'stopping'].includes(snapshot.phase);
  return (
    <section className="sensor-panel" aria-label="Sensor controls">
      <div className="sensor-actions">
        <label>
          Sensor{' '}
          <select
            aria-label="Sensor provider"
            value={provider}
            disabled={busy}
            onChange={(event) =>
              setSelected(event.target.value as SensorProviderKind)
            }
          >
            <option value="presage">Presage camera</option>
            <option value="mock">Mock · no camera</option>
          </select>
        </label>
        {busy ? (
          <button
            className="sensor-button"
            disabled={snapshot.phase === 'stopping'}
            onClick={() => {
              void sensor.stop();
            }}
          >
            {snapshot.phase === 'stopping' ? 'Stopping…' : 'Stop sensing'}
          </button>
        ) : (
          <button
            className="sensor-button"
            disabled={!available}
            onClick={() => {
              void sensor.start(provider);
            }}
          >
            {provider === 'mock' ? 'Start mock sensor' : 'Start camera sensing'}
          </button>
        )}
      </div>
      <p className="muted sensor-privacy">
        {provider === 'mock'
          ? 'Simulated readings for development. No camera or Presage connection is used.'
          : 'Starting enables your camera. Presage processes frames on-device and sends derived vitals summaries to its insight service. TrueIris stores no frames or readings in this feature. Stop sensing at any time.'}
      </p>
    </section>
  );
}
