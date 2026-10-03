# Privacy inventory

## Current capture

Camera sensing starts only after the user chooses Presage and clicks Start, with OS permission enforced on macOS. A persistent sidebar status and Stop control remain visible across routes. Native frames are processed inside the main-owned sensor worker and are not stored, logged, or sent through renderer IPC. TrueIris holds only the current normalized reading in memory; stopping clears it. Stop, reload, renderer crash, window close, and quit tear down the worker. Mock sensing is explicitly labeled, has `source: mock`, and uses no camera or Presage connection.

**Presage sensing includes off-device derived data:** the SDK automatically dispatches buffered vitals snapshots to Presage's analytics gateway, which forwards them to its LLM service. The documented payload includes allowlisted pulse, respiration, and HRV series plus session/request metadata. Presage documents no raw video/facial imagery transmission for this insight feature. TrueIris does not request or display vendor-generated insights. The pre-start UI discloses derived vitals transport. See [Presage insight data notice](https://smartspectra.presagetech.com/docs/llm-insights/).

Optional aggregate diagnostic telemetry is explicitly disabled with `enableTelemetry: false`; this does not disable insight requests. See [Presage telemetry documentation](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/). SDK model/runtime caches may exist outside the repo; TrueIris has no measurement database yet. External service retention is governed by Presage's policies, not the application's local no-storage behavior.

Keys remain in main/worker configuration. The worker receives only its required key through a private parent message, not the renderer bridge, and inherits an environment allowlist. Strict schemas reject unknown event fields. Vendor free-text errors and raw native logs are discarded; application logs contain lifecycle phase/provider/issue enums, not readings or credentials.

The configured API receives health requests only. No microphone, OS foreground application, window title, screenshots, journal entry, or user history is captured. Renderer permission requests remain denied; native camera permission is a separate main-owned operation.

## Integration inventory

| Information                                  | Activation                                    | Current persistence                       | External destination                                                         |
| -------------------------------------------- | --------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| Webcam frames                                | Explicit Presage start + OS camera permission | None in TrueIris                          | Processed locally; no imagery in documented insight transport                |
| Pulse, respiration, HRV, confidence, talking | Camera sensing enabled                        | Current normalized reading in memory only | Presage automatic insights include derived vitals; no TrueIris ingestion yet |
| Mock readings                                | Explicit mock selection/start                 | Current reading only, marked `mock`       | None                                                                         |
| Foreground application / idle / window title | Planned consent controls                      | None                                      | Planned scoped API/Tiger Data; titles omitted by default                     |
| Screen image                                 | Planned separate opt-in                       | None                                      | Planned transient Gemini classification                                      |
| Microphone / spoken responses                | Planned user-started voice                    | None                                      | Planned ElevenLabs streaming                                                 |
| Questions, journal, summaries, history       | Planned conversation/memory controls          | None                                      | Planned Tiger Data / Gemini                                                  |

Retention, export, and deletion controls must arrive with persistence. Future screen understanding requires explicit opt-in and discards pixels after classification. Logging must not serialize arbitrary provider events, prompts, screenshots, audio, or configuration objects. No scraping is planned. See [sensor setup and lifecycle](PRESAGE_SETUP.md) for quality gates, failure states, and stop timing.
