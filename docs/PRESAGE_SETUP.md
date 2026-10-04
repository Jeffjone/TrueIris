# Presage sensor setup

Feature 2 uses `@smartspectra/node-sdk` **3.4.0**. Native camera frames stay in a main-owned Electron utility process. React receives validated readings and status through the secure preload. Nothing is persisted by TrueIris in this feature.

## Start a live session

1. Install dependencies with the pinned pnpm version. Keep the SDK, platform runtime package, and koffi runtime present; the approved build scripts are in `pnpm-workspace.yaml`.
2. Put `PRESAGE_API_KEY` in the ignored root `.env`, never `.env.example`. Restart Electron after changing configuration. Confirm your key has access to pulse, respiration, HRV, and talking; unsupported metrics remain absent.
3. Run `pnpm dev`, or `pnpm build` followed by `pnpm start:desktop`.
4. On Live, choose **Presage camera**, review the data disclosure, and click **Start camera sensing**. Allow the macOS camera prompt if shown. Center one face, use even lighting, sit still, and pause speaking.
5. Wait for stabilization. A genuine measurement displays a pulse number and accepted confidence. Respiration and HRV may need longer warm-up or different plan access; missing values are shown as a dash.
6. Click **Stop sensing** or the sidebar **Stop sensor**. The reading clears and status returns to **Sensing is off**. Restart requires another explicit start.

Camera access never starts from environment configuration alone. Closing the window, quitting, reloading the document, or a renderer crash also stops sensing. Switching hash routes preserves capture and the sidebar status/Stop control.

Presage runtime platforms are macOS Apple Silicon, Linux x64/ARM64 (glibc 2.35+), and Windows x64. The current project was hardware-tested on macOS Apple Silicon; other platforms need native verification. On macOS, denied/restricted access is shown explicitly; re-enable Electron/TrueIris under System Settings → Privacy & Security → Camera. On other platforms, native input-unavailable errors become **Camera unavailable**; check OS permissions and camera contention.

## Quality and freshness

Vendor confidence is a percentage, normalized to 0–1. Each value must be finite, stable, and meet its own SDK confidence minimum: pulse 40%, respiration 45%, HRV 50%. Pulse must be positive; respiration/HRV may be zero when valid. These are signal acceptance gates, not medical interpretations.

Cached pulse/talking expire after 5 seconds, respiration after 10 seconds, and HRV after 15 seconds, using each sample's absolute microsecond Unix timestamp. A one-second future skew tolerance handles small clock differences. Older partial packets cannot replace newer values. Losing face/lighting/position validation clears cached measurements; fresh measurements are required after recovery. Stable talking detection withholds physiological values. A silent provider clears the current reading after 5 seconds.

The overall label is a TrueIris display heuristic: **Excellent** requires all accepted metric confidences to be at least 80%; **Good** includes accepted values below that; **Low confidence** indicates at least one fresh rejected metric; no accepted value is unavailable/calibrating. A valid independent metric may remain visible when another is rejected. No rejected value is shown as authoritative, and missing data is never fabricated.

## Explicit mock provider

Choose **Mock · no camera** and **Start mock sensor**. The UI labels the stream, every reading has `source: mock`, and no native SDK, camera permission, or Presage connection is used. Outside dedicated demo mode, there is no automatic mock fallback.

`TRUEIRIS_SENSOR_PROVIDER=presage|mock` chooses the initial selector only. `TRUEIRIS_MOCK_SENSOR_SCENARIO` supports `steady`, `no_face`, `low_confidence`, `lighting`, `motion`, `talking`, `network`, `no_camera`, and `permission_denied`. Restart after changing scenarios. `TRUEIRIS_DEMO_MODE` does not start capture. Feature 20 allows a clearly labeled mock fallback only after an explicitly started Presage session fails in demo mode; see [demo mode](DEMO_MODE.md).

## Failure states

Missing credentials, unsupported architecture, unavailable native library, denied permission, missing camera, auth/credit failures, and network/server errors receive sanitized UI states. No vendor message or key is exposed. Low lighting, motion, no/multiple faces, positioning, talking, unstable samples, and stale readings clear or withhold affected measurements. Stop and reconnect after fatal failures; restart TrueIris if native teardown failed. A replacement native session cannot start until teardown completes.

Native startup is bounded to 30 seconds. Stop requests await SDK `stopAsync()` and `destroy()` in the worker; after 5 seconds main kills a stuck process and waits another second for exit. Camera frames and arbitrary SDK logs never reach the renderer or application logger.

## Data disclosure

The SDK processes frames on-device. Its automatic insight dispatch can send derived pulse, respiration, and HRV series plus request metadata to Presage's gateway and onward to its LLM service. TrueIris shows this disclosure before start, disables optional diagnostic telemetry, and does not request or display vendor insights. Disabling telemetry does not disable insight transport. See [privacy inventory](PRIVACY.md), [Presage insight privacy](https://smartspectra.presagetech.com/docs/llm-insights/), and [telemetry settings](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/).

## Verification and packaging

Run `pnpm check`, then `pnpm test:integration`. Automated tests do not use the local key or capture live video; real camera acceptance is a separate manual check. On October 3, 2026, the built Apple Silicon app displayed a genuine live pulse with accepted confidence and stopped successfully. A second 90-second session confirmed live pulse, accepted respiration, and talking-state transitions. A valid live HRV value was not independently verified. No raw frames or user measurements were recorded for that check.

`pnpm build` produces runnable desktop bundles, including `out/main/presage-worker.js`; it does not produce installers. Future packaging must retain worker/shared chunks and the SDK JS dependencies, unpack koffi's native module, and copy the complete matching runtime package closure to `resources/smartspectra`. Packaged main sets `SMARTSPECTRA_CAPI_PATH` to that directory's `libsmartspectra_capi.dylib`, `libsmartspectra_capi.so`, or `smartspectra_capi.dll`. Copy dependent libraries/resources too, not just the entry library. macOS installers need `NSCameraUsageDescription` and signing/notarization compatible with the native library. Review [official Node/Electron packaging guidance](https://smartspectra.presagetech.com/docs/nodejs/) before adding an installer configuration.
