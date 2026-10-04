import { useEffect, useRef, useState } from 'react';
import type { AgentResult, AskQuery } from '@trueiris/schemas';
import { VoiceControls } from '../voice/VoiceControls';
import { AgentAnswer } from './AgentAnswer';

export function AskView() {
  const [question, setQuestion] = useState(''),
    [source, setSource] = useState<AskQuery['source']>('live');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [result, setResult] = useState<AgentResult | null>(null),
    [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false),
    [voiceRevision, setVoiceRevision] = useState(0);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      void window.trueiris?.cancelIris().catch(() => {});
    },
    [],
  );
  async function ask(command = question) {
    if (!command.trim() || busy || voiceActive) return;
    setQuestion(command);
    const version = ++generation.current;
    setResult(null);
    setBusy(true);
    let response: AgentResult;
    try {
      response = await window.trueiris!.askIris({
        question: command,
        source,
        timezone,
      });
    } catch {
      response = { state: 'unavailable', data: null };
    }
    if (version === generation.current) {
      setResult(response);
      setBusy(false);
    }
  }
  function clear() {
    generation.current++;
    setResult(null);
    setBusy(false);
    setVoiceRevision((value) => value + 1);
    void window.trueiris?.cancelIris().catch(() => {});
  }
  const zones = Array.from(
    new Set([timezone, 'UTC', ...Intl.supportedValuesOf('timeZone')]),
  );
  const messages = {
    not_configured: 'Connect Gemini and saved history in Settings to ask Iris.',
    unauthorized:
      'Iris access needs attention. Check the private API connection in Settings.',
    unavailable:
      'Iris is unavailable. Your saved history remains available in Timeline.',
    busy: 'Iris is finishing another request. Try again shortly.',
    cancelled: 'This request was cancelled or timed out.',
  };
  return (
    <div className="ask-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVIDENCE FROM YOUR DAY</p>
          <h1>Ask about your day.</h1>
          <p className="muted">Explore your recordings with Iris.</p>
        </div>
      </div>
      <section className="settings-surface" aria-label="Ask Iris">
        <p className="muted">
          Sending a question shares it and requested summaries of your selected
          history with Gemini. Window titles, camera frames and screenshots are
          excluded. Questions and answers are kept in this view only. Voice can
          be started separately below.
        </p>
        <div className="timeline-toolbar">
          <label>
            History source
            <select
              aria-label="Iris history source"
              value={source}
              onChange={(e) => {
                clear();
                setSource(e.target.value as AskQuery['source']);
              }}
            >
              <option value="live">Live · Presage</option>
              <option value="mock">Mock · simulated</option>
              <option value="demo_seed">Demo seed · sample data</option>
            </select>
          </label>
          <label>
            History timezone
            <select
              aria-label="Iris timezone"
              value={timezone}
              onChange={(e) => {
                clear();
                setTimezone(e.target.value);
              }}
            >
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
        </div>
        <VoiceControls
          key={`${source}:${timezone}:${voiceRevision}`}
          options={{ source, timezone }}
          disabled={busy}
          onQuestion={setQuestion}
          onResult={setResult}
          onActive={setVoiceActive}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label className="ask-label" htmlFor="iris-question">
            Your question
          </label>
          <textarea
            id="iris-question"
            className="ask-input"
            maxLength={1500}
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="When was my pulse lowest today?"
            disabled={busy || voiceActive}
          />
          <div className="timeline-toolbar">
            <button
              className="sensor-button"
              type="submit"
              disabled={busy || voiceActive || !question.trim()}
            >
              {busy ? 'Retrieving evidence…' : 'Ask Iris'}
            </button>
            <button
              className="sensor-button"
              type="button"
              disabled={busy || voiceActive}
              onClick={() => void ask('Iris, explain the last 30 minutes.')}
            >
              Explain last 30 minutes
            </button>
            {busy && (
              <button className="sensor-button" type="button" onClick={clear}>
                Cancel request
              </button>
            )}
            <button
              className="sensor-button"
              type="button"
              onClick={() => {
                clear();
                setQuestion('');
              }}
            >
              Clear question & answer
            </button>
          </div>
        </form>
        <div role="status">
          {busy
            ? 'Analyzing your question and retrieving evidence.'
            : result && !result.data
              ? messages[result.state as keyof typeof messages]
              : ''}
        </div>
      </section>
      {result && <AgentAnswer result={result} />}
    </div>
  );
}
