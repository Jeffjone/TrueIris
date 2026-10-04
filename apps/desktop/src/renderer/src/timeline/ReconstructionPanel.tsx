import { useEffect, useRef, useState } from 'react';
import type { AgentResult, TimelineQuery } from '@trueiris/schemas';
import { AgentAnswer } from '../ask/AgentAnswer';
import { timeLabel } from './presentation';
export function ReconstructionPanel({
  range,
  timezone,
}: {
  range: TimelineQuery;
  timezone: string;
}) {
  const [result, setResult] = useState<AgentResult | null>(null),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    active = useRef(false);
  function cancel() {
    generation.current++;
    active.current = false;
    setBusy(false);
    void window.trueiris!.cancelIris().catch(() => {});
  }
  useEffect(
    () => () => {
      generation.current++;
      if (active.current) void window.trueiris!.cancelIris().catch(() => {});
    },
    [],
  );
  async function reconstruct() {
    const version = ++generation.current;
    active.current = true;
    setBusy(true);
    setResult(null);
    let response: AgentResult;
    try {
      response = await window.trueiris!.reconstructEvents({ range, timezone });
    } catch {
      response = { state: 'unavailable', data: null };
    }
    if (version !== generation.current) return;
    active.current = false;
    setBusy(false);
    setResult(response);
  }
  const events = result?.data?.evidence.find(
    (e) => e.tool === 'reconstruct_events',
  );
  return (
    <section className="timeline-details" aria-label="Event reconstruction">
      <h2>What happened here?</h2>
      <p className="muted">
        Reconstruct this selected period from saved observations. Your question
        and projected evidence go to Gemini. Window titles and raw media are
        excluded; unrecorded tasks and causes remain unknown.
      </p>
      <p>
        {timeLabel(Date.parse(range.start), timezone)} –{' '}
        {timeLabel(Date.parse(range.end), timezone)} · {range.source}
      </p>
      <button
        className="sensor-button"
        disabled={busy}
        onClick={() => void reconstruct()}
      >
        What happened here?
      </button>
      {busy && (
        <button className="sensor-button" onClick={cancel}>
          Cancel reconstruction
        </button>
      )}
      <p role="status">
        {busy
          ? 'Retrieving recorded events and assembling a narrative…'
          : result && !result.data
            ? result.state === 'not_configured'
              ? 'Connect Gemini and saved history in Settings.'
              : result.state === 'busy'
                ? 'Iris is finishing another request. Try again shortly.'
                : 'Reconstruction is unavailable. Try again when the connection is ready.'
            : ''}
      </p>
      {events && (
        <>
          <h3>Recorded sequence</h3>
          <ol className="reconstruction-events">
            {events.facts
              .filter((f) => !events.limitations.includes(f.id))
              .map((f) => (
                <li key={f.id}>
                  <time dateTime={f.range!.start}>
                    {timeLabel(Date.parse(f.range!.start), timezone)}
                  </time>
                  <span>{f.text}</span>
                </li>
              ))}
          </ol>
        </>
      )}
      {result && <AgentAnswer result={result} showTimeline={false} />}
    </section>
  );
}
