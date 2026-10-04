# Implementation milestones

Complete one feature, validate, review the diff, update documentation, commit, push, and check Git status before starting the next. Section 49 of the master brief controls priority when its feature numbering differs from the detailed sections.

| Priority | Slice                         | Acceptance gate                                                                                                                                           |
| -------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Foundation (completed)        | Desktop main/preload/renderer, routes, error boundary, status, API, strict typing, config/logging, checks and runnable production output                  |
| P0       | Presage sensor (completed)    | Genuine pulse from camera on demo machine; typed normalization; quality/error states; labeled mock provider; permission and native packaging verification |
| P0       | Live UI (completed)           | Dominant pulse; breathing/HRV when available; confidence; session/context; reliable reactive updates                                                      |
| P0       | Tiger persistence (completed) | Authenticated scoped ingestion; bounded batch/retry; idempotency; timestamp tests; epoch computation; migrations                                          |
| P0       | Timeline (completed)          | Trends/context/gaps; period selection; no invented readings; timezone handling                                                                            |
| P0       | Context engine (completed)    | Supported foreground app/idle provider; consent; interval segmentation; manual override; unsupported-platform fallback                                    |
| P0       | Personal baselines            | Activity/time-specific comparisons; minimum coverage/history; no medical thresholds; source-aware statistics                                              |
| P0       | Gemini agent                  | Allowlisted Zod tools, scoped SQL, bounded multi-step calls; every numeric claim backed by evidence                                                       |
| P0       | Explain last 30 minutes       | Metrics/context/baseline retrieval; narrative + evidence cards + timeline highlight; missing-history fallback                                             |
| P0       | ElevenLabs voice              | Explicit microphone start, partial/final STT, agent orchestration, streaming speech, text fallback; no renderer keys                                      |
| P1       | Semantic memory               | Session summaries, embedding model/dimension, scoped similarity retrieval with factual metadata                                                           |
| P1       | Patterns                      | Editorial evidence cards; sample counts, uncertainty, correlation language                                                                                |
| P1       | Focus mode                    | Goal, timer, switches, baseline comparison, completion summary                                                                                            |
| P1       | Event reconstruction          | Selected range → timestamped observations → grounded narrative                                                                                            |
| P1       | Demo data                     | Deterministic multi-day history marked `demo_seed`; targeted clear operation                                                                              |
| P1       | Demo mode                     | Explicit fallback with correct provenance; real sensing preferred; repeatable questions and visible diagnostic health                                     |
| P1       | Vultr deployment              | Docker runtime, TLS/auth, health/readiness, managed database, reproducible deployment instructions                                                        |
| P2       | Experiments                   | Conditions, minimum sessions, self-report; association vs insufficient evidence                                                                           |
| P2       | Proactive insights            | Personal evidence, conservative cadence, user control                                                                                                     |
| P2       | Optional screen context       | Explicit opt-in, visible activation, temporary downscaled image, classification only, discard pixels                                                      |

Observability and privacy controls are implemented alongside each integration, with final end-to-end review before demo readiness. The initial read-only privacy page is not a substitute for working controls later.

## Demo gates

1. Camera → genuine Presage measurement is stable on the demo laptop.
2. Persisted data joins real context and meaningful personal baselines.
3. Voice question → Gemini tools → Tiger evidence → spoken explanation works repeatedly.
4. Historical seeded content is labeled internally and clearly explained in the demo.
5. API failures, poor signal, permission denial, and missing history have useful UI states.
6. The full 90-second script runs repeatedly from a clean start without developer intervention.

## Deferred commands

The working migration command is `pnpm db:migrate`. Add `pnpm seed:demo` and `pnpm seed:clear` when their implementations exist. Do not advertise successful no-op commands. API deployment and desktop installer creation are separate features from compiling application output.

## Feature 2 verification

The built macOS Apple Silicon application produced a genuine live Presage pulse in the visible UI with accepted confidence, then stopped sensing successfully. A second session also confirmed accepted respiration and talking-state transitions; valid live HRV remains unverified. Unit tests cover normalization, provenance, quality gates, provider lifecycle, and mock failures. Desktop integration tests cover mock updates, routing, reload cleanup, missing credentials, withheld values, and native library loading. See [Presage setup](PRESAGE_SETUP.md). Native installer creation remains deferred; this milestone verifies runnable production bundles. Feature 3 adds the fuller live session/context experience.

## Feature 3 verification

The live view displays pulse, respiration, HRV, and per-metric confidence with explicit signal/failure states. A main-owned session start anchors duration across navigation; manual activity is labeled, and application context is explicitly off pending Feature 6. Automated checks cover realtime updates, stop/restart, clock boundaries, compact/narrow layouts, reduced motion, and visible Stop access. See [live view behavior](LIVE_VIEW.md).

## Feature 4 verification

Authenticated ingestion persists UTC measurements to a Timescale hypertable and updates scoped 30-second epochs atomically. Tests cover serialization, quality/missing values, ownership/provenance, idempotency, concurrency, rollback, queue caps/backoff, export and deletion replay protection. The built desktop is also verified with a mock provider against the real configured Tiger Data service using isolated fixture users. Saving remains opt-in and off on launch; no raw media is stored. See [Tiger Data setup](TIGER_DATA_SETUP.md).

## Feature 5 verification

Today shows saved activity periods, pulse/respiration/HRV trends, recorded manual context changes and signal gaps. Queries and display keep live/mock/demo-seed sources separate, honor local-day/DST boundaries, and expose exact selected-period evidence. Keyboard, drag and accessible period controls support selection and zoom. Unit/API tests, built desktop integration, real scoped Timescale SQL (including display limits), and built desktop → Tiger Data → timeline verification cover the feature. Automatic application detection remains off until Feature 6. See [timeline behavior](TIMELINE.md).

## Feature 6 verification

Desktop context adds explicit independent capture, foreground application/switch/idle/session state, opt-in titles, manual override and focus state. Conservative rules return activity/confidence/reason; unknown apps are low confidence and missing observations remain gaps. Immutable intervals are consent-scoped and persisted through the existing private pipeline. Timeline, context export and full-history deletion expose the evidence and controls. Validation includes classifier/lifecycle/contracts/API/queue tests, built mock desktop controls and context-only history, real scoped Timescale ownership/overlap/retry/pagination/clipping/deletion checks, and built desktop → Tiger Data → context overlay verification. Built native app detection and lock cleanup are verified on macOS; Windows/X11 native smoke checks remain platform-specific. See [desktop context](DESKTOP_CONTEXT.md).

## Feature 8 verification

Activity and local time-of-day baselines use earlier quality-filtered history with explicit sample/date support. Timeline selected periods expose comparisons and insufficient-history/no-current-data states through a private named bridge and scoped authenticated API. Arithmetic/contracts/API, built desktop and isolated real Timescale checks cover the feature. See [personal baselines](PERSONAL_BASELINES.md). Feature 7 screen capture remains unimplemented and off.
