# Dedicated demonstration data

Feature 19 supplies deterministic illustrative history for baselines, coding/day comparisons, activity-matched sessions, sample episode summaries, experiments and pattern cards. Every generated observation, context interval, epoch, episode and experiment carries `demo_seed` provenance. Nothing is represented as genuine user history. The prepared dataset contains seven prior UTC days plus five recent periods, including a thirty-minute coding trajectory ending one minute before generation. Thirty-second epochs are calculated with the production aggregation rules.

The fixed generator version, owner namespace and minute-aligned reference time determine IDs and pseudorandom values. Identical inputs produce identical records. A manifest links pattern cards and authored summaries to exact source-scoped episode ranges, sample counts and aggregate values. The music experiment contains seven fictional condition assignments and focus ratings. Differences are intentionally designed to demonstrate the comparison UI; they are not findings about music or a real person. Physiology deviations are computed by the existing baseline service when seeding, with insufficient earlier support left absent.

## Setup and commands

Keep database credentials and the existing private token in the ignored root `.env`. Run `pnpm db:migrate` explicitly. Migration 5 adds `demo_datasets`; readiness now requires version 5. Seed commands require `TRUEIRIS_DEMO_MODE=true` and use `TRUEIRIS_DEMO_USER_ID` (default `00000000-0000-4000-8000-000000000019`). This identity must differ from `TRUEIRIS_USER_ID`. They never seed or clear the ordinary account.

```bash
TRUEIRIS_DEMO_MODE=true pnpm seed:demo
TRUEIRIS_DEMO_MODE=true pnpm seed:clear
```

On Windows, set the variable in your shell or root `.env` before running `pnpm seed:demo` / `pnpm seed:clear`. Credentials never belong in `.env.example` or command arguments. Startup does not migrate automatically.

Seeding is one owner-locked transaction: readers cannot observe a partial dataset, failed writes roll back, and concurrent writes/deletion serialize. An identical minute/version is idempotent. A later seed refresh replaces only the previous manifest's generated sessions and prepared experiment; live/mock captures and independently created records are preserved. Refresh resets the prepared sample experiment, including sessions manually added to that managed experiment. Create a separate experiment to keep independent work.

`seed:clear` removes only `demo_seed` measurements, epochs, context, experiments/sessions and manifest for the demo identity. Real/mock records and other owners remain intact. Settings' full-history deletion also removes the manifest, as part of its existing owner-scoped deletion. No provider call or capture occurs during seeding/clearing. There is no silent replacement of an unavailable database with in-memory history.

## Episode summaries and patterns

The `search_memories` tool can retrieve authored sample summaries by keyword only when the selected source is `demo_seed` and its authenticated owner has a manifest. Its evidence explicitly states that semantic embeddings and real episodic memory remain unimplemented. This prepares demonstrable episode metadata without claiming Feature 11 is complete. Existing similarity retrieval remains activity/recency based. Pattern cards describe generated associations with linked sessions and dates; this does not implement the general personal-pattern mining features.

Feature 20 now adds automatic preparation and the dedicated presentation UI; see [demo mode](DEMO_MODE.md). Outside that mode, ordinary capture, history and provider behavior stay under their existing controls.

## Validation

`pnpm check` verifies deterministic generation, source contracts, exact aggregation, unique owner namespaces, fictional experiment inputs and demo-only summary retrieval. `pnpm test:database` seeds isolated fixture owners against real Timescale SQL and checks idempotency, exact timeline means, supported earlier baselines, seven-session comparisons, managed refresh, source-only clearing and live/mock/foreign preservation. Existing desktop and persistence suites verify that migration 5 preserves the working architecture.
