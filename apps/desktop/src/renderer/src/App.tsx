import { useEffect, useState } from 'react';
import { useSensor, sensorLabel, type SensorControls } from './sensor';
import { LiveView } from './live/LiveView';
import type { Activity } from './live/presentation';
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
  const [activity, setActivity] = useState<Activity>('');
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
          <Route
            path="/live"
            element={
              <LiveView
                sensor={sensor}
                activity={activity}
                onActivity={setActivity}
              />
            }
          />
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
