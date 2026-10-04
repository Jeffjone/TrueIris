import { useEffect, useState } from 'react';
import type { SensorSnapshot } from '@trueiris/schemas';
import {
  ContextPanel,
  contextLabel,
  type ContextControls,
} from '../components/ContextPanel';
import { SensorPanel } from '../components/SensorPanel';
import { sensorLabel, sensorMessages, type SensorControls } from '../sensor';
import {
  activities,
  elapsedSeconds,
  formatDuration,
  signalPresentation,
  type Activity,
} from './presentation';

function useElapsed(snapshot: SensorSnapshot) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (snapshot.phase !== 'running' || !snapshot.startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.phase, snapshot.startedAt]);
  return snapshot.phase === 'running' && snapshot.startedAt
    ? elapsedSeconds(snapshot.startedAt, now)
    : null;
}

function Confidence({
  value,
  withheld = false,
}: {
  value: number | undefined;
  withheld?: boolean;
}) {
  return (
    <span className="metric-confidence">
      {value === undefined
        ? 'Confidence unavailable'
        : `${Math.round(value * 100)}% confidence`}
      {withheld && value !== undefined ? ' · withheld' : ''}
    </span>
  );
}

export function LiveView({
  sensor,
  context,
  activity,
  onActivity,
  presentation = false,
}: {
  presentation?: boolean;
  sensor: SensorControls;
  context: ContextControls;
  activity: Activity;
  onActivity: (value: Activity) => void;
}) {
  const { snapshot } = sensor;
  const reading = snapshot.phase === 'running' ? snapshot.reading : null;
  const signal = signalPresentation(snapshot);
  const seconds = useElapsed(snapshot);
  const hasPulse = reading?.pulseRate !== undefined;
  const message =
    snapshot.phase === 'off'
      ? {
          title: 'A moment to connect.',
          detail:
            'Choose camera sensing to measure with Presage, or explore with an explicitly labeled mock sensor.',
        }
      : snapshot.issue === 'none'
        ? {
            title: signal.label,
            detail:
              snapshot.provider === 'mock'
                ? 'Simulated measurements. This stream does not describe your physiology.'
                : 'Your latest stable measurements, with confidence shown for each signal.',
          }
        : sensorMessages[snapshot.issue];

  return (
    <div className="live-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE MORE AWARE</p>
          <h1>Your state, in context.</h1>
        </div>
        <span className="pill" data-testid="capture-status">
          {sensorLabel(snapshot)}
        </span>
      </div>
      <section
        className={`live-surface signal-${signal.tone}`}
        aria-label="Current physiology"
      >
        <div className="live-source">
          <span className="eyebrow">
            {snapshot.provider === 'mock'
              ? 'SIMULATED · MOCK SENSOR'
              : 'PRESAGE · LIVE SENSING'}
          </span>
          <span className="live-local-note">
            {snapshot.phase === 'off'
              ? 'Ready when you are'
              : snapshot.provider === 'mock'
                ? 'No camera in use'
                : 'Camera session'}
          </span>
        </div>
        <div
          className={`pulse-stage ${hasPulse ? 'has-signal' : ''}`}
          data-testid="pulse-stage"
          data-signal={hasPulse ? 'accepted' : 'unavailable'}
        >
          <div className="iris-visualizer" aria-hidden="true">
            <div className="iris-orbit" />
            <div className="iris-halo" />
            <div className="iris-ring">
              <div className="iris-core" />
            </div>
          </div>
          <p className="eyebrow pulse-label">
            {snapshot.provider === 'mock' ? 'MOCK PULSE' : 'PULSE'}
          </p>
          <div className="pulse-value" data-testid="pulse-value">
            <span
              className="pulse-number"
              key={`${snapshot.sessionId}:${reading?.pulseRate ?? 'empty'}`}
            >
              {reading?.pulseRate === undefined
                ? '—'
                : Math.round(reading.pulseRate)}
            </span>
            <span className="pulse-unit">BPM</span>
          </div>
          <div className="pulse-confidence">
            <span>Pulse confidence</span>
            <strong data-testid="pulse-confidence">
              {reading?.pulseConfidence === undefined
                ? '—'
                : `${Math.round(reading.pulseConfidence * 100)}%`}
            </strong>
            {!hasPulse && reading?.pulseConfidence !== undefined && (
              <span>Value withheld</span>
            )}
          </div>
        </div>
        <div className="live-message">
          <h2 data-testid="sensor-message">{message.title}</h2>
          <p className="muted">{message.detail}</p>
        </div>
        <div className="metrics">
          <div className="metric">
            <span className="metric-label">Respiration</span>
            <strong data-testid="respiration-value">
              {reading?.respirationRate === undefined
                ? '—'
                : reading.respirationRate.toFixed(1)}{' '}
              <small>/min</small>
            </strong>
            <Confidence
              value={reading?.respirationConfidence}
              withheld={reading?.respirationRate === undefined}
            />
          </div>
          <div className="metric">
            <span className="metric-label">
              HRV <small>RMSSD</small>
            </span>
            <strong data-testid="hrv-value">
              {reading?.hrvRmssd === undefined
                ? '—'
                : Math.round(reading.hrvRmssd)}{' '}
              <small>ms</small>
            </strong>
            <Confidence
              value={reading?.hrvConfidence}
              withheld={reading?.hrvRmssd === undefined}
            />
          </div>
          <div className="metric signal-metric">
            <span className="metric-label">Signal quality</span>
            <strong
              className="signal-label"
              data-testid="signal-quality"
              aria-live="polite"
            >
              <span className="signal-dot" aria-hidden="true" />
              {signal.label}
            </strong>
            <span className="metric-confidence">
              {reading?.talking === true
                ? 'Talking · values withheld'
                : hasPulse
                  ? 'Stable pulse accepted'
                  : 'Waiting for a reliable signal'}
            </span>
          </div>
        </div>
      </section>
      <section className="live-context" aria-label="Session context">
        <div className="activity-context">
          <label className="eyebrow" htmlFor="current-activity">
            CURRENT ACTIVITY
          </label>
          <select
            id="current-activity"
            value={activity}
            onChange={(event) => onActivity(event.target.value as Activity)}
          >
            <option value="">Not selected</option>
            {activities.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <p className="context-caption">
            {activity ? 'Selected by you' : 'Choose what you’re doing'}
          </p>
          <p className="context-caption">
            Included in new readings when saving is on.
          </p>
        </div>
        <div>
          <p className="eyebrow">CURRENT APPLICATION</p>
          <strong data-testid="current-application">
            {context.snapshot?.phase === 'running'
              ? (context.snapshot.application?.name ??
                'Application unavailable')
              : 'Context off'}
          </strong>
          <p className="context-caption">
            {context.snapshot?.classification
              ? `${context.snapshot.classification.activity} · ${Math.round(context.snapshot.classification.confidence * 100)}% confidence`
              : contextLabel(context.snapshot)}
          </p>
        </div>
        <div>
          <p className="eyebrow">SESSION DURATION</p>
          <time
            className="session-duration"
            data-testid="session-duration"
            dateTime={seconds === null ? undefined : `PT${seconds}S`}
          >
            {seconds === null ? '—' : formatDuration(seconds)}
          </time>
          <p className="context-caption">
            {snapshot.phase === 'running'
              ? snapshot.provider === 'mock'
                ? 'Mock sensing session'
                : 'Camera sensing session'
              : snapshot.phase === 'starting'
                ? 'Preparing sensor'
                : 'Start sensing to begin'}
          </p>
        </div>
      </section>
      {presentation ? (
        <section
          className="settings-surface"
          aria-label="Demo capture controls"
        >
          {snapshot.fallbackIssue && (
            <p className="demo-fallback" role="status">
              Presage is unavailable. Demo fallback is simulated; no camera is
              in use.
            </p>
          )}
          <button
            className="sensor-button"
            disabled={
              !sensor.available ||
              ['starting', 'stopping'].includes(snapshot.phase)
            }
            onClick={() =>
              void (snapshot.phase === 'running'
                ? sensor.stop()
                : sensor.start('presage'))
            }
          >
            {snapshot.phase === 'running'
              ? 'Stop sensing'
              : 'Start live signal'}
          </button>
          <button
            className="sensor-button"
            disabled={context.busy}
            onClick={() =>
              void context.action(
                context.snapshot?.phase === 'running' ? 'stop' : 'start',
              )
            }
          >
            {context.snapshot?.phase === 'running'
              ? 'Stop desktop context'
              : 'Start desktop context'}
          </button>
          <p className="muted">
            Starting a live signal enables your camera; Presage processes frames
            on-device and uploads derived vitals. TrueIris stores no frames. If
            Presage fails, demo mode switches to a clearly labeled simulated
            stream. Desktop context is a separate opt-in and captures app
            identity/idle state without window titles. Automatic saving remains
            off until enabled in Diagnostics.
          </p>
        </section>
      ) : (
        <>
          <ContextPanel context={context} />
          <SensorPanel sensor={sensor} />
        </>
      )}
    </div>
  );
}
