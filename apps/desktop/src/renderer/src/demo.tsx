import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { DemoDataset, DemoOutcome } from '@trueiris/schemas';
export function useDemo(enabled: boolean) {
  const [result, setResult] = useState<DemoOutcome | null>(null),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const request = useCallback(
    async (prepare = false) => {
      if (!enabled) return;
      const version = ++generation.current;
      setBusy(true);
      try {
        const response = await (prepare
          ? window.trueiris!.prepareDemo()
          : window.trueiris!.getDemo());
        if (version === generation.current) setResult(response);
      } catch {
        if (version === generation.current)
          setResult({ state: 'unavailable', data: null });
      } finally {
        if (version === generation.current) setBusy(false);
      }
    },
    [enabled],
  );
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void Promise.resolve().then(() => request());
    const timer = window.setInterval(() => {
      void request();
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      invalidate();
    };
  }, [enabled, request, invalidate]);
  return {
    result,
    busy,
    refresh: () => request(),
    prepare: () => request(true),
  };
}
export type DemoControls = ReturnType<typeof useDemo>;
const notices: Record<Exclude<DemoOutcome['state'], 'ready'>, string> = {
  preparing: 'Preparing the sample history…',
  empty: 'Sample history has been cleared. Prepare it again in Diagnostics.',
  unavailable: 'Sample history is temporarily unavailable. Check Diagnostics.',
  not_configured:
    'Connect the dedicated demo API in Diagnostics to show sample history.',
  unauthorized: 'Demo history access needs attention in Diagnostics.',
  disabled:
    'Start both the API and desktop in demo mode to show sample history.',
};
export function DemoBanner({ demo }: { demo: DemoControls }) {
  return (
    <aside className="demo-banner" aria-label="Demo provenance">
      <strong>Demo mode</strong>
      <span>
        Historical samples are generated. Current camera and desktop
        observations keep their actual source.
      </span>
      <NavLink to="/settings">Diagnostics</NavLink>
      {demo.result?.state !== 'ready' && (
        <p role="status">
          {demo.result ? notices[demo.result.state] : 'Loading sample history…'}
        </p>
      )}
    </aside>
  );
}
export function DemoHome({ demo }: { demo: DemoControls }) {
  const data = demo.result?.state === 'ready' ? demo.result.data : null;
  const dates = data
    ? [...new Set(data.episodes.map((e) => e.range.start.slice(0, 10)))]
        .sort()
        .reverse()
    : [];
  return (
    <div className="demo-home">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TRUEIRIS · PRESENTATION</p>
          <h1>A moment becomes a pattern.</h1>
          <p className="muted">
            Start with a live signal, then explore a week of clearly labeled
            sample history.
          </p>
        </div>
      </div>
      <div className="demo-cards">
        <NavLink className="demo-card" to="/live">
          <span className="eyebrow">01 · CURRENT</span>
          <h2>Connect your moment.</h2>
          <p>
            Try Presage camera measurements and real desktop context. Sensing
            starts only when you choose; any sensor fallback stays labeled
            simulated.
          </p>
        </NavLink>
        <NavLink className="demo-card" to="/timeline">
          <span className="eyebrow">02 · SEEDED HISTORY</span>
          <h2>See the shape of a day.</h2>
          <p>
            Recorded activity, physiological trends, gaps and personal baseline
            comparisons in generated sample history.
          </p>
        </NavLink>
        <NavLink className="demo-card" to="/ask-iris">
          <span className="eyebrow">03 · EVIDENCE</span>
          <h2>Ask Iris what happened.</h2>
          <p>
            Explore sample history with example questions and cited answers.
            Start voice when you choose to hear Iris’s explanation.
          </p>
        </NavLink>
        <NavLink className="demo-card" to="/experiments">
          <span className="eyebrow">04 · COMPARISON</span>
          <h2>A small question.</h2>
          <p>
            Seven fictional Music / No Music sessions demonstrate ratings,
            thresholds and uncertainty.
          </p>
        </NavLink>
      </div>
      {data && (
        <section className="timeline-details" aria-label="Sample week">
          <h2>One sample week, several perspectives.</h2>
          <p className="muted">
            {data.measurementCount.toLocaleString()} generated readings ·{' '}
            {data.episodes.length} sample periods · UTC. Prepared{' '}
            {new Date(data.generatedAt).toLocaleString()}. These are
            illustrative sessions, not your personal past.
          </p>
          <div className="demo-days">
            {dates.map((date) => (
              <NavLink key={date} to={`/timeline?day=${date}`}>
                {date}
              </NavLink>
            ))}
          </div>
          <NavLink className="text-link" to="/patterns">
            Explore the sample patterns →
          </NavLink>
        </section>
      )}
    </div>
  );
}
export function DemoPatterns({ data }: { data: DemoDataset | null }) {
  return (
    <div className="demo-patterns">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SEEDED SAMPLE · OBSERVED ASSOCIATIONS</p>
          <h1>Notice what repeats.</h1>
          <p className="muted">
            Illustrative cards computed from generated sessions. They are not
            personal findings or medical conclusions.
          </p>
        </div>
      </div>
      {!data ? (
        <p>
          Sample patterns will appear when preparation finishes. Check
          Diagnostics if history is unavailable.
        </p>
      ) : (
        <div className="demo-cards">
          {data.patterns.map((p) => (
            <article className="demo-card" key={p.title}>
              <span className="pill">demo_seed · illustrative</span>
              <h2>{p.title}</h2>
              <p>{p.description}</p>
              <p className="muted">
                {p.sessionCount} sample sessions across {p.dayCount} UTC dates.
              </p>
              <details>
                <summary>Show the recorded sample evidence</summary>
                <ul>
                  {p.episodeIds.map((id) => {
                    const e = data.episodes.find((e) => e.id === id)!;
                    return (
                      <li key={id}>
                        <NavLink
                          to={`/timeline?day=${e.range.start.slice(0, 10)}`}
                        >
                          {e.title} · {e.range.start.slice(0, 10)}
                        </NavLink>
                        <p>{e.summary}</p>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
export function DemoDiagnostics({ demo }: { demo: DemoControls }) {
  return (
    <section className="settings-surface" aria-label="Demo diagnostics">
      <h2>Dedicated demo</h2>
      <p>
        Sample data and current recordings use a separate demo identity. Leaving
        demo mode returns to your ordinary account. Current readings are never
        relabeled as sample history.
      </p>
      <p role="status">
        {demo.result?.state === 'ready'
          ? `Sample history ready · ${demo.result.data.measurementCount} generated readings`
          : demo.result
            ? notices[demo.result.state]
            : 'Checking sample history…'}
      </p>
      <p className="muted">
        Prepare refreshes the managed sample history and example experiment.
        Independent experiments and live/mock recordings are preserved. No
        camera, microphone or desktop capture starts.
      </p>
      <button
        className="sensor-button"
        disabled={demo.busy || demo.result?.state === 'preparing'}
        onClick={() => void demo.prepare()}
      >
        Prepare sample history
      </button>
      <button
        className="sensor-button"
        disabled={demo.busy}
        onClick={() => void demo.refresh()}
      >
        Check sample history
      </button>
      <NavLink className="text-link" to="/demo">
        Return to presentation →
      </NavLink>
    </section>
  );
}
