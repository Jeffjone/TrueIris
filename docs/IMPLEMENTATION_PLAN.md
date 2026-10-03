# Implementation milestones

Complete one feature, validate, review the diff, update documentation, commit, push, and check Git status before starting the next. Section 49 of the master brief controls priority when its feature numbering differs from the detailed sections.

| Priority | Slice                    | Acceptance gate                                                                                                                                           |
| -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Foundation (this change) | Desktop main/preload/renderer, routes, error boundary, status, API, strict typing, config/logging, checks and runnable production output                  |
| P0       | Presage sensor           | Genuine pulse from camera on demo machine; typed normalization; quality/error states; labeled mock provider; permission and native packaging verification |
| P0       | Live UI                  | Dominant pulse; breathing/HRV when available; confidence; session/context; reliable reactive updates                                                      |
| P0       | Tiger persistence        | Authenticated scoped ingestion; bounded batch/retry; idempotency; timestamp tests; epoch computation; migrations                                          |
| P0       | Timeline                 | Trends/context/gaps; period selection; no invented readings; timezone handling                                                                            |
| P0       | Context engine           | Supported foreground app/idle provider; consent; interval segmentation; manual override; unsupported-platform fallback                                    |
| P0       | Personal baselines       | Activity/time-specific comparisons; minimum coverage/history; no medical thresholds; source-aware statistics                                              |
| P0       | Gemini agent             | Allowlisted Zod tools, scoped SQL, bounded multi-step calls; every numeric claim backed by evidence                                                       |
| P0       | Explain last 30 minutes  | Metrics/context/baseline retrieval; narrative + evidence cards + timeline highlight; missing-history fallback                                             |
| P0       | ElevenLabs voice         | Explicit microphone start, partial/final STT, agent orchestration, streaming speech, text fallback; no renderer keys                                      |
| P1       | Semantic memory          | Session summaries, embedding model/dimension, scoped similarity retrieval with factual metadata                                                           |
| P1       | Patterns                 | Editorial evidence cards; sample counts, uncertainty, correlation language                                                                                |
| P1       | Focus mode               | Goal, timer, switches, baseline comparison, completion summary                                                                                            |
| P1       | Event reconstruction     | Selected range → timestamped observations → grounded narrative                                                                                            |
| P1       | Demo data                | Deterministic multi-day history marked `demo_seed`; targeted clear operation                                                                              |
| P1       | Demo mode                | Explicit fallback with correct provenance; real sensing preferred; repeatable questions and visible diagnostic health                                     |
| P1       | Vultr deployment         | Docker runtime, TLS/auth, health/readiness, managed database, reproducible deployment instructions                                                        |
| P2       | Experiments              | Conditions, minimum sessions, self-report; association vs insufficient evidence                                                                           |
| P2       | Proactive insights       | Personal evidence, conservative cadence, user control                                                                                                     |
| P2       | Optional screen context  | Explicit opt-in, visible activation, temporary downscaled image, classification only, discard pixels                                                      |

Observability and privacy controls are implemented alongside each integration, with final end-to-end review before demo readiness. The initial read-only privacy page is not a substitute for working controls later.

## Demo gates

1. Camera → genuine Presage measurement is stable on the demo laptop.
2. Persisted data joins real context and meaningful personal baselines.
3. Voice question → Gemini tools → Tiger evidence → spoken explanation works repeatedly.
4. Historical seeded content is labeled internally and clearly explained in the demo.
5. API failures, poor signal, permission denial, and missing history have useful UI states.
6. The full 90-second script runs repeatedly from a clean start without developer intervention.

## Deferred commands

Add `pnpm db:migrate`, `pnpm seed:demo`, and `pnpm seed:clear` when their implementations exist. Do not advertise successful no-op commands. API deployment and desktop installer creation are separate features from compiling application output.
