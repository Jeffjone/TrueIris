# Desktop context engine

Feature 6 adds computer context independently of camera sensing. Choose **Start desktop context** on Live or Settings. Capture and window titles start off each launch. The sidebar reports its state and provides **Stop context** across routes. OS metadata stays in memory unless **Enable saving** is also on.

## Capture and controls

The engine observes about once per second: foreground application identity/name, application switch count, idle seconds, context-session duration and foreground duration. Idle means time since computer input; it does not establish what you are doing away from the computer. Capture stops on sleep, screen lock, document reload, renderer crash, window close and quit. It requires another explicit start after those events. Hash-route navigation keeps the session.

**Include window titles** is a separate, default-off choice. Titles can reveal private document names. On macOS, enabling it may request Accessibility permission; grant permission to the running Electron/TrueIris application in System Settings → Privacy & Security → Accessibility. App-name detection works without this permission. A denied, unavailable or revoked title permission keeps app detection running and reports the title state. Turning titles off clears the current title immediately, stops subsequent title reads and discards old in-flight replies. It does not erase previously consented history. Stop/reload resets title and focus options.

The existing **Current activity** selection remains explicitly **Selected by you**, persists across routes and stops, and clears on reload. It overrides automatic estimates in new context intervals without changing old records. Clearing it restores conservative classification. Manual labels on sensor readings keep their existing semantics; an inferred context label never replaces them.

**Focus mode** records your explicit on/off choice in context. This milestone does not modify notifications or implement the later goal/timer/completion-summary feature.

## Platform support

| Desktop                                        | Foreground identity                                | Optional title                              | Limits                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| macOS                                          | AppKit `NSWorkspace.frontmostApplication`          | Accessibility `AXFocusedWindow` / `AXTitle` | Title permission is separate; no Screen Recording or browser Automation permission needed for app identity |
| Windows                                        | `GetForegroundWindow`, process executable basename | `GetWindowTextW`                            | Protected/unreadable processes can leave application/title unavailable; executable paths are not retained  |
| Linux X11                                      | EWMH active window and `WM_CLASS` through `xprop`  | `_NET_WM_NAME` / `WM_NAME`                  | Requires `xprop` on PATH and an X11 display; bounded commands use argument arrays, never a shell           |
| Wayland / headless / other unsupported desktop | Unavailable                                        | Unavailable                                 | Explicit unsupported state; no guessed foreground application or fallback scraping                         |

Native reads use Koffi 2.16.3 in a main-owned Electron utility process. The worker receives an allowlisted environment without API/database credentials. Each read has a four-second main deadline; AX calls and X11 subprocesses also have shorter native timeouts. Stop kills the worker, and generation/revision guards discard late replies. No webpage DOM, browser history, screenshot, keyboard text, document contents or file contents are read. No OS observation or raw native error is logged.

macOS foreground capture and lock cleanup have been verified in the built desktop on the development machine. Windows and X11 implementations require native smoke verification on their corresponding graphical platforms before claiming the same platform assurance. No native title-permission dialog is automated in ordinary tests.

## Classification and evidence

`classifyActivity({ application, windowTitle, previousActivity, timeOfDay })` is a replaceable pure abstraction returning a fixed activity, confidence and short reason. Known editors suggest Coding; document readers suggest Reading; meeting software suggests Meeting without asserting an active call; study software suggests Studying. An ambiguous browser/application yields Other at low confidence. Opted-in browser titles may provide limited study/meeting clues; reasons do not echo title text. Previous activity and time of day alone never justify a label. Missing application observations produce no inferred activity.

Manual override has confidence 1 as an explicit self-report. Without an override, at least 60 idle seconds suggests Break at 0.8 confidence while explicitly stating that a break is not confirmed. These rule confidences are heuristic strengths, not calibrated probabilities. No physiological/emotional state is inferred from an application.

## Persistence and timeline

Migration **3** adds `context_sessions` and `context_intervals`. Run `pnpm db:migrate` before the new API; health checks require migration 3 and the measurement hypertable. Context has its own session UUID, immutable source and start time, so starting desktop capture does not fabricate a camera session. Real OS observations use `live`; the explicitly configured test provider uses `mock`. The default `TRUEIRIS_CONTEXT_PROVIDER=desktop` uses the OS adapter. `mock` never silently replaces native capture.

Closed half-open `[start,end)` intervals contain a stable UUID, UTC millisecond bounds, application, optional title, manual selection, classified activity/confidence/reason, idle flag/duration, session duration, switch count and focus flag. They split on context changes or at most every 30 seconds. Missing foreground observations or delayed polls create gaps. Saving begins with a fresh observation after consent; stopping saving discards unsent intervals, and re-enabling never replays earlier transient context.

The main process queues at most 120 intervals in memory, including active retries. The same tested bounded queue mechanism handles measurement transport: batches of 30, up to six attempts, exponential jitter, immutable retry IDs, explicit blocked/interrupt states and visible discarded counts. Context counts are displayed separately and included in the global history counts. Closing discards unsent history; an already committed request cannot be undone by turning saving off.

`POST /context/batch` validates 1–60 intervals and rejects unknown fields, bounds over 30 seconds, spoofed identity and excessive future timestamps. The authenticated API supplies owner identity and shares its quota/body limits with measurement routes. A user-row transaction lock serializes ingestion and deletion. Session ownership/source/origin, immutable payloads, within-session overlaps and deletion-watermark replay are checked atomically. Identical retries are acknowledged as duplicates; changed UUID reuse and overlapping intervals conflict. Across owners, global ID conflicts are rechecked after insertion.

Timeline queries return up to 3,000 clipped context intervals in the same scoped repeatable-read snapshot as measurements. The independent **Desktop** row shares the physiological time axis, marks application/activity/focus/idle changes, and preserves missing-context gaps. Period details include app, classification/confidence/reason, optional title, manual origin, idle/focus and session/switch metadata. Context-only periods remain inspectable with empty physiology. The source selector prevents mock context from appearing as live evidence. Context joins physiology through authenticated owner, selected source and interval overlap; a context session is never assumed to equal a camera session. Epoch scalar context columns remain nullable: multiple contexts can overlap one epoch, so this milestone does not assign a misleading single context ID or relabel aggregates. Later analytical queries can use the saved interval composition.

**Export context** streams scoped intervals in JSON Lines pages of 500 using a private temporary file and atomic replacement; **Export history** remains the measurement export. Both turn saving off. **Delete history** confirms then stops camera/context/saving and removes both histories and sessions in one scoped transaction. A minimal owner/deletion watermark retains the full UTC timestamp and blocks late old-session replay, including sessions started in the same second. Exports and provider backups remain outside deletion. Title-bearing exports are personal data.

## Validation

```bash
pnpm check
pnpm test:integration
pnpm test:database
pnpm test:persistence
# Explicit metadata-only native check on a supported graphical desktop:
TRUEIRIS_TEST_NATIVE_CONTEXT=true pnpm exec playwright test tests/integration/context.spec.ts
```

Build before desktop checks. Ordinary tests explicitly use mock context and blank private credentials, and never open an OS title-permission dialog. Unit/API tests cover classification uncertainty/override/idle, consent boundaries, missing polls, interval caps, async teardown/privacy races, strict schemas, authentication and retries. Built desktop tests cover control state, routes/reload, independent camera-off operation, context-only timeline, export and deletion. Real Timescale tests use random fixture owners and cover ownership, source/origin immutability, overlap, concurrent idempotency, rollback, pagination, clipping, context-only ranges, display limits and deletion/replay protection. The real persistence check drives both mock physiology and mock context through the built desktop/API into Tiger Data and renders their timeline; cleanup touches only its fixture owner.

## Native references

- [Apple foreground application API](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)
- [Apple Accessibility UI element APIs](https://developer.apple.com/documentation/applicationservices/axuielement)
- [Microsoft foreground window API](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)
- [Microsoft window-title API](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw)
- [Electron idle and power events](https://www.electronjs.org/docs/latest/api/power-monitor)
- [Koffi pointer and output parameters](https://koffi.dev/output)
- [EWMH active window specification](https://specifications.freedesktop.org/wm-spec/latest/ar01s03.html)
