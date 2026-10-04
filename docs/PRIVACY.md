# Privacy inventory

## Current capture

Camera sensing starts only after the user chooses Presage and clicks Start, with OS permission enforced on macOS. A persistent sidebar status and Stop control remain visible across routes. Native frames are processed inside the main-owned sensor worker and are not stored, logged, or sent through renderer IPC. The current normalized reading lives in memory; stopping clears it. Stop, reload, renderer crash, window close, and quit tear down the worker. Mock sensing is explicitly labeled, has `source: mock`, and uses no camera or Presage connection.

**Presage sensing includes off-device derived data:** the SDK automatically dispatches buffered vitals snapshots to Presage's analytics gateway, which forwards them to its LLM service. The documented payload includes allowlisted pulse, respiration, and HRV series plus session/request metadata. Presage documents no raw video/facial imagery transmission for this insight feature. TrueIris does not request or display vendor-generated insights. The pre-start UI discloses derived vitals transport. See [Presage insight data notice](https://smartspectra.presagetech.com/docs/llm-insights/).

Optional aggregate diagnostic telemetry is explicitly disabled with `enableTelemetry: false`; this does not disable insight requests. See [Presage telemetry documentation](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/). SDK model/runtime caches may exist outside the repo. External service retention is governed by Presage's policies, separately from TrueIris saving controls.

Keys remain in main/backend/worker configuration. The worker receives only its required Presage key through a private parent message and inherits an environment allowlist, excluding database and ingestion credentials. Strict schemas reject unknown event fields. Vendor free-text errors and raw native logs are discarded; application logs contain fixed lifecycle/error events and enums, not readings, SQL, URLs or credentials.

Manual activity remains explicitly user-selected, clears on reload, and is never logged. With Feature 5, a selected fixed label accompanies new measurements only while saving is enabled and is sent to the configured API/Tiger Data. It is included in exports and removed with measurement deletion; no previous history is relabeled. Feature 6 foreground application detection requires a separate explicit start. No microphone, OS foreground application, window title, screenshots, journal or questions are captured automatically. Renderer microphone permission is leased only to the trusted frame during an explicitly started voice turn; other permissions remain denied. Native camera permission is separate.

## Measurement storage

Feature 4 adds an independent **Enable saving** action in Settings. It starts off on every desktop launch. While enabled, canonical UTC measurements (about one per second) and 30-second aggregates go through the private authenticated API to Tiger Data. Records include user/session identifiers, source, session origin, pulse/respiration/HRV when available, confidence, talking, signal quality, and an optional manually selected activity label. Quality gaps and missing metrics are preserved; no camera frames or other media enter this pipeline. Session origins now form part of saved history when saving is enabled.

The bounded offline queue holds at most 300 measurements in memory. Overflow and exhausted retries are visible as discarded/unconfirmed observations. Stop saving drops queued data; it cannot undo a request that already committed. Stop sensing stops new capture and releases the camera, while queued observations can finish saving. Quit clears the remaining queue after releasing the camera. No durable measurement cache is written by TrueIris.

Retention is explicit: saved history stays until deleted. Settings offers native-dialog JSON Lines export, which pauses saving and includes all scoped measurements. Exports are personal data and remain wherever the user saves them. Delete asks for confirmation, stops sensing, context capture and saving, removes the user's measurements/aggregates/context intervals and both session types, and records a deletion watermark to block old-session replay. The minimal user UUID/watermark remains to enforce that protection. Exported files and provider backups are outside the application's deletion transaction. See [Tiger Data setup and controls](TIGER_DATA_SETUP.md).

Opening Timeline makes authenticated scoped history queries without activating sensing/saving. Source datasets stay separate. History responses exist only in renderer memory while the view is open; no disk cache is added. Display timezone is a local view choice. See [timeline behavior](TIMELINE.md).

## Integration inventory

| Information                                        | Activation                                         | Current persistence                                                | External destination                                                      |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Webcam frames                                      | Explicit Presage start + OS permission             | None in TrueIris                                                   | Processed locally; no imagery in documented insight transport             |
| Pulse, respiration, HRV, confidence, talking       | Camera sensing; separate opt-in for saving         | Transient reading; measurements/epochs only when saving is enabled | Presage automatic derived insights; configured API/Tiger Data when saving |
| Mock readings                                      | Explicit mock start; separate opt-in for saving    | Labeled `mock` measurements/epochs only when saving is enabled     | Configured API/Tiger Data when saving                                     |
| Foreground app / switches / idle / session / focus | Explicit context start; titles separately opted in | Transient; context intervals only while saving is enabled          | Configured API/Tiger Data only when saving                                |
| Manual activity                                    | User selection                                     | Transient choice; label on opted-in measurements/context           | Configured API/Tiger Data only when saving                                |
| Screen image                                       | Planned separate opt-in                            | None                                                               | Planned transient Gemini classification                                   |
| Microphone / spoken responses                      | Explicit Start voice + microphone permission       | None                                                               | ElevenLabs realtime STT / streaming TTS                                   |
| Questions and retrieved evidence                   | Explicit Ask Iris action                           | Request/view memory only                                           | Gemini; no private window titles or raw media                             |
| Journal and episodic summaries                     | Planned memory controls                            | None                                                               | Planned Tiger Data / Gemini                                               |

Future screen understanding requires explicit opt-in and discards pixels after classification. Logging must not serialize arbitrary provider events, prompts, screenshots, audio or configuration objects. No scraping is planned. See [sensor lifecycle](PRESAGE_SETUP.md) for quality gates, failure states and stop timing.

## Feature 6 desktop metadata

Desktop capture is independent of camera capture, starts off and has persistent status/Stop controls. Window-title capture and user-selected focus mode are off by default; title permission is distinct from app identity. Turning titles off scrubs current/in-flight data; prior explicitly saved history remains until deleted. No webpage DOM, keystroke contents, screenshots or browser history are collected. Metadata is read through bounded OS APIs/commands in an isolated worker without storage secrets; raw native output is discarded.

Context intervals are saved only with both context capture and saving enabled. They contain application, optional title, manual override, estimated fixed activity/confidence/reason, idle/session/switch statistics and focus flag with immutable UTC/source/session bounds. The 120-interval queue is memory-only and records no pre-consent history. Missing observations stay gaps; rule confidences do not establish a physical or emotional state. An explicit test context provider records only `mock` provenance. Timeline keeps sources separate and can show context without physiology.

The context JSON Lines export is separate from the measurement export and turns saving off. Titles and app history can be sensitive, including in locally saved exports. Delete removes both scoped histories with a replay barrier. Native title-permission prompts occur only from the user's opt-in action; unsupported desktop sessions remain visibly unavailable. See [desktop context privacy and support](DESKTOP_CONTEXT.md).

## Feature 8 historical comparison

Personal baselines query already saved physiology and, for activity comparisons, recorded manual labels or confident unambiguous desktop intervals. No new capture begins. The server owns identity, source datasets stay separate, and selected readings are excluded from historical baselines. Results remain in renderer memory and clear when selections/context change. Existing deletion removes all comparison inputs; no separate baseline cache is persisted. Confidence is an evidence-support heuristic, with explicit insufficient-history states. See [personal baselines](PERSONAL_BASELINES.md).

## Feature 9 questions and evidence

Sending a question from Ask Iris shares its text and requested projected evidence with Gemini, with disclosure before sending. No capture starts. Requested summaries can include accepted metrics, historical context application names, manual labels and baselines. Window titles, classification reasons, frames, screenshots and private credentials/owner IDs are excluded. TrueIris does not log or persist questions, answers, tool transcripts or thought signatures. They remain in request/view memory; navigation/reload/source changes/clear discard results, cancellation stops orchestration, and deletion cancels requests and removes history inputs. The provider is explicit, with no mock fallback. See [Gemini privacy and limits](GEMINI_AGENT.md).

## Feature 10 recent explanation

The dedicated action shares the same disclosure and provider privacy boundary as a typed question. It reads only the selected source, pinned recent window and bounded earlier evidence. The chart fetch remains within the authenticated timeline capability and does not send raw chart data to Gemini. Its highlight and narrative clear with the question/view; no narrative, chart snapshot, screenshot or voice recording is persisted. No extra capture or retention is introduced. See [recent explanation](RECENT_EXPLANATION.md).

## Feature 12 voice

Start voice discloses microphone transport to ElevenLabs, question/evidence transport to Gemini and answer transport to ElevenLabs. PCM, partial/final transcripts and playback buffers are transient; TrueIris does not persist or log them. The microphone stops before reasoning/speech. Stop/interruption, clear, source/timezone changes, navigation/reload/crash, close/quit, suspend/lock and deletion release capture/transport. Gemini remains the reasoning owner and receives the same evidence projection as text. Provider retention policies still apply; no provider zero-retention guarantee is implied. See [voice privacy, controls and validation](ELEVENLABS_VOICE.md).

## Feature 16 event reconstruction

An explicit question about a selected timeline period sends verified recorded-event facts to Gemini. No window titles, raw media, task contents or inferred intentions are sent. Narratives and sequences remain in request/view memory and clear on selection/source/timezone/navigation changes. Existing sensing, saving, scoped history and cancellation boundaries apply. See [event reconstruction](EVENT_RECONSTRUCTION.md).

## Feature 17 personal experiments

Creating a definition or recording a labeled session explicitly saves the hypothesis, conditions, criteria, status, optional rating/notes and an immutable snapshot of derived physiological evidence. It starts no sensing and sends no content to Gemini or ElevenLabs. Session recording is an explicit save independent of automatic observation saving. The server owns identity; experiment sources remain separate. Notes and ratings are never logged. Individual removal and global history deletion cover experiment records and snapshots; the history deletion watermark prevents old-range replay. Native JSON export includes this private metadata, disables automatic saving and uses private permissions. Previously exported files stay under your control. See [experiment controls, evidence and limitations](PERSONAL_EXPERIMENTS.md).

## Feature 19 generated demonstration history

Seeding uses a separate demo identity and fixed `demo_seed` provenance. It stores only generated vitals, desktop metadata without titles, authored sample summaries/patterns and fictional experiment ratings. No camera, provider call, user prompt or personal recording enters the generator. Clearing targets only that source and owner; refresh replaces only managed sample artifacts. Keyword retrieval of demo summaries is explicitly labeled and never returns real episodic memories. See [demo data controls](DEMO_DATA.md).

## Feature 20 explicit demo

The dedicated API binds its existing private token to a separate demo identity. Startup generates sample history, not capture. Main asserts its mode on private requests; the server rejects a mismatched client before operations. Camera, microphone, desktop context, titles and saving retain explicit controls. Demo-only Presage failure replacement stops the real provider, assigns a fresh mock session and visibly labels simulation; stop/lock/suspend/reload/quit cancel replacement. The presentation preserves capture/saving/provenance indicators while diagnostics show only safe availability states. Sample question evidence is qualified generated data; live providers still have their existing transport/retention boundaries. See [demo walkthrough and validation](DEMO_MODE.md).
