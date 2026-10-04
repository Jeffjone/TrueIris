# Tiger Data ingestion

Feature 4 connects normalized sensor readings to authenticated API ingestion, Timescale measurements, and incremental 30-second epochs. Saving is separate from sensing and starts **off on every desktop launch**. The camera can operate without storage or the API. The selected provider stays with the shared session controls across navigation, and active controls always display the main process's actual provider.

## Setup

1. Provision a Tiger Cloud service with TimescaleDB enabled, or a local Timescale PostgreSQL database. Use a dedicated TrueIris database. PostgreSQL alone is insufficient for the migration.
2. Set `DATABASE_URL` in the ignored root `.env`. Remote connections always use TLS with hostname and certificate verification. URL SSL switches cannot disable verification. If your provider uses a private CA, set `DATABASE_CA_FILE` to the local PEM path. Local loopback without a requested SSL mode uses plaintext for development only.
3. Set `TRUEIRIS_INGEST_TOKEN` to a private random value of at least 32 characters. Generate it into `.env` without displaying it. Both desktop main and API use this token; the renderer and sensor worker never receive it. Set `TRUEIRIS_USER_ID` to your UUID, or use the template's single-user default. Each API instance binds its one bearer token to that server-owned identity; clients cannot submit a user ID. Use a different identity and token for a different user.
4. Run `pnpm db:migrate`. It applies versions 1 and 2 under a PostgreSQL advisory lock and transaction, including the Timescale extension, users, sessions, measurements hypertable, epochs and indexes. Version 2 adds an optional measurement activity label and user/source/time index without relabeling existing history. Re-running is safe. Startup does **not** migrate automatically. Existing unrelated tables are not replaced: schema collisions roll back the migration.
5. Restart the API and desktop (`pnpm dev`, or build and start both). In Settings, Tiger Data becomes Connected only when the API verifies the migration version and actual hypertable. Enable saving, then start sensing. Mock recordings stay labeled `mock`; real Presage readings stay `live`.

Keep credentials in `.env` or runtime secrets. No real credential belongs in `.env.example`. For remote API use, set `TRUEIRIS_API_URL` to an HTTPS endpoint. Saving refuses a non-loopback HTTP destination. Public hosting, multi-user authentication, distributed rate limiting, and Vultr configuration remain separate deployment work.

Tiger Cloud initially provisions a private/self-signed certificate while obtaining its publicly signed certificate; this can take about 30 minutes. Retry after provisioning, or configure your trusted provider CA. Do not disable certificate verification to bypass this state. See [Tiger's strict SSL guide](https://docs.timescale.com/use-timescale/latest/security/strict-ssl/). A certificate or database error reports unavailable without exposing credentials. Connection establishment is bounded to five seconds (verified remote TLS/authentication can exceed the previous 2.5-second limit); SQL statements are also bounded to five seconds. Desktop health polling retries while a connection becomes ready.

## Data and aggregation

The desktop main process serializes at most one observation per session per UTC second, truncating its observation timestamp and session origin to canonical ISO seconds. Readings are already normalized by Feature 2; no extra smoothing changes the evidence. Each queued item receives one UUID that remains identical across all retries. Missing metrics remain absent in JSON and SQL `NULL`.

The API accepts strict batches of 1–120 measurements under a 256 KiB body limit, rejects unknown fields and timestamps more than one minute ahead, and applies a quota of 180 authenticated requests per minute per API process. Credentials are compared with `timingSafeEqual`; automatic request/error payload logging is disabled. All SQL values are parameterized. Measurement bodies, raw vendor errors and connection strings are never logged.

A transaction locks the user's row, validates immutable session owner/source/start time, inserts the batch in one SQL statement, and recalculates each affected epoch from the committed candidate measurements. Measurements use `(timestamp, event_id)` as the hypertable primary key plus `(user_id, session_id, timestamp)` uniqueness. A retry or a second event ID for the same session-second cannot replace the first accepted observation. Measurement and aggregate changes commit together. Conflicting sessions roll back the entire batch.

Epochs align to UTC `[start, start + 30 seconds)` and separate user, session and source. Incremental recomputation supports partial windows, out-of-order arrival and late retries, including the last partial session window. Each epoch records mean pulse/respiration/HRV, population pulse variance, measurement count, per-metric accepted counts, coverage, missing seconds and quality score. Missing windows are not invented. Coverage uses the full 30-second denominator, so edge windows can have low coverage; consumers should consider session boundaries. Metric means exclude talking and poor/unavailable quality, then apply the existing sensor thresholds: pulse ≥ 0.40, respiration ≥ 0.45, HRV ≥ 0.50. Quality score is the fraction of non-talking observations with good/excellent quality, independent of individual metric availability. Absent metrics never become zero.

Feature 5 saves an optional manually selected Live activity on new opted-in measurements. Old readings remain unlabeled, and epoch context/activity columns remain nullable pending the context engine. The [Today timeline](TIMELINE.md) derives activity periods from recorded labels and queries exact scoped measurement statistics. Epochs are ordinary tables; minute/hour/day continuous aggregates and baselines arrive when historical query needs justify them. Unique indexes include the hypertable's time dimension as required by [Timescale](https://github.com/timescale/Tiger-Data-Docs/blob/main/src/content/docs/reference/timescaledb/hypertables/create_hypertable.mdx).

## Outages and control

The queue holds at most 300 observations in memory, including its active batch. The timer checks every second, sends up to 30 observations, and normally waits five seconds between successful sends. Failures use exponential delay with jitter (base capped at 30 seconds), with six attempts per batch. Overflow discards the oldest pending observations; exhausted retries discard the uncertain batch and report gaps. HTTP 400/401/403/404/409/413 block saving until the user explicitly disables/re-enables it after correcting the issue. There is no disk-backed private queue or fabricated fallback.

Settings and the sidebar show saving state, queued count and connection interruptions; Settings shows saved count and discarded/unconfirmed count for this launch. Counts include only acknowledgements known to the desktop: a timed-out request might have committed, which is why retries are idempotent. Stop saving discards queued observations and does not erase already stored history. Stop sensing releases the camera while already queued readings may finish saving. Quit releases the camera first, discards the queue and waits for an active request's bounded timeout. Disabling saving does not replay readings previously displayed without consent.

History is retained until explicitly deleted. Export uses a native save dialog, pauses saving, and streams all scoped measurements into a JSON Lines file in pages of 500 with bounded memory. The original observations contain the provenance/confidence/quality needed to recalculate epochs. Export does not restart saving automatically; protect the file as personal data. Export stages a private sibling file and replaces the selected destination atomically on success; failure or quit removes the incomplete file while preserving any previous export. HTTP rate limits and server failures receive bounded retries.

Delete requires confirmation in a native dialog, stops sensing/saving, and atomically removes that user's measurements, epochs and sessions. It retains a deletion watermark on the user row so delayed retries from any old session cannot restore removed records. A new session must begin in a UTC second after that watermark before saving resumes. Provider backups/retention and existing user-exported files remain governed separately.

## Verification

```bash
pnpm check
pnpm test:integration
pnpm test:database
pnpm test:persistence
```

Build before integration or persistence tests. `test:database` requires a configured Timescale service, checks migration idempotency, hypertable readiness, batch duplicate protection, overlapping concurrent epochs, ownership/provenance rollback, export pagination and deletion/replay protection. It creates random fixture owners and cleans only their records. `test:persistence` drives the built desktop with a labeled mock provider through the authenticated API into the real database and verifies persisted measurements/epochs and their selected timeline in the UI, then removes only its fixture user. The real-database desktop check is skipped in ordinary `test:integration`; it is explicitly enabled by its dedicated command.

CI runs both database checks against an isolated Timescale service. The ordinary desktop suite uses isolated credentials and local test servers, exercises offline retry/recovery and private export/delete, and never accesses a developer's keys, real history or camera. The verified real-database path uses normalized mock readings, not a claim of new live-camera verification.
