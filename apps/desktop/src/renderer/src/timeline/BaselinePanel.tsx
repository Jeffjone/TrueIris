import { useRef, useState, useEffect } from 'react';
import {
  activitySchema,
  baselineContextSchema,
  type BaselineContext,
  type BaselineResult,
  type TimelineQuery,
} from '@trueiris/schemas';
import { metrics } from './presentation';

export function BaselinePanel({
  range,
  zone,
}: {
  range: TimelineQuery;
  zone: string;
}) {
  const [choice, setChoice] = useState('activity:Coding');
  const [result, setResult] = useState<BaselineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function compare() {
    const version = ++generation.current;
    setResult(null);
    setLoading(true);
    const [kind, value] = choice.split(':');
    const context: BaselineContext = baselineContextSchema.parse(
      kind === 'activity'
        ? { kind, activity: value }
        : { kind: 'time_of_day', period: value },
    );
    let response: BaselineResult;
    try {
      if (!window.trueiris) throw new Error('Desktop connection unavailable');
      response = await window.trueiris.getBaselines({
        range,
        context,
        timezone: zone,
        lookbackDays: 30,
      });
    } catch {
      response = { state: 'unavailable', data: null };
    }
    if (generation.current === version) {
      setResult(response);
      setLoading(false);
    }
  }
  return (
    <section className="timeline-details" aria-label="Personal baselines">
      <h2>Compare with your history</h2>
      <p className="muted">
        Compare accepted readings in this selected context with the preceding 30
        days of {range.source} history. At least 20 well-covered 30-second
        samples across 3 local dates are required.
      </p>
      <div className="timeline-toolbar">
        <label>
          Baseline context
          <select
            aria-label="Baseline context"
            value={choice}
            onChange={(e) => {
              generation.current++;
              setLoading(false);
              setResult(null);
              setChoice(e.target.value);
            }}
          >
            {activitySchema.options.map((a) => (
              <option key={a} value={`activity:${a}`}>
                {a}
              </option>
            ))}
            {['night', 'morning', 'afternoon', 'evening'].map((p, i) => (
              <option key={p} value={`time_of_day:${p}`}>
                {p} · {i * 6}:00–{(i + 1) * 6}:00 ({zone})
              </option>
            ))}
          </select>
        </label>
        <button
          className="sensor-button"
          disabled={loading}
          onClick={() => void compare()}
        >
          {loading ? 'Comparing…' : 'Compare baseline'}
        </button>
      </div>
      <div aria-live="polite">
        {result && result.state !== 'ready' && (
          <p>
            {result.state === 'not_configured'
              ? 'Connect saved history in Settings to calculate baselines.'
              : result.state === 'unauthorized'
                ? 'Baseline access needs attention. Check storage in Settings.'
                : 'Baselines are unavailable. Try again when storage is ready.'}
          </p>
        )}
        {result?.state === 'ready' && (
          <>
            <p className="muted">
              History: {result.data.historyStart} to {result.data.historyEnd}{' '}
              (excluded). Timezone: {zone}.
            </p>
            <div className="timeline-summary">
              {result.data.comparisons.map((c) => {
                const metric = metrics.find((m) => m.key === c.metric)!;
                return (
                  <div key={c.metric}>
                    <span>{metric.label}</span>
                    <strong>
                      {c.baseline === null ? '—' : c.baseline.toFixed(1)}{' '}
                      <small>{metric.unit} baseline</small>
                    </strong>
                    <p>
                      {c.sampleCount} historical samples · {c.dayCount} local
                      dates
                    </p>
                    {c.state === 'insufficient_history' ? (
                      <p>Insufficient history for this metric and context.</p>
                    ) : c.state === 'no_current_data' ? (
                      <p>No accepted readings in the selected context.</p>
                    ) : (
                      <>
                        <p>
                          Current {c.current!.toFixed(1)} {metric.unit} ·{' '}
                          {c.currentCount} accepted readings
                        </p>
                        <p>
                          {c.differenceAbsolute! > 0 ? '+' : ''}
                          {c.differenceAbsolute!.toFixed(1)} {metric.unit} from
                          baseline
                          {c.differencePercent === null
                            ? ' · percentage unavailable for a zero baseline'
                            : ` (${c.differencePercent > 0 ? '+' : ''}${c.differencePercent.toFixed(1)}%)`}
                        </p>
                      </>
                    )}
                    <p>
                      Evidence confidence: {Math.round(c.confidence * 100)}%
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="muted">
              Confidence describes historical support and measurement quality;
              it is not a health probability. Differences describe your
              recordings and do not diagnose stress or illness.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
