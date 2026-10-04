import { useEffect, useRef, useState } from 'react';
import { useSensor, sensorLabel, type SensorControls } from './sensor';
import { LiveView } from './live/LiveView';
import { AskView } from './ask/AskView';
import { TimelineView } from './timeline/TimelineView';
import type { Activity } from './live/presentation';
import {
  StoragePanel,
  useStorage,
  storageLabel,
  type StorageControls,
} from './components/StoragePanel';
import {
  ContextPanel,
  useContext,
  contextLabel,
  type ContextControls,
} from './components/ContextPanel';
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
  storage,
  context,
}: {
  status: DesktopStatus | null;
  sensor: SensorControls;
  storage: StorageControls;
  context: ContextControls;
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
          Camera and desktop capture are independent and controlled below.
        </p>
        <SensorPanel sensor={sensor} />
        <ContextPanel context={context} />
        {['Screen understanding', 'Voice'].map((label) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <span className="pill">Off · not connected</span>
          </div>
        ))}
        <div className="settings-row">
          <span>Demo configuration</span>
          <span>
            {status?.demoMode ? 'Requested · fallback not implemented' : 'Off'}
          </span>
        </div>
      </section>
      <StoragePanel storage={storage} />
      <section className="settings-surface">
        <h2>Connection status</h2>
        <div className="settings-row">
          <span>API</span>
          <span>
            {status?.api === 'connected' ? 'Connected' : 'Unavailable'}
          </span>
        </div>
        <div className="settings-row">
          <span>Tiger Data</span>
          <span>
            {status?.integrations?.database === 'ready'
              ? 'Connected'
              : 'Unavailable'}
          </span>
        </div>
        {['Gemini', 'ElevenLabs'].map((label) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <span>
              {label === 'Gemini'
                ? status?.integrations?.reasoning === 'ready'
                  ? 'Configured · checked when you ask'
                  : 'Unavailable · check backend configuration'
                : 'Not integrated'}
            </span>
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
  const context = useContext();
  const storage = useStorage();
  const [activity, setActivity] = useState<Activity>('');
  const [activityError, setActivityError] = useState(false);
  const activityRequest = useRef(0);
  async function updateActivity(value: Activity) {
    const request = ++activityRequest.current;
    try {
      const saved = await window.trueiris!.setActivity(value || null);
      if (request === activityRequest.current) {
        setActivity(saved ?? '');
        setActivityError(false);
      }
    } catch {
      if (request === activityRequest.current) setActivityError(true);
    }
  }
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
          <div className="global-storage" data-testid="global-storage-status">
            {storageLabel(storage.status)}
          </div>
          <div className="global-sensor global-context">
            <span data-testid="global-context-status">
              {contextLabel(context.snapshot)}
            </span>
            {context.snapshot &&
              ['starting', 'running'].includes(context.snapshot.phase) && (
                <button
                  disabled={context.busy}
                  onClick={() => {
                    void context.action('stop');
                  }}
                >
                  Stop context
                </button>
              )}
          </div>
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
              <>
                {activityError && (
                  <p className="muted">
                    Activity could not be updated. Try selecting it again.
                  </p>
                )}
                <LiveView
                  sensor={sensor}
                  context={context}
                  activity={activity}
                  onActivity={(value) => void updateActivity(value)}
                />
              </>
            }
          />
          <Route path="/timeline" element={<TimelineView />} />
          <Route
            path="/patterns"
            element={
              <EmptyPage
                title="Notice what repeats."
                description="Personal patterns need enough history. Iris will show the evidence behind each observation."
              />
            }
          />
          <Route path="/ask-iris" element={<AskView />} />
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
            element={
              <Settings
                status={status}
                sensor={sensor}
                storage={storage}
                context={context}
              />
            }
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
