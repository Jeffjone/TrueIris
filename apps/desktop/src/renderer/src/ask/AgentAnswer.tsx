import type { AgentResult } from '@trueiris/schemas';
import { ExplanationTimeline } from './ExplanationTimeline';
export function AgentAnswer({
  result,
  showTimeline = true,
}: {
  result: AgentResult;
  showTimeline?: boolean;
}) {
  if (!result.data) return null;
  return (
    <section className="timeline-details" aria-label="Iris answer">
      <p className="eyebrow">
        {result.data.provider === 'mock'
          ? 'MOCK REASONING · DETERMINISTIC TEST PROVIDER'
          : 'GEMINI · YOUR SAVED EVIDENCE'}{' '}
        · {result.data.query.source}
      </p>
      {result.data.query.source === 'demo_seed' && (
        <p className="muted">
          This answer describes generated sample history, not your personal
          past.
        </p>
      )}
      <h2>
        {result.state === 'partial'
          ? 'An incomplete picture.'
          : 'What your recordings show.'}
      </h2>
      {result.data.answer.startsWith('Iris could not finish') && (
        <p className="muted">
          Iris could not finish this request. The retrieved evidence is shown
          below.
        </p>
      )}
      <div
        className={
          showTimeline && result.data.explanationRange
            ? 'iris-explanation-layout'
            : undefined
        }
      >
        {showTimeline && result.data.explanationRange && (
          <ExplanationTimeline
            key={`${result.data.asOf}:${result.data.query.source}`}
            range={result.data.explanationRange}
            timezone={result.data.query.timezone}
          />
        )}
        <div className="iris-narrative">
          {result.data.selectedFacts.map((fact) => (
            <p key={fact.id}>
              {fact.text}{' '}
              <a
                className="text-link"
                href={`#evidence-${fact.id.split('.')[0]}`}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(`evidence-${fact.id.split('.')[0]}`)
                    ?.scrollIntoView({ block: 'nearest' });
                }}
                aria-label={`Evidence for ${fact.id}`}
              >
                [{fact.id}]
              </a>
            </p>
          ))}
        </div>
      </div>
      <h3>Supporting evidence</h3>
      <div className="iris-evidence">
        {result.data.evidence.map((e) => (
          <article
            key={e.id}
            id={`evidence-${e.id}`}
            className="iris-evidence-card"
          >
            <h4>{e.title}</h4>
            <p className="muted">
              {e.status} · {result.data!.query.source}
              {e.range ? ` · ${e.range.start} – ${e.range.end}` : ''}
            </p>
            <p>{e.facts[0]!.text}</p>
            <details>
              <summary>Supporting facts ({e.facts.length})</summary>
              <ul>
                {e.facts.map((f) => (
                  <li key={f.id}>{f.text}</li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
