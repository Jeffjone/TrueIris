import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  voiceQuestion,
  type AgentResult,
  type VoiceOptions,
  type VoiceSnapshot,
  type VoiceIssue,
} from '@trueiris/schemas';
import { captureMicrophone, SpeechPlayback } from './audio';
const issueText: Record<VoiceIssue, string> = {
  not_configured:
    'Voice needs ElevenLabs and Gemini configuration. You can type your question below.',
  unavailable:
    'Voice could not connect or finish. You can use the transcript or type a question below.',
  unauthorized:
    'Voice access needs attention in Settings. Typed questions remain available.',
  busy: 'Iris is finishing another request. Try again shortly or use text.',
  timeout: 'Voice timed out. Try again or type your question.',
  permission_denied:
    'Microphone permission was denied. Allow it in system settings or use text.',
  no_microphone: 'No microphone is available. You can type your question.',
  invalid_audio: 'Microphone streaming stopped. Try again or use text.',
  playback_failed:
    'Speech could not play. The cited answer remains available below.',
};
export interface VoiceActions {
  phase: VoiceSnapshot['phase'];
  active: boolean;
  disabled: boolean;
  listen: () => Promise<void>;
  stop: () => void;
  finish: () => void;
}
export function VoiceControls({
  options,
  disabled,
  onQuestion,
  onResult,
  onActive,
  renderControl,
}: {
  options: VoiceOptions;
  disabled: boolean;
  onQuestion: (question: string) => void;
  onResult: (result: AgentResult | null) => void;
  onActive: (active: boolean) => void;
  renderControl?: (actions: VoiceActions) => ReactNode;
}) {
  const [phase, setPhase] = useState<VoiceSnapshot['phase']>('off'),
    [issue, setIssue] = useState<VoiceIssue | null>(null);
  const [partial, setPartial] = useState(''),
    [final, setFinal] = useState(''),
    [provider, setProvider] = useState('elevenlabs');
  const resources = useRef<{
    generation: number;
    id: string | null;
    starting: boolean;
    microphone: AbortController | null;
    player: SpeechPlayback | null;
  }>({
    generation: 0,
    id: null,
    starting: false,
    microphone: null,
    player: null,
  });
  const { source, timezone } = options;
  useEffect(() => {
    const resource = resources.current;
    const unsubscribe = window.trueiris!.onVoice((event) => {
      if (
        event.type === 'state' &&
        event.phase === 'connecting' &&
        resource.starting &&
        !resource.id
      )
        resource.id = event.sessionId;
      if (event.sessionId !== resource.id) return;
      const version = resource.generation;
      if (event.type === 'state') {
        setPhase(event.phase);
        setProvider(event.provider);
        if (!['listening', 'connecting'].includes(event.phase))
          resource.microphone?.abort();
      } else if (event.type === 'transcript') {
        if (event.final) {
          setPartial('');
          setFinal(event.text);
          onQuestion(voiceQuestion(event.text));
          resource.microphone?.abort();
        } else setPartial(event.text);
      } else if (event.type === 'answer') onResult(event.result);
      else if (event.type === 'audio') {
        try {
          resource.player?.push(event.pcm);
        } catch {
          resource.microphone?.abort();
          resource.player?.close();
          setPhase('error');
          setIssue('playback_failed');
          onActive(false);
          resource.id = null;
          void window.trueiris!.stopVoice();
        }
      } else if (event.type === 'end') {
        resource.microphone?.abort();
        resource.starting = false;
        if (event.reason === 'completed') {
          void resource.player?.finish().then(() => {
            if (version === resource.generation) {
              resource.id = null;
              setPhase('off');
              onActive(false);
              void window.trueiris!.stopVoice().catch(() => {});
            }
          });
        } else {
          resource.id = null;
          resource.player?.close();
          onActive(false);
          setPhase(event.reason === 'cancelled' ? 'off' : 'error');
          setIssue(event.reason === 'cancelled' ? null : event.reason);
        }
      }
    });
    return () => {
      resource.generation++;
      resource.starting = false;
      resource.id = null;
      resource.microphone?.abort();
      resource.player?.close();
      unsubscribe();
      onActive(false);
      void window.trueiris?.stopVoice().catch(() => {});
    };
  }, [source, timezone, onQuestion, onResult, onActive]);
  function stop() {
    const resource = resources.current;
    resource.generation++;
    resource.starting = false;
    resource.id = null;
    resource.microphone?.abort();
    resource.player?.close();
    setPhase('off');
    setIssue(null);
    onActive(false);
    void window.trueiris!.stopVoice().catch(() => {});
  }
  async function listen() {
    stop();
    const resource = resources.current,
      version = ++resource.generation;
    resource.starting = true;
    resource.microphone = new AbortController();
    setPartial('');
    setFinal('');
    setIssue(null);
    setPhase('connecting');
    onActive(true);
    onResult(null);
    try {
      // Resume playback from the user gesture, before network/permission awaits.
      resource.player = new SpeechPlayback();
      const started = await window.trueiris!.startVoice({ source, timezone });
      if (resource.generation !== version) return;
      resource.starting = false;
      if (
        started.phase !== 'listening' ||
        !started.sessionId ||
        started.issue
      ) {
        resource.player.close();
        setPhase('error');
        setIssue(started.issue ?? 'unavailable');
        onActive(false);
        return;
      }
      resource.id = started.sessionId;
      let seq = 0;
      await captureMicrophone(resource.microphone.signal, (pcm) => {
        if (resource.generation !== version || !resource.id) return;
        void window
          .trueiris!.sendVoiceAudio({ sessionId: resource.id, seq: seq++, pcm })
          .then((accepted) => {
            if (!accepted && resource.generation === version)
              resource.microphone?.abort();
          })
          .catch(() => {
            if (
              resource.generation === version &&
              !resource.microphone?.signal.aborted
            ) {
              stop();
              setPhase('error');
              setIssue('unavailable');
            }
          });
      });
      if (resource.generation === version) setPhase('listening');
    } catch (error) {
      if (
        resource.generation !== version ||
        resource.microphone?.signal.aborted
      )
        return;
      stop();
      setPhase('error');
      setIssue(
        error instanceof DOMException &&
          ['NotAllowedError', 'SecurityError'].includes(error.name)
          ? 'permission_denied'
          : error instanceof DOMException && error.name === 'NotFoundError'
            ? 'no_microphone'
            : 'unavailable',
      );
    }
  }
  const active = !['off', 'error'].includes(phase);
  function finish() {
    resources.current.microphone?.abort();
    const id = resources.current.id;
    if (id) void window.trueiris!.finishVoice(id);
    setPhase('transcribing');
  }
  const labels = {
    off: 'Microphone off',
    connecting: 'Preparing voice…',
    listening: 'Listening · pause when your question is complete',
    transcribing: 'Finishing transcription…',
    analyzing: 'Analyzing your question and retrieving evidence…',
    speaking: 'Iris is speaking · microphone off',
    error: 'Microphone off',
  };
  return (
    <section
      className={`iris-voice ${renderControl ? 'iris-home-voice' : ''}`}
      aria-label="Voice conversation"
    >
      {!renderControl && (
        <p className="muted">
          Start voice to share microphone audio with ElevenLabs for
          transcription. Your question and requested evidence go to Gemini; the
          cited answer goes to ElevenLabs for speech. Audio stays transient in
          TrueIris.
        </p>
      )}
      {renderControl ? (
        // These callbacks access resources only in user events, never in rendering.
        // eslint-disable-next-line react-hooks/refs
        renderControl({
          phase,
          active,
          disabled: disabled || phase === 'connecting',
          listen,
          stop,
          finish,
        })
      ) : (
        <div className="timeline-toolbar">
          <button
            className="sensor-button"
            type="button"
            disabled={disabled || phase === 'connecting'}
            onClick={() => void listen()}
          >
            {active ? 'Interrupt and ask' : 'Start voice'}
          </button>
          {phase === 'listening' && (
            <button className="sensor-button" type="button" onClick={finish}>
              Finish question
            </button>
          )}
          {active && (
            <button className="sensor-button" type="button" onClick={stop}>
              Stop voice
            </button>
          )}
        </div>
      )}
      <p role="status" className="voice-state">
        {labels[phase]}
        {provider === 'mock' && active
          ? ' · MOCK VOICE · simulated transcript and test tone'
          : ''}
      </p>
      {partial && <p aria-label="Partial transcript">{partial}</p>}
      {final && <p aria-label="Final transcript">{final}</p>}
      {issue && <p role="alert">{issueText[issue]}</p>}
    </section>
  );
}
