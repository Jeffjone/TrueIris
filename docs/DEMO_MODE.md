# Dedicated demo mode

Feature 20 runs a separate demonstration identity, prepares seeded history automatically and presents a clean walkthrough while preserving actual realtime provenance. The ordinary account and its observations remain separate. Normal mode has no automatic sensor or database fallback.

## Launch

Configure the existing database/private token, Presage, Gemini and ElevenLabs settings in the ignored root `.env`. Apply `pnpm db:migrate` explicitly; demo preparation needs migration 5. Then use either command:

```bash
pnpm dev:demo
# Or production bundles:
pnpm build
pnpm start:demo
```

These launch API and desktop with `TRUEIRIS_DEMO_MODE=true` without editing your `.env`, and remove an inherited editor `ELECTRON_RUN_AS_NODE` setting so Electron starts normally. Alternatively set that variable in `.env` and launch normally. Both processes must use the same mode. The API binds its token to `TRUEIRIS_DEMO_USER_ID`, which must differ from `TRUEIRIS_USER_ID`. Main tags private HTTP/WebSocket requests with its configured mode; mismatched modes are rejected before storage or reasoning. Saving in demo mode also checks the API's demo capability before enabling. No renderer can choose an owner identity or receive credentials.

The API prepares the dataset once on startup, using the real configured Tiger Data service. It serves explicit preparing, ready, empty and unavailable states. Concurrent prepare requests join the same operation; the database transaction is atomic. There is no in-memory database substitution and no automatic Gemini/ElevenLabs fallback. A failed preparation has a useful visible state and a **Prepare sample history** action in Diagnostics. Startup never migrates automatically. Fresh preparation replaces managed sample sessions/experiment only, preserving current live/mock capture and independently created records. Global deletion stays cleared during that run; a new demo launch or explicit prepare generates fresh sample history again. Requests accepted before a full-history deletion cannot restore the seed afterward.

## Walkthrough

1. **Iris home** opens with the animated blue companion and six surrounding views. Click Iris to talk; optional activity recording has its own mode. **Explore your sample week** opens the historical overview. Historical samples are always labeled generated; current observations retain their actual source.
2. **Live** offers **Start live signal** and independent **Start desktop context**. The camera and app/idle observations require explicit actions; titles, microphone capture and automatic observation saving remain off by default. Stop and actual capture/saving status stay visible across routes.
3. **Timeline** defaults to `demo_seed` and UTC. Choose a sample day from the week overview or date control, inspect ranges, compare with earlier coding/time-of-day baselines and reconstruct events. The dataset is generated, even when current camera readings are genuine.
4. **Ask Iris** defaults to sample history and UTC, with three predictable example questions: last thirty minutes, today's coding/baseline comparison and sample coding episode summaries. The normal Gemini evidence/citation pipeline runs, and spoken questions reuse ElevenLabs. Start voice explicitly. History facts and the view disclose generated evidence; sample summary retrieval is keyword-based, not semantic embeddings.
5. **Patterns** shows evidence-linked illustrative associations, session/date support and authored summaries. These are generated examples, not personal discoveries or medical conclusions.
6. **Experiments** includes the prepared seven-session Music / No Music comparison with fictional ratings and practical thresholds. Its form is collapsed initially to keep the prepared report easy to present. Sample differences illustrate the result states; they do not establish a treatment effect.
7. **Diagnostics / Settings** exposes API, database and provider configuration indicators, detailed capture controls, saving/export/delete controls and preparation/refresh. API health and provider selectors stay outside the presentation pages. Key presence means configured, not proof of provider health; no secret values are shown.

## Sensor fallback

Demo mode first attempts Presage on **Start live signal**. Healthy readings remain `live`. A terminal start/runtime failure or a previously active stream becoming stale triggers teardown, then a new mock session with a new session ID and `mock` provenance. The visible status says **Demo fallback · simulated · no camera** and the original sanitized failure category remains available in Diagnostics. Poor lighting, missing faces and ordinary quality issues do not trigger replacement. There is no fallback loop from mock back into Presage; Stop then Start retries the live provider.

The generation/cleanup guard cancels a pending fallback on Stop, reload, crash, close, quit, screen lock or suspend. Failed teardown prevents replacement capture. No worker starts before an explicit user action. The genuine provider remains the normal default outside demo mode. Context capture remains independent and uses the configured real OS adapter by default; an explicitly configured test context adapter stays labeled mock.

## Validation

`pnpm check` covers preparation single-flight/failure/clearing, scoped authenticated routes, mode mismatch, bounded transport, Presage preservation, fresh-session fallback, stale streams, quality issues, cancellation and failed teardown. `pnpm test:integration` checks ordinary behavior and the offline demo without capture credentials. `pnpm test:demo` uses isolated synthetic owners with real Tiger Data and built Electron to verify automatic preparation, saving current mock readings without relabeling them, prior-day history, pattern evidence, cited explanations, prepared experiments and narrow layout. CI runs that check against its isolated Timescale container.

`pnpm test:demo:live` explicitly uses configured Gemini and real Tiger Data to verify all three sample questions. Only isolated generated data goes to Gemini; fixture owners are deleted afterward, and raw provider responses/prompts/credentials are not printed. Current real camera acceptance remains hardware-dependent and user-started. Existing voice/live-provider validation is described in their respective setup guides.
