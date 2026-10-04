import { IrisHome } from './iris/IrisHome';
import { BlobNavigation } from './iris/BlobNavigation';
import {
  DemoBanner,
  DemoDiagnostics,
  DemoHome,
  DemoPatterns,
  useDemo,
  type DemoControls,
} from './demo';
import { useEffect, useRef, useState } from 'react';
import { useSensor, sensorLabel, type SensorControls } from './sensor';
import { LiveView } from './live/LiveView';
import { ExperimentsView } from './experiments';
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
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import type { DesktopStatus } from '@trueiris/schemas';

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
  demo,
}: {
  demo: DemoControls;
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
        {['Screen understanding'].map((label) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <span className="pill">Off · not connected</span>
          </div>
        ))}
        <div className="settings-row">
          <span>Voice</span>
          <span>
            Off · <NavLink to="/ask-iris">Start in Ask Iris</NavLink>
          </span>
        </div>
        <div className="settings-row">
          <span>Demo configuration</span>
          <span>
            {status?.demoMode
              ? 'On · Presage first; labeled mock after failure'
              : 'Off'}
          </span>
        </div>
      </section>
      {status?.demoMode && <DemoDiagnostics demo={demo} />}
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
                : status?.integrations?.voice === 'ready'
                  ? 'Configured · checked when you start voice'
                  : 'Unavailable · check backend configuration'}
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
  const home = useLocation().pathname === '/';
  const demoMode = status?.demoMode === true;
  const demo = useDemo(demoMode);
  const data = demo.result?.state === 'ready' ? demo.result.data : null;
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
      <header className="app-header">
        <NavLink to="/" className="brand" aria-label="TrueIris home">
          <span className="brand-symbol" aria-hidden="true">
            ✳
          </span>
          trueiris<span className="brand-dot">.</span>
        </NavLink>
        {home ? (
          <span className="header-note">a little more in tune with you</span>
        ) : (
          <>
            <NavLink className="back-to-iris" to="/">
              ← Back to Iris
            </NavLink>
            <BlobNavigation />
          </>
        )}
      </header>
      <main
        className={`main-content ${home ? 'home-content' : 'detail-content'}`}
      >
        {demoMode && <DemoBanner demo={demo} />}
        <Routes>
          <Route
            path="/"
            element={
              checked ? (
                <>
                  <IrisHome
                    key={demoMode ? 'demo' : 'normal'}
                    demo={demoMode}
                    context={context}
                    storage={storage}
                    activity={activity}
                    onActivity={(value) => void updateActivity(value)}
                  />
                  {activityError && (
                    <p role="alert">
                      Activity could not be updated. Try selecting it again.
                    </p>
                  )}
                </>
              ) : (
                <p className="iris-loading">Getting your little space ready…</p>
              )
            }
          />

          <Route
            path="/demo"
            element={
              !checked ? (
                <p>Getting your sample history ready…</p>
              ) : demoMode ? (
                <DemoHome demo={demo} />
              ) : (
                <Navigate to="/live" replace />
              )
            }
          />
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
                  presentation={demoMode}
                  sensor={sensor}
                  context={context}
                  activity={activity}
                  onActivity={(value) => void updateActivity(value)}
                />
              </>
            }
          />
          <Route
            path="/timeline"
            element={
              <TimelineView
                key={demoMode ? 'demo' : 'normal'}
                demo={demoMode}
              />
            }
          />
          <Route
            path="/patterns"
            element={
              demoMode ? (
                <DemoPatterns data={data} />
              ) : (
                <EmptyPage
                  title="Notice what repeats."
                  description="Personal patterns need enough history. Iris will show the evidence behind each observation."
                />
              )
            }
          />
          <Route
            path="/ask-iris"
            element={
              <AskView key={demoMode ? 'demo' : 'normal'} demo={demoMode} />
            }
          />
          <Route
            path="/experiments"
            element={
              <ExperimentsView
                key={demoMode ? 'demo' : 'normal'}
                demo={demoMode}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <Settings
                demo={demo}
                status={status}
                sensor={sensor}
                storage={storage}
                context={context}
              />
            }
          />
          <Route
            path="*"
            element={
              checked ? <Navigate to="/" replace /> : <p>Loading TrueIris…</p>
            }
          />
        </Routes>
      </main>
      <div className="capture-footer">
        {!demoMode && (
          <>
            <span
              className={`status-dot ${status?.api === 'connected' ? 'connected' : ''}`}
            />
            <span role="status" data-testid="api-status">
              {!checked
                ? 'Checking connection'
                : status?.api === 'connected'
                  ? 'API connected'
                  : 'API unavailable'}
            </span>
            <div className="global-storage" data-testid="global-storage-status">
              {storageLabel(storage.status)}
            </div>
          </>
        )}
        {demoMode && (
          <div className="global-storage" data-testid="global-storage-status">
            {storage.status?.enabled
              ? 'Saving current observations'
              : 'Saving off'}
          </div>
        )}
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
    </div>
  );
}
