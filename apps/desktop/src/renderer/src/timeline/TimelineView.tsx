import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type {
  TimelineData,
  TimelineQuery,
  TimelineResult,
} from '@trueiris/schemas';
import {
  contextChanges,
  dateKey,
  dayBounds,
  metrics,
  timeLabel,
} from './presentation';
import { TimelineChart, type Selection } from './TimelineChart';
import { useTimeline } from './useTimeline';

function Notice({ result }: { result: TimelineResult | null }) {
  return (
    <section className="timeline-notice" aria-live="polite">
      <h2>
        {!result
          ? 'Loading saved history…'
          : result.state === 'not_configured'
            ? 'Connect your saved history.'
            : result.state === 'unauthorized'
              ? 'History access needs attention.'
              : 'Saved history is unavailable.'}
      </h2>
      <p className="muted">
        {result?.state === 'not_configured'
          ? 'Configure storage, then enable saving in Settings to build your timeline.'
          : result?.state === 'unauthorized'
            ? 'Check the storage connection in Settings.'
            : 'Try refreshing when the connection is ready. Saved history will appear when it can be retrieved.'}
      </p>
      <NavLink to="/settings" className="text-link">
        Open Settings →
      </NavLink>
    </section>
  );
}
function Summary({ data }: { data: TimelineData }) {
  return (
    <div className="timeline-summary">
      {metrics.map((m) => {
        const s = data.summary[m.key];
        return (
          <div key={m.key}>
            <span>{m.label}</span>
            <strong>
              {s.mean === null ? '—' : s.mean.toFixed(1)}{' '}
              <small>{m.unit}</small>
            </strong>
            <p>
              {s.count} accepted readings
              {s.confidence !== null
                ? ` · ${Math.round(s.confidence * 100)}% mean confidence`
                : ''}
            </p>
            {s.min !== null && (
              <p>
                Range {s.min.toFixed(1)}–{s.max!.toFixed(1)} {m.unit}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
function PeriodDetails({ data, zone }: { data: TimelineData; zone: string }) {
  const changes = contextChanges(data);
  return (
    <>
      <Summary data={data} />
      <p className="muted">
        {data.summary.count} saved readings · {data.summary.observedSeconds}{' '}
        recorded seconds · {data.summary.sessions} sensing sessions
      </p>
      <div className="timeline-context-details">
        <div>
          <h3>Activity & context</h3>
          <p className="muted">
            Manually selected activity. Application detection is off.
          </p>
          {data.activities.length === 0 ? (
            <p>No recorded activity in this period.</p>
          ) : (
            <ul>
              {data.activities.slice(0, 12).map((p) => (
                <li key={`${p.sessionId}:${p.start}`}>
                  <strong>{p.activity ?? 'Activity not recorded'}</strong>
                  <span>
                    {timeLabel(p.start, zone)} – {timeLabel(p.end, zone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.activities.length > 12 && (
            <p className="muted">
              {data.activities.length - 12} more periods. Select a shorter range
              to explore.
            </p>
          )}
          <p className="muted">
            {changes.length} recorded activity changes within this period.
          </p>
        </div>
        <div>
          <h3>Signal gaps</h3>
          <p className="muted">
            Blank chart regions have no saved observations. Each sensing session
            is shown separately.
          </p>
          {!data.gaps.length ? (
            <p>No internal gaps in the recorded signal.</p>
          ) : (
            <ul>
              {data.gaps.slice(0, 12).map((g) => (
                <li key={`${g.sessionId}:${g.start}:${g.kind}`}>
                  <strong>
                    {g.kind === 'missing'
                      ? 'No saved signal'
                      : 'Values withheld'}
                  </strong>
                  <span>
                    {timeLabel(g.start, zone)} – {timeLabel(g.end, zone)} ·{' '}
                    {((Date.parse(g.end) - Date.parse(g.start)) / 1000).toFixed(
                      0,
                    )}
                    s
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.gaps.length > 12 && (
            <p className="muted">
              {data.gaps.length - 12} more gaps. Select a shorter range to
              explore.
            </p>
          )}
        </div>
      </div>
      {data.limited && (
        <p className="timeline-warning">
          Display limit reached. The summary covers this whole range, but the
          chart and context list are partial. Choose a shorter period.
        </p>
      )}
    </>
  );
}
function TimelineDay({
  zone,
  now,
  source,
  setSource,
}: {
  zone: string;
  now: number;
  source: TimelineQuery['source'];
  setSource: (source: TimelineQuery['source']) => void;
}) {
  const day = dayBounds(now, zone);
  const [zoom, setZoom] = useState<Selection | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<Selection>({
    start: day.start,
    end: Math.max(day.start + 1, Math.min(now, day.end)),
  });
  const [revision, setRevision] = useState(0);

  const query: TimelineQuery = {
    start: new Date(zoom?.start ?? day.start).toISOString(),
    end: new Date(
      zoom?.end ?? Math.max(day.start + 1, Math.min(now, day.end)),
    ).toISOString(),
    source,
  };
  const { result, loading } = useTimeline(query, revision);
  const selectedQuery = selection
    ? {
        ...query,
        start: new Date(selection.start).toISOString(),
        end: new Date(selection.end).toISOString(),
      }
    : null;
  const details = useTimeline(selectedQuery, revision);
  const data = result?.state === 'ready' ? result.data : null;
  function select(value: Selection) {
    if (value.end <= value.start) return;
    setSelection(value);
    setDraft(value);
  }
  const start = Date.parse(query.start),
    end = Date.parse(query.end);
  return (
    <>
      <div className="timeline-toolbar">
        <label>
          History source
          <select
            aria-label="History source"
            value={source}
            onChange={(e) => {
              setSelection(null);
              setZoom(null);
              setDraft({
                start: day.start,
                end: Math.max(day.start + 1, Math.min(now, day.end)),
              });
              setSource(e.target.value as TimelineQuery['source']);
            }}
          >
            <option value="live">Live · Presage</option>
            <option value="mock">Mock · simulated</option>
            <option value="demo_seed">Demo seed · sample data</option>
          </select>
        </label>
        <button
          className="sensor-button"
          onClick={() => setRevision(revision + 1)}
          disabled={loading}
        >
          Refresh history
        </button>
        <button
          className="sensor-button"
          onClick={() => {
            setZoom(null);
            setSelection(null);
            setDraft({
              start: day.start,
              end: Math.max(day.start + 1, Math.min(now, day.end)),
            });
          }}
          disabled={!selection && !zoom}
        >
          Reset to Today
        </button>
      </div>
      <p className="timeline-provenance">
        {source === 'live'
          ? 'LIVE · PRESAGE'
          : source === 'mock'
            ? 'SIMULATED · MOCK HISTORY'
            : 'SAMPLE DATA · DEMO SEED'}
        <span>
          {timeLabel(start, zone)} – {timeLabel(end, zone)}
        </span>
      </p>
      {!data ? (
        <Notice result={result} />
      ) : data.summary.count === 0 ? (
        <section className="timeline-notice">
          <h2>
            No saved{' '}
            {source === 'live'
              ? 'live'
              : source === 'mock'
                ? 'mock'
                : 'demo seed'}{' '}
            readings in this period.
          </h2>
          <p className="muted">
            Enable saving in Settings and start a sensor to build history.
            Activity labels from Live are included in new readings while saving
            is on.
          </p>
          <NavLink className="text-link" to="/live">
            Back to Live →
          </NavLink>
        </section>
      ) : (
        <>
          <section className="timeline-surface" aria-label="Saved history">
            <div className="timeline-chart-heading">
              <h2>{!zoom ? 'Today, so far.' : 'A closer view.'}</h2>
              <span className="muted">
                {loading ? 'Refreshing…' : 'Saved readings · updates every 15s'}
              </span>
            </div>
            <p className="muted" id="timeline-instructions">
              Drag to select a period, or click to inspect a 30-second summary.
              Use arrow keys and Enter on the chart, or the period controls
              below.
            </p>
            <TimelineChart
              data={data}
              zone={zone}
              selection={selection}
              onSelect={select}
            />
            <div className="timeline-legend">
              <span className="missing">No saved signal</span>
              <span className="withheld">Values withheld</span>
              <span className="change">Activity change</span>
            </div>
            <p className="muted">
              Trends show 30-second means and min–max ranges on separate scales.
              Blank regions are unrecorded; gaps and sensing sessions are never
              joined. Withheld metrics stay empty.
            </p>
            <Summary data={data} />
            {data.limited && (
              <p className="timeline-warning">
                Display limit reached. This chart is partial; summaries cover
                the full range. Select a shorter period.
              </p>
            )}
          </section>
          <section className="timeline-details" aria-label="Period details">
            <h2>{selection ? 'Selected period' : 'Explore a period'}</h2>
            <form
              className="timeline-range"
              onSubmit={(e) => {
                e.preventDefault();
                select({
                  start: Math.max(start, draft.start),
                  end: Math.min(end, draft.end),
                });
              }}
            >
              <label>
                Period start{' '}
                <output>{timeLabel(Math.max(start, draft.start), zone)}</output>
                <input
                  aria-label="Period start"
                  aria-valuetext={timeLabel(Math.max(start, draft.start), zone)}
                  type="range"
                  min={0}
                  max={Math.floor((end - start) / 1000)}
                  step={1}
                  value={Math.min(
                    Math.floor((end - start) / 1000),
                    Math.max(0, (draft.start - start) / 1000),
                  )}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      start: start + Number(e.target.value) * 1000,
                    })
                  }
                />
              </label>
              <label>
                Period end{' '}
                <output>{timeLabel(Math.min(end, draft.end), zone)}</output>
                <input
                  aria-label="Period end"
                  aria-valuetext={timeLabel(Math.min(end, draft.end), zone)}
                  type="range"
                  min={0}
                  max={Math.ceil((end - start) / 1000)}
                  step={1}
                  value={Math.min(
                    (end - start) / 1000,
                    (draft.end - start) / 1000,
                  )}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      end: Math.min(end, start + Number(e.target.value) * 1000),
                    })
                  }
                />
              </label>
              <button
                className="sensor-button"
                disabled={draft.end <= draft.start}
              >
                Inspect period
              </button>
              <button
                className="sensor-button"
                type="button"
                disabled={!selection}
                onClick={() => {
                  if (selection) {
                    setZoom(selection);
                    setSelection(null);
                  }
                }}
              >
                Zoom to period
              </button>
            </form>
            {selection ? (
              <>
                <p className="timeline-selected-time">
                  {timeLabel(selection.start, zone)} –{' '}
                  {timeLabel(selection.end, zone)}
                </p>
                {details.result?.state === 'ready' ? (
                  details.result.data.summary.count === 0 ? (
                    <p>No saved observations in the selected period.</p>
                  ) : (
                    <PeriodDetails data={details.result.data} zone={zone} />
                  )
                ) : (
                  <Notice result={details.result} />
                )}
              </>
            ) : (
              <p className="muted">
                Choose a point or period for exact saved-reading counts,
                confidence, activity and gaps.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
export function TimelineView() {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [zone, setZone] = useState(localZone);
  const [source, setSource] = useState<TimelineQuery['source']>('live');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const zones = Array.from(
    new Set([localZone, 'UTC', ...Intl.supportedValuesOf('timeZone')]),
  );
  return (
    <div className="timeline-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE SHAPE OF YOUR DAY</p>
          <h1>Today’s timeline.</h1>
          <p className="muted">
            {new Intl.DateTimeFormat('en-US', {
              timeZone: zone,
              dateStyle: 'full',
            }).format(now)}
          </p>
        </div>
      </div>
      <div className="timeline-toolbar">
        <label>
          Display timezone
          <select
            aria-label="Display timezone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
      </div>
      <TimelineDay
        key={`${zone}:${dateKey(now, zone)}`}
        zone={zone}
        now={now}
        source={source}
        setSource={setSource}
      />
    </div>
  );
}
