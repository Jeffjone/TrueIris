import { useEffect, useRef, useState } from 'react';
import type { AgentResult, AskQuery } from '@trueiris/schemas';

export const conversationMessages = {
  not_configured: 'Connect Iris in Settings to ask about your history.',
  unauthorized: 'Check the Iris connection in Settings, then try again.',
  unavailable: 'Iris could not connect. You can try again in a moment.',
  busy: 'Iris is finishing another request. Try again shortly.',
  cancelled: 'This request was cancelled or timed out.',
};

/** Shared text/voice answer state; cancelling prevents late private responses. */
export function useConversation(source: AskQuery['source'], timezone: string) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceRevision, setVoiceRevision] = useState(0);
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
  return {
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
  };
}
