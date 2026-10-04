import { useCallback, useEffect, useRef, useState } from 'react';
import {
  experimentDefinitionSchema,
  experimentRecordSchema,
  type ExperimentAction,
  type ExperimentSnapshot,
  type ExperimentDefinition,
  type ExperimentMetric,
  type ExperimentDetail,
} from '@trueiris/schemas';
const metricInfo: Record<
  ExperimentMetric,
  { label: string; unit: string; threshold: number }
> = {
  session_duration: {
    label: 'Reported session duration',
    unit: 'minutes',
    threshold: 5,
  },
  focus_rating: {
    label: 'Self-reported focus',
    unit: 'rating points',
    threshold: 1,
  },
  pulse_deviation: {
    label: 'Pulse deviation from baseline',
    unit: 'percentage points',
    threshold: 10,
  },
  hrv_deviation: {
    label: 'HRV deviation from baseline',
    unit: 'percentage points',
    threshold: 10,
  },
};
const stateLabels = {
  insufficient_data: 'Insufficient data',
  observed_association: 'Observed association · difference is uncertain',
  meaningful_difference: 'Meaningful observed difference',
  no_meaningful_difference: 'No meaningful observed difference',
};
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
function SessionForm({
  detail,
  busy,
  onRecord,
}: {
  detail: ExperimentDetail;
  busy: boolean;
  onRecord: (action: ExperimentAction) => void;
}) {
  const [condition, setCondition] = useState(
      detail.experiment.definition.conditions[0],
    ),
    [start, setStart] = useState(() =>
      localInput(new Date(Date.now() - 1800_000)),
    ),
    [end, setEnd] = useState(() => localInput(new Date())),
    [rating, setRating] = useState(''),
    [notes, setNotes] = useState(''),
    [error, setError] = useState('');
  return (
    <form
      className="experiment-form"
      aria-label="Record experiment session"
      onSubmit={(e) => {
        e.preventDefault();
        let input;
        try {
          input = experimentRecordSchema.parse({
            condition,
            range: {
              start: new Date(start).toISOString(),
              end: new Date(end).toISOString(),
              source: detail.experiment.definition.source,
            },
            rating: rating ? Number(rating) : null,
            notes: notes.trim() || null,
          });
        } catch {
          setError(
            'Choose a valid past session range and optional rating from 1 to 5.',
          );
          return;
        }
        setError('');
        onRecord({ type: 'record', id: detail.experiment.id, input });
      }}
    >
      <h3>Record a session</h3>
      <p className="muted">
        Assign a condition to a completed period. Times use your computer’s
        timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Recording
        this session saves your condition, optional rating/notes and derived
        evidence. It does not start sensing.
      </p>
      <div className="experiment-grid">
        <label>
          Condition
          <select
            aria-label="Session condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            {detail.experiment.definition.conditions.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input
            aria-label="Session start"
            required
            type="datetime-local"
            step="1"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          End
          <input
            aria-label="Session end"
            required
            type="datetime-local"
            step="1"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label>
          Optional focus rating (1–5)
          <input
            aria-label="Session focus rating"
            type="number"
            min="1"
            max="5"
            step="1"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          />
        </label>
      </div>
      <label>
        Optional notes
        <textarea
          aria-label="Session notes"
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <button
        className="sensor-button"
        disabled={busy || detail.experiment.status !== 'active'}
      >
        Save session
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function ExperimentsView({ demo = false }: { demo?: boolean }) {
  const [snapshot, setSnapshot] = useState<ExperimentSnapshot | null>(null),
    [busy, setBusy] = useState(true),
    [notice, setNotice] = useState('');
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const [title, setTitle] = useState('Music vs No Music'),
    [hypothesis, setHypothesis] = useState(
      'Do my recorded sessions differ when I listen to music?',
    ),
    [first, setFirst] = useState('Music'),
    [second, setSecond] = useState('No Music'),
    [minimum, setMinimum] = useState(7),
    [source, setSource] = useState<ExperimentDefinition['source']>(
      demo ? 'demo_seed' : 'live',
    ),
    [timezone, setTimezone] = useState(() =>
      demo ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [activity, setActivity] =
      useState<ExperimentDefinition['activity']>('Coding');
  const [criteria, setCriteria] = useState<ExperimentDefinition['criteria']>([
    { metric: 'session_duration', meaningfulDifference: 5 },
    { metric: 'focus_rating', meaningfulDifference: 1 },
  ]);
  const DefinitionContainer = demo ? 'details' : 'div';
  const errors = {
    not_configured: 'Connect saved history in Settings to save experiments.',
    unauthorized: 'Experiment access needs attention in Settings.',
    unavailable:
      'Experiments are unavailable. Try again when the connection is ready.',
    conflict:
      'The session conflicts with this experiment. Check its status, condition, source, past range, session limit or overlapping sessions.',
    not_found:
      'This experiment or session is no longer available. Refresh the list.',
  };
  useEffect(() => {
    const version = ++generation.current;
    void window
      .trueiris!.experimentAction({ type: 'list' })
      .then((r) => {
        if (version !== generation.current) return;
        if (r.state === 'ready') setSnapshot(r.data);
        else
          setNotice(
            r.state === 'not_configured'
              ? 'Connect saved history in Settings to save experiments.'
              : 'Experiments are unavailable. Try again when the connection is ready.',
          );
        setBusy(false);
      })
      .catch(() => {
        if (version === generation.current) {
          setNotice('Experiments are unavailable. Try refreshing.');
          setBusy(false);
        }
      });
    return invalidate;
  }, [invalidate]);
  async function run(action: ExperimentAction) {
    if (busy) return;
    const version = ++generation.current;
    setBusy(true);
    setNotice('');
    try {
      const result = await window.trueiris!.experimentAction(action);
      if (version !== generation.current) return;
      if (result.state === 'ready') setSnapshot(result.data);
      else setNotice(errors[result.state]);
    } catch {
      if (version === generation.current) setNotice(errors.unavailable);
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  const detail = snapshot?.selected,
    definition = detail?.experiment.definition;
  return (
    <div className="experiments-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SMALL QUESTIONS · YOUR OWN EVIDENCE</p>
          <h1>Learn what works for you.</h1>
          <p className="muted">
            Compare condition-labeled sessions without turning observations into
            certainty.
          </p>
        </div>
      </div>
      {demo && (
        <p className="muted">
          Demo experiment ratings and condition assignments are fictional.
          Designed differences illustrate the comparison rules; they are not
          personal findings.
        </p>
      )}
      <p role="status" aria-label="Experiment status">
        {busy ? 'Loading or saving experiment evidence…' : notice}
      </p>
      <section className="timeline-details" aria-label="Your experiments">
        <h2>Your experiments</h2>
        <button
          className="sensor-button"
          disabled={busy}
          onClick={() => void run({ type: 'list' })}
        >
          Refresh experiments
        </button>
        {snapshot?.experiments.length ? (
          <ul className="experiment-list">
            {snapshot.experiments.map((e) => (
              <li key={e.id}>
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => void run({ type: 'get', id: e.id })}
                >
                  {e.definition.title}
                </button>
                <span>
                  {e.status} · {e.definition.source}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No saved experiments yet.</p>
        )}
      </section>
      <DefinitionContainer>
        {demo && (
          <summary className="text-link">Create another comparison</summary>
        )}
        <section className="timeline-details" aria-label="Define an experiment">
          <h2>Define an experiment</h2>
          <p className="muted">
            Set two conditions and practical difference thresholds before
            recording sessions. Definitions stay fixed; create a new experiment
            to change them. Music, time of day, walks or breaks can be compared.
            Conditions are selected by you.
          </p>
          <form
            className="experiment-form"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = experimentDefinitionSchema.safeParse({
                title,
                hypothesis,
                conditions: [first, second],
                minimumSessions: minimum,
                criteria,
                source,
                timezone,
                activity,
              });
              if (!parsed.success) {
                setNotice(
                  'Use distinct conditions, at least one measure, positive thresholds and a target of 6–200 sessions. Rating thresholds are at most four points.',
                );
                return;
              }
              void run({ type: 'create', definition: parsed.data });
            }}
          >
            <label>
              Title
              <input
                aria-label="Experiment title"
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Hypothesis
              <textarea
                aria-label="Experiment hypothesis"
                required
                maxLength={500}
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
              />
            </label>
            <div className="experiment-grid">
              <label>
                First condition
                <input
                  aria-label="First condition"
                  required
                  maxLength={60}
                  value={first}
                  onChange={(e) => setFirst(e.target.value)}
                />
              </label>
              <label>
                Second condition
                <input
                  aria-label="Second condition"
                  required
                  maxLength={60}
                  value={second}
                  onChange={(e) => setSecond(e.target.value)}
                />
              </label>
              <label>
                Minimum sessions
                <input
                  aria-label="Minimum sessions"
                  required
                  type="number"
                  min="6"
                  max="200"
                  value={minimum}
                  onChange={(e) => setMinimum(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="experiment-grid">
              <label>
                History source
                <select
                  aria-label="Experiment history source"
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  <option value="live">Live recordings</option>
                  <option value="mock">Mock · simulated</option>
                  <option value="demo_seed">Demo seed</option>
                </select>
              </label>
              <label>
                Comparison timezone
                <select
                  aria-label="Experiment timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {[
                    ...new Set([
                      timezone,
                      'UTC',
                      ...Intl.supportedValuesOf('timeZone'),
                    ]),
                  ].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
              <label>
                Baseline activity
                <select
                  aria-label="Experiment activity"
                  value={activity}
                  onChange={(e) =>
                    setActivity(e.target.value as typeof activity)
                  }
                >
                  {[
                    'Coding',
                    'Studying',
                    'Reading',
                    'Meeting',
                    'Break',
                    'Other',
                  ].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Measurement criteria and practical thresholds</legend>
              {(Object.keys(metricInfo) as ExperimentMetric[]).map((metric) => {
                const selected = criteria.find((c) => c.metric === metric),
                  info = metricInfo[metric];
                return (
                  <div className="experiment-criterion" key={metric}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={(e) =>
                          setCriteria(
                            e.target.checked
                              ? [
                                  ...criteria,
                                  {
                                    metric,
                                    meaningfulDifference: info.threshold,
                                  },
                                ]
                              : criteria.filter((c) => c.metric !== metric),
                          )
                        }
                      />
                      {info.label}
                    </label>
                    {selected && (
                      <label>
                        Meaningful difference ({info.unit})
                        <input
                          aria-label={`${info.label} threshold`}
                          required
                          type="number"
                          min="0.01"
                          max={metric === 'focus_rating' ? 4 : 2000}
                          step="0.01"
                          value={selected.meaningfulDifference}
                          onChange={(e) =>
                            setCriteria(
                              criteria.map((c) =>
                                c.metric === metric
                                  ? {
                                      ...c,
                                      meaningfulDifference: Number(
                                        e.target.value,
                                      ),
                                    }
                                  : c,
                              ),
                            )
                          }
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </fieldset>
            <p className="muted">
              Creating this definition saves it to your configured database. Raw
              media is not saved and experiments do not send data to Gemini.
            </p>
            <button className="sensor-button" disabled={busy}>
              Create experiment
            </button>
          </form>
        </section>
      </DefinitionContainer>
      {detail && definition && (
        <section className="timeline-details" aria-label="Experiment detail">
          <p className="eyebrow">
            {definition.source} · {detail.experiment.status} ·{' '}
            {definition.timezone}
          </p>
          <h2>{definition.title}</h2>
          <p>{definition.hypothesis}</p>
          <p>
            {detail.sessions.length} / {definition.minimumSessions} recorded
            sessions · baseline activity {definition.activity}
          </p>
          <div className="timeline-toolbar">
            {(['active', 'paused', 'completed'] as const)
              .filter((s) => s !== detail.experiment.status)
              .map((status) => (
                <button
                  className="sensor-button"
                  key={status}
                  disabled={busy}
                  onClick={() =>
                    void run({
                      type: 'status',
                      id: detail.experiment.id,
                      status,
                    })
                  }
                >
                  {status === 'active'
                    ? 'Resume experiment'
                    : status === 'paused'
                      ? 'Pause experiment'
                      : 'Complete experiment'}
                </button>
              ))}
            <button
              className="sensor-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void window
                  .trueiris!.exportExperiment(detail.experiment.id)
                  .then((r) =>
                    setNotice(
                      r === 'saved'
                        ? 'Experiment exported.'
                        : r === 'cancelled'
                          ? 'Export cancelled.'
                          : 'Export failed.',
                    ),
                  )
                  .catch(() => setNotice('Export failed.'))
                  .finally(() => setBusy(false));
              }}
            >
              Export experiment
            </button>
          </div>
          <p className="muted">
            Comparisons need the target number of eligible sessions, at least
            three per condition, and two local dates per condition. “Meaningful”
            means every observed between-condition pair exceeds your threshold;
            it is a practical description of these sessions, not statistical or
            medical certainty. Retrospective selection, context, order and other
            factors can confound associations.
          </p>
          <div className="experiment-results">
            {detail.comparisons.map((c) => (
              <article className="iris-evidence-card" key={c.metric}>
                <h3>{metricInfo[c.metric].label}</h3>
                <strong>{stateLabels[c.state]}</strong>
                <p>
                  Threshold: {c.threshold} {metricInfo[c.metric].unit}
                </p>
                {c.conditions.map((condition) => (
                  <p key={condition.condition}>
                    {condition.condition}:{' '}
                    {condition.mean === null
                      ? 'No eligible values'
                      : condition.mean.toFixed(2)}{' '}
                    · {condition.count} eligible sessions across{' '}
                    {condition.dayCount} dates
                    {condition.min === null
                      ? ''
                      : ` · observed range ${condition.min.toFixed(2)}–${condition.max!.toFixed(2)}`}
                  </p>
                ))}
                {c.difference !== null && (
                  <p>
                    {definition.conditions[1]} minus {definition.conditions[0]}:{' '}
                    {c.difference.toFixed(2)} {metricInfo[c.metric].unit}
                  </p>
                )}
                <p className="muted">
                  {c.state === 'insufficient_data'
                    ? 'Missing ratings, sparse accepted readings or unsupported baselines do not count as zero. More supported sessions are needed.'
                    : 'This describes observed associations. No causal effect, confidence interval or proof of an improvement is established.'}
                </p>
              </article>
            ))}
          </div>
          <SessionForm
            key={detail.experiment.id}
            detail={detail}
            busy={busy}
            onRecord={(action) => void run(action)}
          />
          <h3>Session evidence</h3>
          {detail.sessions.length === 0 ? (
            <p>No sessions recorded yet.</p>
          ) : (
            <ul className="experiment-sessions">
              {detail.sessions.map((s) => (
                <li key={s.id}>
                  <strong>{s.input.condition}</strong>
                  <p>
                    {new Date(s.input.range.start).toLocaleString('en-US', {
                      timeZone: definition.timezone,
                    })}{' '}
                    –{' '}
                    {new Date(s.input.range.end).toLocaleString('en-US', {
                      timeZone: definition.timezone,
                    })}{' '}
                    · {s.input.range.source}
                  </p>
                  <p>
                    {s.metrics.session_duration.toFixed(1)} reported minutes ·
                    rating {s.input.rating ?? 'not provided'} ·{' '}
                    {s.evidence.observedSeconds} seconds with saved physiology
                    {s.evidence.retrospective
                      ? ' · retrospectively selected'
                      : ''}
                  </p>
                  <p>
                    Pulse: {s.evidence.pulse.currentCount} accepted matching
                    readings · baseline {s.evidence.pulse.sampleCount} samples
                    across {s.evidence.pulse.dayCount} dates. HRV:{' '}
                    {s.evidence.hrv.currentCount} accepted matching readings ·
                    baseline {s.evidence.hrv.sampleCount} samples across{' '}
                    {s.evidence.hrv.dayCount} dates.
                  </p>
                  {s.input.notes && <p>{s.input.notes}</p>}
                  <details>
                    <summary>Remove this session</summary>
                    <button
                      className="sensor-button"
                      disabled={busy}
                      onClick={() =>
                        void run({
                          type: 'remove_session',
                          id: detail.experiment.id,
                          sessionId: s.id,
                        })
                      }
                    >
                      Confirm remove session
                    </button>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>Delete this experiment and its sessions</summary>
            <button
              className="sensor-button"
              disabled={busy}
              onClick={() =>
                void run({ type: 'remove', id: detail.experiment.id })
              }
            >
              Confirm delete experiment
            </button>
          </details>
        </section>
      )}
    </div>
  );
}
