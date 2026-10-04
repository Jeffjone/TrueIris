# Iris companion interface

The home screen centers Iris, a baby-blue CSS blob with blinking eyes, pointer-following pupils, a smile and subtle breathing motion. Six smaller, faceless blobs form a symmetrical orbit linking Live, Timeline, Patterns, Ask Iris, Experiments and Settings. Detail pages use the same pastel palette and compact blob navigation with a direct return to Iris. No external image, font or animation service is required.

## Talking

Click Iris to start the existing ElevenLabs → Gemini → cited answer → spoken response pipeline directly from the user gesture. The surrounding navigation disappears during the interaction. Click Iris again while listening to finish the question; while transcribing, analyzing or speaking, click to stop. **Done for now** stops voice, cancels outstanding reasoning, clears the local answer and brings the surrounding views back. Escape works while the central button is focused.

Live transcripts, microphone state, provider failures and cited answers remain visible. A typed question is available in the focused view if voice is unavailable. Voice stops on navigation/unmount, reload, lock and suspend using the existing resource guards. Nothing listens on app startup. The home view uses live saved history normally and clearly labeled generated history/UTC in demo mode. The existing Ask Iris page remains available for source/timezone selection.

## Recording

Choose **Record my activity**, optionally select an activity and choose whether to save, then click Iris. This starts independent desktop app/idle context capture; camera sensing stays under Live/Settings controls. Clicking Iris again stops context. Saving is off by default; the home checkbox explicitly enables the existing authenticated storage pipeline. It includes other active observations, as disclosed. Recording controls retain real/mock provenance and title settings; window titles remain off by default.

You can switch back to **Talk with Iris** while activity records in the background. **Done for now** stops the activity session started from home as well as voice.

When home enabled saving for its session, stopping that session turns saving off. Saving already enabled in Settings remains under the user's existing control. Failed startup rolls back newly enabled saving, and navigation during startup prevents delayed capture. Global capture/saving status and Stop controls stay visible across routes. Sample-week navigation remains available from demo home without mixing sources or changing dataset preparation.

## Accessibility and validation

Iris is a native button with an action-specific accessible name. Views are native links; hidden navigation leaves the keyboard/accessibility tree. Focus outlines, Enter/Space activation, visible completion controls and reduced-motion support accompany the animations. The layout supports compact windows without horizontal page overflow.

Built Electron checks cover initial capture-off state, faceless navigation, click-to-listen, unavailable-provider text fallback, transcripts and cited answers with test providers, activity capture with optional saving, stopping/recovery, keyboard use and reduced motion. Existing integration checks continue to cover sensing, contexts, storage, timelines, experiments, demo provenance and voice interruption. Tests do not send personal recordings to real providers.
