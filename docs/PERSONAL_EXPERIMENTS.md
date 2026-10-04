# Personal experiments

Feature 17 adds lightweight, user-defined comparisons in **Experiments**. Create a hypothesis, name two conditions (for example Music and No Music), select measures and practical difference thresholds, and set a session target. The default target is seven; the allowed range is 6–200. Source, timezone, baseline activity, conditions and criteria are fixed at creation. Start a new experiment to change them. Status can be active, paused or completed; only active experiments accept sessions.

Record completed start/end periods and assign their condition yourself. A focus rating from 1 to 5 and notes are optional. This explicit action saves the session even when automatic observation saving is off. Recording starts no sensing or focus timer. Duration is the elapsed time of your reported range, not an inferred focus score. Sessions from before experiment creation are allowed and labeled retrospectively selected. Session inputs use the computer timezone; evidence and comparison dates use the experiment timezone. You can remove incorrect sessions and delete the entire experiment.

## Evidence and comparisons

Supported measures are reported duration in minutes, optional self-reported focus, pulse deviation from baseline and HRV deviation from baseline. Physiology is computed by the server from saved, accepted readings of the experiment's source and matching activity, using the existing 30-day earlier personal baseline. Selected sessions are excluded from their own baseline. Signed deviations are percentages relative to that reference; comparison thresholds use percentage points. A physiology value needs a ready baseline, at least 20 matching accepted readings and readings covering at least half the reported duration at the saved one-per-second cadence. Missing ratings, missing physiology and unsupported baselines remain absent and do not contribute zeros.

Each measure has separate eligibility. A comparison needs the target number of eligible sessions, at least three per condition and at least two local dates per condition. Results show counts, dates, means and observed ranges. Conditions receive equal weight per eligible session; a longer recording does not supply extra independent sessions.

The four result states use a deliberately descriptive rule:

- **Insufficient data:** the eligibility, session or date requirements are unmet.
- **Meaningful observed difference:** every observed pairwise difference between the second and first condition reaches the predefined threshold in the same direction.
- **No meaningful observed difference:** every observed pairwise difference lies strictly inside the positive/negative threshold.
- **Observed association:** enough sessions exist, but observed variation straddles those boundaries.

The mean difference is second condition minus first. The pairwise difference range is `[minimum second − maximum first, maximum second − minimum first]`. This is an observed range, not a confidence interval or significance test. “Meaningful” describes a user-selected practical threshold in these recordings. It does not establish causality, medical significance, statistical certainty or an improvement. Selection, condition order, missing ratings, activity and other unmeasured factors can confound results. Retrospective labeling adds selection bias. Use comparable sessions and record both conditions across multiple dates.

Session metrics and baseline support are immutable snapshots taken when you save the session. Later-arriving observations do not silently change them. Remove and record the session again if you need a new snapshot; removal changes the eligible sample counts and can return a comparison to Insufficient data.

## Storage, privacy and setup

Run `pnpm db:migrate` and restart the API/desktop. Migration 4 adds owner/source-scoped `experiments` and `experiment_sessions`, immutable definition and evidence JSON, ratings, notes, indexes and a cascading foreign key. Existing history is preserved. Experiment storage was introduced in migration 4; current readiness requires migration 5. No additional credential or environment setting is needed: the existing verified TLS database connection and private owner-bound API token are reused.

Named `experimentAction` and `exportExperiment` IPC capabilities validate strict contracts. The authenticated `/experiments/action` endpoint binds every action to the server's owner; clients cannot provide identities or calculated metrics. Owner-row locking serializes mutations, observation writes and deletion, including across API instances. Evidence queries reuse the locked transaction's connection so concurrent retries cannot exhaust the pool while its lock holder waits for another connection. Exact retries are idempotent; other overlapping periods within one experiment are rejected across conditions. Timestamp precision is canonicalized. Limits are 50 experiments per owner and 200 sessions per experiment, with past ranges no longer than 26 hours.

No Gemini, ElevenLabs, camera or desktop capture is invoked by this feature. Hypotheses, notes, condition labels, ratings and derived evidence are private saved metadata; they are not logged or sent to reasoning providers. Native **Export experiment** writes the selected definition, sessions and comparison report as JSON with private file permissions and an atomic replacement. Export disables automatic observation saving. Keep this local file private; history deletion cannot remove exports you saved elsewhere. Settings' global deletion removes experiments and sessions with both observation histories. The existing deletion watermark blocks replay of previously deleted session ranges. Individual experiment/session removal is immediate and scoped.

## Validation

`pnpm check` covers contracts, all four result states, per-measure missingness, date support, ownership/source/status/overlap gates, canonical idempotent retries, authenticated API actions, bounded main transport and private atomic export/cancellation. `pnpm test:integration` exercises the built desktop from definition creation through seven labeled sessions, comparisons, overlap rejection, pause/resume, reload, export, session removal, narrow layout and deletion without starting capture. `pnpm test:database` uses isolated synthetic owners against real Timescale SQL, including concurrent retries beyond pool size, source/owner isolation, deletion and replay protection. The in-memory experiment adapter is explicitly injected by tests and is never a production fallback.
