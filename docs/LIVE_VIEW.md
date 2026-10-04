# Live view

Feature 3 presents the normalized Feature 2 sensor stream in a single physiological surface: dominant pulse, respiration, HRV (RMSSD), per-metric confidence, and plain-language signal quality. Missing or withheld values stay as dashes. Mock readings retain their visible simulation labels.

The signal state takes precedence over a previous quality label. The view distinguishes excellent/good signal, low confidence, calibration, no face, lighting/motion/positioning, talking, stale data, and camera/connection failures. Confidence percentages describe measurement confidence, not wellness scores. TrueIris makes no stress or medical interpretation.

Subtle halo motion appears only while an accepted pulse is present. It is decorative signal activity, not an ECG or measured pulse waveform. Number changes use a short arrival transition without inventing intermediate values. Both effects stop under `prefers-reduced-motion` and halo activity stops when values are withheld or sensing stops. Signal text is announced politely; changing numeric readings and the session clock do not generate repeated screen-reader announcements.

## Context and duration

**Current activity** is an optional manual selection, explicitly labeled **Selected by you**. It stays in renderer/main memory across routes and sensor stop/restart, and clears on document reload. Feature 5 attaches the choice to new measurements only while saving is enabled, so [the timeline](TIMELINE.md) can show recorded activity periods. It is not inferred or logged, and a later choice never relabels history. **Current application** shows **Context off** because OS detection belongs to Feature 6; no foreground application is invented.

**Session duration** uses `SensorSnapshot.startedAt`, assigned by main when the provider reports ready. It counts the current sensing session, including calibration and temporary signal gaps. React updates elapsed time once per second from that UTC timestamp, so leaving Live and returning preserves elapsed time. Stop/error clears the clock, and a new session gets a new start. Pending permissions/native startup have no elapsed sensing time. This is a sensing session, not a focus timer or historical record.

The layout adapts from a full desktop row to stacked signal/context bands in compact windows. Narrow layouts retain an always-visible capture status and Stop control outside the scrolling content. Electron still opens with its existing minimum desktop dimensions.

## Verification

`pnpm check` covers types, unit tests, formatting, lint, and builds. `pnpm test:integration` covers realtime mock metric changes, confidence/withholding, calibration and failure states, duration across navigation and restart, manual selection, 1180/700/390-pixel layouts, and reduced motion. Test screenshots contain only labeled mock values and remain in ignored `test-results/`. Hardware-independent tests never use the local Presage key or open the camera.
