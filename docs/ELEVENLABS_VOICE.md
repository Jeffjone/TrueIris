# ElevenLabs voice

Feature 12 adds an explicit voice turn to **Ask Iris**. Choose the history source and timezone, then click **Start voice** and allow microphone access. Partial text appears while listening. Pause to commit the question automatically, or click **Finish question**. The final transcript fills the existing question field, Gemini retrieves evidence with the existing tools, and the cited answer appears while ElevenLabs streams speech. Saying **“Iris, explain the last thirty minutes.”** invokes the existing recent explanation and highlights its timeline beside the spoken answer.

**Stop voice** cancels capture, reasoning and queued playback. **Interrupt and ask** stops the current turn and starts a new one. The microphone turns off before reasoning and speech; automatic speech interruption by speaking over Iris is not implemented. Typed questions remain available after stopping or after a voice failure. A speech failure preserves any already retrieved answer and citations.

## Configuration

Set these values in the ignored root `.env`; leave credentials out of `.env.example` and all `VITE_` variables:

```dotenv
ELEVENLABS_API_KEY=<your key>
ELEVENLABS_VOICE_ID=<an accessible voice ID>
TRUEIRIS_VOICE_PROVIDER=elevenlabs
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
```

The existing `GEMINI_API_KEY`, authenticated API token, server identity and saved-history database configuration are also needed for useful answers. Start with `pnpm dev`. Settings reports configuration availability; key presence does not prove authentication, model/voice access or available quota. Errors appear during an actual turn. Enable the account's realtime speech-to-text and text-to-speech permissions. On macOS, allow the running Electron application microphone access in System Settings; a packaged application will also require `NSMicrophoneUsageDescription` in its bundle metadata.

The backend uses [Scribe v2 realtime STT](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime), mono signed 16-bit little-endian PCM at 16 kHz, VAD commits and optional manual commit. [Streaming TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) uses the configured voice and model with mono PCM at 24 kHz. The default Flash model prioritizes response latency. A configured voice ID must be accessible to the API key.

## Transport and lifecycle

A local AudioWorklet batches microphone samples into 100 ms frames. Narrow, validated IPC carries them to Electron main, which owns the microphone permission lease and private API token. Main connects to authenticated `/voice/stream`; the API owns both ElevenLabs connections and the existing Gemini agent. No vendor key or temporary vendor token reaches the renderer. Remote transport requires HTTPS/WSS; local loopback HTTP/WS is supported. Browser origins and query parameters are rejected on the private WebSocket upgrade.

The server admits one voice turn at a time. Capture lasts at most 60 seconds, manual completion waits at most 10 seconds, and an overall 240-second deadline bounds a turn. Existing Gemini tool deadlines, evidence verification and source/owner scope still apply. TTS has a 120-second HTTP deadline and a 14.4 MB output limit. Audio frame sizes, sequence numbers, capture volume and transport buffers are bounded. Playback queues at most five minutes and starts before the response stream finishes. Frames already in flight when transcription commits are discarded.

Stop, new turn, clear, source/timezone changes, route exit, reload, renderer failure, window close, quit, system suspend/lock and history deletion release the voice transport. Renderer cleanup stops microphone tracks and pending playback. Only the trusted main frame with a current listening lease can request audio permission; camera, screen and other permissions stay denied. No always-on microphone is introduced.

## Privacy and validation

TrueIris holds raw audio, transcripts, questions, answers and tool results only in request/view memory. It writes no recordings, transcripts or voice cache and logs no audio, prompts or provider payloads. Microphone audio goes to ElevenLabs, the final question and requested projected evidence go to Gemini, and the verified answer goes to ElevenLabs. External retention is governed by those services. ElevenLabs' documented zero-retention option is account restricted and is not enabled by this integration; TrueIris' memory-only handling does not establish provider zero retention.

`TRUEIRIS_VOICE_PROVIDER=mock` is an explicit testing adapter with a simulated transcript and generated test tone, visibly labeled in the UI. It does not contact ElevenLabs and never substitutes automatically for a failed live provider. Chromium fake-device flags are used only by desktop integration tests; ordinary tests clear all developer provider credentials.

Run `pnpm check` and `pnpm test:integration` for automated protocol, adapter, cancellation, permission, fallback and built-desktop checks. With credentials configured, `pnpm test:voice` creates a synthetic spoken question in memory, sends it through real ElevenLabs STT, real Gemini tools over synthetic history, and real streaming TTS. It reports only pass/fail and event/evidence/audio counts. It never opens the microphone or sends private saved history. Actual microphone and speaker hardware still need an interactive acceptance check on the target machine.
