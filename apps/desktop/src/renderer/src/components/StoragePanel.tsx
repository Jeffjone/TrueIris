import { useEffect, useState } from 'react';
import type { StorageStatus } from '@trueiris/schemas';

export function useStorage() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const value = await window.trueiris?.getStorage();
        if (active) setStatus(value ?? null);
      } catch {
        if (active) setStatus(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const toggle = async () => {
    setBusy(true);
    setMessage('');
    try {
      setStatus(await window.trueiris!.setStorageEnabled(!status?.enabled));
    } catch {
      setMessage('Saving could not be changed. Check your connection setup.');
    } finally {
      setBusy(false);
    }
  };
  const manage = async (action: 'export' | 'delete' | 'context') => {
    setBusy(true);
    setMessage('');
    try {
      const result =
        action === 'export'
          ? await window.trueiris!.exportData()
          : action === 'context'
            ? await window.trueiris!.exportContext()
            : await window.trueiris!.deleteData();
      setMessage(
        result === 'failed'
          ? 'The data action failed. Check the API connection and retry.'
          : result === 'cancelled'
            ? 'Cancelled.'
            : result === 'saved'
              ? 'Export saved. Saving is now off.'
              : 'History deleted. Sensing and saving are now off.',
      );
      setStatus(await window.trueiris!.getStorage());
    } catch {
      setMessage('The data action failed. Please retry.');
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, message, toggle, manage };
}
export type StorageControls = ReturnType<typeof useStorage>;
export function storageLabel(status: StorageStatus | null) {
  if (!status) return 'Saving unavailable';
  if (!status.enabled) return 'Saving off';
  if (status.state === 'blocked') return 'Saving blocked · check connection';
  if (status.state === 'retrying')
    return `Saving interrupted · ${status.queued} queued`;
  return `Saving on · ${status.queued} queued`;
}
export function StoragePanel({ storage }: { storage: StorageControls }) {
  const { status, busy, message } = storage;
  return (
    <section className="settings-surface">
      <h2>Saved history</h2>
      <p className="muted">
        Saving is optional and starts off each time you open TrueIris. When
        enabled, normalized measurements and 30-second summaries go to your
        configured Tiger Data database. Desktop context intervals are also saved
        when their capture is enabled. Live and mock sources remain labeled.
        Camera frames are never saved.
      </p>
      <div className="settings-row">
        <span>{storageLabel(status)}</span>
        <button
          disabled={busy || !status?.configured}
          onClick={() => {
            void storage.toggle();
          }}
        >
          {status?.enabled ? 'Stop saving' : 'Enable saving'}
        </button>
      </div>
      {!status?.configured && (
        <p className="muted">
          A private API connection must be configured before saving is
          available.
        </p>
      )}
      <div className="settings-row">
        <span>Data retention</span>
        <span>Saved history stays until you delete it</span>
      </div>
      <p className="muted">
        Stopping saving discards unsent records. During outages, up to 300
        readings and 120 context intervals wait in memory with bounded retries.
        Closing the app discards the remaining queue.
      </p>
      <p className="muted" data-testid="storage-counts">
        {status?.saved ?? 0} saved this launch · {status?.dropped ?? 0}{' '}
        discarded or unconfirmed
      </p>
      <div className="settings-row">
        <span>Export all measurements as JSON Lines</span>
        <button
          disabled={busy || !status?.configured}
          onClick={() => {
            void storage.manage('export');
          }}
        >
          Export history
        </button>
      </div>
      <p className="muted">
        Export turns saving off. It includes timestamps, session IDs,
        provenance, confidence and quality. Summaries can be recalculated from
        these observations.
      </p>
      <div className="settings-row">
        <span>Export desktop context as JSON Lines</span>
        <button
          disabled={busy || !status?.configured}
          onClick={() => {
            void storage.manage('context');
          }}
        >
          Export context
        </button>
      </div>
      <div className="settings-row">
        <span>Remove saved measurements, summaries and desktop context</span>
        <button
          disabled={busy || !status?.configured}
          onClick={() => {
            void storage.manage('delete');
          }}
        >
          Delete history
        </button>
      </div>
      {message && <p aria-live="polite">{message}</p>}
    </section>
  );
}
