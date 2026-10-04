import type { SensorProviderKind } from '@trueiris/schemas';
import { sensorMessages, type SensorControls } from '../sensor';

export function SensorPanel({ sensor }: { sensor: SensorControls }) {
  const { snapshot, available, provider, selectProvider } = sensor;
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
              selectProvider(event.target.value as SensorProviderKind)
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
      {snapshot.fallbackIssue && (
        <p className="muted" role="status">
          Demo fallback: {sensorMessages[snapshot.fallbackIssue].title} Current
          mock readings are simulated.
        </p>
      )}
      <p className="muted sensor-privacy">
        {provider === 'mock'
          ? 'Simulated readings for development. No camera or Presage connection is used.'
          : 'Starting enables your camera. Presage processes frames on-device and sends derived vitals summaries to its insight service. TrueIris never stores camera frames. Readings are saved only when you enable saving in Settings. Stop sensing at any time.'}
      </p>
    </section>
  );
}
