import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { VoiceControls, type VoiceActions } from '../voice/VoiceControls';
import { useConversation, conversationMessages } from '../ask/useConversation';
import { AgentAnswer } from '../ask/AgentAnswer';
import type { ContextControls } from '../components/ContextPanel';
import type { StorageControls } from '../components/StoragePanel';
import { activities, type Activity } from '../live/presentation';
import { BlobNavigation } from './BlobNavigation';

function IrisFace({ phase }: { phase: string }) {
  return (
    <span className={`iris-character iris-${phase}`} aria-hidden="true">
      <span className="iris-shine" />
      <span className="iris-face">
        <span className="iris-eye">
          <span className="iris-pupil" />
        </span>
        <span className="iris-eye">
          <span className="iris-pupil" />
        </span>
      </span>
      <span className="iris-cheek iris-cheek-left" />
      <span className="iris-cheek iris-cheek-right" />
      <span className="iris-smile" />
    </span>
  );
}

export function IrisHome({
  demo,
  context,
  storage,
  activity,
  onActivity,
}: {
  demo: boolean;
  context: ContextControls;
  storage: StorageControls;
  activity: Activity;
  onActivity: (activity: Activity) => void;
}) {
  const [engaged, setEngaged] = useState(false);
  const [mode, setMode] = useState<'talk' | 'record'>('talk');
  const [saveHistory, setSaveHistory] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const owners = useRef({ saving: false, recording: false, busy: false });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const recording = ['starting', 'running'].includes(
    context.snapshot?.phase ?? 'off',
  );
  const source = demo ? 'demo_seed' : 'live';
  const timezone = demo
    ? 'UTC'
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const conversation = useConversation(source, timezone);
  async function stopRecording() {
    if (owners.current.busy) return;
    owners.current.busy = true;
    setRecordBusy(true);
    try {
      const stopped = await context.action('stop');
      if (owners.current.saving) await storage.setEnabled(false);
      owners.current.saving = false;
      owners.current.recording = false;
      if (mounted.current && stopped?.phase === 'off') setEngaged(false);
    } finally {
      owners.current.busy = false;
      if (mounted.current) setRecordBusy(false);
    }
  }
  async function record() {
    if (owners.current.busy) return;
    if (recording) {
      await stopRecording();
      return;
    }
    owners.current.busy = true;
    setRecordBusy(true);
    setEngaged(true);
    setNotice('');
    try {
      if (saveHistory && !storage.status?.enabled) {
        const saved = await storage.setEnabled(true);
        if (!saved?.enabled) {
          setNotice(
            'History could not be enabled. Check Settings, then try again.',
          );
          return;
        }
        owners.current.saving = true;
      }
      if (!mounted.current) {
        if (owners.current.saving) await storage.setEnabled(false);
        owners.current.saving = false;
        return;
      }
      const started = await context.action('start');
      if (!mounted.current) {
        await context.action('stop');
        if (owners.current.saving) await storage.setEnabled(false);
        owners.current.saving = false;
        return;
      }
      if (!started || !['starting', 'running'].includes(started.phase)) {
        if (owners.current.saving) await storage.setEnabled(false);
        owners.current.saving = false;
        setNotice(
          'Activity could not start. You can check capture in Settings.',
        );
      } else owners.current.recording = true;
    } finally {
      owners.current.busy = false;
      if (mounted.current) setRecordBusy(false);
    }
  }
  function leave(voice: VoiceActions) {
    voice.stop();
    conversation.clear();
    setEngaged(false);
    setNotice('');
    if (owners.current.recording || owners.current.saving) void stopRecording();
  }
  return (
    <div className={`iris-home ${engaged ? 'iris-home-focused' : ''}`}>
      <header className="iris-welcome">
        <p className="eyebrow">A LITTLE COMPANY FOR YOUR DAY</p>
        <h1>
          Hi, I’m Iris
          <span className="welcome-sparkle" aria-hidden="true">
            {' '}
            ✳
          </span>
        </h1>
        <p>A place to talk, reflect, and notice the little things.</p>
      </header>
      <VoiceControls
        key={`${source}:${conversation.voiceRevision}`}
        options={{ source, timezone }}
        disabled={recordBusy}
        onQuestion={conversation.setQuestion}
        onResult={conversation.setResult}
        onActive={conversation.setVoiceActive}
        renderControl={(voice) => {
          const state =
            mode === 'record'
              ? recording
                ? 'recording'
                : 'off'
              : conversation.busy
                ? 'analyzing'
                : voice.phase;
          const title =
            mode === 'record'
              ? recording
                ? 'Stop activity recording'
                : 'Start activity recording'
              : conversation.busy
                ? 'Cancel request'
                : voice.phase === 'listening'
                  ? 'Finish question'
                  : voice.active
                    ? 'Stop voice'
                    : 'Talk to Iris';
          const caption =
            mode === 'record'
              ? recording
                ? 'Making a little memory'
                : 'Click to record activity'
              : voice.phase === 'listening'
                ? 'I’m listening. Click to finish.'
                : ['analyzing', 'transcribing'].includes(state)
                  ? 'Connecting the little dots…'
                  : state === 'speaking'
                    ? 'A little thought for you'
                    : engaged
                      ? 'Click to talk again'
                      : 'Click me to say hello';
          return (
            <>
              <div
                className={`iris-playground ${engaged ? 'iris-engaged' : ''}`}
              >
                <div className="iris-orbit-guide" aria-hidden="true" />
                <BlobNavigation orbital hidden={engaged} />
                <button
                  className="iris-primary"
                  type="button"
                  aria-label={title}
                  aria-describedby="iris-click-description"
                  aria-pressed={engaged}
                  disabled={voice.disabled || context.busy || recordBusy}
                  style={
                    {
                      '--gaze-x': `${gaze.x}px`,
                      '--gaze-y': `${gaze.y}px`,
                    } as CSSProperties
                  }
                  onPointerMove={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setGaze({
                      x: Math.max(
                        -6,
                        Math.min(
                          6,
                          (event.clientX - bounds.left - bounds.width / 2) / 20,
                        ),
                      ),
                      y: Math.max(
                        -4,
                        Math.min(
                          4,
                          (event.clientY - bounds.top - bounds.height / 2) / 25,
                        ),
                      ),
                    });
                  }}
                  onPointerLeave={() => setGaze({ x: 0, y: 0 })}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && engaged) leave(voice);
                  }}
                  onClick={() => {
                    setEngaged(true);
                    if (mode === 'record') void record();
                    else if (conversation.busy) conversation.clear();
                    else if (voice.phase === 'listening') voice.finish();
                    else if (voice.active) voice.stop();
                    else void voice.listen();
                  }}
                >
                  <IrisFace phase={state} />
                </button>
                <p className="iris-caption" aria-live="polite">
                  {caption}
                  <span>
                    {mode === 'record'
                      ? context.snapshot?.provider === 'mock'
                        ? 'SIMULATED DESKTOP ACTIVITY'
                        : recording
                          ? 'DESKTOP ACTIVITY ON'
                          : 'READY WHEN YOU ARE'
                      : 'YOUR LITTLE CONTEXT COMPANION'}
                  </span>
                </p>
              </div>
              <div
                className="iris-interaction-bar"
                role="group"
                aria-label="Iris interaction"
              >
                <button
                  type="button"
                  aria-pressed={mode === 'talk'}
                  disabled={voice.active || conversation.busy || recordBusy}
                  onClick={() => {
                    setMode('talk');
                    setNotice('');
                  }}
                >
                  Talk with Iris
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'record'}
                  disabled={voice.active || conversation.busy || recordBusy}
                  onClick={() => {
                    setMode('record');
                    setNotice('');
                  }}
                >
                  Record my activity
                </button>
              </div>
              {engaged && (
                <button
                  className="iris-done"
                  type="button"
                  disabled={recordBusy || context.busy}
                  onClick={() => leave(voice)}
                >
                  Done for now · show my views
                </button>
              )}
            </>
          );
        }}
      />
      <p className="iris-click-description" id="iris-click-description">
        {mode === 'talk'
          ? 'Clicking Iris starts your microphone. ElevenLabs transcribes and speaks; Gemini answers from selected history. Click again to finish or stop.'
          : 'Clicking Iris records your foreground app and idle state. Camera capture is separate. Stop by clicking Iris again.'}
      </p>
      {mode === 'record' && (
        <section
          className="iris-record-options"
          aria-label="Activity recording options"
        >
          <label>
            What are you doing?
            <select
              aria-label="Activity to record"
              value={activity}
              disabled={recordBusy}
              onChange={(e) => onActivity(e.target.value as Activity)}
            >
              <option value="">Let Iris use app context</option>
              {activities.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="iris-save-option">
            <input
              type="checkbox"
              checked={saveHistory}
              disabled={recordBusy || recording || !storage.status?.configured}
              onChange={(e) => setSaveHistory(e.target.checked)}
            />{' '}
            Save this activity to history
          </label>
          <p className="muted">
            {storage.status?.enabled
              ? 'Saving is already enabled. New activity will be saved.'
              : 'Saving is off unless you choose it.'}{' '}
            {context.snapshot?.options.windowTitles
              ? 'Window titles are enabled in Settings.'
              : 'Window titles and screenshots stay off.'}{' '}
            Saving includes other sensing you have already started. Camera
            frames are never saved.
          </p>
        </section>
      )}
      {(notice || (context.error && mode === 'record')) && (
        <p role="alert" className="iris-notice">
          {notice || context.error}
        </p>
      )}
      {engaged && mode === 'talk' && (
        <section className="iris-chat" aria-label="Talk with Iris">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void conversation.ask();
            }}
          >
            <label htmlFor="iris-home-question">Prefer a little note?</label>
            <div className="iris-text-entry">
              <input
                id="iris-home-question"
                maxLength={1500}
                value={conversation.question}
                onChange={(e) => conversation.setQuestion(e.target.value)}
                disabled={conversation.busy || conversation.voiceActive}
                placeholder="What did you notice about my day?"
              />
              <button
                type="submit"
                disabled={
                  !conversation.question.trim() ||
                  conversation.busy ||
                  conversation.voiceActive
                }
              >
                Send ↗
              </button>
            </div>
          </form>
          <button
            className="iris-suggestion"
            disabled={conversation.busy || conversation.voiceActive}
            onClick={() =>
              void conversation.ask('Iris, explain the last 30 minutes.')
            }
          >
            Explain my last 30 minutes
          </button>
          <div role="status">
            {conversation.busy
              ? 'Iris is looking through your selected history…'
              : conversation.result && !conversation.result.data
                ? conversationMessages[
                    conversation.result
                      .state as keyof typeof conversationMessages
                  ]
                : ''}
          </div>
          {demo && (
            <p className="muted">
              Answers use generated sample history, not your personal past.
            </p>
          )}
        </section>
      )}
      {conversation.result && <AgentAnswer result={conversation.result} />}
      {demo && !engaged && (
        <NavLink className="iris-sample-link" to="/demo">
          Explore your sample week ↗
        </NavLink>
      )}
    </div>
  );
}
