import { useEffect, useState } from 'react';
import {
  useSensor,
  sensorMessages,
  sensorLabel,
  type SensorControls,
} from './sensor';
import { SensorPanel } from './components/SensorPanel';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { DesktopStatus } from '@trueiris/schemas';

const pages = [
  'Live',
  'Timeline',
  'Patterns',
  'Ask Iris',
  'Experiments',
  'Settings',
] as const;
const routeFor = (page: string) =>
  `/${page.toLowerCase().replaceAll(' ', '-')}`;

function useStatus() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await window.trueiris?.getStatus();
        if (active) setStatus(result ?? null);
      } catch {
        if (active) setStatus(null);
      } finally {
        if (active) setChecked(true);
      }
    }
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);
  return { status, checked };
}

function Live({ sensor }: { sensor: SensorControls }) {
  const { snapshot } = sensor;
  const reading = snapshot.reading;
  const connected = snapshot.phase === 'running';
  const message =
    snapshot.phase === 'off'
      ? {
          title: 'A moment to connect.',
          detail:
            'Choose camera sensing to measure with Presage, or explore with an explicitly labeled mock sensor.',
        }
      : sensorMessages[snapshot.issue];
  const quality = reading?.signalQuality;
  const signal =
    quality === 'excellent'
      ? 'Excellent'
      : quality === 'good'
        ? 'Good'
        : quality === 'poor'
          ? 'Low confidence'
          : connected
            ? 'Calibrating'
            : 'Not connected';
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE MORE AWARE</p>
          <h1>Your state, in context.</h1>
        </div>
        <span className="pill" data-testid="capture-status">
          {sensorLabel(snapshot)}
        </span>
      </div>
      <section className="live-surface" aria-label="Current physiology">
        <div className={`iris-ring ${connected ? 'sensor-connected' : ''}`}>
          <div className="iris-core" />
        </div>
        <p className="eyebrow">
          {snapshot.provider === 'mock' ? 'MOCK PULSE' : 'PULSE'}
        </p>
        <div className="pulse-value" data-testid="pulse-value">
          {reading?.pulseRate === undefined
            ? '—'
            : Math.round(reading.pulseRate)}
          <span>BPM</span>
        </div>
        <h2 data-testid="sensor-message">{message.title}</h2>
        <p className="muted">{message.detail}</p>
        {reading?.pulseConfidence !== undefined && (
          <p className="confidence-note">
            Pulse confidence {Math.round(reading.pulseConfidence * 100)}%
            {reading.pulseRate === undefined ? ' · value withheld' : ''}
          </p>
        )}
        <div className="metrics">
          <div>
            <span>Breathing</span>
            <strong data-testid="respiration-value">
              {reading?.respirationRate === undefined
                ? '—'
                : reading.respirationRate.toFixed(1)}{' '}
              <small>/min</small>
            </strong>
          </div>
          <div>
            <span>HRV</span>
            <strong data-testid="hrv-value">
              {reading?.hrvRmssd === undefined
                ? '—'
                : Math.round(reading.hrvRmssd)}{' '}
              <small>ms</small>
            </strong>
          </div>
          <div>
            <span>Signal</span>
            <strong className="signal-empty">{signal}</strong>
          </div>
        </div>
      </section>
      <SensorPanel sensor={sensor} />
      <section className="context-strip">
        <span className="context-symbol" aria-hidden="true">
          ⌘
        </span>
        <div>
          <p className="eyebrow">CURRENT ACTIVITY</p>
          <h2>No active session</h2>
          <p className="muted">
            Desktop context will appear when you choose to enable it.
          </p>
        </div>
      </section>
    </>
  );
}

function EmptyPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR PERSONAL CONTEXT</p>
          <h1>{title}</h1>
        </div>
      </div>
      <section className="empty-surface">
        <div className="empty-mark" aria-hidden="true">
          ◌
        </div>
        <h2>It starts with your day.</h2>
        <p className="muted">{description}</p>
        <NavLink className="text-link" to="/live">
          Back to Live →
        </NavLink>
      </section>
    </>
  );
}

function Settings({
  status,
  sensor,
}: {
  status: DesktopStatus | null;
  sensor: SensorControls;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ALWAYS YOUR CHOICE</p>
          <h1>Your data, your control.</h1>
        </div>
      </div>
      <section className="settings-surface">
        <h2>Capture & privacy</h2>
        <p className="muted">
          Camera sensing is controlled below. Other capture integrations remain
          off.
        </p>
        <SensorPanel sensor={sensor} />
        {['Desktop context', 'Screen understanding', 'Voice'].map((label) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <span className="pill">Off · not connected</span>
          </div>
        ))}
        <div className="settings-row">
          <span>Data retention</span>
          <span>No observations stored</span>
        </div>
        <div className="settings-row">
          <span>Demo configuration</span>
          <span>
            {status?.demoMode ? 'Requested · fallback not implemented' : 'Off'}
          </span>
        </div>
      </section>
      <section className="settings-surface">
        <h2>Connection status</h2>
        <div className="settings-row">
          <span>API</span>
          <span>
            {status?.api === 'connected' ? 'Connected' : 'Unavailable'}
          </span>
        </div>
        {['Tiger Data', 'Gemini', 'ElevenLabs'].map((label) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <span>Not integrated</span>
          </div>
        ))}
        <p className="muted">
          Application version {status?.version ?? 'unavailable'}
        </p>
      </section>
    </>
  );
}

export function App() {
  const { status, checked } = useStatus();
  const sensor = useSensor();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/live" className="brand" aria-label="TrueIris home">
          <span className="brand-symbol" aria-hidden="true">
            ◉
          </span>{' '}
          trueiris<span className="brand-dot">.</span>
        </NavLink>
        <p className="brand-subtitle">A clearer view of you.</p>
        <nav aria-label="Main navigation">
          {pages.map((page, index) => (
            <NavLink key={page} to={routeFor(page)}>
              <span className="nav-index" aria-hidden="true">
                0{index + 1}
              </span>
              {page}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span
            className={`status-dot ${status?.api === 'connected' ? 'connected' : ''}`}
          />
          <span role="status">
            {!checked
              ? 'Checking connection'
              : status?.api === 'connected'
                ? 'API connected'
                : 'API unavailable'}
          </span>
          <div className="global-sensor">
            <span data-testid="global-capture-status">
              {sensorLabel(sensor.snapshot)}
            </span>
            {['starting', 'running', 'stopping'].includes(
              sensor.snapshot.phase,
            ) && (
              <button
                disabled={sensor.snapshot.phase === 'stopping'}
                onClick={() => {
                  void sensor.stop();
                }}
              >
                Stop sensor
              </button>
            )}
          </div>
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/live" element={<Live sensor={sensor} />} />
          <Route
            path="/timeline"
            element={
              <EmptyPage
                title="The shape of your day."
                description="Your activity and measurements will form a timeline here. There’s no history yet."
              />
            }
          />
          <Route
            path="/patterns"
            element={
              <EmptyPage
                title="Notice what repeats."
                description="Personal patterns need enough history. Iris will show the evidence behind each observation."
              />
            }
          />
          <Route
            path="/ask-iris"
            element={
              <EmptyPage
                title="Ask about your day."
                description="Once your measurements and context are connected, Iris will help you explore them through conversation."
              />
            }
          />
          <Route
            path="/experiments"
            element={
              <EmptyPage
                title="Learn what works for you."
                description="Personal experiments will help you compare sessions and explore your own patterns."
              />
            }
          />
          <Route
            path="/settings"
            element={<Settings status={status} sensor={sensor} />}
          />
          <Route path="*" element={<Navigate to="/live" replace />} />
        </Routes>
        <footer className="content-footer">
          TRUEIRIS <span>Personal context intelligence</span>
        </footer>
      </main>
    </div>
  );
}
