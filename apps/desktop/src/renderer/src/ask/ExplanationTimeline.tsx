import { useEffect, useState } from 'react';
import type { TimelineQuery, TimelineResult } from '@trueiris/schemas';
import { TimelineChart, type Selection } from '../timeline/TimelineChart';

/** Fetch the exact narrated window once; later observations cannot silently refresh the explanation chart. */
export function ExplanationTimeline({
  range,
  timezone,
}: {
  range: TimelineQuery;
  timezone: string;
}) {
  const [result, setResult] = useState<TimelineResult | null>(null);
  const whole = { start: Date.parse(range.start), end: Date.parse(range.end) };
  const [selection, setSelection] = useState<Selection>(whole);
  useEffect(() => {
    let active = true;
    void window
      .trueiris!.getTimeline(range)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active) setResult({ state: 'unavailable', data: null });
      });
    return () => {
      active = false;
    };
  }, [range]);
  const format = (time: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(time));
  return (
    <section
      className="timeline-surface explanation-timeline"
      aria-label="Explanation timeline"
    >
      <h3>Highlighted explanation period</h3>
      <p className="muted">
        {format(range.start)} – {format(range.end)} · {timezone} ·{' '}
        {range.source}
      </p>
      <p className="muted">
        The highlighted 30-minute window ends when you asked Iris. Gaps
        represent unknown time.
      </p>
      {!result && <p role="status">Loading the explanation timeline…</p>}
      {result?.state === 'ready' && (
        <>
          <p id="timeline-instructions" className="muted">
            Drag to inspect a shorter period. Use arrow keys and Enter to select
            recorded epochs.
          </p>
          <TimelineChart
            data={result.data}
            zone={timezone}
            selection={selection}
            onSelect={setSelection}
            label="Explanation timeline chart"
          />
          <button className="sensor-button" onClick={() => setSelection(whole)}>
            Highlight all 30 minutes
          </button>
          {result.data.summary.count === 0 && (
            <p className="muted">No saved measurements in this window.</p>
          )}
          {result.data.limited && (
            <p className="muted">
              Timeline detail is limited; the narrative states the available
              evidence.
            </p>
          )}
        </>
      )}
      {result && result.state !== 'ready' && (
        <p role="status">
          The explanation timeline could not be loaded. The retrieved evidence
          remains below.
        </p>
      )}
    </section>
  );
}
