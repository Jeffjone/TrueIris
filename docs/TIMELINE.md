# Today timeline

Feature 5 presents saved history from Tiger Data. Open Timeline, select a history source, then inspect a point or period. History can be viewed while saving and sensing are off. No camera starts when opening the timeline, and no sample history is inserted automatically.

## Reading the day

The display defaults to the computer's IANA timezone. The timezone selector changes both the displayed clock and the UTC range defining **Today**. Local calendar boundaries account for 23-hour and 25-hour daylight-saving days; measurements remain canonical UTC in storage. Today extends from local midnight to the latest refresh, with updates every 15 seconds. A date/timezone change resets the current selection while preserving the selected history source. Repeated daylight-saving clock times are distinguished by timezone abbreviations in selection details.

Live Presage, simulated mock, and demo-seed history are queried separately. Live is the default. Mock/seed views remain explicitly labeled; an empty live history never falls back to simulated values. Demo seeding itself remains a later feature.

Activity occupies its own band above three aligned physiological tracks: pulse (bpm), respiration (/min), and HRV RMSSD (ms). Each track uses its own labeled scale. Dots/lines show **30-second means**, with min–max bars showing variation inside that summary. A point is a time-window summary, not a fabricated instantaneous reading. Means exclude poor/unavailable quality, talking, and values below the existing metric confidence thresholds (pulse 0.40, respiration 0.45, HRV 0.50). Missing values remain empty. No clinical thresholds or wellness interpretation are applied.

Trends break across missing readings, withheld metrics and sensing sessions. Gray bands indicate absent saved seconds **between observations within the selected range and same session**; amber bands indicate recorded observations with all physiological metrics withheld. A partially missing metric is blank on that metric's track. Space outside recorded spans has no saved observations; it is not automatically classified as a sensor failure. Missing history can reflect sensing off, saving off, or a connection interruption, and the chart does not guess the cause. Gap details never extrapolate beyond the observations available inside a query.

Activity bands come from manually selected labels attached to saved observations. Unlabeled older history stays **Activity not recorded**. Dashed markers indicate contiguous recorded label changes. Feature 6 adds the independent Desktop row for application, idle, optional titles and conservative activity estimates. A sensing session is not treated as a focus session.

## Selection

- Drag horizontally to select a period. Click a nearby summary to inspect its 30-second window; clicking unrecorded space selects a window without inventing observations.
- Focus the chart, use Left/Right to move among recorded summaries, and press Enter or Space to inspect one.
- The labeled Period start/end sliders provide an alternative to dragging, with one-second keyboard increments and spoken local time. Choose **Inspect period** to load those bounds.
- **Zoom to period** narrows the chart. **Reset to Today** restores the day and its selection controls. Changing source clears the previous selection.

Selected-period statistics are queried again from measurements using exact half-open `[start, end)` bounds. They are not averages of already-averaged chart points. Details include metric means/ranges, accepted counts and mean confidence, saved-reading/recorded-second counts, sensing sessions, manual activity periods/changes, and signal gaps. Context and gap lists show their first 12 entries; select a shorter range to inspect the remainder.

Loading, missing configuration, authentication failure, unavailable storage, and empty history have explicit states. Failed refreshes discard previously displayed history. Requests from an earlier source/range cannot overwrite a newer query or a closed view. No private timeline cache is persisted.

## Persistence and query contract

Migration **2** adds an optional fixed activity label to `measurements` and a user/source/time index. Existing rows remain null; epoch context columns remain deferred. Run `pnpm db:migrate` on an existing installation before using the new build. `/health` now requires migration 3 and the actual measurement hypertable.

Live selection updates main through a named validated IPC operation. Main stamps the label only on new opted-in measurements. A label change neither retroactively changes a saved observation nor queues the currently displayed reading again. Retries preserve the original label with the event ID. The current choice survives routes and stop/restart, and clears with reload, renderer crash or window close. Export includes recorded labels; deletion removes them with the measurements.

Authenticated `GET /timeline?start=<UTC ISO>&end=<UTC ISO>&source=live|mock|demo_seed` binds reads to the API's server-owned user. Clients cannot supply another user ID. Positive ranges are bounded to 26 hours (including a 25-hour local day). Main owns the token and private transport; renderer and native sensor worker receive no credentials. Input, IPC and response contracts use strict Zod schemas. Remote transport requires HTTPS, redirects are refused, and failures contain no private SQL or credentials.

The repository queries parameterized SQL in one read-only repeatable-read transaction. Thirty-second bins are per session/source; activity and gap periods retain observation timing. The summary counts accepted observations directly, so partially populated windows are weighted correctly. Display limits are 6,000 summaries, 3,000 activity periods and 3,000 gaps. A `limited` response explicitly marks the chart/context partial while its summary still covers the full range; shorter selection retrieves more detail. Database connection establishment is bounded to five seconds, SQL has a five-second statement deadline, and main uses a ten-second request deadline. The route shares the authenticated API quota.

## Verification

`pnpm check` covers strict contracts, authentication/scoping, private transport, DST/UTC boundaries, segmentation across sessions/gaps/missing metrics, context changes, serialization, formatting, lint, types and production builds.

`pnpm test:integration` launches built Electron against isolated fixture APIs to verify source selection, empty/configuration/offline/malformed responses, keyboard/pointer/slider selection, zoom/reset, context/gap details, display limits and compact layout. Screenshots are explicitly mock and stay in ignored `test-results/`; tests use no camera or developer credentials.

`pnpm test:database` verifies migration idempotency, scoped real Timescale summaries, null/confidence/quality behavior, exact period boundaries, persisted labels, gaps, overlapping sessions, source/owner separation, all display limits and deletion with random fixture owners. `pnpm test:persistence` verifies the built desktop → authenticated API → configured Tiger Data → rendered selected timeline, using new mock readings and a random fixture owner. Both clean only their test owners.

## References

- [PostgreSQL date_bin and timestamp functions](https://www.postgresql.org/docs/16/functions-datetime.html)
- [PostgreSQL lag and window functions](https://www.postgresql.org/docs/current/functions-window.html)
- [React effect cleanup and asynchronous requests](https://react.dev/reference/react/useEffect)

## Desktop context overlay (Feature 6)

The **Desktop** row shows independent context intervals on the same axis as physiology, with source/owner/time scope and missing observations preserved. Changes in application, activity, optional title, idle and focus are marked; periodic 30-second chunk boundaries are not changes. Context-only periods display the chart with empty physiological metrics. Selected-period details show app, optional title, confidence/reason, manual selection and idle/focus/session/switch metadata, clipped to the requested bounds.

Migration 3 adds separate context sessions and intervals. Timeline reads at most 3,000 intervals in its existing repeatable-read transaction and sets `limited` when details exceed the cap. Independent context sessions never inflate sensing-session counts or relabel measurements. Captured context and physiology correlate through owner, selected source and time overlap. The native provider records `live`; test context remains `mock`. See [desktop context](DESKTOP_CONTEXT.md).

## Personal comparison (Feature 8)

Select a point or period to reveal **Compare with your history**. Choose an activity or local time of day and click **Compare baseline**. References use only earlier history of the selected source, with explicit sample/date counts and insufficient-history states. Changing selections/context or refreshing history clears previous comparisons. See [personal baselines](PERSONAL_BASELINES.md).
