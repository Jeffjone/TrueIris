import { useState } from 'react';
import { useConversation, conversationMessages } from './useConversation';
import type { AskQuery } from '@trueiris/schemas';
import { VoiceControls } from '../voice/VoiceControls';
import { AgentAnswer } from './AgentAnswer';

export function AskView({ demo = false }: { demo?: boolean }) {
  const [source, setSource] = useState<AskQuery['source']>(
    demo ? 'demo_seed' : 'live',
  );
  const [timezone, setTimezone] = useState(
    demo ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const {
    question,
    setQuestion,
    result,
    setResult,
    busy,
    voiceActive,
    setVoiceActive,
    voiceRevision,
    ask,
    clear,
  } = useConversation(source, timezone);
  const zones = Array.from(
    new Set([timezone, 'UTC', ...Intl.supportedValuesOf('timeZone')]),
  );
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
        {demo && (
          <>
            <p className="pill">
              demo_seed · generated historical evidence · UTC
            </p>
            <div className="demo-questions" aria-label="Demo example questions">
              {[
                'Iris, explain the last 30 minutes.',
                'Summarize today’s sample history and compare its coding pulse with the earlier coding baseline.',
                'Find sample coding episode summaries from history.',
              ].map((q) => (
                <button
                  className="sensor-button"
                  key={q}
                  disabled={busy || voiceActive}
                  onClick={() => void ask(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </>
        )}
        {!demo && (
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
        )}
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
              ? conversationMessages[
                  result.state as keyof typeof conversationMessages
                ]
              : ''}
        </div>
      </section>
      {result && <AgentAnswer result={result} />}
    </div>
  );
}
