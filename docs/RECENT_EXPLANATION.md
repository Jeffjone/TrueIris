# Explain the last 30 minutes

Open **Ask Iris**, choose the saved history source and timezone, then click **Explain last 30 minutes**. Typing **“Iris, explain the last 30 minutes.”** (or “Explain last 30 minutes”) uses the same workflow. The action sends the question and requested evidence to Gemini under the existing visible disclosure. It never starts sensing, context capture, saving or voice.

## Evidence and narrative

The API fixes `asOf` once when it receives the request. The explanation window is exactly `[asOf − 30 elapsed minutes, asOf)`, independent of midnight, timezone and daylight-saving changes. Source and owner remain server-bound. A response includes a validated `explanationRange`; main/preload reject a forged or inconsistent highlight.

Gemini chooses the order of bounded tool calls and the facts to narrate. This dedicated workflow requires eight retrievals before a completed answer:

- Context and all three metric summaries for the pinned window.
- Personal pulse, respiration and HRV comparisons using the earlier 30-day baseline.
- Up to three earlier activity-matched sensing periods, excluding the explained window.

Returned manual measurement labels select an activity reference only when they have one consistent non-null label and chart detail is complete. Mixed/unlabelled/limited history uses the local time-of-day at the window's start; comparisons explicitly name that subset, including when the window crosses a daypart. Historical sessions match saved manual labels and recency. They do not establish physiological or semantic similarity; semantic memory remains Feature 11.

The tool loop rejects unrelated periods, guessed baseline contexts and premature final answers. If Gemini emits more than four parallel functions, none are executed; bounded feedback asks it to split the plan while preserving every call ID. Completed answers must include facts from metrics, context, baselines and historical sessions. Missing/limited/unavailable evidence is retained automatically. One request-local history snapshot serves context and metric tools, and a single baseline query serves the three comparisons. These caches disappear with the request. Provider/storage failures return available cited evidence as a clearly partial answer; unknown time is never filled with invented measurements.

The narrative uses the existing verified descriptive sentences and citations. Pulse comparisons can describe the first accepted matching epoch relative to the personal baseline and the first later saved epoch closer to it, with exact elapsed time. These require at least 15 accepted pulse readings per epoch, a supported baseline and matching stored activity or local daypart. They stop at a sensing-session boundary, withhold limited detail, and explicitly distinguish sparse observations from a continuous trend. The first saved value is not assumed to be the window's starting value. Respiration and HRV describe measured means/ranges and personal comparisons, without diagnoses, causal claims or stress/focus labels. No similarity narrative is fabricated from a matching activity label.

## Timeline highlight

The cited narrative and an **Explanation timeline** appear together in Ask Iris. The chart uses the existing authenticated timeline bridge to load the exact returned UTC window and source once. The entire 30 minutes are highlighted initially; dragging or arrow keys/Enter can inspect a recorded epoch, and **Highlight all 30 minutes** restores the full selection. Dates, local times, timezone and source are visible, including windows spanning midnight. Recorded gaps remain visible. Chart retrieval failure leaves the evidence available and reports that the chart could not load.

The chart does not refresh automatically while the answer is visible. Late saved observations can be included in its initial fetch, so it is a scoped visualization rather than the numerical source of the already cited answer. A new explanation fixes a new window. Source/timezone changes, clear, navigation and reload clear the answer and highlight. Cancellation and deadlines use the existing agent controls. Voice remains off until its own implementation.

## Validation

`pnpm check` covers schema bounds, command recognition, midnight/DST elapsed-time invariance, scope and required-tool enforcement, snapshot reuse, activity/daypart selection, source separation, sparse coverage, cross-session/low-count/limited epoch handling, zero and missing baselines, failed retrieval and forged highlights.

`pnpm test:integration` drives the built Electron one-click and typed flows, cited narrative, source changes, actual SVG selection, reset, narrow layout and clearing. `pnpm test:persistence` exercises the built desktop, authenticated API and real configured Tiger Data service with random fixture owners and explicitly mock reasoning, including saved current history, earlier baselines, historical sessions and the highlighted explanation. It cleans up those owners only.

`pnpm test:gemini` explicitly tests the real configured model with synthetic in-memory fixtures for both a general multi-step question and this eight-retrieval explanation. Ordinary automated tests do not contact Gemini, and the live check sends no private recordings. Only status/turn/tool metadata is printed. See [Gemini agent configuration and privacy](GEMINI_AGENT.md).
