import { useEffect, useRef, useState } from 'react';
import type { ContextOptions, ContextSnapshot } from '@trueiris/schemas';
import { formatDuration } from '../live/presentation';

export function contextLabel(value: ContextSnapshot | null) {
  if (!value) return 'Desktop context unavailable';
  if (value.phase === 'off') return 'Desktop context off';
  if (value.phase === 'starting') return 'Starting desktop context';
  if (value.phase === 'error')
    return value.issue === 'unsupported'
      ? 'Desktop context unsupported'
      : 'Desktop context unavailable';
  return value.provider === 'mock'
    ? 'Mock desktop context on'
    : 'Desktop context on';
}
export function useContext() {
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const version = useRef(0);
  useEffect(() => {
    let active = true;
    const unsubscribe = window.trueiris?.onContext((value) => {
      version.current++;
      if (active) setSnapshot(value);
    });
    const refresh = async () => {
      const current = version.current;
      try {
        const value = await window.trueiris?.getContext();
        if (active && current === version.current) setSnapshot(value ?? null);
      } catch {
        if (active && current === version.current) setSnapshot(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      unsubscribe?.();
      window.clearInterval(timer);
    };
  }, []);
  async function action(kind: 'start' | 'stop' | ContextOptions) {
    setBusy(true);
    setError('');
    if (typeof kind === 'object')
      setSnapshot((value) =>
        value
          ? {
              ...value,
              options: kind,
              windowTitle: kind.windowTitles ? value.windowTitle : null,
            }
          : value,
      );
    version.current++;
    try {
      const result =
        typeof kind === 'object'
          ? await window.trueiris!.setContextOptions(kind)
          : kind === 'start'
            ? await window.trueiris!.startContext()
            : await window.trueiris!.stopContext();
      version.current++;
      setSnapshot(result);
      return result;
    } catch {
      setError('Desktop context could not be updated. Please retry.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { snapshot, busy, error, action };
}
export type ContextControls = ReturnType<typeof useContext>;
export function ContextPanel({ context }: { context: ContextControls }) {
  const { snapshot: s, busy, error } = context;
  const running = s?.phase === 'running' || s?.phase === 'starting';
  return (
    <section className="context-panel" aria-label="Desktop context controls">
      <div className="settings-row">
        <div>
          <h3>Desktop context</h3>
          <span data-testid="context-status">{contextLabel(s)}</span>
        </div>
        <button
          disabled={busy || !s}
          onClick={() => {
            void context.action(running ? 'stop' : 'start');
          }}
        >
          {running ? 'Stop desktop context' : 'Start desktop context'}
        </button>
      </div>
      <p className="muted">
        Records the foreground application, switches and time since computer
        input. Capture starts off each launch and stops on sleep, screen lock or
        reload. Saving is controlled in Settings.{' '}
        {s?.provider === 'mock'
          ? 'This provider simulates context and saves it as mock.'
          : ''}
      </p>
      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={s?.options.windowTitles ?? false}
            disabled={busy || !s}
            onChange={(e) => {
              void context.action({
                windowTitles: e.target.checked,
                focusMode: s?.options.focusMode ?? false,
              });
            }}
          />{' '}
          Include window titles
        </label>
        <span>
          {s?.titleAccess === 'permission_required'
            ? 'Accessibility permission required'
            : s?.titleAccess === 'ready'
              ? 'Available'
              : s?.options.windowTitles
                ? 'Title unavailable'
                : 'Off'}
        </span>
      </div>
      <p className="muted">
        Titles can contain private document names. Off by default; enabling may
        request macOS Accessibility permission. No page contents or screenshots
        are read.
      </p>
      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={s?.options.focusMode ?? false}
            disabled={busy || !s}
            onChange={(e) => {
              void context.action({
                windowTitles: s?.options.windowTitles ?? false,
                focusMode: e.target.checked,
              });
            }}
          />{' '}
          Focus mode
        </label>
        <span>{s?.options.focusMode ? 'On · selected by you' : 'Off'}</span>
      </div>
      <p className="muted">
        This marks your context as focused. It does not change system
        notification settings.
      </p>
      {s?.phase === 'error' && (
        <p className="timeline-warning">
          {s.issue === 'unsupported'
            ? 'Foreground application capture is unsupported in this desktop session. Linux requires X11 and xprop; Wayland is unavailable.'
            : 'The OS observation could not be read. Capture has stopped; try starting again.'}
        </p>
      )}
      {s?.phase === 'running' && (
        <div className="context-observation" data-testid="context-observation">
          <strong>
            {s.application?.name ?? 'Foreground application unavailable'}
          </strong>
          {s.windowTitle && <p>{s.windowTitle}</p>}
          <p>
            {s.classification
              ? `${s.classification.activity} · ${Math.round(s.classification.confidence * 100)}% confidence`
              : 'Activity unavailable'}
          </p>
          <p className="muted">{s.classification?.reason}</p>
          <p className="muted">
            Context session {formatDuration(s.sessionSeconds)} ·{' '}
            {s.applicationSwitches} application switches · idle{' '}
            {formatDuration(s.idleSeconds)} · foreground{' '}
            {formatDuration(s.foregroundSeconds)}
          </p>
        </div>
      )}
      <p className="muted" data-testid="context-storage">
        Context history: {s?.storage.enabled ? s.storage.state : 'saving off'} ·{' '}
        {s?.storage.queued ?? 0} queued · {s?.storage.saved ?? 0} saved ·{' '}
        {s?.storage.dropped ?? 0} discarded or unconfirmed
      </p>
      {error && <p aria-live="polite">{error}</p>}
    </section>
  );
}
