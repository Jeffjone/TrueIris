# Privacy inventory

## Current capture

Camera sensing starts only after the user chooses Presage and clicks Start, with OS permission enforced on macOS. A persistent sidebar status and Stop control remain visible across routes. Native frames are processed inside the main-owned sensor worker and are not stored, logged, or sent through renderer IPC. The current normalized reading lives in memory; stopping clears it. Stop, reload, renderer crash, window close, and quit tear down the worker. Mock sensing is explicitly labeled, has `source: mock`, and uses no camera or Presage connection.

**Presage sensing includes off-device derived data:** the SDK automatically dispatches buffered vitals snapshots to Presage's analytics gateway, which forwards them to its LLM service. The documented payload includes allowlisted pulse, respiration, and HRV series plus session/request metadata. Presage documents no raw video/facial imagery transmission for this insight feature. TrueIris does not request or display vendor-generated insights. The pre-start UI discloses derived vitals transport. See [Presage insight data notice](https://smartspectra.presagetech.com/docs/llm-insights/).

Optional aggregate diagnostic telemetry is explicitly disabled with `enableTelemetry: false`; this does not disable insight requests. See [Presage telemetry documentation](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/). SDK model/runtime caches may exist outside the repo. External service retention is governed by Presage's policies, separately from TrueIris saving controls.

Keys remain in main/backend/worker configuration. The worker receives only its required Presage key through a private parent message and inherits an environment allowlist, excluding database and ingestion credentials. Strict schemas reject unknown event fields. Vendor free-text errors and raw native logs are discarded; application logs contain fixed lifecycle/error events and enums, not readings, SQL, URLs or credentials.

Manual activity remains explicitly user-selected, clears on reload, and is never logged. With Feature 5, a selected fixed label accompanies new measurements only while saving is enabled and is sent to the configured API/Tiger Data. It is included in exports and removed with measurement deletion; no previous history is relabeled. Foreground application detection remains off. No microphone, OS foreground application, window title, screenshots, journal or questions are captured automatically. Renderer permission requests remain denied; native camera permission is separate.

## Measurement storage

Feature 4 adds an independent **Enable saving** action in Settings. It starts off on every desktop launch. While enabled, canonical UTC measurements (about one per second) and 30-second aggregates go through the private authenticated API to Tiger Data. Records include user/session identifiers, source, session origin, pulse/respiration/HRV when available, confidence, talking, signal quality, and an optional manually selected activity label. Quality gaps and missing metrics are preserved; no camera frames or other media enter this pipeline. Session origins now form part of saved history when saving is enabled.

The bounded offline queue holds at most 300 measurements in memory. Overflow and exhausted retries are visible as discarded/unconfirmed observations. Stop saving drops queued data; it cannot undo a request that already committed. Stop sensing stops new capture and releases the camera, while queued observations can finish saving. Quit clears the remaining queue after releasing the camera. No durable measurement cache is written by TrueIris.

Retention is explicit: saved history stays until deleted. Settings offers native-dialog JSON Lines export, which pauses saving and includes all scoped measurements. Exports are personal data and remain wherever the user saves them. Delete asks for confirmation, stops sensing and saving, removes the user's measurements/aggregates/sessions, and records a deletion watermark to block old-session replay. The minimal user UUID/watermark remains to enforce that protection. Exported files and provider backups are outside the application's deletion transaction. See [Tiger Data setup and controls](TIGER_DATA_SETUP.md).

Opening Timeline makes authenticated scoped history queries without activating sensing/saving. Source datasets stay separate. History responses exist only in renderer memory while the view is open; no disk cache is added. Display timezone is a local view choice. See [timeline behavior](TIMELINE.md).

## Integration inventory

| Information                                  | Activation                                      | Current persistence                                                | External destination                                                      |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Webcam frames                                | Explicit Presage start + OS permission          | None in TrueIris                                                   | Processed locally; no imagery in documented insight transport             |
| Pulse, respiration, HRV, confidence, talking | Camera sensing; separate opt-in for saving      | Transient reading; measurements/epochs only when saving is enabled | Presage automatic derived insights; configured API/Tiger Data when saving |
| Mock readings                                | Explicit mock start; separate opt-in for saving | Labeled `mock` measurements/epochs only when saving is enabled     | Configured API/Tiger Data when saving                                     |
| Foreground app / idle / window title         | Planned consent controls                        | None                                                               | Planned scoped API/Tiger Data                                             |
| Manual activity                              | User selection                                  | Transient choice; label on opted-in measurements                   | Configured API/Tiger Data only when saving                                |
| Screen image                                 | Planned separate opt-in                         | None                                                               | Planned transient Gemini classification                                   |
| Microphone / spoken responses                | Planned user-started voice                      | None                                                               | Planned ElevenLabs streaming                                              |
| Questions, journal, summaries                | Planned conversation/memory controls            | None                                                               | Planned Tiger Data / Gemini                                               |

Future screen understanding requires explicit opt-in and discards pixels after classification. Logging must not serialize arbitrary provider events, prompts, screenshots, audio or configuration objects. No scraping is planned. See [sensor lifecycle](PRESAGE_SETUP.md) for quality gates, failure states and stop timing.
